const { executeTask } = require('../services/openclawClient');

async function websearchHandler(context) {
  const { mail, logger } = context;
  logger.info({ subject: mail.subject, from: mail.from }, 'Handling websearch task');
  return executeTask({
    type: 'websearch',
    subject: mail.subject,
    body: mail.text || mail.html || '',
    from: mail.from
  });
}

module.exports = websearchHandler;
