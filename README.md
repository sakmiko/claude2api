# Claude2API

[![Go 1.24](https://img.shields.io/badge/Go-1.24-blue.svg)](https://golang.org/)
[![Docker Compose](https://img.shields.io/badge/Docker-Compose-2496ED.svg)](docker-compose.yml)
[![OpenAI Compatible](https://img.shields.io/badge/API-OpenAI%20%7C%20Anthropic-green.svg)](docs/CLIENT_SETUP.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)

**Claude2API** 是基于 Go 语言开发的高性能 Claude.ai 逆向兼容网关、账号池调度中心与镜像代理服务。

通过统一管理多个 Claude.ai 账号凭证并实现智能负载轮询，项目将 Claude 模型能力无缝转化为工业标准的 **OpenAI API** 与 **Anthropic API** 规范。第三方客户端（如 Claude Code、OpenCode、NextChat、LobeChat、Codex CLI 等）无需修改调用逻辑，仅需配置自定义 Base URL 即可即开即用。

---

## 核心架构与功能矩阵

### 1. 协议双栈兼容与客户端直连
- **Anthropic 官方规范**：原生兼容 `POST /v1/messages` 接口，支持 Claude Code 官方命令行工具直接驱动。
- **OpenAI 双协议适配**：
  - 经典对话流：`POST /v1/chat/completions`；
  - 新一代响应流：`POST /v1/responses`。
- **模型无感映射**：内置 `GET /v1/models`，支持 `claude-sonnet-4-6`、`claude-sonnet-5`、`claude-haiku-4-5-20251001` 等模型，附带 `-thinking` 后缀自动开启扩展深度思考模式。

### 2. 企业级功能完备性
- **全链路流式响应 (SSE)**：支持 Server-Sent Events 流式与非流式双模，低首字延迟，高 TPS 吞吐。
- **高级特性无损支持**：
  - **Tool Use / Function Calling**：完整支持 OpenAI `tools` 与 Anthropic `tool_use` 规范，支持工具调用与执行结果多轮自动回传；
  - **多模态视觉理解**：支持 Base64 / URL 图片上传与 Claude.ai 上游多模态网关自动转换；
  - **超长上下文自动转附件**：当单次对话 Token / 字符数突破阈值时，自动将上下文转换为文本附件上传，规避单次请求上下文溢出；
  - **自动会话清理**：请求处理完毕后，后台自动原子化清理 Claude.ai 上游临时对话，保护账号隐私并保持干净界面。

### 3. 现代化工作台与号池集群
- **自适应 WebUI 控制台**：支持多端自适应布局、深色/浅色主题、在线多轮对话测试 Playground；
- **智能轮询与冷却容灾**：多账号自动负载均衡，支持同一账号请求速率平滑、账号风控自动冷却（Cooldown）以及坏号自动隔离；
- **可观测性监控**：内置详尽的 API 审计日志，包括首字延迟、TPS、Token 消耗、上游返回状态及全量请求/响应回溯。

---

## 界面与效果预览

<table width="100%">
  <tr>
    <td width="50%"><img src="https://i.ibb.co/3yMvBm0R/image.png" alt="控制台概览" border="0"></td>
    <td width="50%"><img src="https://i.ibb.co/zhpt12gG/image.png" alt="号池管理" border="0"></td>
  </tr>
  <tr>
    <td width="50%"><img src="https://i.ibb.co/XZ4G85yp/image.png" alt="在线对话测试" border="0"></td>
    <td width="50%"><img src="https://i.ibb.co/LhxVLkYN/image.png" alt="客户端接入向导" border="0"></td>
  </tr>
  <tr>
    <td width="50%"><img src="https://i.ibb.co/99v19T70/image.png" alt="调用日志统计" border="0"></td>
    <td width="50%"><img src="https://i.ibb.co/ZpYzPkb9/image.png" alt="运行时参数配置" border="0"></td>
  </tr>
</table>

---

## 快速部署指南

### 方式一：Docker Compose 一键部署（推荐）

1. 克隆仓库并进入项目根目录：
   ```bash
   git clone https://github.com/sakmiko/claude2api.git
   cd claude2api
   ```

2. 准备运行配置文件：
   ```bash
   mkdir -p runtime-config
   cp config.example.yaml runtime-config/config.yaml
   ```
   *编辑 `runtime-config/config.yaml`，修改 `admin_password`（后台管理员密码）及网络代理等参数。*

3. 构建并启动容器集群：
   ```bash
   # 从源码直接构建并后台运行
   docker compose -f docker-compose.local.yml up -d --build
   ```

4. 访问管理控制台：
   - 打开浏览器访问：`http://<服务器IP>:8787`
   - 使用配置的 `admin_password` 登录管理控制台。

---

### 方式二：本地 Go 源码直接运行

运行环境要求：`Go 1.23+`、`Node.js 18+`（如需重新构建 WebUI）。

```bash
# 1. 复制配置文件
cp config.example.yaml config.yaml

# 2. 编译服务端
go build -o claude2api ./cmd/server

# 3. 启动网关
./claude2api
```

---

## 环境变量与配置参数 (`config.yaml`)

| 配置项 | 默认值 | 说明 |
| :--- | :---: | :--- |
| `web_host` | `0.0.0.0` | 服务绑定地址（默认监听 8787 端口） |
| `web_uc_host` | `uc.localhost` | Artifacts 沙箱域名（支持多域名反代） |
| `admin_password` | `claude2api` | WebUI 管理后台管理员登录密码 |
| `proxy` | `""` | 访问 Claude.ai 的外部 HTTP/SOCKS5 代理（如 `http://127.0.0.1:7890`） |
| `retry_count` | `0` | 上游请求失败时的换号重试次数 |
| `delete_chat` | `true` | 请求完成后是否自动删除 Claude.ai 上游对话 |
| `max_history_length` | `12000` | 超长上下文自动转换为附件的触发阈值 |
| `detailed_api_log` | `true` | 是否保存详细的请求/响应内容日志 |
| `request_interval_seconds` | `2` | 单个账号连续调用的安全最小间隔时间 |
| `account_cooldown_seconds` | `300` | 账号触发限流/异常后的冷却锁定秒数 |

---

## 客户端接入示例

服务启动后，默认对外暴露的 Base URL 为 `http://<IP>:8787/v1`。

### 1. OpenAI SDK (Python)
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8787/v1",
    api_key="your_api_key_created_in_dashboard"
)

response = client.chat.completions.create(
    model="claude-sonnet-5",
    messages=[
        {"role": "system", "content": "你是一位资深架构师。"},
        {"role": "user", "content": "请简述 Go 语言并发调度的 GMP 模型。"}
    ],
    stream=True
)

for chunk in response:
    content = chunk.choices[0].delta.content or ""
    print(content, end="", flush=True)
```

### 2. Anthropic SDK / Claude Code
在终端中设置环境变量：
```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8787"
export ANTHROPIC_API_KEY="your_api_key_created_in_dashboard"

# 启动 Claude Code 命令行直接使用
claude
```

更多客户端（如 Codex、NextChat 等）的详细对接与排错指引，请参阅 [docs/CLIENT_SETUP.md](docs/CLIENT_SETUP.md)。

---

## 接口调用参考 (cURL)

<details>
<summary><code>GET /v1/models</code> (获取模型列表)</summary>

```bash
curl http://localhost:8787/v1/models \
  -H "Authorization: Bearer your_api_key"
```
</details>

<details>
<summary><code>POST /v1/chat/completions</code> (OpenAI 兼容对话)</summary>

```bash
curl http://localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-5",
    "messages": [
      {"role": "system", "content": "回答尽量简短"},
      {"role": "user", "content": "你好，请自我介绍"}
    ],
    "stream": true
  }'
```
</details>

<details>
<summary><code>POST /v1/messages</code> (Anthropic 兼容对话)</summary>

```bash
curl http://localhost:8787/v1/messages \
  -H "x-api-key: your_api_key" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-5",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "Hello!"}
    ],
    "stream": true
  }'
```
</details>

---

## 项目工程架构

```text
├── cmd/server/          # 程序入口 main.go
├── internal/
│   ├── adapter/         # OpenAI / Anthropic 双向协议管道与转换逻辑
│   ├── config/          # 运行时环境与 YAML 动态解析
│   ├── handler/         # HTTP 路由、鉴权与 WebAPI 控制器
│   ├── model/           # 数据实体与会话结构体
│   ├── service/         # 号池管理、轮询调度器与账号巡检引擎
│   └── util/            # 辅助工具库与网络安全检测
├── docs/                # 详细的技术对比、流式复核与排障文档
├── ui/ & web/           # 现代化 WebUI 前端静态资源与源码
├── docker-compose.yml   # 官方 Docker Compose 编排
└── Dockerfile           # 多阶段生产镜像构建文件
```

---

## 免责声明与安全警告

> **重要合规与使用声明**：
>
> 1. 本项目涉及对公开 Web 端能力的逆向转换与技术研究，**仅供个人学习、技术探讨与非商业性研究测试使用**。
> 2. **严禁用于任何商业牟利、批量刷量、接口倒卖、未授权转发或恶意网络攻击行为**。
> 3. 使用者应当自行承担账号被平台限制或封禁的风险，请勿在生产环境绑定重要或高价值的主力个人账号。
> 4. 本项目开源代码基于 [MIT License](LICENSE) 授权，遵循开源软件免责条款。
