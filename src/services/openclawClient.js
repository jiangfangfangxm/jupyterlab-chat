const { spawn } = require('child_process');

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
    apiToken: process.env.OPENCLAW_API_TOKEN || process.env.OPENCLAW_API_KEY || '',
    gatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN || '',
    agent: process.env.OPENCLAW_AGENT || 'main',
    executionMode: (process.env.OPENCLAW_EXECUTION_MODE || 'http').trim().toLowerCase(),
    timeoutMs: Number.parseInt(process.env.OPENCLAW_TIMEOUT_MS || process.env.TASK_TIMEOUT_MS || '60000', 10),
    browserChatEndpoint: process.env.OPENCLAW_CHAT_ENDPOINT || '/v1/chat/completions',
    toolEndpointPath: process.env.OPENCLAW_TOOL_ENDPOINT || '/tools/invoke',
    toolFallbackEndpointPath: process.env.OPENCLAW_TOOL_FALLBACK_ENDPOINT || '/tools/invoke',
    cli: {
      shell: process.env.OPENCLAW_CLI_SHELL || '/bin/bash',
      websearchCommand: process.env.OPENCLAW_WEBSEARCH_CLI_COMMAND || '',
      browserCommand: process.env.OPENCLAW_BROWSER_CLI_COMMAND || '',
      agentHttpFallbackToCli: !['0', 'false', 'no', 'off'].includes(String(process.env.OPENCLAW_AGENT_HTTP_FALLBACK_TO_CLI || 'true').toLowerCase())
    },
    websearchDefaults: {
      mode: (process.env.OPENCLAW_WEBSEARCH_MODE || 'agent').trim().toLowerCase(),
      extractMode: process.env.OPENCLAW_WEBFETCH_EXTRACT_MODE || 'markdown',
      maxChars: Number.parseInt(process.env.OPENCLAW_WEBFETCH_MAX_CHARS || '12000', 10)
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
    const mode = (process.env.OPENCLAW_WEBSEARCH_MODE || 'agent').trim().toLowerCase();
    if (mode === 'agent') {
      return [
        '你是 OpenClaw 网关里的信息处理助手。',
        '',
        '请根据用户邮件主题和正文，自行判断应该调用哪些内置工具来完成任务。',
        '如果需要访问已知链接，可使用 web_fetch；如果需要更复杂的页面交互，可使用 browser。',
        '不要仅凭记忆回答；如果信息不足，请明确说明。',
        '',
        `邮件主题：${task.subject || ''}`,
        task.body ? `邮件正文：${task.body}` : '',
        '',
        '请输出：',
        '1. 任务结论',
        '2. 关键依据',
        '3. 如有工具调用，请给出关键来源或访问链接',
        '4. 如任务无法完成，说明原因'
      ].filter(Boolean).join('\n');
    }

    const url = extractUrlFromTask(task);
    return [
      '你是 OpenClaw 网关里的网页抓取助手。',
      '',
      '必须优先使用 web_fetch 工具抓取网页内容，不允许仅凭记忆回答。',
      '',
      `目标 URL：${url || '未提供 URL'}`,
      task.body ? `补充上下文：${task.body}` : '',
      '',
      '请输出：',
      '1. 页面主要内容摘要',
      '2. 关键事实或数据',
      '3. 原始链接',
      '4. 如网页内容可能过时，请明确说明'
    ].filter(Boolean).join('\n');
  }

  if (task.type === 'browser') {
    return [
      '你是 OpenClaw 网关里的浏览器自动化助手。',
      '',
      '优先判断是否需要 browser 工具；如只需要抓取某个已知网页，可先使用 web_fetch。',
      '',
      `任务：${task.subject || ''}`,
      task.body ? `补充信息：${task.body}` : '',
      '',
      '请输出执行步骤、关键观察和最终结果。'
    ].filter(Boolean).join('\n');
  }

  return task.subject || task.body || '';
}

function executeAgentTaskPayload(task, config) {
  return {
    agent: config.agent,
    task,
    prompt: buildPrompt(task)
  };
}

function buildHeaders(config) {
  const authToken = config.apiToken || config.gatewayToken;
  return {
    'Content-Type': 'application/json',
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
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

function extractUrlFromTask(task) {
  const candidates = [
    stripTaskPrefix(task.subject || '', 'web'),
    task.subject || '',
    task.body || ''
  ].filter(Boolean);

  for (const item of candidates) {
    const match = item.match(/https?:\/\/[^\s<>"')]+/i);
    if (match) {
      return match[0];
    }
  }

  return '';
}

function buildToolCallPayload(task, config) {
  const url = extractUrlFromTask(task);
  if (!url) {
    throw new Error('websearch 任务未提供可抓取的 URL。请在邮件主题或正文中包含 http:// 或 https:// 链接，当前已改为使用 OpenClaw 内置 web_fetch 工具。');
  }

  const parameters = {
    url,
    extractMode: config.websearchDefaults.extractMode || 'markdown'
  };

  if (Number.isFinite(config.websearchDefaults.maxChars) && config.websearchDefaults.maxChars > 0) {
    parameters.maxChars = config.websearchDefaults.maxChars;
  }

  return {
    tool: 'web_fetch',
    parameters
  };
}

function buildGatewayToolInvokePayload(task, config) {
  const { tool, parameters } = buildToolCallPayload(task, config);
  return {
    tool,
    args: parameters,
    sessionKey: config.agent
  };
}

function parseCliOutput(stdout) {
  const text = (stdout || '').trim();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function executeCliCommand(command, payload, timeout, shell) {
  if (!command) {
    throw new Error('OpenClaw CLI mode is enabled, but the required CLI command is not configured.');
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let finished = false;

    const timer = setTimeout(() => {
      if (finished) {
        return;
      }
      finished = true;
      child.kill('SIGTERM');
      reject(new Error(`OpenClaw CLI command timed out after ${timeout}ms`));
    }, timeout);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);

      if (code !== 0) {
        reject(new Error(`OpenClaw CLI command failed with exit code ${code}${stderr.trim() ? `: ${stderr.trim()}` : ''}`));
        return;
      }

      resolve({
        code,
        data: parseCliOutput(stdout),
        rawStdout: stdout.trim(),
        rawStderr: stderr.trim()
      });
    });

    child.stdin.end(JSON.stringify(payload));
  });
}

function executeCliArgs(file, args, timeout) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let finished = false;

    const timer = setTimeout(() => {
      if (finished) {
        return;
      }
      finished = true;
      child.kill('SIGTERM');
      reject(new Error(`OpenClaw CLI command timed out after ${timeout}ms`));
    }, timeout);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);

      if (code !== 0) {
        reject(new Error(`OpenClaw CLI command failed with exit code ${code}${stderr.trim() ? `: ${stderr.trim()}` : ''}`));
        return;
      }

      resolve({
        code,
        data: parseCliOutput(stdout),
        rawStdout: stdout.trim(),
        rawStderr: stderr.trim()
      });
    });
  });
}

function shouldUseBuiltinAgentCli(command) {
  const normalized = (command || '').trim().toLowerCase();
  return !normalized || normalized === 'agent' || normalized === 'openclaw-agent';
}

function executeBuiltinAgentCli(task, config, timeout) {
  return executeCliArgs('openclaw', ['agent', '--agent', config.agent, '--message', buildPrompt(task)], timeout);
}

function shouldUseBuiltinWebsearchCli(command) {
  const normalized = (command || '').trim().toLowerCase();
  return !normalized || normalized === 'web_fetch' || normalized === 'web-fetch';
}

function executeBuiltinWebsearchCli(task, config, timeout) {
  const { parameters } = buildToolCallPayload(task, config);
  return executeCliArgs('openclaw', ['tool', 'call', 'web_fetch', JSON.stringify(parameters)], timeout);
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
      throw new Error(`OpenClaw endpoint protocol mismatch for ${url}. The target endpoint did not respond with HTTP/1.1. Please make sure OPENCLAW_BASE_URL / OPENCLAW_WEBSEARCH_BASE_URL point to a real HTTP API endpoint, not a WebSocket-only or non-HTTP port.`);
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
  if (config.websearchDefaults.mode === 'agent') {
    try {
      if (config.executionMode === 'cli') {
        const command = config.cli.browserCommand || config.cli.websearchCommand;
        const cliResult = shouldUseBuiltinAgentCli(command)
          ? await executeBuiltinAgentCli(task, config, timeout)
          : await executeCliCommand(
            command,
            executeAgentTaskPayload(task, config),
            timeout,
            config.cli.shell
          );
        const cliText = extractText(cliResult.data) || cliResult.rawStdout;

        return {
          ok: true,
          message: cliText || 'OpenClaw agent-driven websearch executed successfully via CLI.',
          text: cliText,
          result: cliResult.data,
          task
        };
      }

      const url = `${config.baseUrl}${config.browserChatEndpoint}`;
      const { response, data } = await requestOpenClaw(config, url, buildChatCompletionPayload(task, config), timeout);

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`OpenClaw chat completions endpoint is not enabled at ${url}. Agent mode websearch requires a working HTTP chat endpoint. If your deployment only exposes tool APIs or local CLI, switch to OPENCLAW_EXECUTION_MODE=cli, or set OPENCLAW_WEBSEARCH_MODE=web_fetch for URL-only fetching.`);
        }
        throw buildHttpError(response, data, 'OpenClaw agent websearch error');
      }

      const text = extractText(data);
      return {
        ok: true,
        message: text || 'OpenClaw agent-driven websearch executed successfully.',
        text,
        result: data,
        task
      };
    } catch (error) {
      if (typeof error?.message === 'string' && error.message.includes('protocol mismatch')) {
        if (config.cli.agentHttpFallbackToCli) {
          const cliResult = await executeBuiltinAgentCli(task, config, timeout);
          const cliText = extractText(cliResult.data) || cliResult.rawStdout;
          return {
            ok: true,
            message: cliText || 'OpenClaw agent-driven websearch executed successfully via CLI fallback.',
            text: cliText,
            result: cliResult.data,
            task
          };
        }
        throw new Error(`${error.message} Agent mode websearch currently calls ${config.baseUrl}${config.browserChatEndpoint}. If this port does not expose the OpenClaw HTTP chat API, switch to OPENCLAW_EXECUTION_MODE=cli, or set OPENCLAW_WEBSEARCH_MODE=web_fetch for emails that contain direct URLs.`);
      }
      throw error;
    }
  }

  if (config.executionMode === 'cli') {
    const cliResult = shouldUseBuiltinWebsearchCli(config.cli.websearchCommand)
      ? await executeBuiltinWebsearchCli(task, config, timeout)
      : await executeCliCommand(
        config.cli.websearchCommand,
        buildGatewayToolInvokePayload(task, config),
        timeout,
        config.cli.shell
      );
    const cliText = extractText(cliResult.data) || cliResult.rawStdout;

    return {
      ok: true,
      message: cliText || 'OpenClaw web_fetch executed successfully via CLI.',
      text: cliText,
      result: cliResult.data,
      task
    };
  }

  const toolBaseUrl = normalizeHttpBaseUrl(process.env.OPENCLAW_WEBSEARCH_BASE_URL || config.baseUrl, config.baseUrl);
  const attempts = [];
  const requestedPath = config.toolEndpointPath;
  const requestedPayload = requestedPath === '/tools/invoke'
    ? buildGatewayToolInvokePayload(task, config)
    : buildToolCallPayload(task, config);

  attempts.push({
    url: `${toolBaseUrl}${requestedPath}`,
    payload: requestedPayload
  });

  if (requestedPath !== config.toolFallbackEndpointPath) {
    attempts.push({
      url: `${config.baseUrl}${config.toolFallbackEndpointPath}`,
      payload: buildGatewayToolInvokePayload(task, config)
    });
  }

  let response;
  let data;
  let lastError;

  for (const attempt of attempts) {
    try {
      ({ response, data } = await requestOpenClaw(config, attempt.url, attempt.payload, timeout));
      if (!response.ok && response.status === 404 && attempt.url !== attempts[attempts.length - 1].url) {
        lastError = buildHttpError(response, data, 'OpenClaw tool endpoint not found');
        continue;
      }
      break;
    } catch (error) {
      lastError = error;
      if (attempt.url !== attempts[attempts.length - 1].url) {
        continue;
      }
      throw error;
    }
  }

  if (!response) {
    throw lastError || new Error('OpenClaw web_fetch request failed before receiving a response');
  }

  if (!response.ok) {
    throw buildHttpError(response, data, 'OpenClaw tool/call error');
  }

  if (data && data.status && data.status !== 'ok') {
    throw new Error(`OpenClaw web_fetch failed: ${JSON.stringify(data)}`);
  }

  return {
    ok: true,
    message: extractText(data.result || data) || 'OpenClaw web_fetch executed successfully.',
    text: extractText(data.result || data),
    result: data,
    task
  };
}

async function executeBrowser(task, config, timeout) {
  if (config.executionMode === 'cli') {
    const cliResult = await executeCliCommand(
      config.cli.browserCommand,
      executeAgentTaskPayload(task, config),
      timeout,
      config.cli.shell
    );
    const cliText = extractText(cliResult.data) || cliResult.rawStdout;

    return {
      ok: true,
      message: cliText || 'OpenClaw browser task executed successfully via CLI.',
      text: cliText,
      result: cliResult.data,
      task
    };
  }

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
  extractUrlFromTask,
  normalizeHttpBaseUrl,
  stripTaskPrefix
};
