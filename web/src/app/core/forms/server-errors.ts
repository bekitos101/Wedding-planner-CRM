import { AbstractControl, FormGroup } from '@angular/forms';
import { ApiError } from '../models/api-error';

/** Puts server `error.fields[x]` onto the matching control as a `server` error (NFR-10). */
export function applyServerFieldErrors(form: FormGroup, err: ApiError | undefined): void {
  const fields = err?.error?.fields ?? {};
  for (const [name, message] of Object.entries(fields)) {
    const control = form.get(name);
    if (control) {
      control.setErrors({ ...(control.errors ?? {}), server: message });
      control.markAsTouched();
    }
  }
}

/** Message to show under a control: server message first, then client-side rules. */
export function fieldError(
  control: AbstractControl | null,
  messages: Record<string, string> = {},
): string | null {
  if (!control || !control.errors || !(control.touched || control.dirty)) return null;
  const server = control.errors['server'];
  if (typeof server === 'string') return server;
  for (const key of Object.keys(control.errors)) {
    if (messages[key]) return messages[key];
  }
  return null;
}

export function errorMessage(err: unknown): string {
  return (err as ApiError)?.error?.message ?? 'Something went wrong. Please try again.';
}

/** For PATCH: keeps only the body keys whose form control was changed by the user (no lost updates). */
export function pickDirty<T extends Record<string, unknown>>(form: FormGroup, body: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(body) as (keyof T & string)[]) {
    if (form.get(key)?.dirty) out[key] = body[key];
  }
  return out;
}
