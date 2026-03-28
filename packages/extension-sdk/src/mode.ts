export interface ToolFilter {
  include?: string[];
  exclude?: string[];
}

export interface ModeDefinition {
  name: string;
  description?: string;
  systemPrompt?: string;
  tools?: ToolFilter;
}
