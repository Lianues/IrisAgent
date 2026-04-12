# 部署指南

## Windows 一键部署

双击 `start.bat` 即可启动，无需预装 Node.js：

1. 首次运行自动下载 Node.js 便携版 → 安装依赖 → 构建 → 生成默认配置
2. 启动后自动打开浏览器访问 `http://localhost:8192`
3. 关闭 cmd 窗口即停止服务
4. 再次启动会自动清理残留端口占用，跳过已完成的安装步骤

**异常处理**：启动失败时窗口会暂停并显示错误信息，不会闪退。

---

## Linux VPS 部署（Nginx + 域名 + HTTPS）

本节将 Iris 部署到 VPS，通过域名 + HTTPS 安全访问。

> 若启用了 `platform.web.managementToken`，Web GUI 中的配置/部署/Cloudflare 管理接口会要求 `X-Management-Token`。请先在侧边栏“管理令牌”中录入。

## 部署架构

```
浏览器 → https://chat.example.com (Nginx 443)
       → Nginx 反代 + HTTPS + 可选密码保护
       → http://127.0.0.1:8192 (Iris，仅本机监听)
```

---

## 1. 前置准备

- **VPS**：Ubuntu 22.04 / Debian 12（其他发行版类似）
- **域名**：已注册，DNS A 记录指向 VPS 公网 IP
- **SSH 访问**：能以 root 或 sudo 用户登录 VPS

```bash
# 确认 DNS 已生效（替换为你的域名）
dig +short chat.example.com
# 应返回你的 VPS IP
```

## 2. 安装 Node.js

通过 NodeSource 安装 Node.js 20+：

```bash
# 安装 NodeSource 仓库
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

# 安装 Node.js
sudo apt install -y nodejs

# 验证版本
node -v  # 应 >= 20.x
npm -v
```

## 3. 部署应用

```bash
# 创建专用用户
sudo useradd -r -s /bin/false -m -d /opt/iris iris

# 克隆项目
sudo git clone https://github.com/你的用户名/Iris.git /opt/iris
sudo chown -R iris:iris /opt/iris
cd /opt/iris

# 安装依赖并构建
sudo -u iris npm run setup
sudo -u iris npm run build

# 创建分文件配置目录
sudo -u iris cp -r data/configs.example data/configs

# 编辑平台配置
sudo -u iris nano data/configs/platform.yaml

# 编辑 LLM 配置
sudo -u iris nano data/configs/llm.yaml
```

**配置要点**（`data/configs/platform.yaml`）：

```yaml
type: web

web:
  port: 8192
  host: 127.0.0.1  # 重要：仅监听本机，通过 Nginx 反代对外暴露
```

> **安全提示**：`host` 必须设为 `127.0.0.1`，不要用 `0.0.0.0`。否则应用会直接暴露在公网 8192 端口，绕过 Nginx 的 HTTPS 和认证保护。

## 4. 配置 systemd 服务

```bash
# 复制服务文件
sudo cp deploy/linux/iris.service /etc/systemd/system/

# 如果部署路径不是 /opt/iris，编辑服务文件修改 WorkingDirectory
sudo nano /etc/systemd/system/iris.service

# 创建数据目录
sudo mkdir -p /opt/iris/data
sudo chown iris:iris /opt/iris/data

# 启用并启动服务
sudo systemctl daemon-reload
sudo systemctl enable --now iris

# 检查状态
sudo systemctl status iris
```

验证应用已启动：

```bash
curl http://127.0.0.1:8192/api/status
# 应返回正常响应
```

## 5. 配置 Nginx

```bash
# 安装 Nginx
sudo apt install -y nginx

# 复制配置文件
sudo cp deploy/linux/nginx.conf /etc/nginx/sites-available/iris

# 编辑配置：将 chat.example.com 替换为你的域名
sudo nano /etc/nginx/sites-available/iris

# 创建 certbot 验证目录
sudo mkdir -p /var/www/certbot

# 启用站点（如有默认站点可删除）
sudo ln -s /etc/nginx/sites-available/iris /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# 检查配置语法
sudo nginx -t

# 重载 Nginx
sudo systemctl reload nginx
```

## 6. 申请 HTTPS 证书

使用 Let's Encrypt（免费）：

```bash
# 安装 certbot
sudo apt install -y certbot python3-certbot-nginx

# 申请证书（替换域名）
sudo certbot --nginx -d chat.example.com

# certbot 会自动修改 Nginx 配置中的证书路径
# 按提示操作即可
```

验证证书自动续期：

```bash
sudo certbot renew --dry-run
```

> Let's Encrypt 证书有效期 90 天，certbot 自带定时任务自动续期。

## 7. 可选：密码保护

给 Web 界面加 HTTP Basic Auth 密码：

```bash
# 安装工具
sudo apt install -y apache2-utils

# 创建密码文件（替换"用户名"为你想要的用户名）
sudo htpasswd -c /etc/nginx/.htpasswd 用户名

# 编辑 Nginx 配置，取消 Basic Auth 注释
sudo nano /etc/nginx/sites-available/iris
# 找到以下两行，去掉前面的 #：
#   auth_basic "Iris";
#   auth_basic_user_file /etc/nginx/.htpasswd;

# 重载 Nginx
sudo nginx -t && sudo systemctl reload nginx
```

## 8. 可选：Cloudflare 接入

### 8.1 SSL 联动建议

- Cloudflare `Flexible` → 源站建议 HTTP-only（不要做 80→443 强制跳转）
- Cloudflare `Full/Strict` → 源站必须启用 HTTPS（443 + 证书）

部署生成器会根据当前 Cloudflare 状态给出联动建议和组合校验。

当你在部署页成功部署 Nginx 后，可直接点击“Cloudflare SSL 同步”将模式一键切换到：

- 源站 HTTPS：`Full (Strict)`（推荐）或 `Full`
- 源站 HTTP-only：`Flexible`


如果域名托管在 Cloudflare，可以通过 Web GUI 内置的管理面板完成配置：

1. 打开 Web GUI → **设置中心**（左下角 ⚙ 按钮）→ 滚动到 **Cloudflare 管理**
2. 按引导输入 API Token 并连接
3. 添加 A 记录：名称填子域名（如 `chat`），内容填 VPS 公网 IP，开启 CDN 代理
4. 设置 SSL 模式：
   - **已配 HTTPS**（上方第 6 步）→ 选 **Full** 或 **Full (Strict)**
   - **未配 HTTPS** → 选 **Flexible**（CF 到源站走 HTTP）

> **注意**：使用 CF 代理时，Nginx 配置中已附带注释掉的 `set_real_ip_from` 块，取消注释即可还原真实用户 IP。

DNS 记录通过 CF 代理通常 1-5 分钟生效。

### 8.2 Token 存储建议

Cloudflare Token 推荐通过环境变量或文件提供，避免明文写入 `data/configs/` 中的配置文件：

```yaml
cloudflare:
  apiTokenEnv: IRIS_CF_API_TOKEN
  zoneId: auto
```

## 9. 防火墙

部署完成后务必开放 Web 端口，否则外部无法访问：

```bash
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP（HTTPS 重定向 + 证书验证 + CF Flexible）
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
```

> 不要开放 8192 端口 —— 应用只监听 127.0.0.1，外部无法直连。

## 10. 验证部署

```bash
# 1. 检查服务状态
sudo systemctl status iris
sudo systemctl status nginx

# 2. 浏览器访问
# 打开 https://你的域名，应看到 Iris Web 界面

# 3. 测试 SSE 流式输出
# 在界面中发送消息，文字应逐字流式显示，而非等待完成后一次性出现

# 4. 检查 HTTPS
# 浏览器地址栏应显示锁图标
```

## 11. 日常维护

### 查看日志

```bash
# 应用日志
sudo journalctl -u iris -f

# Nginx 日志
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### 更新代码

```bash
cd /opt/iris
sudo -u iris git pull
sudo -u iris npm run setup
sudo -u iris npm run build
sudo systemctl restart iris
```

### 证书续期

Let's Encrypt 证书通过 certbot 定时任务自动续期，通常无需手动操作。确认定时任务存在：

```bash
sudo systemctl list-timers | grep certbot
```

---

## 故障排查

| 问题 | 排查方法 |
|------|----------|
| 502 Bad Gateway | `systemctl status iris` 检查应用是否运行 |
| SSE 流式输出被缓冲 | 确认 Nginx 配置中 `/api/chat` 的 `proxy_buffering off` |
| 证书申请失败 | 确认 DNS 已指向 VPS、80 端口已开放 |
| 应用启动失败 | `journalctl -u iris -e` 查看错误日志 |
| 页面空白 | 确认已执行 `npm run build`，检查 `web-ui/dist/` 是否存在 |

---

## Docker 部署

提供两个镜像变体，均发布到 GitHub Container Registry：

| 镜像 | 基础 | 体积 | 说明 |
|------|------|------|------|
| `ghcr.io/lianues/iris:latest` | Node 22 Debian slim | ~400 MB | 生产用，含 Web GUI + TUI 二进制 |
| `ghcr.io/lianues/iris:computer-use` | Ubuntu + Playwright | ~900 MB | 额外支持 AI 操控浏览器（Chromium） |

### 快速启动（使用预构建镜像）

无需克隆仓库、无需安装 Node.js，只需下载一个 compose 文件即可运行：

```bash
# 1. 下载 compose 文件
mkdir iris && cd iris
curl -O https://raw.githubusercontent.com/Lianues/Iris/main/deploy/docker/iris-compose.yml

# 2. 启动（自动拉取镜像）
docker compose -f iris-compose.yml up -d

# 3. 配置 LLM API Key
nano ~/.iris/configs/llm.yaml

# 4. 重启生效
docker compose -f iris-compose.yml restart
```

启动后：
- **Web GUI**：浏览器访问 `http://localhost:8192`
- **TUI**：终端直接输入 `iris`（二进制已自动部署到 `/usr/local/bin/`）

如需 Computer Use（浏览器自动化）：

```bash
docker compose -f iris-compose.yml --profile computer-use up -d iris-computer-use
```

### 从源码构建

适用于开发者或需要自定义构建的场景：

```bash
git clone https://github.com/Lianues/Iris.git
cd Iris

# 构建并启动 production 镜像
docker compose -f deploy/docker/docker-compose.yml build
docker compose -f deploy/docker/docker-compose.yml up -d

# 或构建 computer-use 镜像
docker compose -f deploy/docker/docker-compose.yml --profile computer-use build iris-computer-use
docker compose -f deploy/docker/docker-compose.yml --profile computer-use up -d iris-computer-use
```

也可以直接使用 `docker build`：

```bash
# 在项目根目录执行
docker build -t iris -f deploy/docker/Dockerfile .                                # production
docker build -t iris-cu -f deploy/docker/Dockerfile --target computer-use-base .  # computer-use
```

### 构建流程

Dockerfile 采用多阶段构建，共 6 个阶段：

```
Stage 1: deps            ── 安装所有依赖（含 devDeps、原生编译工具）
Stage 2: build-ui        ── 构建 Vue 3 Web UI（Vite）
Stage 3: build           ── 编译 TypeScript，然后 npm prune 移除 devDeps
Stage 4: bun-compile     ── 安装扩展依赖 + 使用 Bun 编译独立二进制（TUI + onboard）
Stage 5: production      ── Node 22 Debian slim 最终镜像（默认 target）
Stage 6: computer-use    ── Playwright Ubuntu 镜像（含 Chromium + playwright）
```

### 首次启动行为

容器首次启动时，`entrypoint.sh` 会：

1. 检查 `~/.iris/configs/` 是否为空
2. 如果为空，从内置模板复制默认配置
3. 自动将 `web.host` 改为 `0.0.0.0`（Docker 端口映射需要）
4. 部署 TUI 二进制（`iris`、`iris-onboard`）到宿主机 `/usr/local/bin/`
5. 以非 root 用户启动应用

### 环境变量

通过 `.env` 文件或 `docker compose` 的 `environment` 字段设置：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `IRIS_PLATFORM` | `web` | 启动的平台类型（`web`、`console` 等，逗号分隔）|
| `IRIS_PORT` | `8192` | 宿主机映射端口 |
| `IRIS_DATA_DIR` | `~/.iris` | 宿主机数据目录（配置、会话、数据库） |
| `IRIS_CLI_DIR` | `/usr/local/bin` | TUI 二进制部署目录 |

LLM API Key 不通过环境变量配置，而是编辑 `~/.iris/configs/llm.yaml`。

### 数据持久化

容器挂载宿主机 `~/.iris` 到 `/data`，TUI 和 Web GUI 共享同一份配置：

```
~/.iris/
├── configs/          ← 配置文件（首次启动从模板生成）
│   ├── llm.yaml      ← LLM API Key 和模型配置
│   ├── platform.yaml  ← 平台和网络配置
│   └── ...
├── sessions/         ← 会话数据
└── iris.db           ← SQLite 数据库
```

### Console TUI 和 Onboard

Docker 启动时会自动将 TUI 二进制部署到宿主机（通过 `/host-bin` 挂载），无需手动提取：

```bash
# 直接使用（已自动部署）
iris

# 交互式配置引导
iris-onboard
```

也可以在容器内直接运行：

```bash
# 在已运行的容器中启动 TUI
docker exec -it iris /app/bin/iris

# 首次配置使用 Onboard 引导
docker exec -it iris /app/bin/iris-onboard
```

### CI/CD 自动发布

`release.yml` 中的 `publish-docker` job 支持两种触发方式：

- **推送 `v*` 标签**：自动构建并发布所有内容（Docker + GitHub Release + npm）
- **手动触发**：在 Actions 页面勾选 `publish_docker` 单独构建 Docker 镜像

镜像推送到 GHCR，同时打 `latest` / `<version>` 和 `computer-use` / `<version>-computer-use` 标签。
