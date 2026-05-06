export function formatToolError(error?: string): string | undefined {
  if (!error) return error;
  const normalized = error.trim();
  if (
    normalized === 'Operation aborted'
    || normalized === 'Aborted by user'
    || normalized === 'AbortError'
    || /aborted by user/i.test(normalized)
    || /operation aborted/i.test(normalized)
    || /the operation was aborted/i.test(normalized)
  ) {
    return '被用户终止';
  }
  return error;
}
