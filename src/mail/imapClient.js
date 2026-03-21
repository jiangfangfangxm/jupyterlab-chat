const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length ? Buffer.concat(chunks) : null;
}

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
    if (!this.client.usable) {
      return;
    }

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

  async fetchSourceBuffer(uid, rawMessage) {
    if (rawMessage?.source) {
      return Buffer.isBuffer(rawMessage.source) ? rawMessage.source : Buffer.from(rawMessage.source);
    }

    this.logger.warn({ uid }, 'FETCH response did not include source buffer, falling back to download()');

    try {
      const { content } = await this.client.download(uid, undefined, { uid: true });
      return await streamToBuffer(content);
    } catch (error) {
      this.logger.warn({ uid, err: error }, 'Fallback download() failed while loading message source');
      return null;
    }
  }

  buildMessage(raw, parsed, sourceBuffer) {
    const envelope = raw?.envelope || {};

    return {
      uid: raw.uid,
      messageId: parsed?.messageId || envelope.messageId || `uid:${raw.uid}`,
      subject: parsed?.subject || envelope.subject || '',
      from: parsed?.from?.value || envelope.from || [],
      to: parsed?.to?.value || envelope.to || [],
      date: parsed?.date || envelope.date || raw.internalDate || null,
      text: parsed?.text || '',
      html: parsed?.html || '',
      flags: raw.flags,
      inReplyTo: parsed?.inReplyTo || envelope.inReplyTo,
      references: parsed?.references,
      source: sourceBuffer,
      raw: parsed || null
    };
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

        const sourceBuffer = await this.fetchSourceBuffer(uid, raw);
        let parsed = null;

        if (sourceBuffer) {
          parsed = await simpleParser(sourceBuffer);
        } else {
          this.logger.warn({ uid, folder }, 'Unable to load raw message source, using envelope-only fallback');
        }

        messages.push(this.buildMessage(raw, parsed, sourceBuffer));
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
