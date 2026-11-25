export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RSVP_CLOSED'
  | 'PAYLOAD_TOO_LARGE'
  | 'BAD_REQUEST'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const validationError = (message = 'Some of the submitted values are not valid.', fields?: Record<string, string>) =>
  new AppError(400, 'VALIDATION_ERROR', message, fields);
export const unauthenticated = (message = 'Please log in to continue.') => new AppError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'You do not have permission to do this.') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = 'The requested resource was not found.') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (message = 'This conflicts with existing data.') => new AppError(409, 'CONFLICT', message);
export const rsvpClosed = (message = 'This invitation is no longer open for responses.') => new AppError(410, 'RSVP_CLOSED', message);
