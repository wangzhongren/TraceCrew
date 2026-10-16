import { Router } from 'express';
import { agentService } from '../services/agent';

const router = Router();

/* ── Request param validation (thinking ② / images ①) ── */

const THINKING_TYPES = ['adaptive', 'enabled', 'disabled'] as const;
type ThinkingType = (typeof THINKING_TYPES)[number];

/** 参数的粗略形态描述（仅用于 400 文案；禁三元） */
function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array(${value.length})`;
  return typeof value;
}

type ParamCheck<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * 严格校验思考强度参数（设计 §2.3）：仅接受 { type: 'adaptive' | 'enabled' | 'disabled' }。
 * 未携带（undefined）→ 通过且不向代理传该参数；形状不符/枚举外取值 → 本层 400，不透传。
 */
function validateThinking(raw: unknown): ParamCheck<ThinkingType | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, message: `thinking 参数形状非法：应为对象 { type: 'adaptive' | 'enabled' | 'disabled' }，实际收到 ${describeValue(raw)}` };
  }
  const keys = Object.keys(raw);
  if (keys.length !== 1 || keys[0] !== 'type') {
    return { ok: false, message: `thinking 参数形状非法：仅允许 { type } 单键，实际键 [${keys.join(', ')}]` };
  }
  const type = (raw as Record<string, unknown>).type;
  if (typeof type !== 'string') {
    return { ok: false, message: `thinking.type 非法：应为字符串（expected one of ${THINKING_TYPES.join(', ')}），实际收到 ${describeValue(type)}` };
  }
  if (!(THINKING_TYPES as readonly string[]).includes(type)) {
    return { ok: false, message: `thinking.type 非法：expected one of ${THINKING_TYPES.join(', ')}，实际收到 "${type}"` };
  }
  return { ok: true, value: type as ThinkingType };
}

const IMAGE_DATA_URL_PREFIX_RE = /^data:image\/(png|jpeg|webp|gif);base64,/;
const MAX_IMAGES_PER_MESSAGE = 3;
const MAX_IMAGE_BYTES_PER_ITEM = 750 * 1024; // 单项字节估算上限（客户端按单图 ≤500KB 压缩，此处留余量）

/**
 * 严格校验图片参数（设计 §1.2）：仅接受字符串数组、长度 ≤3、每项为受支持前缀的
 * data URL、单项 base64 载荷字节估算 ≤750KB；非法 → 本层 400，不透传。
 */
function validateImages(raw: unknown): ParamCheck<string[] | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  if (!Array.isArray(raw)) {
    return { ok: false, message: `images 参数形状非法：应为 data URL 字符串数组，实际收到 ${describeValue(raw)}` };
  }
  if (raw.length > MAX_IMAGES_PER_MESSAGE) {
    return { ok: false, message: `images 数量超限：最多 ${MAX_IMAGES_PER_MESSAGE} 张，实际 ${raw.length} 张` };
  }
  const items: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item: unknown = raw[i];
    if (typeof item !== 'string') {
      return { ok: false, message: `images[${i}] 非法：应为字符串，实际收到 ${describeValue(item)}` };
    }
    if (!IMAGE_DATA_URL_PREFIX_RE.test(item)) {
      return { ok: false, message: `images[${i}] 非法：仅支持 data:image/(png|jpeg|webp|gif);base64, 前缀的 data URL` };
    }
    const comma = item.indexOf(',');
    const estimatedBytes = Math.floor((item.length - comma - 1) * 3 / 4);
    if (estimatedBytes > MAX_IMAGE_BYTES_PER_ITEM) {
      return { ok: false, message: `images[${i}] 过大：估算 ${Math.round(estimatedBytes / 1024)}KB，单项上限 ${MAX_IMAGE_BYTES_PER_ITEM / 1024}KB` };
    }
    items.push(item);
  }
  return { ok: true, value: items };
}

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
  console.log(`[route /chat/stream] mode=${req.body?.mode} max_turns=${req.body?.max_turns ?? '(default)'} project_path=${(req.body?.project_path || '').slice(-30)}`);
  // ② 思考强度与 ① 图片：本层严格校验（SSE 头尚未发送，可干净地 400），合法值才进入 processStream
  const thinkingCheck = validateThinking(req.body?.thinking);
  if (!thinkingCheck.ok) {
    console.log(`[route /chat/stream] 400 thinking 参数非法：${thinkingCheck.message}`);
    res.status(400).json({ message: thinkingCheck.message });
    return;
  }
  const imagesCheck = validateImages(req.body?.images);
  if (!imagesCheck.ok) {
    console.log(`[route /chat/stream] 400 images 参数非法：${imagesCheck.message}`);
    res.status(400).json({ message: imagesCheck.message });
    return;
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    for await (const ev of agentService.processStream({ ...req.body, thinking: thinkingCheck.value, images: imagesCheck.value })) {
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
