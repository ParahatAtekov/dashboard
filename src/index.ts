// src/index.ts
import express, { type Express } from 'express';
import { auth } from '@/api/middleware/auth';
import { attachContext } from '@/api/middleware/context';
import api from '@/api/v1';

const app: Express = express();

app.use(express.json());

// Auth and context middleware
app.use(auth);
app.use(attachContext);

// API routes
app.use('/api/v1', api);

// Health check endpoint (no auth required - add before middleware if needed)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;