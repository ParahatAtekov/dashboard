// src/services/auth.service.ts
import { pool } from '@/db/pool';

export interface UserContext {
  org_id: string;
  role: string;
}

export async function resolveUserContext(userId: string): Promise<UserContext> {
  const { rows } = await pool.query(
    `
    SELECT org_id, role
    FROM public.user_profiles
    WHERE user_id = $1
    LIMIT 1
    `,
    [userId]
  );

  if (rows.length === 0) {
    throw new Error('user_not_found');
  }

  return {
    org_id: rows[0].org_id,
    role: rows[0].role
  };
}