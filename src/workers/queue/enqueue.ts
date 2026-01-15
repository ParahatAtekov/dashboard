// src/workers/queue/enqueue.ts
import { pool } from '@/db/pool';

export async function enqueueJob(orgId: string, type: string, payload: any, runAt?: Date) {
  await pool.query(
    `insert into public.jobs (org_id, type, payload, run_at)
     values ($1, $2, $3::jsonb, coalesce($4, now()))`,
    [orgId, type, JSON.stringify(payload), runAt?.toISOString() ?? null]
  );
}
