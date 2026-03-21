const { ImapFlow } = require('imapflow');
const { parseMessage } = require('./parser');

class ImapClientWrapper {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.client = new ImapFlow({
      host: config.imap.host,
      port: config.imap.port,
      secure: config.imap.secure,
      auth: {
        user: config.imap.user,
        pass: config.imap.pass
      },
      logger: false
    });
  }

  async connect() {
    this.logger.info({ host: this.config.imap.host, user: this.config.imap.user }, 'Connecting to IMAP');
    await this.client.connect();
  }

  async disconnect() {
    if (this.client) {
      await this.client.logout().catch(() => undefined);
    }
  }

  async ensureMailbox(mailbox) {
    await this.client.mailboxCreate(mailbox).catch(() => undefined);
  }

  async listUnreadMessages(mailbox) {
    await this.client.mailboxOpen(mailbox);
    const unseen = await this.client.search({ seen: false });
    const messages = [];

    for await (const message of this.client.fetch(unseen, {
      uid: true,
      source: true,
      envelope: true,
      flags: true,
      internalDate: true
    })) {
      const parsed = await parseMessage(message.source, { maxBodyLength: this.config.maxBodyLength });
      messages.push({
        uid: message.uid,
        folder: mailbox,
        flags: Array.from(message.flags || []),
        envelope: message.envelope,
        parsed
      });
    }

    return messages;
  }

  async markSeen(mailbox, uid) {
    await this.client.mailboxOpen(mailbox);
    await this.client.messageFlagsAdd(uid, ['\\Seen']);
  }

  async moveMessage(mailbox, uid, destination) {
    await this.client.mailboxOpen(mailbox);
    await this.ensureMailbox(destination);
    await this.client.messageMove(uid, destination);
  }
}

module.exports = {
  ImapClientWrapper
};
