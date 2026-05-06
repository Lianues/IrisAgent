/**
 * 插件声明配置解析
 *
 * 解析 plugins.yaml 文件内容（可选覆盖配置）。
 *
 * ⚠️  关于 plugins、platforms 与 extensions 的关系：
 *
 * "Extension" 是打包与分发单位——extensions/ 下的一个目录加一份 manifest.json。
 * 每个 extension 可以向系统贡献两种角色：
 *   1. platform 贡献（manifest 的 "platforms" 字段）→ 由 registerExtensionPlatforms() 自动发现注册
 *   2. plugin 贡献（manifest 的 "plugin" 字段）  → 由 discoverLocalPluginEntries() 自动发现注册
 *
 * 所有 extension（无论 platform 还是 plugin）均会被自动发现和注册。
 * plugins.yaml 仅用于覆盖自动发现的配置（如禁用某个插件、调整优先级、传递 config）。
 *
 * 分层语义（在 src/config/index.ts::classifyAndMergePlugins 中实现）：
 *   - 全局 ~/.iris/configs/plugins.yaml：只能控制 installed (~/.iris/extensions/) + embedded 扩展。
 *     列出 agent-installed 或不存在的扩展会被 warn 后忽略。
 *   - Agent ~/.iris/agents/<id>/configs/plugins.yaml：
 *       1) 控制该 agent 的 agent-installed 扩展（~/.iris/agents/<id>/extensions/）；
 *       2) 可覆盖全局可见扩展的 enabled / priority / config（按 name 浅合并 enabled/priority/config）。
 *     不允许 type=npm 条目（npm 扩展属全局基础设施，只能在全局层声明）。
 *
 * 配置格式：
 *   plugins:
 *     - name: my-tool
 *       type: local        # local | npm，默认 local（对应 extensions/ 下同名目录）
 *       enabled: true      # 默认 true
 *       priority: 100      # 可选，数值越大越先执行
 *       config:            # 可选，覆盖插件自身的 config.yaml
 *         apiKey: "xxx"
 */

import type { PluginEntry } from 'irises-extension-sdk';

export function parsePluginsConfig(raw: any): PluginEntry[] | undefined {
  if (!raw) return undefined;

  // 支持两种格式：
  // 1. { plugins: [...] }
  // 2. 直接是数组 [...]
  const list = raw.plugins ?? raw;
  if (!Array.isArray(list)) return undefined;

  const entries: PluginEntry[] = [];

  for (const item of list) {
    if (!item || typeof item !== 'object' || typeof item.name !== 'string') {
      continue;
    }

    entries.push({
      name: item.name,
      type: item.type === 'npm' ? 'npm' : 'local',
      enabled: item.enabled !== false,
      priority: typeof item.priority === 'number' ? item.priority : undefined,
      config: item.config && typeof item.config === 'object' ? item.config : undefined,
    });
  }

  return entries.length > 0 ? entries : undefined;
}
