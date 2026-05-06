/**
 * config-template.ts
 *
 * 两个默认配置文件：
 *   1. remote_exec.yaml      —— 主配置（启用 / 默认环境 / switch 工具开关）
 *   2. remote_exec_servers   —— VSCode SSH config 风格的服务器清单
 */

export const DEFAULT_REMOTE_EXEC_YAML = `# remote-exec 配置
#
# 让 AI 像在远端机器上原生运行本项目一样使用工具：
# AI 调用 list_files / read_file / write_file / shell ... 时，
# 后台自动翻译成等价的 ssh 命令在远端执行，并把结果整理回工具原有的 JSON 形态。
# AI 全程无感。
#
# 目标服务器写在同目录下的 \`remote_exec_servers\` 文件中（VSCode SSH 风格）。

# 是否启用本扩展（false 时所有工具静默走本地）
enabled: false

# 默认活动环境（启动时使用）：
#   local        本机执行（不走 SSH）
#   <Host 别名>  对应 remote_exec_servers 中的 Host
defaultEnvironment: local

# 是否向 AI 暴露 \`switch_environment\` 工具，让 AI 自主切换环境
# 关闭后只能由配置文件指定
exposeSwitchTool: true

# 远端工作目录（cwd）：所有翻译后的命令默认在此目录下执行。
# 留空则使用登录用户的 home。可在 servers 配置里按服务器单独覆写。
remoteWorkdir: ~

ssh:
  reuseConnection: true
  connectTimeoutMs: 10000
  keepAliveSec: 30
  commandTimeoutMs: 0
`;

export const DEFAULT_REMOTE_EXEC_SERVERS = `# remote-exec 服务器清单 — VSCode SSH config 风格
#
# 每个 Host 块定义一个远端服务器。在 remote_exec.yaml 中通过 Host 别名引用，
# AI 也通过该别名调用 switch_environment 切换。
#
# 标准字段：
#   Host         别名（必填，唯一）
#   HostName     实际主机名 / IP（必填）
#   Port         SSH 端口（默认 22）
#   User         登录用户名
#   IdentityFile 私钥文件绝对路径
#
# remote-exec 扩展字段：
#   Password     明文密码（与 IdentityFile 二选一；建议优先用密钥）
#   Workdir      该服务器上的默认工作目录（覆盖 remote_exec.yaml 的 remoteWorkdir）
#   Description  AI 可见的环境描述（switch_environment 工具会展示）
#   Transport    传输策略：auto（默认）/ sftp / bash
#                auto = 文件精确操作优先 SFTP，扫描/搜索/shell 走 bash
#                sftp = 文件精确操作强制 SFTP（失败时报错）
#                bash = 强制纯 bash，适配无 SFTP 的极简环境
#
# 示例：

# Host cqa1
#   HostName connect.cqa1.seetacloud.com
#   Port 32768
#   User root
#   IdentityFile C:\\Users\\Lianues\\.ssh\\id_rsa
#   Workdir /root/projects/myapp
#   Transport auto
#   Description GPU 训练机（A100 x 2）

# Host nginx-prod
#   HostName 93.127.137.197
#   User root
#   IdentityFile C:\\Users\\Lianues\\.ssh\\id_rsa_nginx_server
#   Workdir /etc/nginx
#   Description 生产环境 Nginx 节点

# Host quick-pwd
#   HostName 93.127.137.197
#   User lianuesss
#   Password your_password_here
#   Description 临时账号（密码登录）
`;
