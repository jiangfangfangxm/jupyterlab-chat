class FolderManager {
  constructor(imapClient, logger, config) {
    this.imapClient = imapClient;
    this.logger = logger;
    this.config = config;
  }

  async markDone(folder, uid) {
    await this.imapClient.markSeen(folder, uid);
    await this.imapClient.moveMessage(folder, uid, this.config.imap.mailboxes.done);
    this.logger.info({ folder, uid, target: this.config.imap.mailboxes.done }, 'Message moved to done folder');
  }

  async handleFailure(folder, uid, error) {
    this.logger.error({ folder, uid, err: error }, 'Message processing failed');
    if (!this.config.imap.moveFailed) {
      return;
    }

    await this.imapClient.moveMessage(folder, uid, this.config.imap.mailboxes.failed);
    this.logger.warn({ folder, uid, target: this.config.imap.mailboxes.failed }, 'Message moved to failed folder');
  }
}

module.exports = FolderManager;
