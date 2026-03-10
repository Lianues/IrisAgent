/**
 * MCP 运行时类型
 */

/** MCP 客户端连接状态 */
export type MCPClientStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/** MCP 服务器运行时信息 */
export interface MCPServerInfo {
  name: string;
  status: MCPClientStatus;
  toolCount: number;
  error?: string;
}
