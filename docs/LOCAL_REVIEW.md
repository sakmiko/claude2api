# 本地审阅记录 · 2026-10-28

最新一轮界面、三协议与长等待补强见 [界面与流式复核](STREAMING_REVIEW.md)。本轮分支为 `local/claude-style-streaming`，截图已扩充为 26 张。

## 范围与来源

基于 basketikun/claude2api 的 main 提交 `b8992cda7ea005b45526d3cbd6da317a8e81b32e`。只在本地分支 `local/compatibility-ui-upgrade` 修改，未向 GitHub 推送、合并或关闭 PR/issues。

用户确认原项目 sessionKey 导入可用，因此保留原有导入流程、账号查询、并发与去重。导入入口函数、解析函数、并发导入函数、Claude 客户端构造函数与账号查询函数均已与原 main 对照，内容未变。重复导入时额外保护新增的暂停与休息字段，避免意外取消请求保护。

| 来源 | 审查结论与本地处理 |
| --- | --- |
| PR #1 | 整合会话额度、中英文和深色模式；修复重复 SSE 扫描、异步乱序写入、全行保存覆盖账号状态、无效额度刷新、倒计时作用域、初始化时序、属性转义等问题。 |
| PR #3 | 整合浮窗下移；保留 PR #1 额度栏，移动端也让开顶部，并增加收起/展开。 |
| PR #6 | 整合新增模型标识及测试；不将模型列表当作账号实际授权或模型已上线的证明。 |
| Issue #2 | 修复后台与沙箱 Host 分流冲突；补全连接地址说明和诊断。镜像 /new 的真实上游可达性仍须实测。 |
| Issue #4 | 明确未实现自动续期；巡检、额度更新与授权续期分开说明。不能凭空生成新的 sessionKey。 |
| Issue #5 | 通过 PR #6 登记新模型标识，真实可用性待账号验证。 |

## 后续增强

用户随后确认原先的客户端地址报错已自行定位，本轮不把该报错视为已确认的服务端故障。保留接入帮助，工作重点转向界面、请求保护和稳定性。

已核查十个相关项目，并新增请求间隔、忙碌跳过、受限冷却、手动暂停、原子保存配置、近期调用统计、常用账号与用量条，详见 [项目对照](PROJECT_COMPARISON.md)。新增调度与配置写入均有针对性回归测试。

## 已修复

- 地址解析：客户端缺少协议时提供规范化地址与可复制配置；区分 OpenAI `/v1` Base URL、Anthropic 根地址及完整 endpoint。
- 网页入口：后台与 API 入口优先分流，默认 Artifacts 域名改为 `uc.localhost`，并覆盖 localhost 入口回归。
- 流式额度：每个完整 data 行只解析一次，支持分片、CRLF、无空格 data 行与 EOF；超长行丢弃至换行，避免缓冲无限增长。
- 额度入库：按列写入额度与时间，不覆盖并发刷新产生的账号状态、Cookie 或更新时间；读额度不再额外调用上游账号刷新。
- 流式错误：Chat Completions 发送结构化 error 与结束标记，不把故障伪装成助手正文和成功 finish_reason。
- 接口路由：为 `/v1` 增加无 Cookie 凭据的 CORS 预检；未知 `/v1` API 路径返回 JSON 404，镜像 `/api/...` 保留转发。
- 出口代理：常见 host:port 输入规范化并校验协议、路径；监测间隔和重试次数保持有效范围。
- 镜像响应：去掉未使用的账号 JavaScript 插值，转义上游重置时间；镜像传输恢复证书校验。已验证可用的导入网络客户端保持原行为。
- 界面：工作台、账号/密钥/日志/对话/接入页面统一视觉；SVG 操作图标，清晰焦点状态，移动布局，深浅主题，弹窗焦点约束、Escape 关闭和页面滚动重置。
- 对话：防止重复发送，支持停止接收和图片类型/数量/大小提示；保留原始回复内容再展示中断错误。

## 验证与限制

使用 Go 1.26.2、Node 24 与本地 Chromium，运行全量 Go 测试、竞态检测、go vet、构建，以及 URL 规范化测试。三种协议的 JSON 和 SSE 都使用官方 Go SDK 对本地受控 Runner 进行解析验证，未连接真实上游。

浏览器回归使用新建临时数据库与虚构 `example.com` 账号，覆盖登录、账号与组织筛选、导入弹窗、密钥创建、号池筛选、日志、接入地址、检测、远程地址凭据保护、对话 SSE 渲染、深浅主题、中英文和手机布局。截图标有「本地审阅 · 示例数据」。对话截图使用受控 SSE，不能作为真实生成成功的证据。

没有获得可用于本次测试的真实 Claude sessionKey，因此未复验真实导入、网页镜像、上游生成、真实额度、模型权限和 Artifacts；未运行 Docker Compose。现有代码的网页协议依赖与会话授权机制仍保留，不承诺所有第三方客户端的所有功能都兼容。

## 复现

```bash
go test ./...
go test -race ./...
go vet ./...
npm run test:ui
go build -o claude2api ./cmd/server
```

可选的浏览器审阅需要 Playwright 与 Chromium：

```bash
REVIEW_BINARY="$PWD/claude2api" REVIEW_CHROMIUM=/path/to/chromium \
  node scripts/review-ui.cjs
```

脚本在临时目录启动服务并创建示例数据库，不会往正常数据目录灌入示例账号。截图默认写到 `review-output/`。

真实上游 SDK 测试必须显式启用，并提供测试凭据：

```bash
CLAUDE2API_LIVE_TEST=1 CLAUDE2API_TEST_API_KEY=your-test-key \
  CLAUDE2API_TEST_BASE_URL=http://127.0.0.1:8787 \
  go test ./internal/adapter -run 'SDK' -v
```

另已修复自动选择账号后未真正设置账号的问题。新增回归检查自动选择确实写入账号 Cookie，暂停账号不可被选择。

截图供用户确认，完整源码压缩包将在确认后另行交付。
