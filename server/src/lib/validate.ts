import type { Request } from 'express';
import type { z } from 'zod';

/** Parse request parts with zod; throws ZodError (mapped to 400 by the error handler). */
export function validate<
  B extends z.ZodTypeAny = z.ZodUndefined,
  P extends z.ZodTypeAny = z.ZodUndefined,
  Q extends z.ZodTypeAny = z.ZodUndefined,
>(req: Request, schemas: { body?: B; params?: P; query?: Q }): { body: z.infer<B>; params: z.infer<P>; query: z.infer<Q> } {
  return {
    body: schemas.body ? schemas.body.parse(req.body) : (undefined as never),
    params: schemas.params ? schemas.params.parse(req.params) : (undefined as never),
    query: schemas.query ? schemas.query.parse(req.query) : (undefined as never),
  };
}
