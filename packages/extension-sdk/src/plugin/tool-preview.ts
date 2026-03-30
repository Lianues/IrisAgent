export interface ParsedUnifiedDiffLike {
  oldFile?: string;
  newFile?: string;
  hunks: UnifiedDiffHunkLike[];
}

export interface UnifiedDiffHunkLike {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: UnifiedDiffLineLike[];
}

export interface UnifiedDiffLineLike {
  type: 'context' | 'add' | 'del';
  content: string;
  raw: string;
}

export interface WriteEntryLike { path: string; content: string }
export interface InsertEntryLike { path: string; line: number; content: string }
export interface DeleteCodeEntryLike { path: string; start_line: number; end_line: number }

export interface ToolPreviewUtilsLike {
  parseUnifiedDiff(patch: string): ParsedUnifiedDiffLike;
  normalizeWriteArgs(args: Record<string, unknown>): WriteEntryLike[] | undefined;
  normalizeInsertArgs(args: Record<string, unknown>): InsertEntryLike[] | undefined;
  normalizeDeleteCodeArgs(args: Record<string, unknown>): DeleteCodeEntryLike[] | undefined;
  resolveProjectPath(inputPath: string): string;
  walkFiles(rootAbs: string, onFile: (fileAbs: string, relPosix: string) => void, shouldStop: () => boolean): void;
  buildSearchRegex(query: string, isRegex: boolean): RegExp;
  decodeText(buf: Buffer): { text: string; encoding: string; hasBom: boolean; hasCRLF: boolean };
  globToRegExp(glob: string): RegExp;
  isLikelyBinary(buf: Buffer): boolean;
  toPosix(p: string): string;
}
