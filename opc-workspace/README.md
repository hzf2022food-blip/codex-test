# OPC 云端工作台（Render 免费联调）

此目录为可部署的 Node.js + PostgreSQL 应用，包含登录保护、12个板块、云端保存、跨设备刷新、JSON备份恢复和库存校验。

## 1. 先创建免费数据库

Render：New → Postgres，选择Singapore与**Free**，命名 opc-db。创建后复制 **Internal Database URL** 到网页服务的 DATABASE_URL 环境变量。
数据库与网页服务须在同一区域。

## 2. 创建网页服务

| 字段 | 值 |
|---|---|
| Repository | hzf2022food-blip/codex-test |
| Branch | main |
| Language | Node |
| Root Directory | opc-workspace |
| Build Command | npm install --omit=dev --no-audit --no-fund |
| Start Command | npm start |
| Instance Type | Free / $0 |
| Region | Singapore |
| Health Check Path | /health |

使用Node与npm命令。程序已同步到main；开发分支codex/opc-cloud仍保留。

## 3. 环境变量（直接在Render填写）

- DATABASE_URL：数据库的Internal Database URL；包含密码，不要提交到GitHub或贴到聊天。
- DATABASE_SSL：render-internal。仅用于Render同区域内部数据库连接的自签名TLS。
- ADMIN_LOGIN：自己选择一个工作台登录账号，例如自己的常用账号名。
- ADMIN_PASSWORD：自己设置至少16位、最多512位的独立工作台密码。
- NODE_ENV：production（Render通常自动设置）。
- PORT由Render提供，无需手动开放手机端口。

可选PUBLIC_ORIGIN：只在绑定自定义域名时设置为该HTTPS域名。默认使用Render分配的网址。

请勿使用测试代码中的账号密码作为实际登录凭据。应用无公开注册入口；只有环境变量定义的账号能登录。
不配置上述必要参数时服务会拒绝启动，查看Render日志能看到缺少的变量名，不会显示密码。

## 4. 首次使用与旧版迁移

网页服务显示Live后，打开其HTTPS网址，使用ADMIN_LOGIN和ADMIN_PASSWORD登录。
手机和电脑使用同一网址、同一工作台账号。手机端是响应式页面，不需要下载安装包。
页面每15秒检查更新；点击右上角“同步”可立即读取另一设备的修改。编辑弹窗打开时不自动覆盖表单。

云端首次启动为空库，不预置私人报价或真实任务。
在v0.3本地版“连接与设置→完整备份与恢复”导出JSON。
登录云端后，使用“完整备份”导入。按原ID合并，内容冲突停止，不自动覆盖已有记录。

## 5. 免费阶段范围

Render免费网页服务空闲15分钟后会休眠，首次访问需要等待唤醒。
Render免费Postgres创建30天后到期，不提供托管备份。到期前从工作台导出完整JSON。
应用将业务数据写入Postgres，不使用临时本地文件或SQLite保存记录。
选择Free并核对工作区额度和计费设置；本项目不自动升级、不自动购买资源。
外部平台发布、付款、采购下单和AI Agent自动执行尚未连接。

## 6. 校验与维护

GitHub Actions：OPC cloud checks。使用公共仓库标准Ubuntu runner、独立Postgres和测试账号，不使用真实数据库。
执行领域逻辑测试、后端会话/持久化/冲突检查，以及真实Chromium的电脑→手机→电脑同步测试。
测试截图以分块PNG打印到运行日志，只有隔离测试数据；不上传额外计费的构建产物。
实际Render上线后仍需验证部署日志、/health、登录、旧备份导入及实际手机访问。

本地开发（需要Node22及Postgres）：
npm install
设置.env.example列出的环境变量（不会自动读取.env），然后npm start。
测试：npm test；npx playwright install chromium；npm run test:browser。
