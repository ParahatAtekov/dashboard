// src/config/env.ts
import { config } from 'dotenv';
import { z } from 'zod';

config();

const envSchema = z.object({
  PORT: z.string().default('3001'),
  DATABASE_URL: z.string().url(),
  SUPABASE_JWT_SECRET: z.string().min(1)
});

export const env = envSchema.parse(process.env);