const fs = require('fs/promises');
const path = require('path');

class DedupeStore {
  constructor(filePath, logger, maxEntries = 5000) {
    this.filePath = filePath;
    this.logger = logger;
    this.maxEntries = maxEntries;
    this.cache = {};
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const content = await fs.readFile(this.filePath, 'utf8');
      this.cache = JSON.parse(content || '{}');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.logger.warn({ err: error }, 'Failed to read dedupe store, starting fresh');
      }
      this.cache = {};
      await this.flush();
    }
  }

  has(key) {
    return Boolean(this.cache[key]);
  }

  async mark(key, metadata = {}) {
    this.cache[key] = {
      processedAt: new Date().toISOString(),
      ...metadata
    };

    const keys = Object.keys(this.cache);
    if (keys.length > this.maxEntries) {
      const overflow = keys.length - this.maxEntries;
      keys.slice(0, overflow).forEach((item) => delete this.cache[item]);
    }

    await this.flush();
  }

  async flush() {
    await fs.writeFile(this.filePath, JSON.stringify(this.cache, null, 2), 'utf8');
  }
}

module.exports = DedupeStore;
