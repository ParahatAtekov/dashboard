// src/repositories/walletMetrics.repo.ts
import { pool } from '@/db/pool';

export async function fetchTopWallets(orgId: string, days: number, limit: number) {
  const { rows } = await pool.query(
    `
    select
      w.id as wallet_id,
      w.address,
      sum(m.spot_volume_usd) as spot_volume_usd,
      sum(m.perp_volume_usd) as perp_volume_usd,
      sum(m.trades_count) as trades,
      max(m.last_trade_ts) as last_trade_at
    from public.wallet_day_metrics m
    join public.wallets w on w.id = m.wallet_id
    where m.org_id = $1
      and m.day >= current_date - ($2 || ' days')::interval
    group by w.id, w.address
    order by (sum(m.spot_volume_usd) + sum(m.perp_volume_usd)) desc
    limit $3
    `,
    [orgId, days, limit]
  );

  return rows;
}
