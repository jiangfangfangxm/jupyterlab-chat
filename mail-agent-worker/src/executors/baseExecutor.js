class BaseExecutor {
  constructor(options = {}) {
    this.logger = options.logger;
    this.timeoutMs = options.timeoutMs || 60000;
  }

  async execute() {
    throw new Error('execute(taskText) must be implemented by subclasses');
  }

  buildResult({ success, output, error, startedAt, finishedAt, meta }) {
    return {
      success,
      output,
      error,
      startedAt,
      finishedAt,
      durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
      meta
    };
  }
}

module.exports = {
  BaseExecutor
};
