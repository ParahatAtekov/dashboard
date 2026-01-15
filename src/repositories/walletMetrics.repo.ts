// src/repositories/walletMetrics.repo.ts
import { pool } from '@/db/pool';

export async function fetchTopWallets(orgId: string, days: number, limit: number) {
  const { rows } = await pool.query(
    `
    SELECT
      w.id AS wallet_id,
      w.address,
      SUM(m.spot_volume_usd) AS spot_volume_usd,
      SUM(m.perp_volume_usd) AS perp_volume_usd,
      SUM(m.trades_count) AS trades,
      MAX(m.last_trade_ts) AS last_trade_at
    FROM public.wallet_day_metrics m
    JOIN public.wallets w ON w.id = m.wallet_id
    WHERE m.org_id = $1
      AND m.day >= CURRENT_DATE - ($2 || ' days')::INTERVAL
    GROUP BY w.id, w.address
    ORDER BY (SUM(m.spot_volume_usd) + SUM(m.perp_volume_usd)) DESC
    LIMIT $3
    `,
    [orgId, days, limit]
  );

  return rows;
}