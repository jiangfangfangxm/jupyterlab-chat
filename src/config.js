const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

function toBool(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function toInt(value, defaultValue) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const config = {
  app: {
    env: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'info',
    runMode: process.env.RUN_MODE || 'once',
    pollIntervalMs: toInt(process.env.POLL_INTERVAL_MS, 5 * 60 * 1000),
    taskTimeoutMs: toInt(process.env.TASK_TIMEOUT_MS, 2 * 60 * 1000),
    smtpVerifyOnStart: toBool(process.env.SMTP_VERIFY_ON_START, false),
    dedupeStorePath: path.resolve(process.cwd(), process.env.DEDUPE_STORE_PATH || './data/processed-emails.json')
  },
  imap: {
    host: required('IMAP_HOST'),
    port: toInt(process.env.IMAP_PORT, 993),
    secure: toBool(process.env.IMAP_SECURE, true),
    auth: {
      user: required('IMAP_USER'),
      pass: required('IMAP_PASS')
    },
    mailboxes: {
      websearch: process.env.IMAP_MAILBOX_WEBSEARCH || 'websearch',
      browser: process.env.IMAP_MAILBOX_BROWSER || 'browser',
      done: process.env.IMAP_MAILBOX_DONE || '已完成',
      failed: process.env.IMAP_MAILBOX_FAILED || '失败'
    },
    moveFailed: toBool(process.env.IMAP_MOVE_FAILED, false)
  },
  smtp: {
    host: required('SMTP_HOST'),
    port: toInt(process.env.SMTP_PORT, 465),
    secure: toBool(process.env.SMTP_SECURE, true),
    auth: {
      user: required('SMTP_USER'),
      pass: required('SMTP_PASS')
    },
    from: {
      name: process.env.SMTP_FROM_NAME || 'OpenClaw Mail Agent',
      address: process.env.SMTP_FROM_ADDRESS || required('SMTP_USER')
    }
  },
  filters: {
    allowedFromDomains: (process.env.ALLOWED_FROM_DOMAINS || '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  }
};

module.exports = config;
