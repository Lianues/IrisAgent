/**
 * Unified diff 解析与应用 — re-export from SDK
 */

export { parseUnifiedDiff, applyUnifiedDiffBestEffort, convertHunksToSearchReplace, parseLoosePatchToSearchReplace, applySearchReplaceBestEffort } from 'irises-extension-sdk/tool-utils';
export type { UnifiedDiffLineType, UnifiedDiffLine, UnifiedDiffHunk, ParsedUnifiedDiff, AppliedHunkRange, UnifiedDiffHunkApplyResult, ApplyUnifiedDiffBestEffortResult, SearchReplaceBlock } from 'irises-extension-sdk/tool-utils';
