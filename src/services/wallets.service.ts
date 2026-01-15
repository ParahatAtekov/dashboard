// src/services/wallets.service.ts
import { fetchTopWallets } from '@/repositories/walletMetrics.repo';

const WINDOW_TO_DAYS: Record<string, number> = {
  '7d': 7,
  '30d': 30
};

export async function getTopWallets(orgId: string, window: string, limit: number) {
  const days = WINDOW_TO_DAYS[window] ?? 30;
  return fetchTopWallets(orgId, days, limit);
}