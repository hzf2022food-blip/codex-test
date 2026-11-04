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

### 手机桌面入口（v0.4.1）

手机访问同一HTTPS网址，点击“＋ 添加到手机桌面”。
安卓Chrome可使用浏览器安装提示，或菜单中的“安装应用 / 添加到主屏幕”。
iPhone使用Safari，点分享按钮→添加到主屏幕→添加。
安装后桌面显示独立的OPC工作台图标，点击即可打开；电脑和手机共用云端数据。
应用需要联网。离线显示重新连接提示，不缓存登录后的页面或业务数据。
已有桌面快捷方式如图标未更新，可移除旧快捷方式后重新添加。

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

## 表格导入（v0.5.0）

登录后进入A01“供应商与工厂”，点击“表格导入”；“连接与设置”中也有入口。
支持Excel .xlsx、UTF-8或GB18030 CSV，单文件最多5MB、单工作表1000条、60列。
上传后可选择工作表和表头行；系统识别常用中文及英文字段，也可手动选择字段对应关系。
先导入供应商、再导入工厂；关联关系可使用同一业务内的名称或系统编号。
供应商/工厂名称必填。所属业务可由每行提供，或使用窗口中的默认业务。
未知资料可留空，合作与核实状态默认“待核实”；模板下拉选项列出支持的状态。
电话、编号等保持文本格式以保留前导零；公式须先粘贴为值；旧.xls请先另存为.xlsx。
提供空白Excel模板、填写说明、原表样例、逐行预览、错误清单CSV、导入前完整JSON备份。
仅新增：相同记录跳过，冲突不覆盖；任一行错误均阻止整批确认。
预览20分钟内有效。确认后其他设备如已改动数据，需要重新预览。
确认通过同一云端事务保存并记录审计；重复点击确认不会重复新增。
原表文件不在代码仓库公开；临时预览仅保存在当前账号范围，成功导入的数据纳入完整备份。
目前表格导入范围为供应商、工厂、两者关联关系；其它业务板块仍使用录入界面或完整JSON备份恢复。
