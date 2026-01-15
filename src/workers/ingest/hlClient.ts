// src/workers/ingest/hlClient.ts
import { InfoClient } from '@nktkas/hyperliquid';

export const hlClient = new InfoClient({
  transport: { type: 'http' }
});
