// src/workers/rollup/globalDay.job.ts
import { pool } from '@/db/pool';

export async function rollupGlobalDay(job: any) {
  const { org_id, days } = job.payload as { org_id: string; days: string[] };

  for (const day of days) {
    await pool.query(
      `
      with agg as (
        select
          org_id,
          day,
          count(*) filter (where trades_count > 0) as dau,
          coalesce(sum(spot_volume_usd),0) as spot_volume_usd,
          coalesce(sum(perp_volume_usd),0) as perp_volume_usd
        from public.wallet_day_metrics
        where org_id = $1
          and day = $2::date
        group by org_id, day
      )
      insert into public.global_day_metrics (
        org_id, day, dau,
        spot_volume_usd, perp_volume_usd,
        avg_spot_volume_per_user, avg_perp_volume_per_user,
        updated_at
      )
      select
        org_id,
        day,
        dau,
        spot_volume_usd,
        perp_volume_usd,
        case when dau > 0 then spot_volume_usd / dau else 0 end,
        case when dau > 0 then perp_volume_usd / dau else 0 end,
        now()
      from agg
      on conflict (org_id, day)
      do update set
        dau = excluded.dau,
        spot_volume_usd = excluded.spot_volume_usd,
        perp_volume_usd = excluded.perp_volume_usd,
        avg_spot_volume_per_user = excluded.avg_spot_volume_per_user,
        avg_perp_volume_per_user = excluded.avg_perp_volume_per_user,
        updated_at = now()
      `,
      [org_id, day]
    );
  }
}
