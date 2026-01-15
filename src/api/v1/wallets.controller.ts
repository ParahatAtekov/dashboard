// src/api/v1/wallets.controller.ts
import { Request, Response } from 'express';
import { getTopWallets } from '@/services/wallets.service';

export async function topWallets(req: Request, res: Response) {
  try {
    const orgId = req.user?.orgId;
    
    if (!orgId) {
      res.status(400).json({ error: 'missing_org_id' });
      return;
    }

    const window = (req.query.window as string) || '30d';
    const limit = Math.min(Number(req.query.limit) || 50, 100);

    const data = await getTopWallets(orgId, window, limit);
    
    res.setHeader('Cache-Control', 'public, max-age=120');
    res.json(data);
  } catch (error) {
    console.error('Top wallets error:', error);
    res.status(500).json({ error: 'internal_error' });
  }
}