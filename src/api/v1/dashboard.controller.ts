// src/api/v1/dashboard.controller.ts
import { Request, Response } from 'express';
import { getDashboardSummary } from '@/services/dashboard.service';

export async function dashboardSummary(req: Request, res: Response) {
  try {
    const orgId = req.user?.orgId;
    
    if (!orgId) {
      res.status(400).json({ error: 'missing_org_id' });
      return;
    }

    const data = await getDashboardSummary(orgId);

    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json(data);
  } catch (error) {
    console.error('Dashboard summary error:', error);
    res.status(500).json({ error: 'internal_error' });
  }
}