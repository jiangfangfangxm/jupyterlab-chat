const fs = require('fs');
const path = require('path');

class TaskStateStore {
  constructor(filePath, logger) {
    this.filePath = filePath;
    this.logger = logger;
    this.data = { tasks: {} };
  }

  async init() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
      return;
    }

    const raw = await fs.promises.readFile(this.filePath, 'utf8');
    this.data = raw ? JSON.parse(raw) : { tasks: {} };
  }

  buildKey(folder, parsedMail, uid) {
    return `${folder}:${parsedMail.messageId || uid}`;
  }

  get(key) {
    return this.data.tasks[key] || null;
  }

  async set(key, value) {
    this.data.tasks[key] = {
      ...this.data.tasks[key],
      ...value,
      updatedAt: new Date().toISOString()
    };
    await this.flush();
  }

  async flush() {
    await fs.promises.writeFile(this.filePath, JSON.stringify(this.data, null, 2));
  }
}

module.exports = {
  TaskStateStore
};
