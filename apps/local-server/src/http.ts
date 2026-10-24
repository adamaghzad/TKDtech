export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message); this.name = 'HttpError';
  }
}
export function requiredString(value: unknown, field: string, max = 180): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new HttpError(400, 'VALIDATION_ERROR', `${field} is required and must be at most ${max} characters.`);
  return value.trim();
}
export function optionalString(value: unknown, max = 500): string {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || value.length > max) throw new HttpError(400, 'VALIDATION_ERROR', `Invalid text field.`);
  return value.trim();
}
export function uuidLike(value: unknown, field = 'id'): string {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) throw new HttpError(400, 'VALIDATION_ERROR', `${field} must be a UUID.`);
  return value;
}
