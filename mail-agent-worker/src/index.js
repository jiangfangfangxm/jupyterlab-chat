const { loadConfig } = require('./config');
const { createLogger } = require('./utils/logger');
const { sleep } = require('./utils/timer');
const { TaskStateStore } = require('./state/store');
const { ImapClientWrapper } = require('./mail/imapClient');
const { SmtpClientWrapper } = require('./mail/smtpClient');
const { TaskProcessor } = require('./processor/taskProcessor');

function parseArgs(argv) {
  return {
    once: argv.includes('--once'),
    loop: argv.includes('--loop') || !argv.includes('--once')
  };
}

async function runSingleScan({ config, logger, taskProcessor, imapClient }) {
  logger.info('Starting mailbox scan');
  const folders = [config.mailboxes.websearch, config.mailboxes.browser];

  for (const folder of folders) {
    logger.info({ folder }, 'Scanning mailbox folder');
    const messages = await imapClient.listUnreadMessages(folder);
    logger.info({ folder, count: messages.length }, 'Unread messages found');

    for (let index = 0; index < messages.length; index += config.maxConcurrency) {
      const batch = messages.slice(index, index + config.maxConcurrency);
      await Promise.all(batch.map((message) => taskProcessor.processMessage(message)));
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const logger = createLogger(config);
  const stateStore = new TaskStateStore(config.stateFilePath, logger);
  await stateStore.init();

  const imapClient = new ImapClientWrapper(config, logger);
  const smtpClient = new SmtpClientWrapper(config, logger);
  const taskProcessor = new TaskProcessor({ config, logger, stateStore, smtpClient, imapClient });

  logger.info({ mode: args.once ? 'once' : 'loop', config: { ...config, imap: { ...config.imap, pass: '***' }, smtp: { ...config.smtp, pass: '***' } } }, 'OpenClaw Mail Worker starting');

  process.on('SIGINT', () => {
    logger.info('Received SIGINT, shutting down');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    logger.info('Received SIGTERM, shutting down');
    process.exit(0);
  });

  await imapClient.connect();
  if (!config.dryRun) {
    await smtpClient.verify();
  }

  try {
    if (args.once) {
      await runSingleScan({ config, logger, taskProcessor, imapClient });
      return;
    }

    while (args.loop) {
      try {
        await runSingleScan({ config, logger, taskProcessor, imapClient });
      } catch (error) {
        logger.error({ err: error }, 'Mailbox scan failed');
      }
      await sleep(config.pollIntervalSeconds * 1000);
    }
  } finally {
    await imapClient.disconnect();
    logger.info('OpenClaw Mail Worker stopped');
  }
}

main().catch((error) => {
  const config = { logDir: 'logs', logLevel: 'info', debugMode: false };
  const logger = createLogger(config);
  logger.error({ err: error }, 'Fatal error during startup');
  process.exit(1);
});
