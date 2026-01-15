// src/api/middleware/context.ts
import { Request, Response, NextFunction } from 'express';
import { resolveUserContext } from '@/services/auth.service';

export async function attachContext(req: Request, _res: Response, next: NextFunction) {
  const user = (req as any).user;
  const ctx = await resolveUserContext(user.userId);
  user.orgId = ctx.org_id;
  user.role = ctx.role;
  next();
}
