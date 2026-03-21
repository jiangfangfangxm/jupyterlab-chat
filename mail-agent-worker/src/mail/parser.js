const { simpleParser } = require('mailparser');
const { convert } = require('html-to-text');

function limitText(text, maxLength) {
  if (!text) {
    return '';
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n\n[truncated]` : text;
}

async function parseMessage(downloadStream, options = {}) {
  const parsed = await simpleParser(downloadStream);
  const body = parsed.text || (parsed.html ? convert(parsed.html, { wordwrap: 120 }) : '');

  return {
    from: parsed.from?.text || '',
    subject: parsed.subject || '(no subject)',
    text: limitText(body.trim(), options.maxBodyLength || 12000),
    messageId: parsed.messageId || '',
    inReplyTo: parsed.inReplyTo || '',
    references: parsed.references || [],
    date: parsed.date ? parsed.date.toISOString() : null
  };
}

module.exports = {
  parseMessage,
  limitText
};
