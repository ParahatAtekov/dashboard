// src/api/v1/metrics.controller.ts
import { Request, Response } from 'express';
import { getGlobalTimeseries } from '@/services/metrics.service';

export async function globalTimeseries(req: Request, res: Response) {
  try {
    const orgId = req.user?.orgId;
    
    if (!orgId) {
      res.status(400).json({ error: 'missing_org_id' });
      return;
    }

    const range = (req.query.range as string) || '30d';

    const data = await getGlobalTimeseries(orgId, range);
    
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(data);
  } catch (error) {
    console.error('Global timeseries error:', error);
    res.status(500).json({ error: 'internal_error' });
  }
}