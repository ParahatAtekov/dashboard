// src/api/middleware/auth.ts
import { jwtVerify } from 'jose';
import { Request, Response, NextFunction } from 'express';
import { env } from '@/config/env';

export async function auth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return next(new Error('unauthorized'));

    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(env.SUPABASE_JWT_SECRET)
    );

    (req as any).user = { userId: payload.sub as string };
    next();
  } catch {
    next(new Error('unauthorized'));
  }
}
