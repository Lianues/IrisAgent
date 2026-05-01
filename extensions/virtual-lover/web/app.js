const basePath = window.__VIRTUAL_LOVER_BASE_PATH__ || '/api/ext/virtual-lover';
const fragmentNames = ['persona', 'style', 'rules'];
const state = {
  agentId: 'default',
  config: null,
  memoryInfo: null,
  proactiveInfo: null,
  fragments: {},
  preview: null,
  proactiveResult: null,
};

const app = document.getElementById('app');

main().catch((error) => {
  renderError(error);
});

async function main() {
  await loadAll();
  render();
}

async function loadAll() {
  const [configPayload, agents] = await Promise.all([
    apiGet('/config'),
    apiGet('/agents'),
  ]);
  state.config = configPayload.config || configPayload;
  state.memoryInfo = configPayload.memory || null;
  state.proactiveInfo = configPayload.proactive || null;
  state.agentId = agents.agents?.[0]?.id || state.config.agent?.defaultAgentId || 'default';

  const fragments = await apiGet(`/agents/${encodeURIComponent(state.agentId)}/fragments`);
  state.fragments = fragments.fragments || {};
}

function render() {
  app.innerHTML = `
    <header class="vl-header">
      <div>
        <p class="vl-eyebrow">Iris Extension</p>
        <h1>Virtual Lover</h1>
        <p class="vl-subtitle">提示词工坊与伴侣表达层 MVP</p>
      </div>
      <div class="vl-status">
        <span class="vl-dot ${state.config?.enabled ? 'on' : 'off'}"></span>
        ${state.config?.enabled ? 'Prompt 注入已启用' : 'Prompt 注入未启用'}
      </div>
    </header>

    <section class="vl-card">
      <h2>当前配置</h2>
      <div class="vl-grid">
        <div><strong>Agent</strong><span>${escapeHtml(state.agentId)}</span></div>
        <div><strong>注入模式</strong><span>${escapeHtml(state.config?.prompt?.injectionMode || '')}</span></div>
        <div><strong>ANTML</strong><span>${state.config?.prompt?.useAntml ? '开启' : '关闭'}</span></div>
        <div><strong>Sections</strong><span>${escapeHtml((state.config?.prompt?.sections || []).join(', '))}</span></div>
      </div>
    </section>

    <section class="vl-card vl-memory-note">
      <h2>记忆系统</h2>
      <p>
        Virtual Lover 的记忆与 Iris 主记忆分离，使用 Iris <code>memory</code> extension 提供的
        <code>memory.spaces</code> 服务维护独立空间。
      </p>
      <p>
        Lover memory space：<strong>${escapeHtml(state.memoryInfo?.space || state.config?.memory?.space || 'virtual-lover')}</strong>；
        service 状态：<strong>${state.memoryInfo?.available ? '已可用' : '未启用或未就绪'}</strong>。
        <code>lover_memory_*</code> 工具和 lover dream 只作用于该独立空间。
      </p>
    </section>

    <section class="vl-card">
      <div class="vl-section-title">
        <h2>Proactive 主动消息</h2>
        <div class="vl-inline-status">
          ${state.config?.proactive?.enabled ? '已启用' : '未启用'} · ${escapeHtml(state.config?.proactive?.platform || '-')}
          · ${state.config?.proactive?.binding ? `binding ${escapeHtml(state.config.proactive.binding)}` : 'direct target'}
          · delivery ${state.proactiveInfo?.deliveryAvailable ? '可用' : '不可用'}
        </div>
      </div>
      <p class="vl-help">
        MVP 阶段仅支持手动触发。推荐在 <code>delivery.yaml</code> 配置 binding，
        并在 <code>virtual_lover.yaml</code> 中设置 <code>proactive.binding</code>；
        未设置 binding 时才回退到 <code>proactive.target</code>。
      </p>
      <label class="vl-editor">
        <span>直接发送文本（留空则由 LLM 生成）</span>
        <textarea data-group="proactive" data-name="text" placeholder="例如：刚刚想到你，想轻轻说声晚安。"></textarea>
      </label>
      <label class="vl-editor">
        <span>生成理由 / 上下文（可选）</span>
        <textarea data-group="proactive" data-name="reason" placeholder="例如：用户今天可能很累，需要一条不打扰的关心。"></textarea>
      </label>
      <div class="vl-actions">
        <button id="vl-proactive-preview">生成预览</button>
        <button id="vl-proactive-send">发送</button>
      </div>
      ${state.proactiveResult ? `<pre class="vl-preview">${escapeHtml(formatProactiveResult(state.proactiveResult))}</pre>` : ''}
    </section>

    <section class="vl-card">
      <div class="vl-section-title">
        <h2>Prompt Fragments</h2>
        <button id="vl-save-fragments">保存片段</button>
      </div>
      ${fragmentNames.map((name) => editorBlock('fragment', name, state.fragments[name] || '')).join('')}
    </section>

    <section class="vl-card">
      <div class="vl-section-title">
        <h2>Prompt Preview</h2>
        <button id="vl-preview">生成预览</button>
      </div>
      <pre class="vl-preview">${escapeHtml(state.preview?.systemText || '点击“生成预览”查看将注入到 LLM 的系统提示词。')}</pre>
      ${state.preview?.diagnostics?.length ? `<ul class="vl-diagnostics">${state.preview.diagnostics.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}
    </section>
  `;

  document.getElementById('vl-save-fragments')?.addEventListener('click', saveFragments);
  document.getElementById('vl-preview')?.addEventListener('click', refreshPreview);
  document.getElementById('vl-proactive-preview')?.addEventListener('click', () => sendProactive(true));
  document.getElementById('vl-proactive-send')?.addEventListener('click', () => sendProactive(false));
}

function editorBlock(group, name, content) {
  return `
    <label class="vl-editor">
      <span>${escapeHtml(name)}</span>
      <textarea data-group="${group}" data-name="${escapeHtml(name)}">${escapeHtml(content)}</textarea>
    </label>
  `;
}

async function saveFragments() {
  await Promise.all(fragmentNames.map((name) => {
    const content = readTextarea('fragment', name);
    return apiPut(`/agents/${encodeURIComponent(state.agentId)}/fragments/${encodeURIComponent(name)}`, { content });
  }));
  await loadAll();
  toast('Prompt fragments 已保存');
  render();
}

async function refreshPreview() {
  state.preview = await apiPost(`/agents/${encodeURIComponent(state.agentId)}/preview`, {});
  render();
}

async function sendProactive(dryRun) {
  try {
    state.proactiveResult = await apiPost('/proactive/send', {
      text: readTextarea('proactive', 'text'),
      reason: readTextarea('proactive', 'reason'),
      dryRun,
    });
    toast(dryRun ? '已生成主动消息预览' : '主动消息已发送');
  } catch (error) {
    state.proactiveResult = { ok: false, error: error?.message || String(error) };
  }
  render();
}

function readTextarea(group, name) {
  return document.querySelector(`textarea[data-group="${group}"][data-name="${name}"]`)?.value || '';
}

async function apiGet(path) {
  return api(path, { method: 'GET' });
}

async function apiPut(path, body) {
  return api(path, { method: 'PUT', body: JSON.stringify(body) });
}

async function apiPost(path, body) {
  return api(path, { method: 'POST', body: JSON.stringify(body) });
}

async function api(path, init) {
  const response = await fetch(`${basePath}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

function toast(message) {
  const node = document.createElement('div');
  node.className = 'vl-toast';
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2200);
}

function renderError(error) {
  app.innerHTML = `
    <section class="vl-card vl-error">
      <h1>Virtual Lover 加载失败</h1>
      <pre>${escapeHtml(error?.message || String(error))}</pre>
    </section>
  `;
}

function formatProactiveResult(result) {
  if (!result) return '';
  const lines = [];
  lines.push(`ok: ${result.ok}`);
  if ('sent' in result) lines.push(`sent: ${result.sent}`);
  if ('dryRun' in result) lines.push(`dryRun: ${result.dryRun}`);
  if (result.error) lines.push(`error: ${result.error}`);
  if (result.text) lines.push(`\n${result.text}`);
  if (result.delivery) lines.push(`\ndelivery: ${JSON.stringify(result.delivery, null, 2)}`);
  return lines.join('\n');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
