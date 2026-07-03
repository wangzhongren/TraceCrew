import express from 'express';
import cors from 'cors';
import * as path from 'path';
import * as fs from 'fs';
import type { Server } from 'http';
import { fileURLToPath } from 'url';
import agentRoutes from './routes/agent';
import featuresRoutes from './routes/features';
import changesRoutes from './routes/changes';
import topologyRoutes from './routes/topology';
import { agentService } from './services/agent';
import { updateEnvFile } from '../settingsStore';

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

  const AGENTS = ['pm', 'architect', 'planner', 'reviewer', 'mapper', 'executor'] as const;
  const LEGACY_KEYS = {
    apiKey: 'TRACECREW_LLM_API_KEY',
    baseUrl: 'TRACECREW_LLM_BASE_URL',
    model: 'TRACECREW_LLM_MODEL',
  };

  function readAgentConfig(agent: string): { apiKey: string; baseUrl: string; model: string } {
    const prefix = `TRACECREW_LLM_${agent.toUpperCase()}_`;
    return {
      apiKey: process.env[`${prefix}API_KEY`] || process.env[LEGACY_KEYS.apiKey] || '',
      baseUrl: process.env[`${prefix}BASE_URL`] || process.env[LEGACY_KEYS.baseUrl] || '',
      model: process.env[`${prefix}MODEL`] || process.env[LEGACY_KEYS.model] || '',
    };
  }

  app.get('/api/v1/settings', (_req, res) => {
    const result: Record<string, { apiKey: string; baseUrl: string; model: string }> = {};
    for (const a of AGENTS) {
      result[a] = readAgentConfig(a);
    }
    res.json(result);
  });

  app.post('/api/v1/settings', (req, res) => {
    const data = req.body || {};
    const updates: Record<string, string> = {};

    for (const a of AGENTS) {
      const cfg = data[a] || {};
      const prefix = `TRACECREW_LLM_${a.toUpperCase()}_`;
      if (cfg.apiKey !== undefined) { process.env[`${prefix}API_KEY`] = cfg.apiKey; updates[`${prefix}API_KEY`] = cfg.apiKey; }
      if (cfg.baseUrl !== undefined) { process.env[`${prefix}BASE_URL`] = cfg.baseUrl; updates[`${prefix}BASE_URL`] = cfg.baseUrl; }
      if (cfg.model !== undefined)   { process.env[`${prefix}MODEL`]   = cfg.model;   updates[`${prefix}MODEL`]   = cfg.model; }
    }

    updateEnvFile(updates);
    agentService.reload();
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
