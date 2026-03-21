const { executeTask } = require('../services/openclawClient');

async function browserHandler(context) {
  const { mail, logger } = context;
  logger.info({ subject: mail.subject, from: mail.from }, 'Handling browser task');
  return executeTask({
    type: 'browser',
    subject: mail.subject,
    body: mail.text || mail.html || '',
    from: mail.from
  });
}

module.exports = browserHandler;
