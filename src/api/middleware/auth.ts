// src/api/middleware/auth.ts
import { jwtVerify } from 'jose';
import { Request, Response, NextFunction } from 'express';
import { env } from '@/config/env';

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        orgId?: string;
        role?: string;
      };
    }
  }
}

export async function auth(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'unauthorized', message: 'Missing or invalid authorization header' });
      return;
    }

    const token = authHeader.replace('Bearer ', '');

    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(env.SUPABASE_JWT_SECRET)
    );

    req.user = { userId: payload.sub as string };
    next();
  } catch (error) {
    res.status(401).json({ error: 'unauthorized', message: 'Invalid token' });
  }
}