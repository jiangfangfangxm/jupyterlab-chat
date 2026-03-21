const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function readEnv(name, fallback, options = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    if (options.required && fallback === undefined) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return fallback;
  }

  if (options.type === 'number') {
    const value = Number(raw);
    if (Number.isNaN(value)) {
      throw new Error(`Environment variable ${name} must be a number`);
    }
    return value;
  }

  if (options.type === 'boolean') {
    return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
  }

  return raw;
}

function loadConfig() {
  return {
    imap: {
      host: readEnv('IMAP_HOST', undefined, { required: true }),
      port: readEnv('IMAP_PORT', 993, { type: 'number' }),
      user: readEnv('IMAP_USER', undefined, { required: true }),
      pass: readEnv('IMAP_PASS', undefined, { required: true }),
      secure: readEnv('IMAP_SECURE', true, { type: 'boolean' })
    },
    smtp: {
      host: readEnv('SMTP_HOST', undefined, { required: true }),
      port: readEnv('SMTP_PORT', 465, { type: 'number' }),
      user: readEnv('SMTP_USER', undefined, { required: true }),
      pass: readEnv('SMTP_PASS', undefined, { required: true }),
      secure: readEnv('SMTP_SECURE', true, { type: 'boolean' })
    },
    mailboxes: {
      websearch: readEnv('MAILBOX_WEBSEARCH', 'websearch'),
      browser: readEnv('MAILBOX_BROWSER', 'browser'),
      done: readEnv('MAILBOX_DONE', '已完成'),
      failed: readEnv('MAILBOX_FAILED', '失败')
    },
    pollIntervalSeconds: readEnv('POLL_INTERVAL', 300, { type: 'number' }),
    executionTimeoutMs: readEnv('EXECUTION_TIMEOUT_MS', 60000, { type: 'number' }),
    maxBodyLength: readEnv('MAX_BODY_LENGTH', 12000, { type: 'number' }),
    maxConcurrency: readEnv('MAX_CONCURRENCY', 2, { type: 'number' }),
    logLevel: readEnv('LOG_LEVEL', 'info'),
    dryRun: readEnv('DRY_RUN', false, { type: 'boolean' }),
    debugMode: readEnv('DEBUG_MODE', false, { type: 'boolean' }),
    stateFilePath: path.resolve(process.cwd(), 'data', 'task-state.json'),
    logDir: path.resolve(process.cwd(), 'logs')
  };
}

module.exports = {
  loadConfig
};
