# 客户端接入与排错

## 正确的地址

在运行服务的同一台电脑上：

| 客户端配置项 | 填写示例 |
| --- | --- |
| OpenAI SDK Base URL | `http://127.0.0.1:8787/v1` |
| 完整 Chat Completions URL | `http://127.0.0.1:8787/v1/chat/completions` |
| 完整 Responses URL | `http://127.0.0.1:8787/v1/responses` |
| Anthropic SDK Base URL | `http://127.0.0.1:8787` |
| 完整 Messages URL | `http://127.0.0.1:8787/v1/messages` |

`parse "127.0.0.1:8787/v1/chat/completions": first path segment in URL cannot contain colon` 表示客户端收到的 URL 缺少协议。此错误发生在客户端解析地址时，通常请求还没发到网关。应在客户端配置中补齐 `http://` 或 `https://`，并区分 Base URL 与完整接口地址。服务器不能改写尚未发出的客户端请求。

后台「API 接入」能规范化裸地址、移除重复 `/v1` 或误填的接口后缀，并分别复制 Base URL 与完整请求地址。转换结果仍需要复制到第三方客户端。

从手机或另一台电脑连接时，`127.0.0.1` 指向客户端自身；改用服务器的局域网 IP 或域名。例如 `http://192.168.1.8:8787/v1`。远程 HTTPS 站点不能在浏览器里调用不安全的 HTTP 服务；应使用可达的 HTTPS 服务地址。

## 鉴权与诊断

在「密钥管理」创建访问密钥。OpenAI 请求发送 `Authorization: Bearer <密钥>`；Anthropic 请求发送 `x-api-key: <密钥>`。

「检测连接」验证当前站点的管理鉴权、API 路由与模型列表。检测不会把管理员密码或密钥发送到输入的其他域名，也不会调用模型消耗额度。模型生成需要在「对话测试」中另外验证。

`GET /healthz` 仅表示本地进程可用。`GET /v1/models` 返回网关登记的模型标识，并不证明这些模型已获得账号权限或上游已实际开放。

服务仅实现当前三类兼容接口，不宣称完整实现所有 OpenAI/Anthropic API。未实现的 `/v1/...` API 路径返回 JSON 404，不再误入网页镜像。工具调用由提示词与标签协议转换，效果取决于上游模型输出。

## 网页入口与 Artifacts

后台入口为 `http://127.0.0.1:8787/`，`http://localhost:8787/` 也保留后台入口。新版示例的沙箱域名使用独立的 `uc.localhost`，避免把 `localhost` 后台请求识别成 Artifacts 请求。

公网部署请将 `web_uc_host` 配成独立可解析的沙箱域名，并把主站与沙箱域名都反代到本服务。网页镜像与 Artifacts 的最终可用性仍需真实账号、DNS、HTTPS 与上游网络验证。

## sessionKey 与额度

原始 sessionKey 批量导入、账号查询、去重与保存逻辑保留。没有增加自动续期：巡检只查询状态，不能恢复已失效的登录凭证。失效时重新导入新的 sessionKey。

会话额度来自上游 SSE 的 `message_limit` 事件，尚未捕获时显示「—」。「账号刷新」是账号状态查询，不应被理解为额度实时拉取或授权续期。
