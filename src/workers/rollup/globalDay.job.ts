// src/workers/rollup/globalDay.job.ts
import { pool } from '@/db/pool';

export interface RollupGlobalDayPayload {
  org_id: string;
  days: string[];
}

export async function rollupGlobalDay(job: { payload: RollupGlobalDayPayload }) {
  const { org_id, days } = job.payload;

  for (const day of days) {
    await pool.query(
      `
      WITH agg AS (
        SELECT
          org_id,
          day,
          COUNT(*) FILTER (WHERE trades_count > 0) AS dau,
          COALESCE(SUM(spot_volume_usd), 0) AS spot_volume_usd,
          COALESCE(SUM(perp_volume_usd), 0) AS perp_volume_usd
        FROM public.wallet_day_metrics
        WHERE org_id = $1
          AND day = $2::date
        GROUP BY org_id, day
      )
      INSERT INTO public.global_day_metrics (
        org_id, day, dau,
        spot_volume_usd, perp_volume_usd,
        avg_spot_volume_per_user, avg_perp_volume_per_user,
        updated_at
      )
      SELECT
        org_id,
        day,
        dau,
        spot_volume_usd,
        perp_volume_usd,
        CASE WHEN dau > 0 THEN spot_volume_usd / dau ELSE 0 END,
        CASE WHEN dau > 0 THEN perp_volume_usd / dau ELSE 0 END,
        NOW()
      FROM agg
      ON CONFLICT (org_id, day)
      DO UPDATE SET
        dau = EXCLUDED.dau,
        spot_volume_usd = EXCLUDED.spot_volume_usd,
        perp_volume_usd = EXCLUDED.perp_volume_usd,
        avg_spot_volume_per_user = EXCLUDED.avg_spot_volume_per_user,
        avg_perp_volume_per_user = EXCLUDED.avg_perp_volume_per_user,
        updated_at = NOW()
      `,
      [org_id, day]
    );
  }
}