/**
 * Unified diff 解析与应用
 *
 * 从 file/unifiedDiff.ts 移植，去除 VSCode 依赖。
 * 支持解析标准 unified diff 格式并 best-effort 应用。
 */

// ============ 类型 ============

export type UnifiedDiffLineType = 'context' | 'add' | 'del';

export interface UnifiedDiffLine {
  type: UnifiedDiffLineType;
  content: string;
  raw: string;
}

export interface UnifiedDiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: UnifiedDiffLine[];
}

export interface ParsedUnifiedDiff {
  oldFile?: string;
  newFile?: string;
  hunks: UnifiedDiffHunk[];
}

export interface AppliedHunkRange {
  index: number;
  startLine: number;
  endLine: number;
}

export interface UnifiedDiffHunkApplyResult {
  index: number;
  ok: boolean;
  error?: string;
  startLine?: number;
  endLine?: number;
}

export interface ApplyUnifiedDiffBestEffortResult {
  newContent: string;
  appliedHunks: AppliedHunkRange[];
  results: UnifiedDiffHunkApplyResult[];
}

// ============ 工具函数 ============

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** 去除 AI 常见的包裹行（markdown fence、ApplyPatch 风格包裹等） */
function sanitizeUnifiedDiffPatch(patch: string): string {
  const normalized = normalizeLineEndings(patch);
  const lines = normalized.split('\n');
  const out: string[] = [];

  for (const line of lines) {
    if (line.startsWith('```')) continue;
    if (line.startsWith('***')) {
      if (
        line === '***' ||
        line.startsWith('*** Begin Patch') ||
        line.startsWith('*** End Patch') ||
        line.startsWith('*** Update File:') ||
        line.startsWith('*** Add File:') ||
        line.startsWith('*** Delete File:') ||
        line.startsWith('*** End of File')
      ) {
        continue;
      }
    }
    out.push(line);
  }

  return out.join('\n');
}

function splitLinesPreserveTrailing(text: string): { lines: string[]; endsWithNewline: boolean } {
  const normalized = normalizeLineEndings(text);
  const endsWithNewline = normalized.endsWith('\n');
  const lines = normalized.split('\n');
  if (endsWithNewline) lines.pop();
  return { lines, endsWithNewline };
}

function joinLinesPreserveTrailing(lines: string[], endsWithNewline: boolean): string {
  const body = lines.join('\n');
  return endsWithNewline ? body + '\n' : body;
}

function computeHunkNewLen(hunk: UnifiedDiffHunk): number {
  return hunk.lines.reduce((acc, l) => acc + (l.type === 'del' ? 0 : 1), 0);
}

// ============ 解析 ============

/** 解析 unified diff patch（单文件） */
export function parseUnifiedDiff(patch: string): ParsedUnifiedDiff {
  const normalized = sanitizeUnifiedDiffPatch(patch);
  const lines = normalized.split('\n');

  let oldFile: string | undefined;
  let newFile: string | undefined;
  const hunks: UnifiedDiffHunk[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('diff --git ')) {
      if (hunks.length > 0 || oldFile || newFile) {
        throw new Error('Multi-file patch is not supported. Please split into one apply_diff call per file.');
      }
      i++;
      continue;
    }

    if (line.startsWith('--- ')) {
      if (oldFile && (hunks.length > 0 || newFile)) {
        throw new Error('Multi-file patch is not supported.');
      }
      oldFile = line.slice(4).trim().split('\t')[0]?.trim() || '';
      i++;
      continue;
    }

    if (line.startsWith('+++ ')) {
      if (newFile && hunks.length > 0) {
        throw new Error('Multi-file patch is not supported.');
      }
      newFile = line.slice(4).trim().split('\t')[0]?.trim() || '';
      i++;
      continue;
    }

    if (line.startsWith('@@')) {
      const header = line;
      const m = header.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
      if (!m) {
        throw new Error(
          `Invalid hunk header: ${header}. ` +
          `Expected format: @@ -oldStart,oldCount +newStart,newCount @@`
        );
      }

      const oldStart = parseInt(m[1], 10);
      const oldCount = m[2] ? parseInt(m[2], 10) : 1;
      const newStart = parseInt(m[3], 10);
      const newCount = m[4] ? parseInt(m[4], 10) : 1;

      const hunkLines: UnifiedDiffLine[] = [];
      i++;
      while (i < lines.length) {
        const l = lines[i];
        if (l.startsWith('@@') || l.startsWith('--- ') || l.startsWith('diff --git ') || l.startsWith('+++ ')) break;
        if (l === '') { i++; continue; }
        if (l.startsWith('\\')) { i++; continue; }

        const prefix = l[0];
        const content = l.length > 0 ? l.slice(1) : '';

        if (prefix === ' ') {
          hunkLines.push({ type: 'context', content, raw: l });
        } else if (prefix === '+') {
          hunkLines.push({ type: 'add', content, raw: l });
        } else if (prefix === '-') {
          hunkLines.push({ type: 'del', content, raw: l });
        } else {
          throw new Error(`Invalid hunk line prefix '${prefix}' in line: ${l}`);
        }
        i++;
      }

      hunks.push({ oldStart, oldLines: oldCount, newStart, newLines: newCount, header, lines: hunkLines });
      continue;
    }

    i++;
  }

  if (hunks.length === 0) {
    throw new Error('No hunks (@@ ... @@) found in patch.');
  }

  return { oldFile, newFile, hunks };
}

// ============ 应用 ============

/**
 * best-effort 逐 hunk 应用。
 *
 * 每个 hunk 先按行号 + delta 定位，失败时全局搜索 context+del 文本块。
 * 唯一匹配则用匹配位置重新应用，多处匹配或无匹配则报错。
 */
export function applyUnifiedDiffBestEffort(
  originalContent: string,
  parsed: ParsedUnifiedDiff,
): ApplyUnifiedDiffBestEffortResult {
  const { lines, endsWithNewline } = splitLinesPreserveTrailing(originalContent);

  let delta = 0;
  const appliedHunks: AppliedHunkRange[] = [];
  const results: UnifiedDiffHunkApplyResult[] = [];

  for (let hunkIndex = 0; hunkIndex < parsed.hunks.length; hunkIndex++) {
    const hunk = parsed.hunks[hunkIndex];

    const tryApplyAt = (startIndex: number): { added: number; removed: number } => {
      if (startIndex < 0 || startIndex > lines.length) {
        throw new Error(`Hunk start is out of range. ${hunk.header}`);
      }

      let idx = startIndex;
      let removed = 0;
      let added = 0;

      for (const line of hunk.lines) {
        if (line.type === 'context') {
          if (lines[idx] !== line.content) {
            throw new Error(`Context mismatch at ${hunk.header}`);
          }
          idx++;
          continue;
        }
        if (line.type === 'del') {
          if (lines[idx] !== line.content) {
            throw new Error(`Delete mismatch at ${hunk.header}`);
          }
          lines.splice(idx, 1);
          removed++;
          continue;
        }
        // add
        lines.splice(idx, 0, line.content);
        idx++;
        added++;
      }

      return { added, removed };
    };

    const searchHunkInFile = (): number[] => {
      const oldLines = hunk.lines
        .filter(l => l.type === 'context' || l.type === 'del')
        .map(l => l.content);
      if (oldLines.length === 0) return [];
      const matches: number[] = [];
      const scanLimit = lines.length - oldLines.length + 1;
      for (let s = 0; s < scanLimit; s++) {
        let match = true;
        for (let j = 0; j < oldLines.length; j++) {
          if (lines[s + j] !== oldLines[j]) { match = false; break; }
        }
        if (match) matches.push(s);
      }
      return matches;
    };

    let snapshot = lines.slice();
    let applied = false;

    // 第一轮：按行号 + delta 定位
    try {
      if (hunk.oldStart >= 0) {
        const baseOldStart = Math.max(1, hunk.oldStart);
        const startIndex = baseOldStart - 1 + delta;
        const { added, removed } = tryApplyAt(startIndex);

        const newLen = computeHunkNewLen(hunk);
        const startLine = startIndex + 1;
        const endLine = startLine + Math.max(newLen, 1) - 1;
        appliedHunks.push({ index: hunkIndex, startLine, endLine });
        delta += added - removed;
        results.push({ index: hunkIndex, ok: true, startLine, endLine });
        applied = true;
      }
    } catch {
      lines.splice(0, lines.length, ...snapshot);
    }

    // 第二轮：全局搜索
    if (!applied) {
      snapshot = lines.slice();
      const matches = searchHunkInFile();

      if (matches.length === 1) {
        try {
          const startIndex = matches[0];
          const { added, removed } = tryApplyAt(startIndex);

          const newLen = computeHunkNewLen(hunk);
          const startLine = startIndex + 1;
          const endLine = startLine + Math.max(newLen, 1) - 1;
          appliedHunks.push({ index: hunkIndex, startLine, endLine });
          delta += added - removed;
          results.push({ index: hunkIndex, ok: true, startLine, endLine });
          applied = true;
        } catch {
          lines.splice(0, lines.length, ...snapshot);
        }
      }

      if (!applied) {
        const oldLines = hunk.lines
          .filter(l => l.type === 'context' || l.type === 'del')
          .map(l => l.content);
        let errorMsg: string;
        if (matches.length === 0) {
     errorMsg = `Hunk context mismatch at ${hunk.header}. Line-number match failed and global search found no match for the context/delete block (${oldLines.length} lines).`;
        } else {
          const candidateLineNums = matches.map(m => m + 1);
          errorMsg = `Hunk context mismatch at ${hunk.header}. Line-number match failed and global search found ${matches.length} matches (ambiguous). Candidate lines: ${candidateLineNums.join(', ')}.`;
        }
        results.push({ index: hunkIndex, ok: false, error: errorMsg });
      }
    }
  }

  return {
    newContent: joinLinesPreserveTrailing(lines, endsWithNewline),
    appliedHunks,
    results,
  };
}

// ============ Loose @@ 兜底 ============

/** search/replace 块 */
export interface SearchReplaceBlock {
  search: string;
  replace: string;
  startLine?: number;
}

/**
 * 将带行号的 unified hunks 转换为 search/replace 块。
 * 用于 unified diff 部分 hunk 失败时的兜底路径。
 */
export function convertHunksToSearchReplace(hunks: UnifiedDiffHunk[]): SearchReplaceBlock[] {
  return hunks.map(h => {
    const startLineHint = Number.isFinite(h.oldStart) ? Math.max(1, h.oldStart) : undefined;
    const searchLines: string[] = [];
    const replaceLines: string[] = [];

    for (const l of h.lines) {
      if (l.type === 'context') {
        searchLines.push(l.content);
        replaceLines.push(l.content);
      } else if (l.type === 'del') {
        searchLines.push(l.content);
      } else {
        replaceLines.push(l.content);
      }
    }

    return {
      search: searchLines.join('\n'),
      replace: replaceLines.join('\n'),
      startLine: startLineHint,
    };
  });
}

/**
 * 将裸 @@ 的 patch 解析为 search/replace 块（无行号，全局精确匹配）。
 */
export function parseLoosePatchToSearchReplace(patch: string): SearchReplaceBlock[] {
  const normalized = sanitizeUnifiedDiffPatch(patch);
  const lines = normalized.split('\n');
  const blocks: SearchReplaceBlock[] = [];

  let inHunk = false;
  let searchLines: string[] = [];
  let replaceLines: string[] = [];

  const flush = () => {
    if (!inHunk) return;
    const search = searchLines.join('\n');
    const replace = replaceLines.join('\n');
    if (!search.trim()) {
      throw new Error('Loose @@ hunk has empty search block.');
    }
    blocks.push({ search, replace });
    searchLines = [];
    replaceLines = [];
  };

  for (const line of lines) {
    if (line.startsWith('@@')) {
      flush();
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith('diff --git ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
      flush();
      inHunk = false;
      continue;
    }
    if (line.startsWith('\\') || line === '') continue;

    const prefix = line[0];
    const content = line.length > 0 ? line.slice(1) : '';
    if (prefix === ' ') {
      searchLines.push(content);
      replaceLines.push(content);
    } else if (prefix === '-') {
      searchLines.push(content);
    } else if (prefix === '+') {
      replaceLines.push(content);
    } else {
      searchLines.push(line);
 replaceLines.push(line);
    }
  }

  flush();

  if (blocks.length === 0) {
    throw new Error('No hunks (@@) found in patch.');
  }

  return blocks;
}

/**
 * 应用 search/replace 块到内容（best-effort）。
 * 用于 loose @@ 兜底和 unified hunk 退化兜底。
 */
export function applySearchReplaceBestEffort(
  originalContent: string,
  blocks: SearchReplaceBlock[],
): {
  newContent: string;
  results: Array<{ index: number; success: boolean; error?: string; matchCount?: number }>;
  appliedCount: number;
  failedCount: number;
} {
  const norm = normalizeLineEndings;
  let currentContent = norm(originalContent);
  const results: Array<{ index: number; success: boolean; error?: string; matchCount?: number }> = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const search = norm(block.search);
    const replace = norm(block.replace);

    if (!search) {
      results.push({ index: i, success: false, error: 'Empty search content' });
      continue;
    }

    // 如果有 startLine 提示，从该行开始搜索
    if (block.startLine && block.startLine > 0) {
      const lines = currentContent.split('\n');
      let charOffset = 0;
      for (let j = 0; j < Math.min(block.startLine - 1, lines.length); j++) {
        charOffset += lines[j].length + 1;
      }
      const idx = currentContent.indexOf(search, charOffset);
      if (idx !== -1) {
        currentContent = currentContent.slice(0, idx) + replace + currentContent.slice(idx + search.length);
        results.push({ index: i, success: true, matchCount: 1 });
        continue;
      }
    }

    // 全局精确匹配
    const matchCount = currentContent.split(search).length - 1;
    if (matchCount === 0) {
      results.push({ index: i, success: false, error: 'No exact match found', matchCount: 0 });
    } else if (matchCount > 1) {
      results.push({ index: i, success: false, error: `Multiple matches found (${matchCount})`, matchCount });
    } else {
      currentContent = currentContent.replace(search, replace);
      results.push({ index: i, success: true, matchCount: 1 });
    }
  }

  const appliedCount = results.filter(r => r.success).length;
  return {
    newContent: currentContent,
    results,
    appliedCount,
    failedCount: results.length - appliedCount,
  };
}
