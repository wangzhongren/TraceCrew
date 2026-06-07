import { Router } from 'express';
import { loadFeatures, saveFeatures, findFeature, updateFeatureChildren, updateFeatureOverview } from '../services/db';
import type { FeatureNode } from '../types';

const router = Router();

/* ── GET features ── */

router.get('/', (req, res) => {
  const projectPath = (req.query.project_path as string) || '';
  if (!projectPath) {
    return res.json({ features: [], last_updated: '' });
  }
  try {
    const features = loadFeatures(projectPath);
    res.json({ features, last_updated: '' });
  } catch (e: any) {
    res.json({ features: [], last_updated: '' });
  }
});

/* ── POST analyze (drill-down) ── */

router.post('/analyze', async (req, res) => {
  // Stub: drill-down requires LLM. Returns empty for now.
  res.json({ nodes: [] });
});

/* ── POST analyze-top ── */

router.post('/analyze-top', async (req, res) => {
  // Stub: requires LLM exploration. Returns empty for now.
  res.json({ features: [] });
});

/* ── POST analyze-all ── */

router.post('/analyze-all', async (req, res) => {
  // Stub: requires LLM. Returns empty for now.
  res.json({ features: [] });
});

/* ── GET analyze-all/stream ── */

router.get('/analyze-all/stream', async (req, res) => {
  // Stub: requires LLM. Returns empty for now.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.write('event: connected\ndata: {}\n\n');
  res.write('event: done\ndata: {"features":[],"message":"Not yet migrated"}\n\n');
  res.end();
});

/* ── POST incremental-refresh ── */

router.post('/incremental-refresh', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.write('event: connected\ndata: {}\n\n');
  res.write('event: done\ndata: {"features":[],"message":"Not yet migrated"}\n\n');
  res.end();
});

/* ── GET search ── */

router.get('/search', (req, res) => {
  // Stub: search not yet migrated
  res.json({ features: [], symbols: [] });
});

/* ── POST overview ── */

router.post('/overview', async (req, res) => {
  // Stub: requires LLM
  const { project_path, node_id } = req.body;
  if (node_id && project_path) {
    try {
      const node = findFeature(project_path, node_id);
      if (node) {
        updateFeatureOverview(project_path, node_id, node.flow_description as string || '', '[]');
      }
    } catch { /* ignore */ }
  }
  res.json({ overview: '', issues: [] });
});

/* ── POST incremental-update ── */

router.post('/incremental-update', (req, res) => {
  res.json({ status: 'queued' });
});

export default router;
