// src/workers/rollup/walletDay.job.ts
import { pool } from '@/db/pool';
import { enqueueJob } from '@/workers/queue/enqueue';

export async function rollupWalletDay(job: any) {
  const { org_id, wallet_id, days } = job.payload as {
    org_id: string; wallet_id: number; days: string[];
  };

  // recompute each day deterministically
  for (const day of days) {
    await pool.query(
      `
      with agg as (
        select
          org_id,
          wallet_id,
          date(ts) as day,
          sum(case when is_spot then notional_usd else 0 end) as spot_volume_usd,
          sum(case when is_perp then notional_usd else 0 end) as perp_volume_usd,
          count(*) as trades_count,
          max(ts) as last_trade_ts
        from public.hl_fills_raw
        where org_id = $1
          and wallet_id = $2
          and ts >= $3::date
          and ts <  ($3::date + interval '1 day')
        group by org_id, wallet_id, date(ts)
      )
      insert into public.wallet_day_metrics (
        org_id, wallet_id, day,
        spot_volume_usd, perp_volume_usd, trades_count, last_trade_ts, updated_at
      )
      select
        org_id, wallet_id, day,
        spot_volume_usd, perp_volume_usd, trades_count, last_trade_ts, now()
      from agg
      on conflict (org_id, wallet_id, day)
      do update set
        spot_volume_usd = excluded.spot_volume_usd,
        perp_volume_usd = excluded.perp_volume_usd,
        trades_count = excluded.trades_count,
        last_trade_ts = excluded.last_trade_ts,
        updated_at = now()
      `,
      [org_id, wallet_id, day]
    );
  }

  // chain global rollup for same days
  await enqueueJob(org_id, 'rollup_global_day', { org_id, days });
}
