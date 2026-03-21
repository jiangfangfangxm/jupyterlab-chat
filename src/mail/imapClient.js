const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

class ImapClient {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.client = new ImapFlow(config);
  }

  async connect() {
    await this.client.connect();
    this.logger.info('IMAP connected successfully');
  }

  async close() {
    await this.client.logout();
    this.logger.info('IMAP disconnected');
  }

  async ensureMailbox(path) {
    try {
      await this.client.mailboxCreate(path);
    } catch (error) {
      this.logger.debug({ mailbox: path, err: error }, 'Mailbox create skipped');
    }
  }

  async listUnread(folder) {
    const lock = await this.client.getMailboxLock(folder);
    try {
      const uids = await this.client.search({ seen: false });
      const messages = [];
      for (const uid of uids) {
        const raw = await this.client.fetchOne(uid, {
          uid: true,
          envelope: true,
          source: true,
          flags: true,
          internalDate: true
        }, { uid: true });

        const parsed = await simpleParser(raw.source);
        messages.push({
          uid: raw.uid,
          messageId: parsed.messageId || raw.envelope?.messageId || `uid:${raw.uid}`,
          subject: parsed.subject || raw.envelope?.subject || '',
          from: parsed.from?.value || [],
          to: parsed.to?.value || [],
          date: parsed.date || raw.internalDate,
          text: parsed.text || '',
          html: parsed.html || '',
          flags: raw.flags,
          inReplyTo: parsed.inReplyTo,
          references: parsed.references,
          raw: parsed
        });
      }
      return messages;
    } finally {
      lock.release();
    }
  }

  async markSeen(folder, uid) {
    const lock = await this.client.getMailboxLock(folder);
    try {
      await this.client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
    } finally {
      lock.release();
    }
  }

  async moveMessage(folder, uid, destination) {
    const lock = await this.client.getMailboxLock(folder);
    try {
      await this.ensureMailbox(destination);
      await this.client.messageMove(uid, destination, { uid: true });
    } finally {
      lock.release();
    }
  }
}

module.exports = ImapClient;
