// src/api/middleware/context.ts
import { Request, Response, NextFunction } from 'express';
import { resolveUserContext } from '@/services/auth.service';

export async function attachContext(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'unauthorized', message: 'User not authenticated' });
      return;
    }

    const ctx = await resolveUserContext(req.user.userId);
    req.user.orgId = ctx.org_id;
    req.user.role = ctx.role;
    next();
  } catch (error) {
    if (error instanceof Error && error.message === 'user_not_found') {
      res.status(404).json({ error: 'user_not_found', message: 'User profile not found' });
      return;
    }
    next(error);
  }
}