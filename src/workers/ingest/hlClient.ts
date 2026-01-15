// src/workers/ingest/hlClient.ts

/**
 * Hyperliquid Info API client wrapper.
 * 
 * Note: The @nktkas/hyperliquid package may not exist or have different API.
 * This is a typed wrapper that you can adapt to the actual SDK you use.
 */

const HL_INFO_URL = process.env.HL_INFO_URL || 'https://api.hyperliquid.xyz/info';

export interface UserFillsRequest {
  user: string;
  startTime: number;
  endTime?: number;
}

export interface HLFillResponse {
  time: number;
  coin: string;
  side: string;
  px: string;
  sz: string;
  startPosition: string;
  dir: string;
  closedPnl: string;
  hash: string;
  oid: number;
  crossed: boolean;
  fee: string;
  tid: number;
  feeToken: string;
}

class HyperliquidInfoClient {
  private baseUrl: string;

  constructor(baseUrl: string = HL_INFO_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * Fetches user fills by time range.
   * Uses the Hyperliquid info API endpoint.
   */
  async userFillsByTime(params: UserFillsRequest): Promise<HLFillResponse[]> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'userFillsByTime',
        user: params.user,
        startTime: params.startTime,
        endTime: params.endTime,
      }),
    });

    if (!response.ok) {
      throw new Error(`Hyperliquid API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data as HLFillResponse[];
  }

  /**
   * Fetches user state (positions, balances, etc.)
   */
  async userState(user: string): Promise<unknown> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'clearinghouseState',
        user: user,
      }),
    });

    if (!response.ok) {
      throw new Error(`Hyperliquid API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }
}

// Singleton instance
export const hlClient = new HyperliquidInfoClient();