const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

async function streamToBuffer(stream) {
  if (!stream) {
    return null;
  }

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

  async fetchMessageMetadata(uid) {
    return this.client.fetchOne(uid, {
      uid: true,
      envelope: true,
      source: true,
      flags: true,
      internalDate: true,
      bodyParts: ['1', '1.1', 'TEXT']
    }, { uid: true });
  }

  async fetchSourceBuffer(uid, rawMessage) {
    if (rawMessage?.source) {
      return Buffer.isBuffer(rawMessage.source) ? rawMessage.source : Buffer.from(rawMessage.source);
    }

    const bodyParts = rawMessage?.bodyParts;
    if (bodyParts && typeof bodyParts === 'object') {
      for (const [partId, partValue] of Object.entries(bodyParts)) {
        if (!partValue) {
          continue;
        }

        const bufferValue = Buffer.isBuffer(partValue) ? partValue : Buffer.from(partValue);
        if (bufferValue.length > 0) {
          this.logger.warn({ uid, partId }, 'FETCH response did not include full source, using body part fallback');
          return bufferValue;
        }
      }
    }

    this.logger.warn({ uid }, 'FETCH response did not include source buffer, falling back to download()');

    try {
      const downloadResult = await this.client.download(uid, undefined, { uid: true });
      return await streamToBuffer(downloadResult?.content);
    } catch (error) {
      this.logger.warn({ uid, err: error }, 'Fallback download() failed while loading message source');
      return null;
    }
  }

  async parseMessage(sourceBuffer, context) {
    if (!sourceBuffer) {
      return null;
    }

    try {
      return await simpleParser(sourceBuffer);
    } catch (error) {
      this.logger.warn({ ...context, err: error }, 'mailparser failed, using envelope-only fallback');
      return null;
    }
  }

  buildMessage(raw, parsed, sourceBuffer) {
    const envelope = raw?.envelope || {};

    return {
      uid: raw?.uid,
      messageId: parsed?.messageId || envelope.messageId || `uid:${raw?.uid ?? 'unknown'}`,
      subject: parsed?.subject || envelope.subject || '',
      from: parsed?.from?.value || envelope.from || [],
      to: parsed?.to?.value || envelope.to || [],
      date: parsed?.date || envelope.date || raw?.internalDate || null,
      text: parsed?.text || '',
      html: parsed?.html || '',
      flags: raw?.flags || [],
      inReplyTo: parsed?.inReplyTo || envelope.inReplyTo,
      references: parsed?.references,
      source: sourceBuffer,
      raw: parsed || null
    };
  }

  async listUnread(folder) {
    const lock = await this.client.getMailboxLock(folder);
    try {
      const uids = await this.client.search({ seen: false }, { uid: true });
      const messages = [];
      for (const uid of uids) {
        const raw = await this.fetchMessageMetadata(uid);
        if (!raw) {
          this.logger.warn({ folder, uid }, 'fetchOne() returned no message metadata, skipping message');
          continue;
        }

        const sourceBuffer = await this.fetchSourceBuffer(uid, raw);
        const parsed = await this.parseMessage(sourceBuffer, { folder, uid });

        if (!sourceBuffer) {
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
