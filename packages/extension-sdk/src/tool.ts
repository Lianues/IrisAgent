export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters?: {
    type: 'object';
    properties: Record<string, Record<string, unknown>>;
    required?: string[];
  };
}

export type ToolStatus =
  | 'streaming'
  | 'queued'
  | 'awaiting_approval'
  | 'executing'
  | 'awaiting_apply'
  | 'success'
  | 'warning'
  | 'error';

export interface ToolInvocation {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  status: ToolStatus;
  result?: unknown;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
export type ToolParallelResolver = (args: Record<string, unknown>) => boolean;
export type ToolParallelPolicy = boolean | ToolParallelResolver;

export interface ToolDefinition {
  declaration: FunctionDeclaration;
  handler: ToolHandler;
  parallel?: ToolParallelPolicy;
}
