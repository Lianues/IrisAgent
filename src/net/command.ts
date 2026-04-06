/**
 * iris net — CLI 快捷配置 Net 多端互联
 *
 * 用法:
 *   iris net                        显示当前 Net 配置
 *   iris net enable                 启用 Net 服务
 *   iris net disable                禁用 Net 服务
 *   iris net set <key> <value>      设置配置项
 *   iris net token <value>          设置认证 token
 *   iris net port <number>          设置端口
 *
 * 示例:
 *   iris net enable
 *   iris net token mypassword
 *   iris net port 8080
 *   iris net set relay.url wss://relay.example.com:9001
 */

import { configDir } from '../paths';
import { readEditableConfig, updateEditableConfig } from '../config/manage';

export function runNetCommand(argv: string[]): void {
  const sub = argv[0];

  if (!sub || sub === 'status') {
    showStatus();
    return;
  }

  if (sub === 'enable') {
    update({ net: { enabled: true } });
    console.log('✓ Net 服务已启用。重启 Iris 后生效。');
    showStatus();
    return;
  }

  if (sub === 'disable') {
    update({ net: { enabled: false } });
    console.log('✓ Net 服务已禁用。重启 Iris 后生效。');
    return;
  }

  if (sub === 'token') {
    const value = argv[1];
    if (!value) {
      console.error('用法: iris net token <value>');
      process.exit(1);
    }
    update({ net: { token: value } });
    console.log('✓ Token 已设置。');
    return;
  }

  if (sub === 'port') {
    const value = parseInt(argv[1], 10);
    if (!value || isNaN(value) || value < 1 || value > 65535) {
      console.error('用法: iris net port <1-65535>');
      process.exit(1);
    }
    update({ net: { port: value } });
    console.log(`✓ 端口已设置为 ${value}。`);
    return;
  }

  if (sub === 'set') {
    const key = argv[1];
    const value = argv[2];
    if (!key || value === undefined) {
      console.error('用法: iris net set <key> <value>');
      console.error('可用 key: enabled, port, host, token, relay.url, relay.nodeId, relay.token');
      process.exit(1);
    }
    setNestedKey(key, value);
    console.log(`✓ ${key} = ${value}`);
    return;
  }

  if (sub === '-h' || sub === '--help' || sub === 'help') {
    showHelp();
    return;
  }

  console.error(`未知子命令: ${sub}`);
  showHelp();
  process.exit(1);
}

function showStatus(): void {
  const config = readEditableConfig(configDir);
  const net = config?.net ?? {};

  console.log('');
  console.log('  Net 多端互联配置:');
  console.log('');
  console.log(`  启用:    ${net.enabled ? '是 ✓' : '否'}`);
  console.log(`  端口:    ${net.port ?? 9100}`);
  console.log(`  地址:    ${net.host ?? '0.0.0.0'}`);
  console.log(`  Token:   ${net.token ? '••••••••' : '(未设置)'}`);

  if (net.relay?.url || net.relay?.nodeId) {
    console.log('');
    console.log('  中继:');
    console.log(`    URL:     ${net.relay.url ?? '(未设置)'}`);
    console.log(`    节点 ID: ${net.relay.nodeId ?? '(未设置)'}`);
    console.log(`    Token:   ${net.relay.token ? '••••••••' : '(未设置)'}`);
  }

  const remotes = net.remotes;
  if (remotes && Object.keys(remotes).length > 0) {
    console.log('');
    console.log('  已保存的连接:');
    for (const [name, entry] of Object.entries(remotes) as [string, any][]) {
      const tokenHint = entry?.token ? ' ✓' : '';
      console.log(`    ${name} → ${entry?.url}${tokenHint}`);
    }
  }

  console.log('');
}

function showHelp(): void {
  console.log(`
用法: iris net <命令>

命令:
  (无)               显示当前配置
  enable             启用 Net 服务
  disable            禁用 Net 服务
  token <value>      设置认证 Token
  port <number>      设置监听端口
  set <key> <value>  设置任意配置项

set 可用 key:
  enabled, port, host, token
  relay.url, relay.nodeId, relay.token

示例:
  iris net enable
  iris net token mypassword
  iris net port 8080
  iris net set relay.url wss://relay.example.com:9001
`.trim());
}

function update(updates: any): void {
  updateEditableConfig(configDir, updates);
}

function setNestedKey(key: string, value: string): void {
  // 解析布尔和数字
  let parsed: any = value;
  if (value === 'true') parsed = true;
  else if (value === 'false') parsed = false;
  else if (/^\d+$/.test(value)) parsed = parseInt(value, 10);

  // 支持 relay.url 等嵌套 key
  const parts = key.split('.');
  if (parts.length === 1) {
    update({ net: { [key]: parsed } });
  } else if (parts.length === 2 && parts[0] === 'relay') {
    update({ net: { relay: { [parts[1]]: parsed } } });
  } else {
    console.error(`不支持的 key: ${key}`);
    process.exit(1);
  }
}
