// src/api/middleware/auth.ts
import { jwtVerify, createRemoteJWKSet } from 'jose';
import { Request, Response, NextFunction } from 'express';

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

// Create JWKS client for Supabase
const JWKS = createRemoteJWKSet(new URL('https://jwyddxxaoykxbgeooetp.supabase.co/auth/v1/.well-known/jwks.json'));

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
      JWKS,
      {
        issuer: 'https://jwyddxxaoykxbgeooetp.supabase.co/auth/v1',
        audience: 'authenticated'
      }
    );

    req.user = { userId: payload.sub as string };
    next();
  } catch (error) {
    res.status(401).json({ error: 'unauthorized', message: 'Invalid token' });
  }
}