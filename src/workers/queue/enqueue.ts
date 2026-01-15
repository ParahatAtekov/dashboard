// src/workers/queue/enqueue.ts
import { pool } from '@/db/pool';

export async function enqueueJob(
  orgId: string,
  type: string,
  payload: Record<string, unknown>,
  runAt?: Date
): Promise<void> {
  await pool.query(
    `INSERT INTO public.jobs (org_id, type, payload, run_at)
     VALUES ($1, $2, $3::jsonb, COALESCE($4, NOW()))`,
    [orgId, type, JSON.stringify(payload), runAt?.toISOString() ?? null]
  );
}