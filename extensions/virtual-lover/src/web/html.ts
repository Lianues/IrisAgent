export function buildPanelHTML(basePath: string): string {
  const safeBasePath = escapeHtml(basePath);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Virtual Lover</title>
  <link rel="stylesheet" href="${safeBasePath}/assets/styles.css" />
</head>
<body>
  <main id="app" class="vl-shell">
    <section class="vl-loading">正在加载 Virtual Lover 面板...</section>
  </main>
  <script>window.__VIRTUAL_LOVER_BASE_PATH__ = ${JSON.stringify(basePath)};</script>
  <script type="module" src="${safeBasePath}/assets/app.js"></script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
