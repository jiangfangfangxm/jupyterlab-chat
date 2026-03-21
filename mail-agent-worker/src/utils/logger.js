const fs = require('fs');
const path = require('path');
const pino = require('pino');
const pinoRoll = require('pino-roll');

function createLogger(config) {
  fs.mkdirSync(config.logDir, { recursive: true });

  const stream = pinoRoll({
    file: path.join(config.logDir, 'app.log'),
    frequency: 'daily',
    mkdir: true,
    size: '10m'
  });

  return pino(
    {
      level: config.debugMode ? 'debug' : config.logLevel,
      redact: {
        paths: [
          'config.imap.pass',
          'config.smtp.pass',
          'imap.pass',
          'smtp.pass',
          'password'
        ],
        censor: '***'
      },
      base: {
        service: 'openclaw-mail-agent-worker'
      },
      timestamp: pino.stdTimeFunctions.isoTime
    },
    pino.multistream([
      { stream: process.stdout },
      { stream }
    ])
  );
}

module.exports = {
  createLogger
};
