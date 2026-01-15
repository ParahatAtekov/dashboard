// src/repositories/globalMetrics.repo.ts
import { pool } from '@/db/pool';

export async function fetchGlobalDays(orgId: string, days: number) {
  const { rows } = await pool.query(
    `
    SELECT day, dau, spot_volume_usd, perp_volume_usd
    FROM public.global_day_metrics
    WHERE org_id = $1
    ORDER BY day DESC
    LIMIT $2
    `,
    [orgId, days]
  );
  return rows.reverse();
}

export async function getLatestGlobalDay(orgId: string) {
  const { rows } = await pool.query(
    `
    SELECT
      day,
      dau,
      spot_volume_usd,
      perp_volume_usd,
      avg_spot_volume_per_user,
      avg_perp_volume_per_user,
      updated_at
    FROM public.global_day_metrics
    WHERE org_id = $1
    ORDER BY day DESC
    LIMIT 1
    `,
    [orgId]
  );
  return rows[0] ?? null;
}