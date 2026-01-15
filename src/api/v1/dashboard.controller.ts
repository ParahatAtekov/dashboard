// src/api/v1/dashboard.controller.ts
import { Request, Response } from 'express';
import { getDashboardSummary } from '@/services/dashboard.service';

export async function dashboardSummary(req: Request, res: Response) {
  const { orgId } = (req as any).user;
  const data = await getDashboardSummary(orgId);

  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json(data);
}
