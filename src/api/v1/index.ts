// src/api/v1/index.ts
import { Router, type IRouter } from 'express';
import { globalTimeseries } from './metrics.controller';
import { topWallets } from './wallets.controller';
import { dashboardSummary } from './dashboard.controller';

const router: IRouter = Router();

router.get('/dashboard/summary', dashboardSummary);
router.get('/metrics/global', globalTimeseries);
router.get('/wallets/top', topWallets);

export default router;