// src/workers/ingest/ingestWallet.job.ts
import { pool } from '@/db/pool';
import { hlClient } from './hlClient';
import { acquire } from './rateLimiter';

const OVERLAP_MS = 10 * 60 * 1000;

export async function ingestWallet(job: any) {
  const { org_id, wallet_id, address } = job.payload;

  const cursorRes = await pool.query(
    `select cursor_ts from hl_ingest_cursor
     where org_id=$1 and wallet_id=$2`,
    [org_id, wallet_id]
  );

  const cursorTs = cursorRes.rows[0]?.cursor_ts ?? new Date(0);
  const startTime = new Date(cursorTs.getTime() - OVERLAP_MS);

  await acquire();

  const fills = await hlClient.userFillsByTime({
    user: address,
    startTime: startTime.getTime()
  });

  if (!fills.length) return { inserted: 0 };

  const values = [];
  for (const f of fills) {
    values.push([
      org_id,
      wallet_id,
      deriveFillId(f),
      new Date(f.time),
      f.coin,
      f.side,
      f.px,
      f.sz,
      isSpot(f),
      isPerp(f)
    ]);
  }

  await pool.query(
    `
    insert into hl_fills_raw
      (org_id, wallet_id, hl_fill_id, ts, coin, side, px, sz, is_spot, is_perp)
    select * from unnest(
      $1::uuid[], $2::bigint[], $3::text[], $4::timestamptz[],
      $5::text[], $6::text[], $7::numeric[], $8::numeric[],
      $9::boolean[], $10::boolean[]
    )
    on conflict do nothing
    `,
    transpose(values)
  );

  const maxTs = Math.max(...fills.map(f => f.time));

  await pool.query(
    `
    update hl_ingest_cursor
    set cursor_ts = to_timestamp($3/1000),
        last_success_at = now(),
        error_count = 0,
        next_run_at = now() + interval '60 seconds'
    where org_id=$1 and wallet_id=$2
    `,
    [org_id, wallet_id, maxTs]
  );

  return { inserted: fills.length };
}
