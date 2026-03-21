# OpenClaw Mail Agent Worker

一个可运行的 Node.js Worker，用于定时读取 IMAP 邮箱中的任务邮件，按文件夹路由到不同执行器，并通过 SMTP 将结果回发给请求人。

## 功能特性

- 定时轮询 IMAP 邮箱，支持 `--once` 与 `--loop` 两种模式。
- 通过 `websearch` / `browser` 文件夹识别任务类型。
- 统一 `BaseExecutor` 接口，方便后续替换为 OpenClaw Skill、Tavily 或其他执行器。
- `WebSearchExecutor` 提供默认 mock 搜索结果。
- `BrowserExecutor` 基于 Playwright，支持：
  - `打开 xxx`
  - `搜索 xxx`
  - `访问 xxx 并提取内容`
- 使用 JSON 持久化幂等状态，避免重复处理邮件。
- 通过 Nodemailer 自动回复结果邮件。
- 处理成功后自动归档到 `已完成`，失败时可移动到 `失败`。
- 使用 Pino + `pino-roll` 输出控制台日志和 `logs/app.log` 按天滚动日志。
- 支持并发处理、超时控制、dry-run、debug 模式。

## 目录结构

```text
mail-agent-worker/
  ├── src/
  │   ├── index.js
  │   ├── config.js
  │   ├── mail/
  │   │   ├── imapClient.js
  │   │   ├── smtpClient.js
  │   │   └── parser.js
  │   ├── processor/
  │   │   └── taskProcessor.js
  │   ├── executors/
  │   │   ├── baseExecutor.js
  │   │   ├── websearchExecutor.js
  │   │   └── browserExecutor.js
  │   ├── state/
  │   │   └── store.js
  │   ├── utils/
  │   │   ├── logger.js
  │   │   └── timer.js
  ├── logs/
  ├── data/
  ├── .env.example
  ├── package.json
  └── README.md
```

## 安装步骤

### 1. 安装依赖

```bash
cd mail-agent-worker
npm install
```

### 2. 安装 Playwright 浏览器

```bash
npx playwright install chromium
```

### 3. 配置环境变量

```bash
cp .env.example .env
```

然后编辑 `.env`：

```dotenv
IMAP_HOST=imap.example.com
IMAP_PORT=993
IMAP_USER=websearch@bank-risk.cn
IMAP_PASS=replace_me
IMAP_SECURE=true

SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_USER=websearch@bank-risk.cn
SMTP_PASS=replace_me
SMTP_SECURE=true

MAILBOX_WEBSEARCH=websearch
MAILBOX_BROWSER=browser
MAILBOX_DONE=已完成
MAILBOX_FAILED=失败

POLL_INTERVAL=300
EXECUTION_TIMEOUT_MS=60000
MAX_BODY_LENGTH=12000
MAX_CONCURRENCY=2
LOG_LEVEL=info
DRY_RUN=false
DEBUG_MODE=false
```

## 运行方式

### 执行一次

```bash
node src/index.js --once
```

### 常驻轮询

```bash
node src/index.js --loop
```

## 邮箱处理规则

- `websearch` 文件夹：取邮件主题作为查询内容，调用 `WebSearchExecutor`。
- `browser` 文件夹：将 `主题 + 正文` 拼接为任务内容，调用 `BrowserExecutor`。
- 处理完成：
  - 成功 -> 移动到 `MAILBOX_DONE`
  - 失败 -> 移动到 `MAILBOX_FAILED`
- 所有邮件在处理前都会进入幂等状态机：`pending / processing / success / failed`。

## 回复邮件格式

主题示例：

```text
Re: [websearch已完成] 帮我搜索 OpenClaw 最新架构
```

正文结构：

```text
任务类型: websearch
原始请求: 帮我搜索 OpenClaw 最新架构

执行结果:
----------------
...
----------------

时间:
开始: ...
结束: ...
耗时: ...

系统:
OpenClaw Mail Worker
```

## dry-run 与 debug

### dry-run

开启后只读取和执行任务，不发送邮件、不移动邮件：

```dotenv
DRY_RUN=true
```

### debug

开启后日志级别提升为 `debug`：

```dotenv
DEBUG_MODE=true
```

## Cron 示例

每 5 分钟执行一次：

```cron
*/5 * * * * cd /path/to/mail-agent-worker && /usr/bin/node src/index.js --once >> /var/log/mail-agent-worker-cron.log 2>&1
```

## systemd 示例

创建 `/etc/systemd/system/mail-agent-worker.service`：

```ini
[Unit]
Description=OpenClaw Mail Agent Worker
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/openclaw/mail-agent-worker
ExecStart=/usr/bin/node src/index.js --loop
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

启用：

```bash
sudo systemctl daemon-reload
sudo systemctl enable mail-agent-worker
sudo systemctl start mail-agent-worker
sudo systemctl status mail-agent-worker
```

## 关键设计说明

### 1. 幂等控制

- 使用 `folder + messageId/uid` 作为唯一键。
- 持久化到 `data/task-state.json`。
- 若状态为 `processing` 或 `success`，直接跳过，避免重复执行。

### 2. Executor 可插拔

- 所有执行器都实现 `BaseExecutor.execute(taskText)`。
- 当前内置：
  - `WebSearchExecutor`：mock 搜索
  - `BrowserExecutor`：Playwright 浏览器自动化
- 后续可直接扩展：
  - `OpenClawSkillExecutor`
  - `TavilyExecutor`
  - `GoogleSearchExecutor`

### 3. 超时与健壮性

- 所有 Browser 任务都通过 `withTimeout()` 受 `EXECUTION_TIMEOUT_MS` 限制。
- 邮件正文经过 HTML 转文本与长度截断。
- 所有主流程都包含错误捕获和失败归档。
- 日志中对密码字段做了脱敏处理。

### 4. 可观测性

- 控制台实时输出。
- `logs/app.log` 按天滚动。
- 记录启动、扫描、邮件处理、执行器调用、异常栈等核心事件。

## 后续扩展建议

- 将 JSON 状态存储切换为 SQLite / PostgreSQL。
- 为 BrowserExecutor 增加白名单域名限制。
- 将回复邮件改为 HTML + 文本双格式。
- 增加 Prometheus 指标与健康检查接口。
