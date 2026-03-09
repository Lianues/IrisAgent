<template>
  <div class="deploy-page">
    <!-- 左侧表单 -->
    <div class="deploy-form">
      <span class="deploy-kicker">Delivery Studio</span>
      <h2 class="deploy-title">部署配置生成器</h2>
      <p class="deploy-desc">填写参数，实时生成 nginx 和 systemd 配置文件</p>
      <div class="deploy-badges">
        <span class="deploy-badge">{{ detectLoaded ? (canDeploy ? '环境就绪' : '环境待处理') : '环境检测中' }}</span>
        <span class="deploy-badge subtle">{{ activeTab === 'nginx' ? 'Nginx 配置' : 'Service 配置' }}</span>
      </div>

      <!-- 环境检测面板 -->
      <div class="deploy-detect" v-if="detectLoaded">
        <h3 class="detect-title">环境检测</h3>
        <div class="detect-item" :class="detect.isLinux ? 'detect-ok' : 'detect-fail'">
          <AppIcon :name="detect.isLinux ? ICONS.status.ok : ICONS.status.fail" class="detect-icon" />
          <span>Linux 系统{{ detect.isLinux ? '' : '（当前非 Linux）' }}</span>
        </div>
        <div class="detect-item" :class="detect.isLocal ? 'detect-ok' : 'detect-warn'">
          <AppIcon :name="detect.isLocal ? ICONS.status.ok : ICONS.status.warn" class="detect-icon" />
          <span>本地访问{{ detect.isLocal ? '' : '（当前为远程访问）' }}</span>
        </div>
        <div class="detect-item" :class="detect.nginx.installed ? 'detect-ok' : 'detect-fail'">
          <AppIcon :name="detect.nginx.installed ? ICONS.status.ok : ICONS.status.fail" class="detect-icon" />
          <span>Nginx {{ detect.nginx.installed ? `v${detect.nginx.version}` : '未安装' }}</span>
          <span v-if="detect.nginx.existingConfig" class="detect-extra">（已有配置）</span>
        </div>
        <div class="detect-item" :class="detect.systemd.available ? 'detect-ok' : 'detect-fail'">
          <AppIcon :name="detect.systemd.available ? ICONS.status.ok : ICONS.status.fail" class="detect-icon" />
          <span>Systemd {{ detect.systemd.available ? '可用' : '不可用' }}</span>
          <span v-if="detect.systemd.existingService" class="detect-extra">
            （服务状态: {{ detect.systemd.serviceStatus }}）
          </span>
        </div>
        <div class="detect-item" :class="sudoClass">
          <AppIcon :name="detect.sudo.available ? (detect.sudo.noPassword ? ICONS.status.ok : ICONS.status.warn) : ICONS.status.fail" class="detect-icon" />
          <span>
            sudo {{ !detect.sudo.available ? '未安装' : (detect.sudo.noPassword ? '免密可用' : '需要密码') }}
          </span>
        </div>
      </div>
      <div class="deploy-detect" v-else-if="detectError">
        <h3 class="detect-title">环境检测</h3>
        <div class="detect-item detect-fail">
          <AppIcon :name="ICONS.status.fail" class="detect-icon" />
          <span>检测失败: {{ detectError }}</span>
        </div>
      </div>
      <div class="deploy-detect" v-else>
        <h3 class="detect-title">环境检测</h3>
        <div class="detect-item detect-warn">
          <AppIcon :name="ICONS.status.loading" class="detect-icon" />
          <span>正在检测...</span>
        </div>
      </div>

      <!-- 前置引导 -->
      <div v-if="!detect.nginx.installed && detectLoaded && detect.isLinux" class="deploy-guide">
        <h4>Nginx 未安装？</h4>
        <p>在服务器上运行以下命令安装：</p>
        <code class="deploy-guide-cmd">sudo apt update && sudo apt install -y nginx</code>
        <p style="margin-top:6px">安装后刷新本页以重新检测。</p>
      </div>

      <div class="form-group">
        <label>域名 *</label>
        <input type="text" v-model="form.domain" placeholder="chat.example.com" />
        <p class="field-hint">已解析到服务器 IP 的域名。Cloudflare 用户填代理后的域名即可。</p>
      </div>

      <div class="form-group">
        <label>后端端口</label>
        <input type="number" v-model.number="form.port" placeholder="3000" />
        <p class="field-hint">IrisClaw 后端监听的端口，对应 config.yaml 中 web.port 的值。</p>
      </div>

      <div class="form-group">
        <label>部署路径</label>
        <input type="text" v-model="form.deployPath" placeholder="/opt/irisclaw" />
        <p class="field-hint">项目文件在服务器上的绝对路径，systemd 服务将从此目录启动。</p>
      </div>

      <div class="form-group">
        <label>运行用户</label>
        <input type="text" v-model="form.user" placeholder="irisclaw" />
        <p class="field-hint">
          systemd 服务运行的 Linux 用户。
          如未创建，可运行 <code style="background:var(--code-bg);padding:1px 5px;border-radius:4px">sudo useradd -r -s /bin/false irisclaw</code>
        </p>
      </div>

      <div class="form-group inline">
        <input type="checkbox" id="enableHttps" v-model="form.enableHttps" />
        <label for="enableHttps">启用 HTTPS</label>
      </div>
      <p v-if="form.enableHttps" class="field-hint" style="margin-top:-8px;margin-bottom:12px">
        需要先用 Certbot 申请证书：
        <code style="background:var(--code-bg);padding:1px 5px;border-radius:4px">
          sudo certbot certonly --webroot -w /var/www/certbot -d {{ domain }}
        </code>
        <br/>如使用 Cloudflare 代理，可在 CF 侧开启 SSL 而这里关闭 HTTPS。
      </p>

      <div class="form-group inline">
        <input type="checkbox" id="enableAuth" v-model="form.enableAuth" />
        <label for="enableAuth">启用密码保护（HTTP Basic Auth）</label>
      </div>
      <p v-if="form.enableAuth" class="field-hint" style="margin-top:-8px;margin-bottom:12px">
        需创建密码文件：
        <code style="background:var(--code-bg);padding:1px 5px;border-radius:4px">
          sudo apt install -y apache2-utils && sudo htpasswd -c /etc/nginx/.htpasswd youruser
        </code>
      </p>

      <!-- Cloudflare + 防火墙 引导 -->
      <div class="deploy-guide" style="margin-top:16px">
        <h4>后续步骤</h4>
        <p>部署 Nginx 后，还需完成以下操作才能从外部访问：</p>
        <ol style="margin:8px 0 0;padding-left:1.4em;line-height:2">
          <li><strong>开放防火墙端口</strong>
            <code class="deploy-guide-cmd" style="display:inline;padding:2px 8px;margin-left:4px">sudo ufw allow 80,443/tcp</code>
          </li>
          <li><strong>配置域名解析</strong> — 在域名服务商处添加 A 记录指向服务器 IP</li>
          <li v-if="form.enableHttps"><strong>申请 SSL 证书</strong> — 见上方 Certbot 命令</li>
          <li>
            <strong>使用 Cloudflare？</strong> — 前往
            <em style="color:var(--accent-cyan, var(--accent))">设置中心 → Cloudflare 管理</em>
            连接 Token、添加 DNS 记录、设置 SSL 模式
          </li>
        </ol>
        <p style="margin-top:8px">
          DNS 记录生效通常需要 1-5 分钟（Cloudflare 代理模式更快），请耐心等待后再验证。
        </p>
      </div>
    </div>

    <!-- 右侧输出 -->
    <div class="deploy-output">
      <div class="deploy-output-head">
        <div>
          <span class="deploy-output-label">实时预览</span>
          <h3 class="deploy-output-title">{{ activeTab === 'nginx' ? 'nginx.conf' : 'irisclaw.service' }}</h3>
        </div>
        <span class="deploy-output-status" :class="{ disabled: !canDeploy }">
          {{ canDeploy ? '可直接部署' : (deployDisabledReason || '仅生成配置') }}
        </span>
      </div>

      <div class="deploy-tabs">
        <button
          class="deploy-tab"
          type="button"
          :class="{ active: activeTab === 'nginx' }"
          @click="activeTab = 'nginx'"
        >nginx.conf</button>
        <button
          class="deploy-tab"
          type="button"
          :class="{ active: activeTab === 'service' }"
          @click="activeTab = 'service'"
        >irisclaw.service</button>
      </div>

      <div class="deploy-code-wrapper">
        <pre class="deploy-code">{{ activeTab === 'nginx' ? nginxConfig : serviceConfig }}</pre>
        <div class="deploy-actions">
          <button class="btn-copy" type="button" @click="handleCopy">{{ copyText }}</button>
          <button class="btn-download" type="button" @click="handleDownload">下载</button>
          <button
            class="btn-deploy"
            type="button"
            :disabled="!canDeploy"
            :title="deployDisabledReason"
            @click="showConfirm = true"
          >
            {{ activeTab === 'nginx' ? '部署 Nginx' : '部署 Service' }}
          </button>
        </div>
      </div>

      <!-- 部署步骤结果 -->
      <div class="deploy-steps" v-if="deployResult">
        <h3 class="deploy-steps-title">
          {{ deployResult.ok ? '部署成功' : '部署失败' }}
        </h3>
        <div
          v-for="(step, i) in deployResult.steps"
          :key="i"
          class="deploy-step"
          :class="step.success ? 'step-ok' : 'step-fail'"
        >
          <AppIcon :name="step.success ? ICONS.status.ok : ICONS.status.fail" class="step-icon" />
          <span class="step-name">{{ step.name }}</span>
          <span class="step-output">{{ step.output }}</span>
        </div>
        <div v-if="deployResult.error" class="deploy-step step-fail">
          <AppIcon :name="ICONS.status.warn" class="step-icon" />
          <span class="step-name">错误</span>
          <span class="step-output">{{ deployResult.error }}</span>
        </div>
      </div>
    </div>

    <!-- 确认弹窗 -->
    <Transition name="panel-modal">
      <div class="overlay" v-if="showConfirm" @click.self="showConfirm = false">
        <div class="deploy-confirm">
          <h3>确认部署</h3>
          <p>
            即将{{ activeTab === 'nginx' ? '部署 Nginx 反向代理配置' : '安装 systemd 服务' }}到服务器，
            此操作需要 sudo 权限。
          </p>
          <p v-if="activeTab === 'nginx' && detect.nginx.existingConfig" class="text-warn">
            注意：已存在 IrisClaw 的 nginx 配置，将被覆盖。
          </p>
          <p v-if="activeTab === 'service' && detect.systemd.existingService" class="text-warn">
            注意：已存在 IrisClaw 的 systemd 服务文件，将被覆盖。
          </p>
          <div class="form-group" style="margin-top:12px">
            <label>部署令牌</label>
            <input type="password" v-model="deployToken" placeholder="从服务端启动日志中获取" />
            <p class="field-hint">启动时日志会打印：部署令牌（一键部署需要）: xxxxx</p>
          </div>
          <div class="confirm-actions">
            <button class="btn-cancel" type="button" @click="showConfirm = false">取消</button>
            <button class="btn-deploy" type="button" @click="executeDeploy" :disabled="deploying || !deployToken.trim()">
              {{ deploying ? '部署中...' : '确认部署' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { reactive, computed, ref, onMounted } from 'vue'
import { detectDeploy, deployNginx, deployService } from '../api/client'
import type { DetectResponse, DeployResponse } from '../api/types'
import AppIcon from '../components/AppIcon.vue'
import { ICONS } from '../constants/icons'

const form = reactive({
  domain: '',
  port: 3000,
  deployPath: '/opt/irisclaw',
  user: 'irisclaw',
  enableHttps: true,
  enableAuth: false,
})

const activeTab = ref<'nginx' | 'service'>('nginx')
const copyText = ref('复制')

// 环境检测
const detectLoaded = ref(false)
const detectError = ref('')
const detect = reactive<DetectResponse>({
  isLinux: false,
  isLocal: false,
  nginx: { installed: false, version: '', configDir: '', existingConfig: false },
  systemd: { available: false, existingService: false, serviceStatus: '' },
  sudo: { available: false, noPassword: false },
})

// 部署令牌
const deployToken = ref('')

// 部署状态
const showConfirm = ref(false)
const deploying = ref(false)
const deployResult = ref<DeployResponse | null>(null)

onMounted(async () => {
  try {
    const result = await detectDeploy()
    Object.assign(detect, result)
    detectLoaded.value = true
  } catch (e: any) {
    detectError.value = e.message || '未知错误'
  }
})

const sudoClass = computed(() => {
  if (!detect.sudo.available) return 'detect-fail'
  return detect.sudo.noPassword ? 'detect-ok' : 'detect-warn'
})

const canDeploy = computed(() => {
  if (!detectLoaded.value) return false
  if (!detect.isLinux || !detect.isLocal) return false
  if (!detect.sudo.available || !detect.sudo.noPassword) return false
  if (activeTab.value === 'nginx' && !detect.nginx.installed) return false
  if (activeTab.value === 'service' && !detect.systemd.available) return false
  return true
})

const deployDisabledReason = computed(() => {
  if (!detectLoaded.value) return '环境检测中...'
  if (!detect.isLinux) return '仅支持 Linux 系统'
  if (!detect.isLocal) return '仅允许本地访问'
  if (!detect.sudo.available) return 'sudo 未安装'
  if (!detect.sudo.noPassword) return 'sudo 需要密码，请配置 NOPASSWD'
  if (activeTab.value === 'nginx' && !detect.nginx.installed) return 'Nginx 未安装'
  if (activeTab.value === 'service' && !detect.systemd.available) return 'Systemd 不可用'
  return ''
})

async function executeDeploy() {
  if (!deployToken.value.trim()) {
    deployResult.value = { ok: false, steps: [], error: '请输入部署令牌' }
    showConfirm.value = false
    return
  }
  deploying.value = true
  deployResult.value = null
  try {
    const token = deployToken.value.trim()
    if (activeTab.value === 'nginx') {
      deployResult.value = await deployNginx(nginxConfig.value, token)
    } else {
      deployResult.value = await deployService(serviceConfig.value, token)
    }
  } catch (e: any) {
    deployResult.value = {
      ok: false,
      steps: [],
      error: e.message || '请求失败',
    }
  } finally {
    deploying.value = false
    showConfirm.value = false
  }
}

const domain = computed(() => form.domain || 'chat.example.com')
const port = computed(() => form.port || 3000)

const nginxConfig = computed(() => {
  const d = domain.value
  const p = port.value

  const authBlock = form.enableAuth
    ? `    auth_basic "IrisClaw";
    auth_basic_user_file /etc/nginx/.htpasswd;

`
    : ''

  const sseLocation = `    # SSE 专用：/api/chat
    location /api/chat {
        proxy_pass http://127.0.0.1:${p};

        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;

        proxy_read_timeout 300s;
        proxy_send_timeout 300s;

        proxy_set_header Connection '';
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }`

  const generalLocation = `    location / {
        proxy_pass http://127.0.0.1:${p};
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }`

  if (!form.enableHttps) {
    // 仅 HTTP
    return `server {
    listen 80;
    listen [::]:80;
    server_name ${d};

    # 安全头
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Cloudflare 真实 IP 还原（如使用 CF 代理请取消注释）
    # set_real_ip_from 173.245.48.0/20;
    # set_real_ip_from 103.21.244.0/22;
    # set_real_ip_from 103.22.200.0/22;
    # set_real_ip_from 103.31.4.0/22;
    # set_real_ip_from 141.101.64.0/18;
    # set_real_ip_from 108.162.192.0/18;
    # set_real_ip_from 190.93.240.0/20;
    # set_real_ip_from 188.114.96.0/20;
    # set_real_ip_from 197.234.240.0/22;
    # set_real_ip_from 198.41.128.0/17;
    # set_real_ip_from 162.158.0.0/15;
    # set_real_ip_from 104.16.0.0/13;
    # set_real_ip_from 104.24.0.0/14;
    # set_real_ip_from 172.64.0.0/13;
    # set_real_ip_from 131.0.72.0/22;
    # real_ip_header CF-Connecting-IP;

${authBlock}${sseLocation}

${generalLocation}
}`
  }

  // HTTPS + HTTP 重定向
  return `# HTTP → HTTPS 重定向
server {
    listen 80;
    listen [::]:80;
    server_name ${d};

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

# HTTPS 主站
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${d};

    # SSL 证书（Let's Encrypt）
    ssl_certificate     /etc/letsencrypt/live/${d}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${d}/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # 安全头
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Cloudflare 真实 IP 还原（如使用 CF 代理请取消注释）
    # set_real_ip_from 173.245.48.0/20;
    # set_real_ip_from 103.21.244.0/22;
    # set_real_ip_from 103.22.200.0/22;
    # set_real_ip_from 103.31.4.0/22;
    # set_real_ip_from 141.101.64.0/18;
    # set_real_ip_from 108.162.192.0/18;
    # set_real_ip_from 190.93.240.0/20;
    # set_real_ip_from 188.114.96.0/20;
    # set_real_ip_from 197.234.240.0/22;
    # set_real_ip_from 198.41.128.0/17;
    # set_real_ip_from 162.158.0.0/15;
    # set_real_ip_from 104.16.0.0/13;
    # set_real_ip_from 104.24.0.0/14;
    # set_real_ip_from 172.64.0.0/13;
    # set_real_ip_from 131.0.72.0/22;
    # real_ip_header CF-Connecting-IP;

${authBlock}${sseLocation}

${generalLocation}
}`
})

const serviceConfig = computed(() => {
  const p = form.deployPath || '/opt/irisclaw'
  const u = form.user || 'irisclaw'

  return `[Unit]
Description=IrisClaw AI Chat Service
After=network.target

[Service]
Type=simple

WorkingDirectory=${p}

ExecStart=/usr/bin/node dist/index.js

User=${u}
Group=${u}

Environment=NODE_ENV=production

Restart=on-failure
RestartSec=5

StandardOutput=journal
StandardError=journal

NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${p}/data

[Install]
WantedBy=multi-user.target
`
})

function currentContent() {
  return activeTab.value === 'nginx' ? nginxConfig.value : serviceConfig.value
}

function currentFilename() {
  return activeTab.value === 'nginx' ? 'nginx.conf' : 'irisclaw.service'
}

async function handleCopy() {
  try {
    await navigator.clipboard.writeText(currentContent())
    copyText.value = '已复制'
    setTimeout(() => { copyText.value = '复制' }, 2000)
  } catch {
    copyText.value = '复制失败'
    setTimeout(() => { copyText.value = '复制' }, 2000)
  }
}

function handleDownload() {
  const blob = new Blob([currentContent()], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = currentFilename()
  a.click()
  URL.revokeObjectURL(url)
}
</script>
