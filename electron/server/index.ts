import express from 'express';
import cors from 'cors';
import * as path from 'path';
import * as fs from 'fs';
import type { Server } from 'http';
import agentRoutes from './routes/agent';
import featuresRoutes from './routes/features';
import changesRoutes from './routes/changes';
import topologyRoutes from './routes/topology';

const PORT = 19850;

export function createServer(frontendDistDir: string): Server {
  const app = express();

  // ── Middleware ──
  app.use(cors({ origin: '*', credentials: true }));
  app.use(express.json({ limit: '2mb' }));

  // ── Static files (production: serve frontend dist) ──
  if (fs.existsSync(frontendDistDir)) {
    app.use('/assets', express.static(path.join(frontendDistDir, 'assets')));
  }

  // ── API Routes ──
  app.use('/api/v1/agent', agentRoutes);
  app.use('/api/v1/features', featuresRoutes);
  app.use('/api/v1/changes', changesRoutes);
  app.use('/api/v1/topology', topologyRoutes);

  // ── Settings ──
  app.post('/api/v1/settings', (req, res) => {
    const { apiKey, baseUrl, model } = req.body || {};
    if (apiKey) process.env.CODEATLAS_LLM_API_KEY = apiKey;
    if (baseUrl) process.env.CODEATLAS_LLM_BASE_URL = baseUrl;
    if (model) process.env.CODEATLAS_LLM_MODEL = model;
    // Reset the agent service to pick up new settings
    try {
      const { agentService } = require('./services/agent');
      agentService.reload();
    } catch {}
    res.json({ status: 'ok' });
  });

  // ── Health ──
  app.get('/api/v1/health', (_req, res) => {
    res.json({ status: 'ok', service: 'code-atlas' });
  });

  // SPA fallback — skipped in dev (Vite serves frontend)
  // In production: serve index.html for all non-API routes

  const server = app.listen(PORT, () => {
    console.log(`[server] Express listening on http://localhost:${PORT}`);
  });

  return server;
}
