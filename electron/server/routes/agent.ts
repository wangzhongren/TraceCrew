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
      res.write(JSON.stringify(ev) + '\n');
    }
  } catch (e: any) {
    if (!res.destroyed) {
      res.write(JSON.stringify({ event: 'done', data: { message: e.message, operations: [] } }) + '\n');
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

router.post('/name-plan', async (req, res) => {
  try {
    const name = await agentService.generatePlanName(req.body.summary || '');
    res.json({ name });
  } catch (e: any) {
    res.json({ name: (req.body.summary || 'plan').slice(0, 40).replace(/\s+/g, '-') });
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
      res.write(JSON.stringify(ev) + '\n');
    }
  } catch {
    if (!res.destroyed) {
      res.write(JSON.stringify({ event: 'plan_error', data: { error: 'failed' } }) + '\n');
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
      res.write(JSON.stringify(ev) + '\n');
    }
  } catch {
    if (!res.destroyed) {
      res.write(JSON.stringify({ event: 'step_error', data: { error: 'failed' } }) + '\n');
    }
  }
  if (!res.destroyed) res.end();
});

/* ── Action stream ── */

router.post('/action/stream', async (req, res) => {
  const { action, node, instruction, project_path, downstream_nodes, locale, plan_context } = req.body || {};
  console.log(`[route /action/stream] action=${action} node=${node?.label} project=${(project_path || '').slice(-30)} locale=${locale} has_plan=${!!plan_context}`);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    for await (const ev of agentService.runActionStream({
      action: action || 'explain',
      node: node || {},
      instruction: instruction || '',
      project_path: project_path || '',
      downstream_nodes: downstream_nodes || [],
      locale: locale || 'zh-CN',
      plan_context: plan_context || null,
    })) {
      if (res.destroyed) break;
      res.write(JSON.stringify(ev) + '\n');
    }
  } catch (e: any) {
    if (!res.destroyed) {
      res.write(JSON.stringify({ event: 'done', data: { success: false, message: e.message, review_passed: null } }) + '\n');
    }
  }
  if (!res.destroyed) res.end();
});

export default router;
