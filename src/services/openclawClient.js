function getConfig() {
  return {
    baseUrl: (process.env.OPENCLAW_BASE_URL || 'http://127.0.0.1:18789').replace(/\/$/, ''),
    chatEndpoint: process.env.OPENCLAW_CHAT_ENDPOINT || '/v1/chat/completions',
    toolEndpoint: process.env.OPENCLAW_TOOL_ENDPOINT || '/tools/invoke',
    apiKey: process.env.OPENCLAW_API_KEY || process.env.OPENCLAW_GATEWAY_TOKEN || '',
    agent: process.env.OPENCLAW_AGENT || 'main',
    timeoutMs: Number.parseInt(process.env.OPENCLAW_TIMEOUT_MS || process.env.TASK_TIMEOUT_MS || '60000', 10)
  };
}

function buildPrompt(task) {
  if (task.type === 'websearch') {
    return [
      '你是 OpenClaw 网关里的信息检索助手。',
      '',
      '必须优先使用 web_search 工具完成任务，不允许仅凭记忆回答。',
      '',
      `问题：${task.subject || task.body || ''}`,
      task.body ? `补充上下文：${task.body}` : '',
      '',
      '请输出：',
      '1. 关键结论（3-5 点）',
      '2. 重要数据或事实',
      '3. 来源链接',
      '4. 如果信息存在时效性，明确说明时间范围'
    ].filter(Boolean).join('\n');
  }

  if (task.type === 'browser') {
    return [
      '你是 OpenClaw 网关里的浏览器自动化助手。',
      '',
      '优先判断是否需要 browser 工具；如只需检索信息，可先使用 web_search。',
      '',
      `任务：${task.subject || ''}`,
      task.body ? `补充信息：${task.body}` : '',
      '',
      '请输出执行步骤、关键观察和最终结果。'
    ].filter(Boolean).join('\n');
  }

  return task.subject || task.body || '';
}

function buildHeaders(config) {
  return {
    'Content-Type': 'application/json',
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    'x-openclaw-agent-id': config.agent
  };
}

function extractText(data) {
  if (!data) {
    return '';
  }

  if (typeof data === 'string') {
    return data;
  }

  const choiceContent = data.choices?.[0]?.message?.content;
  if (typeof choiceContent === 'string') {
    return choiceContent;
  }

  if (Array.isArray(choiceContent)) {
    return choiceContent
      .map((part) => (typeof part === 'string' ? part : (part?.text || JSON.stringify(part))))
      .join('\n');
  }

  if (typeof data.result === 'string') {
    return data.result;
  }

  if (Array.isArray(data.result)) {
    return data.result.map((item) => JSON.stringify(item, null, 2)).join('\n');
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

  return JSON.stringify(data, null, 2);
}

function buildChatCompletionPayload(task) {
  return {
    model: `openclaw:${task.agent || 'main'}`,
    user: Array.isArray(task.from) && task.from[0]?.address ? task.from[0].address : undefined,
    messages: [
      {
        role: 'user',
        content: buildPrompt(task)
      }
    ]
  };
}

function buildToolInvokePayload(task, config) {
  return {
    tool: 'web_search',
    action: 'json',
    sessionKey: config.agent,
    args: {
      query: task.subject || task.body || ''
    }
  };
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function requestOpenClaw(config, path, payload, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const data = await parseJsonResponse(response);
    return { response, data };
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`OpenClaw request timed out after ${timeout}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function buildHttpError(response, data, fallbackMessage) {
  const detail = data?.error?.message || data?.message || data?.raw || response.statusText || fallbackMessage;
  return new Error(`${fallbackMessage}: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ''}`);
}

async function executeWebsearch(task, config, timeout) {
  const { response, data } = await requestOpenClaw(config, config.toolEndpoint, buildToolInvokePayload(task, config), timeout);

  if (!response.ok) {
    const error = buildHttpError(response, data, 'OpenClaw tools/invoke error');
    if (response.status >= 500 && String(error.message).includes('tool execution failed')) {
      throw new Error('OpenClaw web_search tool execution failed. Please verify the Gateway web search provider/API key is configured correctly (for example via OpenClaw web search settings or `openclaw configure --section web`).');
    }
    throw error;
  }

  if (data && data.ok === false) {
    throw new Error(`OpenClaw web_search failed: ${data.error?.message || JSON.stringify(data.error || data)}`);
  }

  return {
    ok: true,
    message: extractText(data.result || data) || 'OpenClaw web_search executed successfully.',
    text: extractText(data.result || data),
    result: data,
    task
  };
}

async function executeBrowser(task, config, timeout) {
  const { response, data } = await requestOpenClaw(config, config.chatEndpoint, buildChatCompletionPayload({ ...task, agent: config.agent }), timeout);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('OpenClaw chat completions endpoint is not enabled. Enable gateway.http.endpoints.chatCompletions.enabled=true or configure OPENCLAW_CHAT_ENDPOINT to a working endpoint.');
    }
    throw buildHttpError(response, data, 'OpenClaw Gateway API error');
  }

  const text = extractText(data);

  return {
    ok: true,
    message: text || 'OpenClaw browser task executed successfully.',
    text,
    result: data,
    task
  };
}

async function executeTask(task) {
  const config = getConfig();
  const timeout = Number.isFinite(config.timeoutMs) ? config.timeoutMs : 60000;

  if (task.type === 'websearch') {
    return executeWebsearch(task, config, timeout);
  }

  if (task.type === 'browser') {
    return executeBrowser(task, config, timeout);
  }

  throw new Error(`Unsupported OpenClaw task type: ${task.type}`);
}

module.exports = {
  executeTask,
  buildPrompt,
  extractText,
  buildChatCompletionPayload,
  buildToolInvokePayload
};
