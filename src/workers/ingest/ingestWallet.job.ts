// src/workers/ingest/ingestWallet.job.ts
import { pool } from '@/db/pool';
import { hlClient } from './hlClient';
import { acquire } from './rateLimiter';
import { deriveFillId, isSpot, isPerp, transpose, HLFill } from './helpers';

const OVERLAP_MS = 10 * 60 * 1000; // 10 minutes overlap window

export interface IngestWalletPayload {
  org_id: string;
  wallet_id: number;
  address: string;
}

export async function ingestWallet(job: { payload: IngestWalletPayload }) {
  const { org_id, wallet_id, address } = job.payload;

  // Get cursor position for this wallet
  const cursorRes = await pool.query(
    `SELECT cursor_ts FROM public.hl_ingest_cursor
     WHERE org_id = $1 AND wallet_id = $2`,
    [org_id, wallet_id]
  );

  const cursorTs: Date = cursorRes.rows[0]?.cursor_ts ?? new Date(0);
  const startTime = new Date(cursorTs.getTime() - OVERLAP_MS);

  // Rate limit before API call
  await acquire();

  // Fetch fills from Hyperliquid
  const fills = await hlClient.userFillsByTime({
    user: address,
    startTime: startTime.getTime()
  }) as HLFill[];

  if (!fills.length) {
    return { inserted: 0 };
  }

  // Prepare values for bulk insert
  const values: unknown[][] = [];
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

  // Bulk insert with conflict handling (idempotent)
  await pool.query(
    `
    INSERT INTO public.hl_fills_raw
      (org_id, wallet_id, hl_fill_id, ts, coin, side, px, sz, is_spot, is_perp)
    SELECT * FROM unnest(
      $1::uuid[], $2::bigint[], $3::text[], $4::timestamptz[],
      $5::text[], $6::text[], $7::numeric[], $8::numeric[],
      $9::boolean[], $10::boolean[]
    )
    ON CONFLICT DO NOTHING
    `,
    transpose(values)
  );

  // Update cursor to latest fill timestamp
  const maxTs = Math.max(...fills.map(f => f.time));

  await pool.query(
    `
    UPDATE public.hl_ingest_cursor
    SET cursor_ts = to_timestamp($3 / 1000.0),
        last_success_at = NOW(),
        error_count = 0,
        status = 'ok',
        next_run_at = NOW() + INTERVAL '60 seconds'
    WHERE org_id = $1 AND wallet_id = $2
    `,
    [org_id, wallet_id, maxTs]
  );

  return { inserted: fills.length };
}