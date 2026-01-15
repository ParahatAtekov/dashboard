// src/config/env.ts
import { z } from 'zod';

export const env = z.object({
  PORT: z.string().default('3000'),
  DATABASE_URL: z.string().url(),
  SUPABASE_JWT_SECRET: z.string()
}).parse(process.env);
