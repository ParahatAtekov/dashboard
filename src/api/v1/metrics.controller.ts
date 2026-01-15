// src/api/v1/metrics.controller.ts
import { Request, Response } from 'express';
import { getGlobalTimeseries } from '@/services/metrics.service';

export async function globalTimeseries(req: Request, res: Response) {
  const { orgId } = (req as any).user;
  const range = (req.query.range as string) || '30d';

  const data = await getGlobalTimeseries(orgId, range);
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(data);
}
