// src/workers/ingest/ingestWallet.job.ts

import { pool } from '@/db/pool';
import { hlClient } from './hlClient';
import { getRateLimiter, reportRateLimit, adjustForResponseSize } from './rateLimiter';
import { deriveFillId, isSpot, isPerp, transpose, HLFill } from './helpers';
import { updateCursorAfterIngestion } from '@/workers/scheduler/walletScheduler';
import { enqueueJob } from '@/workers/queue/enqueue';

const OVERLAP_MS = 10 * 60 * 1000; // 10 minutes overlap window

export interface IngestWalletPayload {
  org_id: string;
  wallet_id: number;
  address: string;
}

export async function ingestWallet(job: { payload: IngestWalletPayload }) {
  const { org_id, wallet_id, address } = job.payload;
  const limiter = getRateLimiter();

  try {
    // Get cursor position for this wallet
    const cursorRes = await pool.query(
      `SELECT cursor_ts FROM public.hl_ingest_cursor
       WHERE org_id = $1 AND wallet_id = $2`,
      [org_id, wallet_id]
    );

    const cursorTs: Date = cursorRes.rows[0]?.cursor_ts ?? new Date(0);
    const startTime = new Date(cursorTs.getTime() - OVERLAP_MS);

    // Acquire rate limit token before API call
    const waitTime = await limiter.acquire();
    if (waitTime > 0) {
      console.log(`[Ingest ${wallet_id}] Waited ${waitTime}ms for rate limit`);
    }

    // Fetch fills from Hyperliquid
    let fills: HLFill[];
    try {
      fills = await hlClient.userFillsByTime({
        user: address,
        startTime: startTime.getTime()
      }) as HLFill[];
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('rate limit') || errorMessage.includes('Too many')) {
        reportRateLimit();
        throw new Error(`Rate limited: ${errorMessage}`);
      }
      throw error;
    }

    // Adjust rate limiter for actual response size
    adjustForResponseSize(fills.length);

    if (!fills.length) {
      await updateCursorAfterIngestion(org_id, wallet_id, true, cursorTs);
      return { inserted: 0, message: 'No new fills' };
    }

    // Prepare values for bulk insert
    const values: unknown[][] = [];
    const affectedDays = new Set<string>();

    for (const f of fills) {
      const fillDate = new Date(f.time);
      affectedDays.add(fillDate.toISOString().split('T')[0]);
      
      values.push([
        org_id,
        wallet_id,
        deriveFillId(f),
        fillDate,
        f.coin,
        f.side,
        f.px,
        f.sz,
        isSpot(f),
        isPerp(f)
      ]);
    }

    // Bulk insert with conflict handling (idempotent)
    const insertResult = await pool.query(
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

    // Get max timestamp for cursor update
    const maxTs = Math.max(...fills.map(f => f.time));
    const newCursorTs = new Date(maxTs);

    // Update cursor with success
    await updateCursorAfterIngestion(org_id, wallet_id, true, newCursorTs);

    // Chain rollup job for affected days
    if (affectedDays.size > 0) {
      await enqueueJob(org_id, 'rollup_wallet_day', {
        org_id,
        wallet_id,
        days: Array.from(affectedDays),
      });
    }

    console.log(`[Ingest ${wallet_id}] Inserted ${insertResult.rowCount ?? 0} fills, rollup for ${affectedDays.size} days`);

    return {
      inserted: insertResult.rowCount ?? 0,
      fills_fetched: fills.length,
      days_affected: affectedDays.size,
    };

  } catch (error: unknown) {
    await updateCursorAfterIngestion(org_id, wallet_id, false);
    throw error;
  }
}