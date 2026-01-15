// src/services/dashboard.service.ts
import { getLatestGlobalDay } from '@/repositories/globalMetrics.repo';

export async function getDashboardSummary(orgId: string) {
  const row = await getLatestGlobalDay(orgId);
  if (!row) return null;

  return {
    day: row.day,
    dau: row.dau,
    spotVolumeUsd: row.spot_volume_usd,
    perpVolumeUsd: row.perp_volume_usd,
    avgSpotPerUser: row.avg_spot_volume_per_user,
    avgPerpPerUser: row.avg_perp_volume_per_user,
    updatedAt: row.updated_at
  };
}
