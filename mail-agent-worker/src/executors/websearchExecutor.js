const { BaseExecutor } = require('./baseExecutor');

class WebSearchExecutor extends BaseExecutor {
  async execute(taskText) {
    const startedAt = new Date().toISOString();
    const normalizedTask = String(taskText || '').trim();

    const output = [
      `Search Result for: ${normalizedTask}`,
      '',
      '1. Mock result: OpenClaw can integrate a real web search API here.',
      '2. Mock result: Replace this executor with Tavily, Google Custom Search, or an internal OpenClaw skill.',
      '3. Mock result: Add citation enrichment, ranking, and summarization in a future iteration.'
    ].join('\n');

    const finishedAt = new Date().toISOString();
    return this.buildResult({
      success: true,
      output,
      startedAt,
      finishedAt,
      meta: {
        provider: 'mock-websearch',
        taskLength: normalizedTask.length
      }
    });
  }
}

module.exports = {
  WebSearchExecutor
};
