const { chromium } = require('playwright');
const { BaseExecutor } = require('./baseExecutor');
const { withTimeout } = require('../utils/timer');

function extractCommand(taskText) {
  const input = String(taskText || '').trim();
  const openMatch = input.match(/^打开\s+(.+)$/m);
  if (openMatch) {
    return { type: 'open', value: openMatch[1].trim() };
  }

  const searchMatch = input.match(/^搜索\s+(.+)$/m);
  if (searchMatch) {
    return { type: 'search', value: searchMatch[1].trim() };
  }

  const visitMatch = input.match(/^访问\s+(.+?)\s+并提取内容$/m);
  if (visitMatch) {
    return { type: 'extract', value: visitMatch[1].trim() };
  }

  if (/^https?:\/\//i.test(input)) {
    return { type: 'extract', value: input };
  }

  return { type: 'search', value: input };
}

function summarizeText(text) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return '未提取到可用内容。';
  }
  return cleaned.slice(0, 1800);
}

class BrowserExecutor extends BaseExecutor {
  async execute(taskText) {
    const startedAt = new Date().toISOString();
    const command = extractCommand(taskText);
    const browser = await chromium.launch({ headless: true });

    try {
      const { result } = await withTimeout(async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await page.setDefaultTimeout(Math.min(this.timeoutMs, 30000));

        if (command.type === 'open') {
          const url = /^https?:\/\//i.test(command.value) ? command.value : `https://${command.value}`;
          await page.goto(url, { waitUntil: 'domcontentloaded' });
          const title = await page.title();
          const content = summarizeText(await page.locator('body').innerText());
          return {
            output: `已打开: ${url}\n标题: ${title}\n\n摘要:\n${content}`,
            meta: { command, finalUrl: page.url(), title }
          };
        }

        if (command.type === 'search') {
          await page.goto('https://www.bing.com', { waitUntil: 'domcontentloaded' });
          await page.locator('textarea[name="q"], input[name="q"]').first().fill(command.value);
          await page.keyboard.press('Enter');
          await page.waitForLoadState('domcontentloaded');
          const titles = await page.locator('li.b_algo h2').allInnerTexts().catch(() => []);
          const snippets = await page.locator('li.b_algo .b_caption p').allInnerTexts().catch(() => []);
          const combined = titles.slice(0, 5).map((title, index) => `${index + 1}. ${title}${snippets[index] ? ` - ${snippets[index]}` : ''}`);
          return {
            output: `搜索关键词: ${command.value}\n\n${combined.join('\n') || '未抓取到搜索结果，请检查网络或页面结构。'}`,
            meta: { command, finalUrl: page.url(), resultCount: combined.length }
          };
        }

        const url = /^https?:\/\//i.test(command.value) ? command.value : `https://${command.value}`;
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        const title = await page.title();
        const content = summarizeText(await page.locator('body').innerText());
        return {
          output: `访问并提取内容: ${url}\n标题: ${title}\n\n内容摘要:\n${content}`,
          meta: { command, finalUrl: page.url(), title }
        };
      }, this.timeoutMs, `Browser task timed out after ${this.timeoutMs}ms`);

      const finishedAt = new Date().toISOString();
      return this.buildResult({
        success: true,
        output: result.output,
        startedAt,
        finishedAt,
        meta: result.meta
      });
    } catch (error) {
      const finishedAt = new Date().toISOString();
      return this.buildResult({
        success: false,
        output: '',
        error: error.stack || error.message,
        startedAt,
        finishedAt,
        meta: { command }
      });
    } finally {
      await browser.close();
    }
  }
}

module.exports = {
  BrowserExecutor,
  extractCommand
};
