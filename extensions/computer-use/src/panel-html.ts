/**
 * Computer Use 扩展面板 HTML
 *
 * 自包含的配置页面，通过 registerWebRoute 提供给宿主 iframe 渲染。
 * 使用 Vue 3 CDN + 内联样式，与宿主前端框架完全解耦。
 * 通过扩展自身的 /api/ext/computer-use/config 路由读写配置。
 */
export function buildPanelHTML(): string {
  return /* html */ `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Computer Use</title>
<script src="https://unpkg.com/vue@3/dist/vue.global.prod.js"><\/script>
<style>
:root {
  --bg: #0e1117;
  --surface: #161b22;
  --surface-hover: #1c2129;
  --border: #30363d;
  --border-focus: #58a6ff;
  --text: #e6edf3;
  --text-secondary: #8b949e;
  --text-muted: #6e7681;
  --accent: #58a6ff;
  --success: #3fb950;
  --error: #f85149;
  --radius: 8px;
  --radius-sm: 6px;
  --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Noto Sans, Helvetica, Arial, sans-serif;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: var(--font);
  font-size: 14px;
  line-height: 1.5;
  color: var(--text);
  background: var(--bg);
  -webkit-font-smoothing: antialiased;
}

.panel {
  max-width: 860px;
  margin: 0 auto;
  padding: 24px 20px 40px;
}

.panel-header {
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
}
.panel-header h2 {
  font-size: 20px;
  font-weight: 700;
  margin-bottom: 4px;
}
.panel-header p {
  color: var(--text-secondary);
  font-size: 13px;
}

.section {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 18px;
  margin-bottom: 16px;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
@media (max-width: 600px) {
  .grid { grid-template-columns: 1fr; }
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.form-group.full { grid-column: 1 / -1; }

.form-group label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}

.hint {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
}

input[type="text"],
input[type="number"],
textarea,
select {
  width: 100%;
  padding: 8px 12px;
  font-size: 14px;
  font-family: var(--font);
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  outline: none;
  transition: border-color 0.15s;
}
input:focus, textarea:focus, select:focus {
  border-color: var(--border-focus);
}
select {
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238b949e' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  padding-right: 32px;
}
textarea { resize: vertical; min-height: 60px; }

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
}
.switch-row .switch-text {
  flex: 1;
  min-width: 0;
}
.switch-label {
  font-size: 14px;
  font-weight: 600;
}

.toggle {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
  flex-shrink: 0;
}
.toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
.toggle-track {
  position: absolute;
  inset: 0;
  background: var(--border);
  border-radius: 12px;
  transition: background 0.2s;
  cursor: pointer;
}
.toggle-track::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  background: #fff;
  border-radius: 50%;
  transition: transform 0.2s;
}
.toggle input:checked + .toggle-track {
  background: var(--accent);
}
.toggle input:checked + .toggle-track::after {
  transform: translateX(20px);
}

.sub-label {
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
  margin: 16px 0 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border);
}

.collapse-header {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 8px 0;
  user-select: none;
}
.collapse-header:hover { color: var(--accent); }
.collapse-arrow {
  display: inline-block;
  width: 0; height: 0;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-top: 6px solid var(--text-secondary);
  transition: transform 0.2s;
}
.collapse-arrow.open { transform: rotate(180deg); }
.collapse-label { font-size: 14px; font-weight: 700; }
.collapse-desc { font-size: 12px; color: var(--text-muted); }

.status-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 8px 20px;
  background: var(--surface);
  border-top: 1px solid var(--border);
  text-align: right;
  font-size: 13px;
  color: var(--text-secondary);
}
.status-bar.error { color: var(--error); }
.status-bar.saving { color: var(--accent); }

.loading {
  text-align: center;
  padding: 60px 0;
  color: var(--text-secondary);
}
</style>
</head>
<body>
<div id="app">
  <div class="panel">
    <div class="panel-header">
      <h2>Computer Use</h2>
      <p>启用浏览器或桌面自动化能力，让 AI 可以操作屏幕完成复杂任务。</p>
    </div>

    <div v-if="loading" class="loading">加载中…</div>
    <template v-else>
      <div class="section">
        <div class="switch-row">
          <div class="switch-text">
            <span class="switch-label">启用 Computer Use</span>
            <p class="hint">开启后 AI 将能使用浏览器或桌面截图与操作工具。</p>
          </div>
          <label class="toggle">
            <input type="checkbox" v-model="cu.enabled">
            <span class="toggle-track"></span>
          </label>
        </div>

        <template v-if="cu.enabled">
          <div class="grid" style="margin-top:14px">
            <div class="form-group">
              <label>执行环境</label>
              <select v-model="cu.environment">
                <option value="browser">Browser — Playwright 浏览器</option>
                <option value="screen">Screen — 系统桌面截图与鼠标键盘</option>
              </select>
            </div>
            <div class="form-group">
              <label>截图格式</label>
              <select v-model="cu.screenshotFormat">
                <option value="png">PNG — 无损格式</option>
                <option value="jpeg">JPEG — 有损压缩，体积更小</option>
              </select>
            </div>
            <div class="form-group">
              <label>视口宽度</label>
              <input type="number" v-model="cu.screenWidth" placeholder="1440" min="100">
            </div>
            <div class="form-group">
              <label>视口高度</label>
              <input type="number" v-model="cu.screenHeight" placeholder="900" min="100">
            </div>
            <div class="form-group">
              <label>截图质量</label>
              <input type="number" v-model="cu.screenshotQuality" placeholder="仅 JPEG 格式有效 (1-100)" min="1" max="100">
            </div>
            <div class="form-group">
              <label>保留截图轮次</label>
              <input type="number" v-model="cu.maxRecentScreenshots" placeholder="3" min="1">
            </div>
            <div class="form-group">
              <label>操作后延迟（ms）</label>
              <input type="number" v-model="cu.postActionDelay" placeholder="无延迟" min="0">
            </div>
          </div>

          <!-- browser 环境 -->
          <template v-if="cu.environment === 'browser'">
            <div class="sub-label">浏览器环境设置</div>
            <div class="grid">
              <div class="switch-row">
                <div class="switch-text">
                  <span class="switch-label">无头模式</span>
                  <p class="hint">不弹出浏览器窗口，在后台运行。</p>
                </div>
                <label class="toggle">
                  <input type="checkbox" v-model="cu.headless">
                  <span class="toggle-track"></span>
                </label>
              </div>
              <div class="switch-row">
                <div class="switch-text">
                  <span class="switch-label">高亮鼠标指针</span>
                  <p class="hint">在截图中标记鼠标位置。</p>
                </div>
                <label class="toggle">
                  <input type="checkbox" v-model="cu.highlightMouse">
                  <span class="toggle-track"></span>
                </label>
              </div>
              <div class="form-group full">
                <label>初始 URL</label>
                <input type="text" v-model="cu.initialUrl" placeholder="https://example.com">
                <p class="hint">浏览器启动时打开的页面。</p>
              </div>
              <div class="form-group full">
                <label>搜索引擎 URL</label>
                <input type="text" v-model="cu.searchEngineUrl" placeholder="https://www.google.com/search?q=">
              </div>
            </div>
          </template>

          <!-- screen 环境 -->
          <template v-if="cu.environment === 'screen'">
            <div class="sub-label">桌面环境设置</div>
            <div class="grid">
              <div class="form-group full">
                <label>目标窗口标题</label>
                <input type="text" v-model="cu.targetWindow" placeholder="子字符串匹配（可选）">
                <p class="hint">指定后仅截取包含该标题的窗口。</p>
              </div>
              <div class="switch-row">
                <div class="switch-text">
                  <span class="switch-label">后台模式</span>
                  <p class="hint">不将窗口置于前台，通过 PostMessage 在后台操作。</p>
                </div>
                <label class="toggle">
                  <input type="checkbox" v-model="cu.backgroundMode">
                  <span class="toggle-track"></span>
                </label>
              </div>
            </div>
          </template>

          <!-- 环境工具策略 -->
          <div style="margin-top:16px">
            <div class="collapse-header" @click="toolPolicyOpen = !toolPolicyOpen">
              <span class="collapse-arrow" :class="{ open: toolPolicyOpen }"></span>
              <span class="collapse-label">环境工具策略</span>
              <span class="collapse-desc">控制不同环境下可用的工具</span>
            </div>
            <div v-show="toolPolicyOpen">
              <div v-for="env in envKeys" :key="env.key" style="margin-bottom:16px">
                <div class="sub-label">{{ env.label }}</div>
                <div class="grid">
                  <div class="form-group">
                    <label>工具策略</label>
                    <select v-model="cu[env.modeKey]">
                      <option value="all">全部工具</option>
                      <option value="include">白名单</option>
                      <option value="exclude">黑名单</option>
                    </select>
                  </div>
                  <div class="form-group full" v-if="cu[env.modeKey] !== 'all'">
                    <label>{{ cu[env.modeKey] === 'include' ? '工具白名单' : '工具黑名单' }}（每行一个）</label>
                    <textarea v-model="cu[env.listKey]" rows="3" placeholder="computer_screenshot\ncomputer_click\n..."></textarea>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </template>

    <div class="status-bar" :class="{ error: statusError, saving: saving }">
      <template v-if="saving">自动保存中…</template>
      <template v-else-if="statusError">{{ statusText }}</template>
      <template v-else-if="statusText">{{ statusText }}</template>
      <template v-else>就绪</template>
    </div>
  </div>
</div>

<script>
const { createApp, reactive, ref, watch, onMounted, onBeforeUnmount } = Vue;

const AUTH_KEY = 'iris.authToken';
const MGMT_KEY = 'iris.managementToken';
const AGENT_KEY = 'iris.activeAgentName';
const API_BASE = '/api/ext/computer-use/config';

function buildHeaders() {
  const h = { 'Content-Type': 'application/json' };
  try {
    const auth = localStorage.getItem(AUTH_KEY);
    if (auth) h['Authorization'] = 'Bearer ' + auth.trim();
    const mgmt = localStorage.getItem(MGMT_KEY);
    if (mgmt) h['X-Management-Token'] = mgmt.trim();
    const agent = localStorage.getItem(AGENT_KEY);
    if (agent) h['X-Agent-Name'] = agent.trim();
  } catch {}
  return h;
}

async function fetchConfig() {
  const res = await fetch(API_BASE, { headers: buildHeaders() });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function saveConfig(payload) {
  const res = await fetch(API_BASE, {
    method: 'PUT',
    headers: buildHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'HTTP ' + res.status);
  }
  return res.json();
}

createApp({
  setup() {
    const loading = ref(true);
    const saving = ref(false);
    const statusText = ref('');
    const statusError = ref(false);
    const toolPolicyOpen = ref(false);

    const cu = reactive({
      enabled: false,
      environment: 'browser',
      screenWidth: '',
      screenHeight: '',
      postActionDelay: '',
      screenshotFormat: 'png',
      screenshotQuality: '',
      headless: false,
      initialUrl: '',
      searchEngineUrl: '',
      highlightMouse: false,
      targetWindow: '',
      backgroundMode: false,
      maxRecentScreenshots: '',
      envToolBrowserMode: 'all',
      envToolBrowserList: '',
      envToolScreenMode: 'all',
      envToolScreenList: '',
      envToolBackgroundMode: 'all',
      envToolBackgroundList: '',
    });

    const envKeys = [
      { key: 'browser', label: 'Browser 环境', modeKey: 'envToolBrowserMode', listKey: 'envToolBrowserList' },
      { key: 'screen', label: 'Screen 环境', modeKey: 'envToolScreenMode', listKey: 'envToolScreenList' },
      { key: 'background', label: 'Background 环境', modeKey: 'envToolBackgroundMode', listKey: 'envToolBackgroundList' },
    ];

    function loadFromData(data) {
      if (!data || typeof data !== 'object') return;
      cu.enabled = !!data.enabled;
      cu.environment = data.environment === 'screen' ? 'screen' : 'browser';
      cu.screenWidth = data.screenWidth != null ? String(data.screenWidth) : '';
      cu.screenHeight = data.screenHeight != null ? String(data.screenHeight) : '';
      cu.postActionDelay = data.postActionDelay != null ? String(data.postActionDelay) : '';
      cu.screenshotFormat = data.screenshotFormat === 'jpeg' ? 'jpeg' : 'png';
      cu.screenshotQuality = data.screenshotQuality != null ? String(data.screenshotQuality) : '';
      cu.headless = !!data.headless;
      cu.initialUrl = data.initialUrl || '';
      cu.searchEngineUrl = data.searchEngineUrl || '';
      cu.highlightMouse = !!data.highlightMouse;
      cu.targetWindow = data.targetWindow || '';
      cu.backgroundMode = !!data.backgroundMode;
      cu.maxRecentScreenshots = data.maxRecentScreenshots != null ? String(data.maxRecentScreenshots) : '';
      if (data.environmentTools && typeof data.environmentTools === 'object') {
        const lp = (p) => {
          if (!p || typeof p !== 'object') return { mode: 'all', list: '' };
          if (Array.isArray(p.include) && p.include.length) return { mode: 'include', list: p.include.join('\n') };
          if (Array.isArray(p.exclude) && p.exclude.length) return { mode: 'exclude', list: p.exclude.join('\n') };
          return { mode: 'all', list: '' };
        };
        const bp = lp(data.environmentTools.browser); cu.envToolBrowserMode = bp.mode; cu.envToolBrowserList = bp.list;
        const sp = lp(data.environmentTools.screen);  cu.envToolScreenMode = sp.mode;  cu.envToolScreenList = sp.list;
        const bg = lp(data.environmentTools.background); cu.envToolBackgroundMode = bg.mode; cu.envToolBackgroundList = bg.list;
      }
    }

    function buildPayload() {
      const n = (v) => { const t = String(v).trim(); if (!t) return null; const x = Number(t); return Number.isFinite(x) ? x : null; };
      const payload = {
        enabled: cu.enabled,
        environment: cu.environment,
        screenWidth: n(cu.screenWidth),
        screenHeight: n(cu.screenHeight),
        postActionDelay: n(cu.postActionDelay),
        screenshotFormat: cu.screenshotFormat,
        screenshotQuality: n(cu.screenshotQuality),
        headless: cu.headless,
        initialUrl: cu.initialUrl.trim() || null,
        searchEngineUrl: cu.searchEngineUrl.trim() || null,
        highlightMouse: cu.highlightMouse,
        targetWindow: cu.targetWindow.trim() || null,
        backgroundMode: cu.backgroundMode,
        maxRecentScreenshots: n(cu.maxRecentScreenshots),
      };
      const tp = (mode, list) => {
        if (mode === 'include') return { include: list.split('\n').map(s => s.trim()).filter(Boolean) };
        if (mode === 'exclude') return { exclude: list.split('\n').map(s => s.trim()).filter(Boolean) };
        return null;
      };
      const browser = tp(cu.envToolBrowserMode, cu.envToolBrowserList);
      const screen = tp(cu.envToolScreenMode, cu.envToolScreenList);
      const background = tp(cu.envToolBackgroundMode, cu.envToolBackgroundList);
      if (browser || screen || background) payload.environmentTools = { browser, screen, background };
      return payload;
    }

    let configLoaded = false;
    let autoSaveTimer = null;
    let lastSnapshot = '';

    async function doSave() {
      if (saving.value) return;
      saving.value = true;
      statusText.value = '';
      statusError.value = false;
      const payload = buildPayload();
      try {
        const result = await saveConfig(payload);
        lastSnapshot = JSON.stringify(payload);
        statusText.value = result.reloaded ? '已保存并生效' : '已保存，需要重启生效';
        statusError.value = false;
      } catch (err) {
        statusText.value = '保存失败: ' + (err.message || '未知错误');
        statusError.value = true;
      } finally {
        saving.value = false;
      }
    }

    function scheduleAutoSave() {
      if (!configLoaded) return;
      if (autoSaveTimer) clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(() => {
        const snap = JSON.stringify(buildPayload());
        if (snap === lastSnapshot) return;
        if (saving.value) { scheduleAutoSave(); return; }
        doSave();
      }, 1000);
    }

    watch(() => JSON.stringify(cu), scheduleAutoSave);

    onMounted(async () => {
      try {
        const data = await fetchConfig();
        loadFromData(data);
        lastSnapshot = JSON.stringify(buildPayload());
      } catch (err) {
        statusText.value = '加载失败: ' + (err.message || '未知错误');
        statusError.value = true;
      } finally {
        loading.value = false;
        configLoaded = true;
      }
    });

    onBeforeUnmount(() => {
      if (autoSaveTimer) clearTimeout(autoSaveTimer);
    });

    return { loading, saving, statusText, statusError, toolPolicyOpen, cu, envKeys };
  },
}).mount('#app');
<\/script>
</body>
</html>`;
}
