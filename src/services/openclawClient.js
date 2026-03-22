function normalizeHttpBaseUrl(value, fallback) {
  const raw = (value || fallback).trim();
  if (raw.startsWith('ws://')) {
    return `http://${raw.slice(5)}`.replace(/\/$/, '');
  }
  if (raw.startsWith('wss://')) {
    return `https://${raw.slice(6)}`.replace(/\/$/, '');
  }
  return raw.replace(/\/$/, '');
}

function getConfig() {
  const baseUrl = normalizeHttpBaseUrl(process.env.OPENCLAW_BASE_URL || 'http://127.0.0.1:18789', 'http://127.0.0.1:18789');
  return {
    baseUrl,
    apiKey: process.env.OPENCLAW_API_TOKEN || process.env.OPENCLAW_API_KEY || process.env.OPENCLAW_GATEWAY_TOKEN || '',
    agent: process.env.OPENCLAW_AGENT || 'main',
    timeoutMs: Number.parseInt(process.env.OPENCLAW_TIMEOUT_MS || process.env.TASK_TIMEOUT_MS || '60000', 10),
    browserChatEndpoint: process.env.OPENCLAW_CHAT_ENDPOINT || '/v1/chat/completions',
    toolEndpointPath: process.env.OPENCLAW_TOOL_ENDPOINT || '/api/v1/tool/call',
    websearchDefaults: {
      count: Number.parseInt(process.env.OPENCLAW_WEBSEARCH_COUNT || '5', 10),
      country: process.env.OPENCLAW_WEBSEARCH_COUNTRY || 'CN',
      language: process.env.OPENCLAW_WEBSEARCH_LANGUAGE || 'zh',
      freshness: process.env.OPENCLAW_WEBSEARCH_FRESHNESS || ''
    }
  };
}

function stripTaskPrefix(input, prefix) {
  const value = (input || '').trim();
  if (!value) {
    return '';
  }

  const patterns = [
    new RegExp(`^${prefix}[:：\\s-]+`, 'i'),
    new RegExp(`^${prefix}$`, 'i')
  ];

  return patterns.reduce((current, pattern) => current.replace(pattern, '').trim(), value);
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
    return choiceContent.map((part) => (typeof part === 'string' ? part : (part?.text || JSON.stringify(part)))).join('\n');
  }

  if (Array.isArray(data.results)) {
    return data.results
      .map((item, index) => `${index + 1}. ${item.title || ''}\n${item.url || ''}\n${item.snippet || ''}`.trim())
      .join('\n\n');
  }

  if (data.result && Array.isArray(data.result.results)) {
    return data.result.results
      .map((item, index) => `${index + 1}. ${item.title || ''}\n${item.url || ''}\n${item.snippet || ''}`.trim())
      .join('\n\n');
  }

  if (typeof data.result === 'string') {
    return data.result;
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

function buildChatCompletionPayload(task, config) {
  return {
    model: `openclaw:${config.agent}`,
    user: Array.isArray(task.from) && task.from[0]?.address ? task.from[0].address : undefined,
    messages: [{ role: 'user', content: buildPrompt(task) }]
  };
}

function buildToolCallPayload(task, config) {
  const query = stripTaskPrefix(task.subject || task.body || '', 'web') || task.subject || task.body || '';
  const parameters = {
    query,
    count: Math.min(Math.max(config.websearchDefaults.count || 5, 1), 10)
  };

  if (config.websearchDefaults.country) {
    parameters.country = config.websearchDefaults.country;
  }
  if (config.websearchDefaults.language) {
    parameters.language = config.websearchDefaults.language;
  }
  if (config.websearchDefaults.freshness) {
    parameters.freshness = config.websearchDefaults.freshness;
  }

  return {
    tool: 'web_search',
    parameters
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

async function requestOpenClaw(config, url, payload, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
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

    const causeMessage = error?.cause?.message || '';
    if (error instanceof TypeError && causeMessage.includes('Expected HTTP/')) {
      throw new Error('OpenClaw Gateway protocol mismatch. Please set OPENCLAW_BASE_URL to the HTTP API base URL (for example http://127.0.0.1:7681), not a raw WebSocket URL.');
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
  const url = `${normalizeHttpBaseUrl(process.env.OPENCLAW_WEBSEARCH_BASE_URL || config.baseUrl, config.baseUrl)}${config.toolEndpointPath}`;
  const { response, data } = await requestOpenClaw(config, url, buildToolCallPayload(task, config), timeout);

  if (!response.ok) {
    throw buildHttpError(response, data, 'OpenClaw tool/call error');
  }

  if (data && data.status && data.status !== 'ok') {
    throw new Error(`OpenClaw web_search failed: ${JSON.stringify(data)}`);
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
  const url = `${config.baseUrl}${config.browserChatEndpoint}`;
  const { response, data } = await requestOpenClaw(config, url, buildChatCompletionPayload(task, config), timeout);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('OpenClaw chat completions endpoint is not enabled. Enable the HTTP chat endpoint or configure OPENCLAW_CHAT_ENDPOINT to a working browser-compatible endpoint.');
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
  buildToolCallPayload,
  normalizeHttpBaseUrl,
  stripTaskPrefix
};
