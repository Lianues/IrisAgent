/**
 * iris net — CLI 快捷配置远程互联
 *
 * 用法:
 *   iris net                        显示当前配置
 *   iris net enable                 启用远程互联服务
 *   iris net disable                禁用远程互联服务
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

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYAML, stringify as stringifyYAML } from 'yaml';
import { resolveDefaultDataDir } from 'irises-extension-sdk';

const configDir = path.join(resolveDefaultDataDir(), 'configs');
const netConfigPath = path.join(configDir, 'net.yaml');

export function runNetCommand(argv: string[]): void {
  const sub = argv[0];

  if (!sub || sub === 'status') {
    showStatus();
    return;
  }

  if (sub === 'enable') {
    update({ net: { enabled: true } });
    console.log('✓ 远程互联服务已启用。重启 Iris 后生效。');
    showStatus();
    return;
  }

  if (sub === 'disable') {
    update({ net: { enabled: false } });
    console.log('✓ 远程互联服务已禁用。重启 Iris 后生效。');
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
      console.error('可用 key: enabled, port, host, token, gatewayAgent, relay.url, relay.nodeId, relay.token');
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
  const net = readNetConfig();

  console.log('');
  console.log('  远程互联配置:');
  console.log('');
  console.log(`  启用:    ${net.enabled ? '是 ✓' : '否'}`);
  console.log(`  端口:    ${net.port ?? 9100}`);
  console.log(`  地址:    ${net.host ?? '0.0.0.0'}`);
  console.log(`  Token:   ${net.token ? '••••••••' : '(未设置)'}`);
  console.log(`  网关:    ${net.gatewayAgent ?? 'master'}`);

  if (isRecord(net.relay) && (net.relay.url || net.relay.nodeId)) {
    console.log('');
    console.log('  中继:');
    console.log(`    URL:     ${net.relay.url ?? '(未设置)'}`);
    console.log(`    节点 ID: ${net.relay.nodeId ?? '(未设置)'}`);
    console.log(`    Token:   ${net.relay.token ? '••••••••' : '(未设置)'}`);
  }

  const remotes = net.remotes;
  if (isRecord(remotes) && Object.keys(remotes).length > 0) {
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
  enable             启用远程互联服务
  disable            禁用远程互联服务
  token <value>      设置认证 Token
  port <number>      设置监听端口
  set <key> <value>  设置任意配置项

set 可用 key:
  enabled, port, host, token, gatewayAgent
  relay.url, relay.nodeId, relay.token

示例:
  iris net enable
  iris net token mypassword
  iris net port 8080
  iris net set relay.url wss://relay.example.com:9001
`.trim());
}

function update(updates: { net?: Record<string, unknown> }): void {
  const netUpdates = updates.net ?? {};
  const next = deepMerge(readNetConfig(), netUpdates);
  writeNetConfig(next);
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

function readNetConfig(): Record<string, any> {
  if (!fs.existsSync(netConfigPath)) return {};
  const parsed = parseYAML(fs.readFileSync(netConfigPath, 'utf-8'));
  return isRecord(parsed) ? parsed : {};
}

function writeNetConfig(net: Record<string, unknown>): void {
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(netConfigPath, stringifyYAML(net, { indent: 2 }), 'utf-8');
}

function deepMerge(target: Record<string, any>, source: Record<string, unknown>): Record<string, any> {
  const result: Record<string, any> = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value === null) {
      delete result[key];
    } else if (Array.isArray(value)) {
      result[key] = [...value];
    } else if (isRecord(value)) {
      result[key] = deepMerge(isRecord(result[key]) ? result[key] : {}, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
