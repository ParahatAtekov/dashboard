// src/repositories/globalMetrics.repo.ts
import { pool } from '@/db/pool';

export async function fetchGlobalDays(orgId: string, days: number) {
  const { rows } = await pool.query(
    `
    select day, dau, spot_volume_usd, perp_volume_usd
    from public.global_day_metrics
    where org_id = $1
    order by day desc
    limit $2
    `,
    [orgId, days]
  );
  return rows.reverse();
}
