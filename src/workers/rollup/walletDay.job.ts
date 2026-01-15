// src/workers/rollup/walletDay.job.ts
import { pool } from '@/db/pool';
import { enqueueJob } from '@/workers/queue/enqueue';

export interface RollupWalletDayPayload {
  org_id: string;
  wallet_id: number;
  days: string[];
}

export async function rollupWalletDay(job: { payload: RollupWalletDayPayload }) {
  const { org_id, wallet_id, days } = job.payload;

  // Recompute each day deterministically from raw fills
  for (const day of days) {
    await pool.query(
      `
      WITH agg AS (
        SELECT
          org_id,
          wallet_id,
          DATE(ts) AS day,
          SUM(CASE WHEN is_spot THEN px * sz ELSE 0 END) AS spot_volume_usd,
          SUM(CASE WHEN is_perp THEN px * sz ELSE 0 END) AS perp_volume_usd,
          COUNT(*) AS trades_count,
          MAX(ts) AS last_trade_ts
        FROM public.hl_fills_raw
        WHERE org_id = $1
          AND wallet_id = $2
          AND ts >= $3::date
          AND ts < ($3::date + INTERVAL '1 day')
        GROUP BY org_id, wallet_id, DATE(ts)
      )
      INSERT INTO public.wallet_day_metrics (
        org_id, wallet_id, day,
        spot_volume_usd, perp_volume_usd, trades_count, last_trade_ts, updated_at
      )
      SELECT
        org_id, wallet_id, day,
        spot_volume_usd, perp_volume_usd, trades_count, last_trade_ts, NOW()
      FROM agg
      ON CONFLICT (org_id, wallet_id, day)
      DO UPDATE SET
        spot_volume_usd = EXCLUDED.spot_volume_usd,
        perp_volume_usd = EXCLUDED.perp_volume_usd,
        trades_count = EXCLUDED.trades_count,
        last_trade_ts = EXCLUDED.last_trade_ts,
        updated_at = NOW()
      `,
      [org_id, wallet_id, day]
    );
  }

  // Chain global rollup for same days
  await enqueueJob(org_id, 'rollup_global_day', { org_id, days });
}