# VPS 部署指南（Nginx + 域名 + HTTPS）

本指南将 IrisClaw 部署到 VPS，通过域名 + HTTPS 安全访问。

## 部署架构

```
浏览器 → https://chat.example.com (Nginx 443)
       → Nginx 反代 + HTTPS + 可选密码保护
       → http://127.0.0.1:8192 (IrisClaw，仅本机监听)
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
sudo useradd -r -s /bin/false -m -d /opt/irisclaw irisclaw

# 克隆项目
sudo git clone https://github.com/你的用户名/IrisClaw.git /opt/irisclaw
sudo chown -R irisclaw:irisclaw /opt/irisclaw
cd /opt/irisclaw

# 安装依赖并构建
sudo -u irisclaw npm run setup
sudo -u irisclaw npm run build

# 创建配置文件
sudo -u irisclaw cp config.example.yaml config.yaml
sudo -u irisclaw nano config.yaml
```

**配置要点**（`config.yaml`）：

```yaml
platform:
  type: web
  web:
    port: 8192
    host: 127.0.0.1  # 重要：仅监听本机，通过 Nginx 反代对外暴露
```

> **安全提示**：`host` 必须设为 `127.0.0.1`，不要用 `0.0.0.0`。否则应用会直接暴露在公网 8192 端口，绕过 Nginx 的 HTTPS 和认证保护。

## 4. 配置 systemd 服务

```bash
# 复制服务文件
sudo cp deploy/irisclaw.service /etc/systemd/system/

# 如果部署路径不是 /opt/irisclaw，编辑服务文件修改 WorkingDirectory
sudo nano /etc/systemd/system/irisclaw.service

# 创建数据目录
sudo mkdir -p /opt/irisclaw/data
sudo chown irisclaw:irisclaw /opt/irisclaw/data

# 启用并启动服务
sudo systemctl daemon-reload
sudo systemctl enable --now irisclaw

# 检查状态
sudo systemctl status irisclaw
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
sudo cp deploy/nginx.conf /etc/nginx/sites-available/irisclaw

# 编辑配置：将 chat.example.com 替换为你的域名
sudo nano /etc/nginx/sites-available/irisclaw

# 创建 certbot 验证目录
sudo mkdir -p /var/www/certbot

# 启用站点（如有默认站点可删除）
sudo ln -s /etc/nginx/sites-available/irisclaw /etc/nginx/sites-enabled/
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
sudo nano /etc/nginx/sites-available/irisclaw
# 找到以下两行，去掉前面的 #：
#   auth_basic "IrisClaw";
#   auth_basic_user_file /etc/nginx/.htpasswd;

# 重载 Nginx
sudo nginx -t && sudo systemctl reload nginx
```

## 8. 可选：Cloudflare 接入

如果域名托管在 Cloudflare，可以通过 Web GUI 内置的管理面板完成配置：

1. 打开 Web GUI → **设置中心**（左下角 ⚙ 按钮）→ 滚动到 **Cloudflare 管理**
2. 按引导输入 API Token 并连接
3. 添加 A 记录：名称填子域名（如 `chat`），内容填 VPS 公网 IP，开启 CDN 代理
4. 设置 SSL 模式：
   - **已配 HTTPS**（上方第 6 步）→ 选 **Full** 或 **Full (Strict)**
   - **未配 HTTPS** → 选 **Flexible**（CF 到源站走 HTTP）

> **注意**：使用 CF 代理时，Nginx 配置中已附带注释掉的 `set_real_ip_from` 块，取消注释即可还原真实用户 IP。

DNS 记录通过 CF 代理通常 1-5 分钟生效。

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
sudo systemctl status irisclaw
sudo systemctl status nginx

# 2. 浏览器访问
# 打开 https://你的域名，应看到 IrisClaw Web 界面

# 3. 测试 SSE 流式输出
# 在界面中发送消息，文字应逐字流式显示，而非等待完成后一次性出现

# 4. 检查 HTTPS
# 浏览器地址栏应显示锁图标
```

## 11. 日常维护

### 查看日志

```bash
# 应用日志
sudo journalctl -u irisclaw -f

# Nginx 日志
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### 更新代码

```bash
cd /opt/irisclaw
sudo -u irisclaw git pull
sudo -u irisclaw npm run setup
sudo -u irisclaw npm run build
sudo systemctl restart irisclaw
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
| 502 Bad Gateway | `systemctl status irisclaw` 检查应用是否运行 |
| SSE 流式输出被缓冲 | 确认 Nginx 配置中 `/api/chat` 的 `proxy_buffering off` |
| 证书申请失败 | 确认 DNS 已指向 VPS、80 端口已开放 |
| 应用启动失败 | `journalctl -u irisclaw -e` 查看错误日志 |
| 页面空白 | 确认已执行 `npm run build`，检查 `web-ui/dist/` 是否存在 |
