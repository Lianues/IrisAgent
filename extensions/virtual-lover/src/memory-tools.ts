import type { ToolDefinition } from 'irises-extension-sdk';

export const MEMORY_SPACES_SERVICE_ID = 'memory.spaces';

export interface MemoryEntryLike {
  id: number;
  content: string;
  name?: string;
  description?: string;
  type?: string;
  updatedAt?: number;
}

export interface MemorySpaceHandleLike {
  search(query: string, options?: { type?: string; limit?: number }): Promise<MemoryEntryLike[]>;
  add(input: { content: string; name?: string; description?: string; type?: string }): Promise<number>;
  update(input: { id: number; content?: string; name?: string; description?: string; type?: string }): Promise<boolean>;
  delete(id: number): Promise<boolean>;
  dream(): Promise<{ ok: boolean; message: string; opCount: number }>;
  buildContext?(input: { userText: string; maxBytes?: number; modelName?: string }): Promise<{ text: string; bytes: number; ids: number[]; userIds?: number[] } | undefined>;
  extractFromSession?(input: { sessionId: string; modelName?: string }): Promise<{ ok: boolean; savedCount: number; message: string }>;
}

export interface MemorySpacesServiceLike {
  getOrCreateSpace(id: string): MemorySpaceHandleLike;
  getSpace?(id: string): MemorySpaceHandleLike | undefined;
  listSpaces?(): Array<{ id: string; enabled: boolean; dbPath: string }>;
}

export const LOVER_MEMORY_TOOL_NAMES = new Set([
  'lover_memory_search',
  'lover_memory_add',
  'lover_memory_update',
  'lover_memory_delete',
  'lover_memory_dream',
]);

const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'] as const;

export function createLoverMemoryTools(getSpace: () => MemorySpaceHandleLike): ToolDefinition[] {
  return [
    {
      parallel: true,
      declaration: {
        name: 'lover_memory_search',
        description: 'Search the isolated virtual-lover memory space. Use this for relationship context, companion preferences, emotional continuity, and lover-specific history. This does not search the main Iris memory.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search keywords or natural language query' },
            type: { type: 'string', enum: [...MEMORY_TYPES], description: 'Optional memory type filter' },
            limit: { type: 'number', description: 'Max results (default 10)' },
          },
          required: ['query'],
        },
      },
      handler: async (args) => {
        const query = typeof args.query === 'string' ? args.query : '';
        if (!query.trim()) return { message: 'query 不能为空', results: [] };
        const results = await getSpace().search(query, {
          type: typeof args.type === 'string' ? args.type : undefined,
          limit: typeof args.limit === 'number' ? args.limit : 10,
        });
        return {
          message: `Found ${results.length} lover memories.`,
          results,
        };
      },
    },
    {
      declaration: {
        name: 'lover_memory_add',
        description: 'Save information to the isolated virtual-lover memory space. Use for relationship-specific continuity, companion preferences, emotional context, and lover-specific long-term facts. This does not write to the main Iris memory.',
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'Memory content' },
            name: { type: 'string', description: 'Short stable identifier' },
            description: { type: 'string', description: 'One-line description for future relevance matching' },
            type: { type: 'string', enum: [...MEMORY_TYPES], description: 'Memory type' },
          },
          required: ['content'],
        },
      },
      handler: async (args) => {
        const content = typeof args.content === 'string' ? args.content.trim() : '';
        if (!content) return { message: 'content 不能为空' };
        const id = await getSpace().add({
          content,
          name: typeof args.name === 'string' ? args.name : undefined,
          description: typeof args.description === 'string' ? args.description : undefined,
          type: typeof args.type === 'string' ? args.type : 'reference',
        });
        return { message: 'Lover memory saved.', id };
      },
    },
    {
      declaration: {
        name: 'lover_memory_update',
        description: 'Update an existing memory in the isolated virtual-lover memory space. Prefer update over creating duplicates.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'number', description: 'Memory ID to update' },
            content: { type: 'string', description: 'New content' },
            name: { type: 'string', description: 'New short identifier' },
            description: { type: 'string', description: 'New one-line description' },
            type: { type: 'string', enum: [...MEMORY_TYPES], description: 'New memory type' },
          },
          required: ['id'],
        },
      },
      handler: async (args) => {
        const id = typeof args.id === 'number' ? args.id : Number(args.id);
        if (!Number.isFinite(id)) return { message: 'id 无效' };
        const ok = await getSpace().update({
          id,
          content: typeof args.content === 'string' ? args.content : undefined,
          name: typeof args.name === 'string' ? args.name : undefined,
          description: typeof args.description === 'string' ? args.description : undefined,
          type: typeof args.type === 'string' ? args.type : undefined,
        });
        return ok ? { message: `Lover memory #${id} updated.` } : { message: `Lover memory #${id} not found.` };
      },
    },
    {
      declaration: {
        name: 'lover_memory_delete',
        description: 'Delete a memory from the isolated virtual-lover memory space.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'number', description: 'Memory ID to delete' },
          },
          required: ['id'],
        },
      },
      handler: async (args) => {
        const id = typeof args.id === 'number' ? args.id : Number(args.id);
        if (!Number.isFinite(id)) return { message: 'id 无效' };
        const ok = await getSpace().delete(id);
        return ok ? { message: `Lover memory #${id} deleted.` } : { message: `Lover memory #${id} not found.` };
      },
    },
    {
      declaration: {
        name: 'lover_memory_dream',
        description: 'Run dream/consolidation only for the isolated virtual-lover memory space. This does not consolidate the main Iris memory.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
      handler: async () => {
        return await getSpace().dream();
      },
    },
  ];
}
