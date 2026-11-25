/** Error shape from docs/API.md. */
export interface ApiError {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}
