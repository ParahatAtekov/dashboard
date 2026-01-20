#!/usr/bin/env ts-node
// src/scripts/recover-stuck-jobs.ts
/**
 * Recovers stuck jobs with expired locks.
 * Can be run manually or as a cron job.
 *
 * Usage:
 *   ts-node -r tsconfig-paths/register src/scripts/recover-stuck-jobs.ts [org-id]
 *
 * If org-id is not provided, recovers for all orgs.
 */

import { pool } from '@/db/pool';
import { recoverStuckJobs } from '@/repositories/jobs.repo';

async function main() {
  const orgId = process.argv[2] || process.env.ORG_ID;

  try {
    if (orgId) {
      console.log(`Recovering stuck jobs for org: ${orgId}`);
      const count = await recoverStuckJobs(orgId);
      console.log(`✅ Recovered ${count} stuck job(s)`);
    } else {
      console.log('Recovering stuck jobs for all orgs...');

      // Get all org IDs
      const { rows } = await pool.query<{ id: string }>(
        'SELECT id FROM public.orgs'
      );

      let totalRecovered = 0;
      for (const org of rows) {
        const count = await recoverStuckJobs(org.id);
        if (count > 0) {
          console.log(`  Org ${org.id}: recovered ${count} job(s)`);
          totalRecovered += count;
        }
      }

      console.log(`✅ Total recovered: ${totalRecovered} job(s) across ${rows.length} org(s)`);
    }

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error recovering stuck jobs:', error);
    await pool.end();
    process.exit(1);
  }
}

main();
