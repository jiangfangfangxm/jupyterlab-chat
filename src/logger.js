const pino = require('pino');
const config = require('./config');

const logger = pino({
  level: config.app.logLevel,
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    }
  }
});

module.exports = logger;
