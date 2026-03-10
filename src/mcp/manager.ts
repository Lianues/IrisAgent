/**
 * MCP 管理器
 *
 * 管理多个 MCP 服务器连接，将 MCP 工具转换为 IrisClaw ToolDefinition 格式。
 */

import { MCPConfig } from '../config/types';
import { ToolDefinition, ParameterSchema } from '../types';
import { MCPClient } from './client';
import { MCPServerInfo } from './types';
import { createLogger } from '../logger';

const logger = createLogger('MCPManager');

export class MCPManager {
  private clients: MCPClient[] = [];

  constructor(config: MCPConfig) {
    for (const [name, serverCfg] of Object.entries(config.servers)) {
      // enabled 默认 true
      if (serverCfg.enabled === false) {
        logger.info(`MCP 服务器 "${name}" 已禁用，跳过`);
        continue;
      }
      this.clients.push(new MCPClient(name, serverCfg));
    }
  }

  /** 并行连接所有服务器（失败不中断） */
  async connectAll(): Promise<void> {
    if (this.clients.length === 0) return;
    logger.info(`正在连接 ${this.clients.length} 个 MCP 服务器...`);
    await Promise.allSettled(this.clients.map(c => c.connect()));

    const connected = this.clients.filter(c => c.status === 'connected').length;
    logger.info(`MCP 连接完成: ${connected}/${this.clients.length} 成功`);
  }

  /** 获取所有已连接服务器的工具（转换为 ToolDefinition） */
  getTools(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];

    for (const client of this.clients) {
      if (client.status !== 'connected') continue;

      for (const sdkTool of client.toolList) {
        const safeName = sanitizeName(client.serverName);
        const safeToolName = sanitizeName(sdkTool.name);
        const qualifiedName = `mcp__${safeName}__${safeToolName}`;
        const originalName = sdkTool.name;

        tools.push({
          declaration: {
            name: qualifiedName,
            description: sdkTool.description || `MCP tool: ${originalName}`,
            parameters: convertInputSchema(sdkTool.inputSchema),
          },
          handler: async (args: Record<string, unknown>) => {
            return client.callTool(originalName, args);
          },
        });
      }
    }

    return tools;
  }

  /** 获取所有服务器的状态信息 */
  getServerInfo(): MCPServerInfo[] {
    return this.clients.map(c => ({
      name: c.serverName,
      status: c.status,
      toolCount: c.toolList.length,
      error: c.error,
    }));
  }

  /** 热重载：断开旧连接，用新配置重新连接 */
  async reload(config: MCPConfig): Promise<void> {
    await this.disconnectAll();
    this.clients = [];
    for (const [name, serverCfg] of Object.entries(config.servers)) {
      if (serverCfg.enabled === false) {
        logger.info(`MCP 服务器 "${name}" 已禁用，跳过`);
        continue;
      }
      this.clients.push(new MCPClient(name, serverCfg));
    }
    await this.connectAll();
  }

  /** 并行断开所有连接 */
  async disconnectAll(): Promise<void> {
    await Promise.allSettled(this.clients.map(c => c.disconnect()));
    logger.info('所有 MCP 连接已断开');
  }
}

/**
 * 将 MCP inputSchema（JSON Schema）转换为 IrisClaw ParameterSchema 格式
 */
function convertInputSchema(schema: Record<string, unknown>): {
  type: 'object';
  properties: Record<string, ParameterSchema>;
  required?: string[];
} | undefined {
  const props = schema.properties as Record<string, any> | undefined;
  if (!props || typeof props !== 'object') return undefined;

  const converted: Record<string, ParameterSchema> = {};
  for (const [key, value] of Object.entries(props)) {
    converted[key] = convertProperty(value);
  }

  const result: {
    type: 'object';
    properties: Record<string, ParameterSchema>;
    required?: string[];
  } = {
    type: 'object',
    properties: converted,
  };

  if (Array.isArray(schema.required) && schema.required.length > 0) {
    result.required = schema.required as string[];
  }

  return result;
}

/** 递归转换单个属性 */
function convertProperty(prop: any): ParameterSchema {
  if (!prop || typeof prop !== 'object') {
    return { type: 'string' };
  }

  const result: ParameterSchema = {
    type: typeof prop.type === 'string' ? prop.type : 'string',
  };

  if (prop.description) result.description = String(prop.description);
  if (Array.isArray(prop.enum)) result.enum = prop.enum.map(String);

  // 数组的 items
  if (prop.items && typeof prop.items === 'object') {
    result.items = convertProperty(prop.items);
  }

  // 对象的 properties
  if (prop.properties && typeof prop.properties === 'object') {
    result.properties = {};
    for (const [key, value] of Object.entries(prop.properties)) {
      result.properties[key] = convertProperty(value);
    }
  }

  if (Array.isArray(prop.required) && prop.required.length > 0) {
    result.required = prop.required;
  }

  return result;
}

/** 将名称中非 [a-zA-Z0-9_] 的字符替换为下划线（兼容 Gemini 函数名规范） */
function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
}
