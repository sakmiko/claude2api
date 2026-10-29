# 启动本地升级版

解压后打开 `claude2api` 目录。源码包含已打包的界面资源，正常构建和运行不需要 Node。

## 使用 Docker

需要安装 Docker 和 Docker Compose。在包含 Dockerfile 的目录执行：

```bash
mkdir -p runtime-config
cp config.example.yaml runtime-config/config.yaml
```

打开 `runtime-config/config.yaml`，把 `admin_password` 改为自己的密码，再运行：

```bash
docker compose -f docker-compose.local.yml up -d --build
```

浏览器打开 `http://127.0.0.1:8787`，登录后在账号管理中导入 sessionKey，再创建客户端使用的访问密钥。

查看运行日志：

```bash
docker compose -f docker-compose.local.yml logs -f
```

默认的 `docker-compose.yml` 会拉取原项目镜像。本次修改在本地源码中，请使用上面的 `docker-compose.local.yml` 构建。

从上一版升级时，把已有的根目录 `config.yaml` 复制到 `runtime-config/config.yaml`。如果目标文件已经存在，先保留备份，不要用示例文件覆盖。账号数据库仍在原来的 `data` 目录。

## 使用 Go

需要 Go 1.25 或更新版本。在项目目录执行：

```bash
cp config.example.yaml config.yaml
# 修改 config.yaml 中的 admin_password
go build -o claude2api ./cmd/server
./claude2api
```

Windows 使用 `go build -o claude2api.exe ./cmd/server`，然后运行 `claude2api.exe`。

运行时会创建 `data` 目录，配置与账号数据保存在本机。手机或其他电脑访问时，把连接地址中的 `127.0.0.1` 换为服务器地址。OpenAI 客户端 Base URL 为 `http://服务器地址:8787/v1`，Anthropic 客户端使用根地址 `http://服务器地址:8787`。

## 说明

- 原有 sessionKey 导入流程保留。
- 三种接口是网页会话的适配，不能视为完整官方平台。模型和额度取决于账号实际权限。
- 本次未使用真实 Claude 凭据，真实上游调用仍需在你的环境验证。
- 代码包包含完整源码、依赖锁定、界面资源、测试、部署配置和审阅记录，不包含运行数据、真实凭据、依赖缓存或编译产物。
- 详细变更见 `docs/LOCAL_REVIEW.md` 与 `docs/STREAMING_REVIEW.md`。
