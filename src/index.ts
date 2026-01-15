// src/index.ts
import express from 'express';
import { auth } from '@/api/middleware/auth';
import { attachContext } from '@/api/middleware/context';
import { dashboardSummary } from '@/api/v1/dashboard.controller';
import api from '@/api/v1';


const app = express();

app.use(express.json());
app.use(auth);
app.use(attachContext);
app.use('/api/v1', api);

app.get('/api/v1/dashboard/summary', dashboardSummary);

app.listen(process.env.PORT || 3000);
