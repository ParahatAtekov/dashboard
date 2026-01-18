// src/index.ts
import express, { type Express } from 'express';
import { auth } from '@/api/middleware/auth';
import { attachContext } from '@/api/middleware/context';
import api from '@/api/v1';

const app: Express = express();

app.use(express.json());

// Health check endpoint (NO auth required - must be before auth middleware)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Readiness check (can add DB ping here later)
app.get('/ready', async (_req, res) => {
  try {
    // TODO: Add database ping check
    // await pool.query('SELECT 1');
    res.json({ status: 'ready', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ status: 'not_ready', error: 'database_unavailable' });
  }
});

// Auth and context middleware (applies to all routes below)
app.use(auth);
app.use(attachContext);

// API routes (all require auth)
app.use('/api/v1', api);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;