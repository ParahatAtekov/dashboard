#!/usr/bin/env ts-node
// src/scripts/job-monitor.ts
/**
 * Monitors job health and reports stuck/failed jobs.
 * Useful for monitoring and alerting.
 *
 * Usage:
 *   ts-node -r tsconfig-paths/register src/scripts/job-monitor.ts [org-id]
 */

import { pool } from '@/db/pool';

interface JobStats {
  org_id: string;
  status: string;
  count: number;
  oldest_job_age_minutes?: number;
}

async function main() {
  const orgId = process.argv[2] || process.env.ORG_ID;

  try {
    const orgFilter = orgId ? 'WHERE org_id = $1' : '';
    const params = orgId ? [orgId] : [];

    // Get job statistics
    const { rows: stats } = await pool.query<JobStats>(
      `
      SELECT
        org_id,
        status,
        COUNT(*) as count,
        ROUND(EXTRACT(EPOCH FROM (NOW() - MIN(run_at))) / 60) as oldest_job_age_minutes
      FROM public.jobs
      ${orgFilter}
      GROUP BY org_id, status
      ORDER BY org_id, status
      `,
      params
    );

    // Get stuck running jobs
    const { rows: stuckJobs } = await pool.query<{ count: number }>(
      `
      SELECT COUNT(*) as count
      FROM public.jobs
      ${orgFilter}
        ${orgFilter ? 'AND' : 'WHERE'} status = 'running'
        AND lock_expires_at < NOW()
      `,
      params
    );

    console.log('\n📊 Job Queue Statistics:');
    console.log('─'.repeat(60));

    if (stats.length === 0) {
      console.log('No jobs found.');
    } else {
      let currentOrg = '';
      for (const stat of stats) {
        if (stat.org_id !== currentOrg) {
          console.log(`\nOrg: ${stat.org_id}`);
          currentOrg = stat.org_id;
        }
        const ageStr = stat.oldest_job_age_minutes
          ? ` (oldest: ${stat.oldest_job_age_minutes}m)`
          : '';
        console.log(`  ${stat.status.padEnd(10)}: ${stat.count}${ageStr}`);
      }
    }

    console.log('\n🚨 Stuck Jobs (running with expired locks):');
    console.log('─'.repeat(60));
    const stuckCount = stuckJobs[0]?.count || 0;
    if (stuckCount > 0) {
      console.log(`⚠️  ${stuckCount} job(s) are stuck!`);
      console.log('   Run: npm run recover-jobs');
    } else {
      console.log('✅ No stuck jobs');
    }

    console.log('');
    await pool.end();
    process.exit(stuckCount > 0 ? 1 : 0);
  } catch (error) {
    console.error('❌ Error monitoring jobs:', error);
    await pool.end();
    process.exit(1);
  }
}

main();
