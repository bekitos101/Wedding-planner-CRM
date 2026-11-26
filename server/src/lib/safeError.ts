/** Loggable summary of an unknown error: name and code only (messages can embed secrets, NFR-06). */
export function safeErrorInfo(err: unknown): { name: string; code?: string } {
  if (err && typeof err === 'object') {
    const code = (err as { code?: unknown }).code;
    return { name: err instanceof Error ? err.name : 'Error', ...(typeof code === 'string' ? { code } : {}) };
  }
  return { name: 'UnknownError' };
}
