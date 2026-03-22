const config = require('./config');
const logger = require('./logger');
const ImapClient = require('./mail/imapClient');
const SmtpClient = require('./mail/smtpClient');
const FolderManager = require('./mail/folderManager');
const DedupeStore = require('./services/dedupStore');
const { routeTask } = require('./handlers/router');
const { buildSuccessMail, buildFailureMail } = require('./services/resultFormatter');

function getPrimaryFrom(mail) {
  return Array.isArray(mail.from) && mail.from.length > 0 ? mail.from[0] : null;
}

function normalizeReferences(references) {
  if (!references) {
    return undefined;
  }
  return Array.isArray(references) ? references.join(' ') : references;
}

function isSenderAllowed(mail) {
  if (config.filters.allowedFromDomains.length === 0) {
    return true;
  }

  const sender = getPrimaryFrom(mail);
  const address = sender && sender.address ? sender.address.toLowerCase() : '';
  const domain = address.split('@')[1] || '';
  return config.filters.allowedFromDomains.includes(domain);
}

async function processMessage({ type, folder, mail, folderManager, smtpClient, dedupeStore }) {
  const sender = getPrimaryFrom(mail);
  const senderAddress = sender && sender.address;
  const dedupeKey = `${folder}:${mail.messageId}`;

  if (!senderAddress) {
    throw new Error('Missing sender address');
  }

  if (!isSenderAllowed(mail)) {
    throw new Error(`Sender domain is not allowed: ${senderAddress}`);
  }

  if (dedupeStore.has(dedupeKey)) {
    logger.warn({ folder, uid: mail.uid, messageId: mail.messageId }, 'Duplicate message detected, skipping');
    await folderManager.markDone(folder, mail.uid);
    return;
  }

  const result = await routeTask({
    type,
    timeoutMs: config.app.taskTimeoutMs,
    mail,
    logger
  });

  const reply = buildSuccessMail({ type, subject: mail.subject, result });
  await smtpClient.sendReply({
    to: senderAddress,
    subject: `Re: ${mail.subject || `[${type}] Task Result`}`,
    text: reply.text,
    html: reply.html,
    inReplyTo: mail.inReplyTo || mail.messageId,
    references: normalizeReferences(mail.references || mail.messageId)
  });

  await dedupeStore.mark(dedupeKey, { folder, uid: mail.uid, type, senderAddress });
  await folderManager.markDone(folder, mail.uid);
}

async function processFolder({ type, folder, imapClient, folderManager, smtpClient, dedupeStore }) {
  let messages;

  try {
    messages = await imapClient.listUnread(folder);
  } catch (error) {
    if (error && (error.mailboxMissing || error.responseStatus === 'NO')) {
      logger.warn({ folder, type, err: error }, 'Mailbox is missing or cannot be selected, skipping folder');
      return;
    }
    throw error;
  }

  logger.info({ folder, type, count: messages.length }, 'Fetched unread messages');

  for (const mail of messages) {
    const childLogger = logger.child({ folder, uid: mail.uid, messageId: mail.messageId, type });
    try {
      childLogger.info({ subject: mail.subject, from: mail.from }, 'Processing message');
      await processMessage({ type, folder, mail, folderManager, smtpClient, dedupeStore });
      childLogger.info('Message processed successfully');
    } catch (error) {
      childLogger.error({ err: error }, 'Message processing failed');
      if (getPrimaryFrom(mail)?.address) {
        const failure = buildFailureMail({ type, subject: mail.subject, error });
        try {
          await smtpClient.sendReply({
            to: getPrimaryFrom(mail).address,
            subject: `Re: ${mail.subject || `[${type}] Task Failed`}`,
            text: failure.text,
            html: failure.html,
            inReplyTo: mail.inReplyTo || mail.messageId,
            references: normalizeReferences(mail.references || mail.messageId)
          });
        } catch (replyError) {
          childLogger.error({ err: replyError }, 'Failed to send failure email');
        }
      }
      await folderManager.handleFailure(folder, mail.uid, error);
    }
  }
}

async function runOnce() {
  const imapClient = new ImapClient(config.imap, logger);
  const smtpClient = new SmtpClient({ ...config.smtp, from: config.smtp.from }, logger);
  const folderManager = new FolderManager(imapClient, logger, config);
  const dedupeStore = new DedupeStore(config.app.dedupeStorePath, logger);

  await dedupeStore.init();
  await imapClient.connect();

  try {
    if (config.app.smtpVerifyOnStart) {
      await smtpClient.verify();
    }

    await processFolder({
      type: 'websearch',
      folder: config.imap.mailboxes.websearch,
      imapClient,
      folderManager,
      smtpClient,
      dedupeStore
    });

    await processFolder({
      type: 'browser',
      folder: config.imap.mailboxes.browser,
      imapClient,
      folderManager,
      smtpClient,
      dedupeStore
    });
  } finally {
    await imapClient.close();
  }
}

async function main() {
  logger.info({ runMode: config.app.runMode }, 'Mail agent starting');

  if (config.app.runMode === 'watch') {
    const execute = async () => {
      try {
        await runOnce();
      } catch (error) {
        logger.error({ err: error }, 'Scheduled run failed');
      }
    };

    await execute();
    setInterval(execute, config.app.pollIntervalMs);
    return;
  }

  await runOnce();
}

main().catch((error) => {
  logger.error({ err: error }, 'Mail agent exited with fatal error');
  process.exitCode = 1;
});
