<template>
  <div class="deploy-page">
    <!-- 左侧表单 -->
    <div class="deploy-form">
      <span class="deploy-kicker">Delivery Studio</span>
      <h2 class="deploy-title">部署配置生成器</h2>
      <p class="deploy-desc">填写参数，由后端统一生成 nginx 和 systemd 配置文件</p>
      <div class="deploy-badges">
        <span class="deploy-badge">{{ detectLoaded ? (canDeploy ? '环境就绪' : '环境待处理') : '环境检测中' }}</span>
        <span class="deploy-badge subtle">{{ activeTab === 'nginx' ? 'Nginx 配置' : 'Service 配置' }}</span>
      </div>

      <div v-if="managementNotice" class="deploy-guide" style="margin-top:12px">
        <h4>管理接口认证</h4>
        <p>{{ managementNotice }}</p>
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
        <p class="field-hint">已解析到服务器 IP 的域名。留空时会使用示例域名生成预览，但不会允许部署。</p>
      </div>

      <div class="form-group">
        <label>后端端口</label>
        <input type="number" v-model.number="form.port" placeholder="8192" />
        <p class="field-hint">Iris 后端监听的端口，对应 config.yaml 中 web.port 的值。{{ runtimeHint }}</p>
      </div>

      <div class="form-group">
        <label>部署路径</label>
        <input type="text" v-model="form.deployPath" placeholder="/opt/iris" />
        <p class="field-hint">项目文件在服务器上的绝对路径，systemd 服务将从此目录启动。</p>
      </div>

      <div class="form-group">
        <label>运行用户</label>
        <input type="text" v-model="form.user" placeholder="iris" />
        <p class="field-hint">
          systemd 服务运行的 Linux 用户。
          如未创建，可运行 <code style="background:var(--code-bg);padding:1px 5px;border-radius:4px">sudo useradd -r -s /bin/false iris</code>
        </p>
      </div>

      <div class="form-group inline">
        <input type="checkbox" id="enableHttps" v-model="form.enableHttps" />
        <label for="enableHttps">启用 HTTPS</label>
      </div>
      <p v-if="form.enableHttps" class="field-hint" style="margin-top:-8px;margin-bottom:12px">
        需要先用 Certbot 申请证书：
        <code style="background:var(--code-bg);padding:1px 5px;border-radius:4px">
          sudo certbot certonly --webroot -w /var/www/certbot -d {{ previewDomain }}
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
          <span class="deploy-output-label">统一预览</span>
          <h3 class="deploy-output-title">{{ activeTab === 'nginx' ? 'nginx.conf' : 'iris.service' }}</h3>
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
        >iris.service</button>
      </div>

      <div class="deploy-code-wrapper">
        <pre class="deploy-code">{{ currentPreviewContent }}</pre>
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

      <!-- 联动建议 -->
      <div class="deploy-steps" v-if="preview.recommendations.length">
        <h3 class="deploy-steps-title">联动建议</h3>
        <div
          v-for="(message, i) in preview.recommendations"
          :key="`rec-${i}`"
          class="deploy-step"
        >
          <AppIcon :name="ICONS.status.ok" class="step-icon" />
          <span class="step-name">建议</span>
          <span class="step-output">{{ message }}</span>
        </div>
      </div>

      <!-- 预览校验 -->
      <div class="deploy-steps" v-if="preview.errors.length || preview.warnings.length">
        <h3 class="deploy-steps-title">预览校验</h3>
        <div
          v-for="(message, i) in preview.errors"
          :key="`error-${i}`"
          class="deploy-step step-fail"
        >
          <AppIcon :name="ICONS.status.fail" class="step-icon" />
          <span class="step-name">错误</span>
          <span class="step-output">{{ message }}</span>
        </div>
        <div
          v-for="(message, i) in preview.warnings"
          :key="`warning-${i}`"
          class="deploy-step"
        >
          <AppIcon :name="ICONS.status.warn" class="step-icon" />
          <span class="step-name">提示</span>
          <span class="step-output">{{ message }}</span>
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

      <!-- 部署后：Cloudflare SSL 一键同步 -->
      <div class="deploy-steps" v-if="showCloudflareSync">
        <h3 class="deploy-steps-title">Cloudflare SSL 同步</h3>
        <div class="deploy-step">
          <AppIcon :name="ICONS.status.warn" class="step-icon" />
          <span class="step-name">当前模式</span>
          <span class="step-output">{{ cloudflareModeLabel(preview.cloudflare?.sslMode || null) }}</span>
        </div>
        <div class="deploy-step" style="grid-template-columns: 20px minmax(0,1fr)">
          <AppIcon :name="ICONS.status.ok" class="step-icon" />
          <div>
            <div style="display:flex;gap:10px;flex-wrap:wrap">
              <button
                class="btn-save"
                type="button"
                :disabled="cfSyncing"
                @click="handleSyncCloudflare(form.enableHttps ? 'strict' : 'flexible')"
              >
                {{ cfSyncing ? '同步中...' : (form.enableHttps ? '同步为 Full (Strict)' : '同步为 Flexible') }}
              </button>
              <button
                v-if="form.enableHttps"
                class="btn-download"
                type="button"
                :disabled="cfSyncing"
                @click="handleSyncCloudflare('full')"
              >
                同步为 Full
              </button>
            </div>
            <p class="field-hint" style="margin-top:8px">
              建议：{{ form.enableHttps ? '源站已启用 HTTPS，优先使用 Full (Strict)。' : '源站为 HTTP-only，建议保持 Flexible。' }}
            </p>
            <span v-if="cfSyncMsg" class="settings-status" :class="{ error: cfSyncError }" style="margin-top:8px;display:inline-flex">
              {{ cfSyncMsg }}
            </span>
          </div>
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
            注意：已存在 Iris 的 nginx 配置，将被覆盖。
          </p>
          <p v-if="activeTab === 'service' && detect.systemd.existingService" class="text-warn">
            注意：已存在 Iris 的 systemd 服务文件，将被覆盖。
          </p>
          <div class="form-group" style="margin-top:12px">
            <label>部署令牌</label>
            <input type="password" v-model="deployToken" placeholder="从服务端启动日志中获取" />
            <p class="field-hint">启动时日志会打印：部署令牌（一键部署需要）: xxxxx</p>
          </div>
          <div class="confirm-actions">
            <button class="btn-cancel" type="button" @click="showConfirm = false">取消</button>
            <button class="btn-deploy" type="button" @click="executeDeploy" :disabled="deploying || !deployToken.trim() || !canDeploy">
              {{ deploying ? '部署中...' : '确认部署' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { reactive, computed, ref, onMounted, onUnmounted, watch } from 'vue'
import { getDeployState, detectDeploy, previewDeploy, deployNginx, deployService, syncDeployCloudflare } from '../api/client'
import type { DetectResponse, DeployResponse, DeployFormOptions, DeployPreviewResponse, CloudflareSslMode } from '../api/types'
import AppIcon from '../components/AppIcon.vue'
import { ICONS } from '../constants/icons'
import { loadManagementToken, subscribeManagementTokenChange } from '../utils/managementToken'

const form = reactive<DeployFormOptions>({
  domain: '',
  port: 8192,
  deployPath: '/opt/iris',
  user: 'iris',
  enableHttps: true,
  enableAuth: false,
})

const runtimeWeb = reactive({
  host: '127.0.0.1',
  port: 8192,
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

// 部署默认值加载
const formReady = ref(false)
const stateError = ref('')

// 统一预览
const previewLoaded = ref(false)
const previewLoading = ref(false)
const preview = reactive<DeployPreviewResponse>({
  options: {
    domain: 'chat.example.com',
    port: 8192,
    deployPath: '/opt/iris',
    user: 'iris',
    enableHttps: true,
    enableAuth: false,
  },
  nginxConfig: '',
  serviceConfig: '',
  warnings: [],
  errors: [],
  recommendations: [],
  cloudflare: null,
})

// 部署令牌
const deployToken = ref('')

// 部署状态
const showConfirm = ref(false)
const deploying = ref(false)
const deployResult = ref<DeployResponse | null>(null)
const lastDeployTarget = ref<'nginx' | 'service' | null>(null)

// Cloudflare 一键同步
const cfSyncing = ref(false)
const cfSyncMsg = ref('')
const cfSyncError = ref(false)

const runtimeHint = computed(() => {
  const base = `当前运行配置：${runtimeWeb.host}:${runtimeWeb.port}`
  return stateError.value ? `${base}（读取部署默认值失败，已回退到本地默认值）` : base
})

const previewDomain = computed(() => form.domain.trim() || preview.options.domain || 'chat.example.com')

const managementTokenReady = ref(false)
let unsubscribeManagementToken: (() => void) | null = null

function refreshManagementTokenReady() {
  managementTokenReady.value = !!loadManagementToken().trim()
}

const managementNotice = computed(() => {
  if (managementTokenReady.value) return ''
  return '如果后端配置了 platform.web.managementToken，请先在浏览器中保存管理令牌，否则部署预览与执行会返回 401。'
})

const showCloudflareSync = computed(() => {
  return activeTab.value === 'nginx'
    && lastDeployTarget.value === 'nginx'
    && !!deployResult.value?.ok
    && !!preview.cloudflare?.connected
})

function getRecommendedAutoSyncMode(): 'flexible' | 'strict' | null {
  if (!preview.cloudflare?.connected) return null
  const expected = form.enableHttps ? 'strict' : 'flexible'
  return preview.cloudflare.sslMode === expected ? null : expected
}

async function promptAndSyncCloudflare(mode: 'flexible' | 'strict') {
  const current = cloudflareModeLabel(preview.cloudflare?.sslMode || null)
  const target = cloudflareModeLabel(mode)
  const hint = mode === 'strict'
    ? '源站已启用 HTTPS，建议 Cloudflare 使用 Full (Strict)。'
    : '源站为 HTTP-only，建议 Cloudflare 使用 Flexible。'

  const confirmed = window.confirm(
    `Nginx 部署成功。\n\n当前 Cloudflare SSL：${current}\n建议同步为：${target}\n\n${hint}\n\n是否立即同步？`,
  )

  if (!confirmed) return
  await handleSyncCloudflare(mode)
}

function cloudflareModeLabel(mode: CloudflareSslMode | null): string {
  if (!mode) return '未知'
  const map: Record<CloudflareSslMode, string> = {
    off: 'Off',
    flexible: 'Flexible',
    full: 'Full',
    strict: 'Full (Strict)',
    unknown: 'Unknown',
  }
  return map[mode] || mode
}


function buildDeployOptions(): DeployFormOptions {
  return {
    domain: form.domain,
    port: form.port,
    deployPath: form.deployPath,
    user: form.user,
    enableHttps: form.enableHttps,
    enableAuth: form.enableAuth,
  }
}

let previewRequestId = 0
let previewTimer: ReturnType<typeof setTimeout> | null = null

async function refreshPreview() {
  const requestId = ++previewRequestId
  previewLoading.value = true

  try {
    const result = await previewDeploy(buildDeployOptions())
    if (requestId !== previewRequestId) return
    Object.assign(preview, result)
  } catch (e: any) {
    if (requestId !== previewRequestId) return
    Object.assign(preview, {
      options: {
        domain: form.domain.trim() || 'chat.example.com',
        port: Number.isFinite(form.port) ? form.port : runtimeWeb.port,
        deployPath: form.deployPath.trim() || '/opt/iris',
        user: form.user.trim() || 'iris',
        enableHttps: form.enableHttps,
        enableAuth: form.enableAuth,
      },
      nginxConfig: '',
      serviceConfig: '',
      warnings: [],
      errors: [`生成预览失败: ${e.message || '未知错误'}`],
      recommendations: [],
      cloudflare: null,
    })
  } finally {
    if (requestId === previewRequestId) {
      previewLoaded.value = true
      previewLoading.value = false
    }
  }
}

function schedulePreview() {
  if (!formReady.value) return
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = setTimeout(() => {
    void refreshPreview()
  }, 150)
}

watch(form, schedulePreview, { deep: true })

onUnmounted(() => {
  if (previewTimer) clearTimeout(previewTimer)
  unsubscribeManagementToken?.()
})

onMounted(async () => {
  refreshManagementTokenReady()
  unsubscribeManagementToken = subscribeManagementTokenChange(refreshManagementTokenReady)

  await Promise.all([loadDetect(), loadDeployState()])
  formReady.value = true
  await refreshPreview()
})

async function loadDetect() {
  try {
    const result = await detectDeploy()
    Object.assign(detect, result)
    detectLoaded.value = true
  } catch (e: any) {
    detectError.value = e.message || '未知错误'
    detectLoaded.value = true
  }
}

async function loadDeployState() {
  try {
    const result = await getDeployState()
    runtimeWeb.host = result.web.host
    runtimeWeb.port = result.web.port
    Object.assign(form, result.defaults)
  } catch (e: any) {
    stateError.value = e.message || '未知错误'
  }
}

const sudoClass = computed(() => {
  if (!detect.sudo.available) return 'detect-fail'
  return detect.sudo.noPassword ? 'detect-ok' : 'detect-warn'
})

const environmentReady = computed(() => {
  if (!detectLoaded.value) return false
  if (!detect.isLinux || !detect.isLocal) return false
  if (!detect.sudo.available || !detect.sudo.noPassword) return false
  if (activeTab.value === 'nginx' && !detect.nginx.installed) return false
  if (activeTab.value === 'service' && !detect.systemd.available) return false
  return true
})

const environmentDisabledReason = computed(() => {
  if (!detectLoaded.value) return '环境检测中...'
  if (detectError.value) return `环境检测失败: ${detectError.value}`
  if (!detect.isLinux) return '仅支持 Linux 系统'
  if (!detect.isLocal) return '仅允许本地访问'
  if (!detect.sudo.available) return 'sudo 未安装'
  if (!detect.sudo.noPassword) return 'sudo 需要密码，请配置 NOPASSWD'
  if (activeTab.value === 'nginx' && !detect.nginx.installed) return 'Nginx 未安装'
  if (activeTab.value === 'service' && !detect.systemd.available) return 'Systemd 不可用'
  return ''
})

const previewDisabledReason = computed(() => {
  if (!previewLoaded.value || previewLoading.value) return '预览生成中...'
  if (preview.errors.length > 0) return preview.errors[0]
  return ''
})

const canDeploy = computed(() => {
  return environmentReady.value && !previewLoading.value && preview.errors.length === 0
})

const deployDisabledReason = computed(() => {
  return environmentDisabledReason.value || previewDisabledReason.value
})

const currentPreviewContent = computed(() => {
  if (previewLoading.value && !previewLoaded.value) return '正在生成预览...'
  return activeTab.value === 'nginx'
    ? (preview.nginxConfig || '暂无预览')
    : (preview.serviceConfig || '暂无预览')
})

function currentFilename() {
  return activeTab.value === 'nginx' ? 'nginx.conf' : 'iris.service'
}

async function executeDeploy() {
  if (!deployToken.value.trim()) {
    deployResult.value = { ok: false, steps: [], error: '请输入部署令牌' }
    showConfirm.value = false
    return
  }

  if (!canDeploy.value) {
    deployResult.value = { ok: false, steps: [], error: deployDisabledReason.value || '当前配置不可部署' }
    showConfirm.value = false
    return
  }

  deploying.value = true
  deployResult.value = null
  lastDeployTarget.value = activeTab.value
  cfSyncMsg.value = ''
  cfSyncError.value = false

  let autoSyncMode: 'flexible' | 'strict' | null = null

  try {
    const token = deployToken.value.trim()
    const options = buildDeployOptions()
    if (activeTab.value === 'nginx') {
      deployResult.value = await deployNginx(options, token)
      if (deployResult.value?.ok) {
        autoSyncMode = getRecommendedAutoSyncMode()
      }
    } else {
      deployResult.value = await deployService(options, token)
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

  if (autoSyncMode) {
    await promptAndSyncCloudflare(autoSyncMode)
  }
}


async function handleSyncCloudflare(mode: 'flexible' | 'full' | 'strict') {
  if (!preview.cloudflare?.connected) {
    cfSyncMsg.value = 'Cloudflare 未连接，无法同步'
    cfSyncError.value = true
    return
  }

  cfSyncing.value = true
  cfSyncMsg.value = ''
  cfSyncError.value = false

  try {
    const result = await syncDeployCloudflare(mode, preview.cloudflare.zoneId)
    if (!result.ok) {
      cfSyncMsg.value = result.error || '同步失败'
      cfSyncError.value = true
      return
    }

    const syncedMode = result.mode || mode
    if (preview.cloudflare) {
      preview.cloudflare.sslMode = syncedMode
    }
    cfSyncMsg.value = `已同步 Cloudflare SSL 模式为 ${cloudflareModeLabel(syncedMode)}`
    cfSyncError.value = false

    // 同步后刷新预览，让联动建议和校验结果即时更新
    await refreshPreview()
  } catch (e: any) {
    cfSyncMsg.value = e.message || '同步失败'
    cfSyncError.value = true
  } finally {
    cfSyncing.value = false
  }
}

async function handleCopy() {
  try {
    await navigator.clipboard.writeText(currentPreviewContent.value)
    copyText.value = '已复制'
    setTimeout(() => { copyText.value = '复制' }, 2000)
  } catch {
    copyText.value = '复制失败'
    setTimeout(() => { copyText.value = '复制' }, 2000)
  }
}

function handleDownload() {
  const blob = new Blob([currentPreviewContent.value], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = currentFilename()
  a.click()
  URL.revokeObjectURL(url)
}
</script>
