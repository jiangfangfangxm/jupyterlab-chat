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

3. 配置 OpenClaw Gateway 接口（根据 `openclaw status`，默认本机网关地址是 `http://127.0.0.1:18789`）：

   - `OPENCLAW_BASE_URL`：默认 `http://127.0.0.1:18789`
   - `OPENCLAW_CHAT_ENDPOINT`：默认 `/v1/chat/completions`（主要给 `browser` 任务使用）
   - `OPENCLAW_TOOL_ENDPOINT`：默认 `/tools/invoke`（`websearch` 默认直接调用内置 `web_search` 工具）
   - `OPENCLAW_AGENT`：默认 `main`
   - `OPENCLAW_GATEWAY_TOKEN`：推荐填写 `gateway.auth.token`（也可继续使用 `OPENCLAW_API_KEY`）
   - `OPENCLAW_TIMEOUT_MS`：OpenClaw 请求超时，默认 60000ms

4. 当前默认策略是：

   - `websearch` → 直接调用 Gateway `POST /tools/invoke` 的 `web_search` 工具
   - `browser` → 调用 Gateway `POST /v1/chat/completions` 让 agent 自主使用 `browser` / `web_search`

5. OpenClaw 官方文档说明 `/tools/invoke` 始终启用，而 `/v1/chat/completions` 默认可能是关闭的，需要在网关配置中启用 `gateway.http.endpoints.chatCompletions.enabled=true`。

6. `websearch` 依赖 OpenClaw 内置 `web_search` 工具。如果邮件回执里出现 `tool execution failed`，通常说明 OpenClaw 的联网搜索提供商或 API key 尚未配置完成；请先在 OpenClaw 中完成 web search 配置（例如通过设置页或 `openclaw configure --section web`），再重试。

7. 如果你的 Gateway 配置了不同端点或策略，请按实际配置调整 `src/services/openclawClient.js`。

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
