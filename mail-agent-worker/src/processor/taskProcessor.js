const { WebSearchExecutor } = require('../executors/websearchExecutor');
const { BrowserExecutor } = require('../executors/browserExecutor');

class TaskProcessor {
  constructor({ config, logger, stateStore, smtpClient, imapClient }) {
    this.config = config;
    this.logger = logger;
    this.stateStore = stateStore;
    this.smtpClient = smtpClient;
    this.imapClient = imapClient;
    this.executors = {
      [config.mailboxes.websearch]: new WebSearchExecutor({ logger, timeoutMs: config.executionTimeoutMs }),
      [config.mailboxes.browser]: new BrowserExecutor({ logger, timeoutMs: config.executionTimeoutMs })
    };
  }

  resolveTask(folder, parsedMail) {
    if (folder === this.config.mailboxes.websearch) {
      return {
        taskType: 'websearch',
        taskText: parsedMail.subject,
        executor: this.executors[folder]
      };
    }

    if (folder === this.config.mailboxes.browser) {
      return {
        taskType: 'browser',
        taskText: `${parsedMail.subject}\n\n${parsedMail.text}`.trim(),
        executor: this.executors[folder]
      };
    }

    throw new Error(`Unsupported folder: ${folder}`);
  }

  async processMessage(message) {
    const { folder, uid, parsed } = message;
    const dedupeKey = this.stateStore.buildKey(folder, parsed, uid);
    const existing = this.stateStore.get(dedupeKey);

    if (existing && ['processing', 'success'].includes(existing.status)) {
      this.logger.info({ dedupeKey, status: existing.status }, 'Skipping duplicate message');
      return { skipped: true, reason: `duplicate:${existing.status}` };
    }

    const { taskType, taskText, executor } = this.resolveTask(folder, parsed);
    await this.stateStore.set(dedupeKey, {
      status: 'processing',
      folder,
      uid,
      taskType,
      messageId: parsed.messageId,
      subject: parsed.subject,
      from: parsed.from,
      startedAt: new Date().toISOString()
    });

    this.logger.info({ dedupeKey, folder, uid, messageId: parsed.messageId, subject: parsed.subject }, 'Processing message');

    try {
      const result = await executor.execute(taskText);

      if (!this.config.dryRun) {
        await this.smtpClient.sendReply({
          to: parsed.from,
          originalSubject: parsed.subject,
          taskType,
          requestText: taskText,
          executionResult: result,
          inReplyTo: parsed.messageId,
          references: parsed.references
        });

        await this.imapClient.markSeen(folder, uid);
        await this.imapClient.moveMessage(
          folder,
          uid,
          result.success ? this.config.mailboxes.done : this.config.mailboxes.failed
        );
      }

      await this.stateStore.set(dedupeKey, {
        status: result.success ? 'success' : 'failed',
        finishedAt: new Date().toISOString(),
        result
      });

      return { skipped: false, result };
    } catch (error) {
      this.logger.error({ err: error, dedupeKey }, 'Failed to process message');
      await this.stateStore.set(dedupeKey, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: error.stack || error.message
      });

      if (!this.config.dryRun) {
        await this.imapClient.markSeen(folder, uid).catch(() => undefined);
        await this.imapClient.moveMessage(folder, uid, this.config.mailboxes.failed).catch(() => undefined);
      }

      return { skipped: false, error };
    }
  }
}

module.exports = {
  TaskProcessor
};
