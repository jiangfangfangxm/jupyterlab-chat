# Mail Auto Agent

一个基于 **Node.js + IMAP + SMTP** 的邮件自动处理 Agent，用于监听 `websearch@bank-risk.cn` 邮箱中的两个文件夹，并自动执行任务后回邮结果。

## 功能特性

- 使用 `imapflow` 读取 IMAP 邮箱中两个文件夹的未读邮件：`websearch`、`browser`
- 根据文件夹类型自动路由任务：
  - `websearch` → `executeTask({ type: "websearch", subject, body, from })`
  - `browser` → `executeTask({ type: "browser", subject, body, from })`
- 使用 `nodemailer` 通过 SMTP 向原发件人回复执行结果
- 处理成功后：邮件标记为已读并移动到“已完成”文件夹
- 处理失败时：默认记录日志并保留原文件夹，可通过配置扩展为移动到失败文件夹
- 内置基础超时控制、发件人白名单过滤、基础去重机制（基于 `messageId` 持久化记录）
- 使用 `pino` 输出结构化日志，便于后续接入日志平台
- 模块化目录结构，方便替换 OpenClaw 接口和扩展更多 handler

## 目录结构

```text
.
├── .env.example
├── package.json
├── README.md
├── data/
│   └── processed-emails.json   # 运行时自动生成
└── src/
    ├── index.js
    ├── config.js
    ├── logger.js
    ├── handlers/
    │   ├── browserHandler.js
    │   ├── router.js
    │   └── websearchHandler.js
    ├── mail/
    │   ├── folderManager.js
    │   ├── imapClient.js
    │   └── smtpClient.js
    └── services/
        ├── dedupStore.js
        ├── openclawClient.js
        └── resultFormatter.js
```

## 安装

```bash
npm install
```

## 配置

1. 复制环境变量模板：

   ```bash
   cp .env.example .env
   ```

2. 按实际邮箱服务修改 `.env`：

   - `IMAP_HOST` / `IMAP_PORT` / `IMAP_SECURE`
   - `IMAP_USER` / `IMAP_PASS`
   - `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE`
   - `SMTP_USER` / `SMTP_PASS`
   - `IMAP_MAILBOX_WEBSEARCH`、`IMAP_MAILBOX_BROWSER`、`IMAP_MAILBOX_DONE`
   - `IMAP_MOVE_FAILED=true` 时，失败邮件会被移动到 `IMAP_MAILBOX_FAILED`
   - `TASK_TIMEOUT_MS` 用于限制单封邮件任务执行时间
   - `ALLOWED_FROM_DOMAINS` 可选，用逗号分隔多个允许发件域名

3. 配置 OpenClaw 接口：

   - `OPENCLAW_BASE_URL`：默认 `http://127.0.0.1:18789`
   - `OPENCLAW_WEBSEARCH_BASE_URL`：可单独覆盖 `websearch` 的 HTTP 地址，默认同 `OPENCLAW_BASE_URL`
   - `OPENCLAW_TOOL_ENDPOINT`：默认 `/tools/invoke`（OpenClaw Gateway 官方工具调用 HTTP API）
   - `OPENCLAW_TOOL_FALLBACK_ENDPOINT`：默认 `/tools/invoke`；当你把 `OPENCLAW_TOOL_ENDPOINT` 配成旧式 `/api/v1/tool/call` 时，程序会在失败后自动回退到该端点
   - `OPENCLAW_CHAT_ENDPOINT`：默认 `/v1/chat/completions`（主要给 `browser` 任务使用；如果你的 OpenClaw 不提供该端点，需要另行调整）
   - `OPENCLAW_GATEWAY_TOKEN`：推荐填写 Gateway Token；也兼容 `OPENCLAW_API_TOKEN` / `OPENCLAW_API_KEY`
   - `OPENCLAW_EXECUTION_MODE`：默认 `http`；如果 Agent 与 OpenClaw 部署在同一台机器，可切到 `cli`
   - `OPENCLAW_WEBSEARCH_CLI_COMMAND` / `OPENCLAW_BROWSER_CLI_COMMAND`：仅在 `cli` 模式下生效；其中 `OPENCLAW_WEBSEARCH_CLI_COMMAND=web_fetch` 表示使用内置官方命令 `openclaw tool call web_fetch '<json>'`
   - `OPENCLAW_CLI_SHELL`：CLI 模式下执行命令的 shell，默认 `/bin/bash`
   - `OPENCLAW_AGENT`：默认 `main`
   - `OPENCLAW_TIMEOUT_MS`：OpenClaw 请求超时，默认 60000ms
   - `OPENCLAW_WEBSEARCH_MODE`：默认 `agent`；表示把邮件主题/正文直接交给 OpenClaw，由它自行决定是否调用 `web_fetch`、`browser` 等工具；如需强制抓某个链接，可改成 `web_fetch`
   - `OPENCLAW_WEBFETCH_EXTRACT_MODE`：默认 `markdown`
   - `OPENCLAW_WEBFETCH_MAX_CHARS`：默认 `12000`

4. 当前默认策略是：

   - `websearch` 默认走 `agent` 模式：`POST /v1/chat/completions`，把邮件主题/正文直接交给 OpenClaw，让它自主决定是否调用 `web_fetch`、`browser` 等工具
   - 如果你显式设置 `OPENCLAW_WEBSEARCH_MODE=web_fetch`，则 `websearch` 会改为 `POST /tools/invoke`，请求体为 `{ tool: "web_fetch", args: { url, extractMode, maxChars }, sessionKey }`
   - `browser` → `POST /v1/chat/completions`（如果你的 OpenClaw 文档提供了更合适的 browser API，可继续替换）
   - 如果你仍需兼容旧代理层的 `/api/v1/tool/call`，可以把 `OPENCLAW_TOOL_ENDPOINT=/api/v1/tool/call`；程序会先按旧格式 `{ tool, parameters }` 调用，并在失败时自动回退到官方 `/tools/invoke`

5. 如果你希望和 OpenClaw 跑在同一台服务器上，也可以改成 CLI 模式：

   ```dotenv
   OPENCLAW_EXECUTION_MODE=cli
   OPENCLAW_WEBSEARCH_MODE=agent
   OPENCLAW_WEBSEARCH_CLI_COMMAND=web_fetch
   OPENCLAW_BROWSER_CLI_COMMAND=/usr/local/bin/openclaw-browser-wrapper
   ```

   在该模式下：

   - 当 `OPENCLAW_WEBSEARCH_MODE=agent` 时，`websearch` 会和 `browser` 一样，把 `{ agent, task, prompt }` 作为 JSON 交给你配置的 CLI 命令，由 OpenClaw 自行决定工具调用
   - 当 `OPENCLAW_WEBSEARCH_MODE=web_fetch` 时，`websearch` 才会直接执行官方 CLI：`openclaw tool call web_fetch '<json>'`
   - `browser` 仍然走你自行配置的本地命令，程序会把 `{ agent, task, prompt }` 作为 JSON 写入标准输入

   如果你把 `OPENCLAW_WEBSEARCH_MODE=web_fetch`，同时把 `OPENCLAW_WEBSEARCH_CLI_COMMAND` 留空，或者显式写成 `web_fetch` / `web-fetch`，程序都会自动回退到官方 `openclaw tool call web_fetch` 形式。

6. 更推荐的简单配置是让 `websearch` 走默认 `agent` 模式：这样邮件里可以是问题、说明或链接，OpenClaw 会自己决定调用什么工具。

7. 只有当你把 `OPENCLAW_WEBSEARCH_MODE=web_fetch` 时，`websearch` 文件夹中的邮件才**必须包含 URL**。程序会优先从邮件主题、正文中提取第一个 `http://` 或 `https://` 链接并抓取该网页内容。

8. 如果 `websearch` 在默认 `agent` 模式下报协议错误，通常说明 `OPENCLAW_BASE_URL + OPENCLAW_CHAT_ENDPOINT` 指向的并不是可用的 HTTP chat API。此时应优先二选一：

   - 改成 `OPENCLAW_EXECUTION_MODE=cli`，让 OpenClaw 在本机自行完成 agent/tool 调用；
   - 或改成 `OPENCLAW_WEBSEARCH_MODE=web_fetch`，但这种模式只适合邮件里已经带有 URL 的情况。

9. 如果你的 OpenClaw 实际开放的端口、端点或鉴权方式与文档不同，请按实际部署情况调整 `src/services/openclawClient.js`。

## 运行

### 单次执行

```bash
npm start
```

适合由外部调度器定时触发一次扫描并退出。

### 持续轮询模式

```bash
npm run start:watch
```

或：

```bash
RUN_MODE=watch POLL_INTERVAL_MS=300000 npm start
```

Agent 会先立即扫描一次，然后按 `POLL_INTERVAL_MS` 周期持续扫描。

## 定时执行方式

### Linux `crontab`

每 5 分钟执行一次：

```cron
*/5 * * * * cd /path/to/mail-auto-agent && /usr/bin/npm start >> /var/log/mail-auto-agent.log 2>&1
```

### systemd timer / 容器调度

推荐在生产环境中由以下方式驱动：

- `systemd timer`
- Kubernetes `CronJob`
- CI/CD 平台定时任务
- PM2 / Docker 容器常驻运行（配合 `RUN_MODE=watch`）

## 去重与失败策略

### 基础去重

- 当前实现使用 `folder + messageId` 作为幂等键
- 已处理记录会写入 `data/processed-emails.json`
- 若遇到重复邮件，将直接跳过并移动到已完成文件夹

### 失败处理

- 默认：记录错误日志，邮件保留在原文件夹，便于人工复查
- 可选：设置 `IMAP_MOVE_FAILED=true`，自动移动到失败文件夹
- 失败时会尝试回复一封错误说明邮件给原发件人

## 模块说明

- `src/index.js`：主入口，负责初始化、轮询、串联处理流程
- `src/config.js`：读取和校验环境变量
- `src/logger.js`：结构化日志实例
- `src/mail/imapClient.js`：封装 IMAP 连接、读取、标记已读、移动邮件
- `src/mail/smtpClient.js`：封装 SMTP 回邮
- `src/mail/folderManager.js`：统一管理成功/失败邮件流转
- `src/handlers/router.js`：按任务类型路由 handler，并附带超时控制
- `src/handlers/websearchHandler.js`：处理 websearch 类型任务
- `src/handlers/browserHandler.js`：处理 browser 类型任务
- `src/services/openclawClient.js`：OpenClaw 客户端 stub，可后续替换
- `src/services/resultFormatter.js`：组织成功/失败回邮内容
- `src/services/dedupStore.js`：基础去重持久化存储

## 后续扩展建议

- 接入真实 OpenClaw API，增加鉴权、重试、限流
- 增加 HTML / 附件解析能力
- 引入任务队列，支持并发和更强的失败重试策略
- 增加 Prometheus 指标、Webhook 告警、Sentry 错误追踪
- 将 dedupe store 从 JSON 文件升级为 Redis / SQLite

## 注意事项

- 首次运行前请确认 IMAP 账户对目标文件夹具有读取和移动权限
- 某些邮件服务商对中文文件夹名有特殊编码要求，如遇问题请改成 ASCII 文件夹名
- 当前实现默认串行处理邮件，优先保证稳定性和可追踪性
- 若部署在容器中，请持久化 `data/processed-emails.json`，避免重启后去重记录丢失
