// src/services/metrics.service.ts
import { fetchGlobalDays } from '@/repositories/globalMetrics.repo';

const RANGE_TO_DAYS: Record<string, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90
};

export async function getGlobalTimeseries(orgId: string, range: string) {
  const days = RANGE_TO_DAYS[range] ?? 30;
  return fetchGlobalDays(orgId, days);
}
