// src/index.ts
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { auth } from '@/api/middleware/auth';
import { attachContext } from '@/api/middleware/context';
import api from '@/api/v1';

console.log('=== Starting server ===');
console.log('Node version:', process.version);
console.log('ENV vars loaded:', {
  PORT: process.env.PORT,
  DATABASE_URL: process.env.DATABASE_URL ? 'SET' : 'NOT SET',
  SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET ? 'SET' : 'NOT SET',
});

const app: Express = express();

// Manual CORS middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const allowedOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000'];
  const origin = req.headers.origin;
  
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  next();
});

app.use(express.json());

// Health check endpoint (NO auth required)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Readiness check
app.get('/ready', async (_req, res) => {
  try {
    res.json({ status: 'ready', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ status: 'not_ready', error: 'database_unavailable' });
  }
});

// Auth and context middleware
app.use(auth);
app.use(attachContext);

// API routes
app.use('/api/v1', api);

const PORT = process.env.PORT || 3001;

try {
  const server = app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
  });

  server.on('error', (err) => {
    console.error('❌ Server error:', err);
  });

} catch (err) {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
}

// Keep process alive and log any crashes
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection:', reason);
});

export default app;