import { Router } from 'express';
import { agentService } from '../services/agent';

const router = Router();

/* ── Non-streaming chat ── */

router.post('/chat', async (req, res) => {
  try {
    const result = await agentService.process(req.body);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ message: e.message, operations: [] });
  }
});

/* ── Streaming chat (SSE) ── */

router.post('/chat/stream', async (req, res) => {
  console.log(`[route /chat/stream] mode=${req.body?.mode} project_path=${(req.body?.project_path || '').slice(-30)}`);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    for await (const ev of agentService.processStream(req.body)) {
      if (res.destroyed) break;
      res.write(`event: ${ev.event}\ndata: ${ev.data}\n\n`);
    }
  } catch (e: any) {
    if (!res.destroyed) {
      res.write(`event: done\ndata: ${JSON.stringify({ message: e.message, operations: [] })}\n\n`);
    }
  }
  if (!res.destroyed) res.end();
});

/* ── Intent classification ── */

router.post('/classify-intent', async (req, res) => {
  try {
    const intent = await agentService.classifyIntent(req.body.instruction || '');
    res.json({ intent });
  } catch {
    res.json({ intent: 'readonly' });
  }
});

/* ── Planner stream ── */

router.post('/plan/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    for await (const ev of agentService.planStream(
      req.body.instruction || '',
      req.body.project_path || '',
    )) {
      if (res.destroyed) break;
      res.write(`event: ${ev.event}\ndata: ${ev.data}\n\n`);
    }
  } catch {
    if (!res.destroyed) {
      res.write(`event: plan_error\ndata: ${JSON.stringify({ error: 'failed' })}\n\n`);
    }
  }
  if (!res.destroyed) res.end();
});

/* ── Sub-agent stream ── */

router.post('/step/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    for await (const ev of agentService.runSubAgent(
      req.body.task || '',
      req.body.step_id || 0,
    )) {
      if (res.destroyed) break;
      res.write(`event: ${ev.event}\ndata: ${ev.data}\n\n`);
    }
  } catch {
    if (!res.destroyed) {
      res.write(`event: step_error\ndata: ${JSON.stringify({ error: 'failed' })}\n\n`);
    }
  }
  if (!res.destroyed) res.end();
});

export default router;
