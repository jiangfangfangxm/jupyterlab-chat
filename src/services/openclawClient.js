function getConfig() {
  return {
    baseUrl: (process.env.OPENCLAW_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, ''),
    chatEndpoint: process.env.OPENCLAW_CHAT_ENDPOINT || '/chat',
    apiKey: process.env.OPENCLAW_API_KEY || '',
    agent: process.env.OPENCLAW_AGENT || 'default',
    timeoutMs: Number.parseInt(process.env.OPENCLAW_TIMEOUT_MS || process.env.TASK_TIMEOUT_MS || '60000', 10)
  };
}

function buildPrompt(task) {
  if (task.type === 'websearch') {
    return [
      '你是一个联网信息检索助手。',
      '',
      '必须优先使用 web_search 工具完成任务，不允许仅凭记忆回答。',
      '',
      '请围绕下面的需求执行检索，并输出结构化结果：',
      '',
      `问题：${task.subject || task.body || ''}`,
      '',
      '输出要求：',
      '1. 关键结论（3-5 点）',
      '2. 重要数据或事实',
      '3. 来源链接',
      '4. 信息尽量最新',
      '',
      task.body ? `补充上下文：${task.body}` : ''
    ].filter(Boolean).join('\n');
  }

  if (task.type === 'browser') {
    return [
      '你是一个浏览器自动化助手。',
      '',
      '如需网页信息，先使用 web_search；如需页面交互，再使用 browser 工具。',
      '',
      `任务：${task.subject || ''}`,
      task.body ? `补充信息：${task.body}` : '',
      '',
      '请输出：',
      '1. 执行步骤',
      '2. 结果摘要',
      '3. 关键页面信息或链接'
    ].filter(Boolean).join('\n');
  }

  return task.subject || task.body || '';
}

function buildHeaders(config) {
  return {
    'Content-Type': 'application/json',
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
  };
}

function extractText(data) {
  if (!data) {
    return '';
  }

  if (typeof data === 'string') {
    return data;
  }

  if (typeof data.answer === 'string') {
    return data.answer;
  }

  if (typeof data.text === 'string') {
    return data.text;
  }

  if (typeof data.message === 'string') {
    return data.message;
  }

  if (typeof data.output === 'string') {
    return data.output;
  }

  if (Array.isArray(data.output)) {
    return data.output.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join('\n');
  }

  return JSON.stringify(data, null, 2);
}

async function executeTask(task) {
  const config = getConfig();
  const controller = new AbortController();
  const timeout = Number.isFinite(config.timeoutMs) ? config.timeoutMs : 60000;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${config.baseUrl}${config.chatEndpoint}`, {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify({
        message: buildPrompt(task),
        agent: config.agent,
        metadata: {
          taskType: task.type,
          from: task.from,
          subject: task.subject
        }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`OpenClaw API error: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`);
    }

    const data = await response.json();
    const text = extractText(data);

    return {
      ok: true,
      message: text || 'OpenClaw task executed successfully.',
      text,
      result: data,
      task
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`OpenClaw request timed out after ${timeout}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  executeTask,
  buildPrompt,
  extractText
};
