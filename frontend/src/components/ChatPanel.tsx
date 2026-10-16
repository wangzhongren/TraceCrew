import { useState, useRef, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { marked } from 'marked';
import type { PipelineState } from '../App';
import PlanCard from './PlanCard';
import ReviewCard from './ReviewCard';
import { cleanProtocolTags } from './ActionDialog';
import type { CallGraph } from '../types/graph';
import { useT, useLocale } from '../i18n';

/* ── Types ── */

type TimelineEntry =
  | { kind: 'agent'; agent: string; text: string; reasoning?: string; result?: any; autoCollapse?: boolean; status?: 'done'; tools?: Array<{ type: string; file: string }> }
  | { kind: 'tool'; agent: string; tool: string; file: string }
  | { kind: 'user'; text: string; images?: string[] }
  | { kind: 'system'; text: string };

/* ── 思考强度三档（②，design_chat-input-images-thinking §2） ── */

type ThinkingTier = 'low' | 'mid' | 'high';

/** 档位 → 代理 thinking.type 映射（同模型三态、不换模型；常量对象，禁三元） */
const THINKING_PARAM: Record<ThinkingTier, { type: 'disabled' | 'adaptive' | 'enabled' }> = {
  low: { type: 'disabled' },
  mid: { type: 'adaptive' },
  high: { type: 'enabled' },
};

/** 客户指定默认=中（adaptive）；调整改此处 */
const DEFAULT_THINKING_TIER: ThinkingTier = 'mid';

/** 会话记忆键：读取时校验枚举，非法值/不可用回落默认档 */
const THINKING_TIER_STORAGE_KEY = 'tracecrew.thinkingTier';

const THINKING_TIERS: ThinkingTier[] = ['low', 'mid', 'high'];

const THINKING_TIER_LABEL_KEY: Record<ThinkingTier, string> = {
  low: 'chat.thinkingLow',
  mid: 'chat.thinkingMid',
  high: 'chat.thinkingHigh',
};

const THINKING_TIER_HINT_KEY: Record<ThinkingTier, string> = {
  low: 'chat.thinkingLowHint',
  mid: 'chat.thinkingMidHint',
  high: 'chat.thinkingHighHint',
};

function readStoredThinkingTier(): ThinkingTier {
  try {
    const raw = localStorage.getItem(THINKING_TIER_STORAGE_KEY);
    if (raw === 'low' || raw === 'mid' || raw === 'high') return raw;
  } catch (err) {
    // 预期可忽略：localStorage 不可用（隐私模式/嵌入环境等）不影响会话，回落默认档
    console.warn('[ChatPanel] 读取思考强度记忆失败：', err);
  }
  return DEFAULT_THINKING_TIER;
}

/* ── 图片发送（①，design_chat-input-images-thinking §1） ── */

type Attachment = { id: string; dataUrl: string; bytes: number };

const MAX_IMAGE_EDGE = 1400;                       // 最长边（等比缩放上限，保持截图文字可读）
const MAX_IMAGE_BYTES_PER_ITEM = 500 * 1024;       // 单图编码后上限（超标二次降质，仍超则拒绝）
const MAX_IMAGES_PER_MESSAGE = 3;                  // 每消息张数上限
const MAX_IMAGE_BYTES_TOTAL = 1.2 * 1024 * 1024;   // 消息总量（编码后）上限
const JPEG_QUALITY_PRIMARY = 0.85;
const JPEG_QUALITY_SECONDARY = 0.7;

/** data URL 的 base64 载荷字节估算（4 字符 ≈ 3 字节） */
function estimateDataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return 0;
  return Math.floor((dataUrl.length - comma - 1) * 3 / 4);
}

type CompressResult = { ok: true; dataUrl: string; bytes: number } | { ok: false; reason: 'too-large' | 'decode-failed' };

/**
 * 浏览器端压缩（纯渲染层，无新 IPC）：createImageBitmap → 最长边 ≤1400 等比缩放 →
 * 白底 JPEG q0.85；编码后 >500KB 二次降质 q0.7；仍超 → 拒绝（too-large）。
 */
async function compressImageFile(file: File): Promise<CompressResult> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (err) {
    console.warn('[ChatPanel] 图片解码失败：', err);
    return { ok: false, reason: 'decode-failed' };
  }
  try {
    let width = bitmap.width;
    let height = bitmap.height;
    const maxEdge = Math.max(width, height);
    if (maxEdge > MAX_IMAGE_EDGE) {
      const ratio = MAX_IMAGE_EDGE / maxEdge;
      width = Math.max(1, Math.round(width * ratio));
      height = Math.max(1, Math.round(height * ratio));
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error('[ChatPanel] 图片压缩失败：canvas 2d 上下文不可用');
      return { ok: false, reason: 'decode-failed' };
    }
    // 白底铺底：避免透明 PNG 转 JPEG 后透明区变黑
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);

    let dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY_PRIMARY);
    let bytes = estimateDataUrlBytes(dataUrl);
    if (bytes > MAX_IMAGE_BYTES_PER_ITEM) {
      dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY_SECONDARY);
      bytes = estimateDataUrlBytes(dataUrl);
    }
    if (bytes > MAX_IMAGE_BYTES_PER_ITEM) {
      console.log(`[ChatPanel] 图片二次降质后仍超限（${Math.round(bytes / 1024)}KB > ${MAX_IMAGE_BYTES_PER_ITEM / 1024}KB），拒绝`);
      return { ok: false, reason: 'too-large' };
    }
    return { ok: true, dataUrl, bytes };
  } finally {
    bitmap.close();
  }
}

/* ── Agent config ── */

const AG: Record<string, { name: string; color: string }> = {
  pm:        { name: 'PM',        color: '#2f7d5f' },
  planner:   { name: 'Planner',   color: '#35608f' },
  architect: { name: 'Architect', color: '#6b5b95' },
  reviewer:  { name: 'Reviewer',  color: '#b4452e' },
  mapper:    { name: 'Mapper',    color: '#3c7d8f' },
};

const TOOL_LABEL: Record<string, string> = {
  read_file: 'Read', list_dir: 'List', search: 'Search',
  insert_lines: 'Insert', replace_lines: 'Replace', delete_lines: 'Delete',
  create_file: 'Create', run_shell: 'Run',
};

const TOOL_COLOR: Record<string, { bg: string; c: string }> = {
  read_file:    { bg: 'rgba(53,96,143,.09)',  c: '#35608f' },
  list_dir:     { bg: 'rgba(53,96,143,.09)',  c: '#35608f' },
  search:       { bg: 'rgba(53,96,143,.09)',  c: '#35608f' },
  insert_lines: { bg: 'rgba(47,125,95,.09)',  c: '#2f7d5f' },
  replace_lines:{ bg: 'rgba(47,125,95,.09)',  c: '#2f7d5f' },
  create_file:  { bg: 'rgba(47,125,95,.09)',  c: '#2f7d5f' },
  delete_lines: { bg: 'rgba(194,69,46,.08)',  c: '#c2452e' },
  run_shell:    { bg: 'rgba(169,123,42,.10)', c: '#a97b2a' },
};

/* ── Pure helpers (exported for unit tests) ── */

/**
 * 拼装 agentLoop 发送给 Agent 的 user 消息 content。
 * ctx 与 systemPrompt 以空行分隔；有项目文件树时追加【项目文件树】小节
 * （JSON 缩进 2、截断 2000 字符）。只接收已获取的数据——
 * `window.tracecrew.file.listDirectory` 的 IPC 调用留在调用点。
 */
export function buildAgentUserContent(ctx: string, systemPrompt: string, fileTree: unknown): string {
  if (fileTree) {
    return `${ctx}\n\n${systemPrompt}\n\n【项目文件树】\n${JSON.stringify(fileTree, null, 2).slice(0, 2000)}`;
  }
  return `${ctx}\n\n${systemPrompt}`;
}

/* ══════════════════════════════════════════════ */

export default function ChatPanel({ projectPath, onPipelineChange, savedPlan, savedGraph }: {
  projectPath: string | null;
  onPipelineChange: (s: Partial<PipelineState>) => void;
  savedPlan?: { plan_summary: string; raw?: string; steps?: any[]; key_files?: string[] } | null;
  savedGraph?: { nodes: any[]; edges: any[] } | null;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);

  // Inject restored plan + graph as initial chat message AND agent history
  useEffect(() => {
    if ((savedPlan || savedGraph) && timeline.length === 0) {
      const parts: string[] = [];
      if (savedPlan?.plan_summary) {
        parts.push(`## 上次计划\n${savedPlan.plan_summary}`);
      }
      if (savedPlan?.steps?.length) {
        parts.push(`### 步骤\n${savedPlan.steps.map((s: any, i: number) => `${i + 1}. ${s.description || s.title || ''}`).join('\n')}`);
      }
      if (savedGraph?.nodes?.length) {
        const done = savedGraph.nodes.filter((n: any) => n.status === 'done' || n.status === 'existing').length;
        const total = savedGraph.nodes.filter((n: any) => n.status !== 'existing').length;
        parts.push(`### 任务进度\n已完成 ${done}/${total} 个任务`);
        const pending = savedGraph.nodes.filter((n: any) => n.status !== 'done' && n.status !== 'existing');
        if (pending.length > 0) {
          parts.push(`**待完成**: ${pending.map((n: any) => n.label).join('、')}`);
        }
      }
      const summary = parts.join('\n\n');
      setTimeline([{ kind: 'agent', agent: 'planner', text: summary, result: { type: 'plan', plan: savedPlan || {} } }]);

      // Inject into agent history — preserve full context for subsequent conversations
      const requirement = savedPlan?.raw?.match(/## 需求\n([\s\S]*?)\n## /)?.[1]?.trim()
        || savedPlan?.plan_summary
        || '';
      const historyCtx: string[] = [
        savedPlan?.plan_summary ? `[计划] ${savedPlan.plan_summary}` : '',
        savedPlan?.steps?.length ? `[步骤]\n${savedPlan.steps.map((s: any, i: number) => `${i + 1}. ${s.description || s.title || JSON.stringify(s)}`).join('\n')}` : '',
        savedPlan?.key_files?.length ? `[关键文件] ${savedPlan.key_files.join(', ')}` : '',
        savedGraph?.nodes?.length ? `[任务节点]\n${savedGraph.nodes.map((n: any) => `- ${n.status === 'done' || n.status === 'existing' ? '✓' : '○'} ${n.label} [${n.kind}]${n.file ? ` @${n.file}${n.line ? `:L${n.line}` : ''}` : ''}${n.detail ? ` — ${n.detail}` : ''}`).join('\n')}` : '',
        savedGraph?.edges?.length ? `[依赖关系] ${savedGraph.edges.map((e: any) => `${e.from}→${e.to}[${e.status}]`).join(', ')}` : '',
      ];
      savedContextRef.current = [
        { role: 'user', content: requirement },
        { role: 'assistant', content: historyCtx.filter(Boolean).join('\n\n') },
      ];
      historyRef.current = [...savedContextRef.current];
    }
  }, [savedPlan, savedGraph]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [thinkingTier, setThinkingTier] = useState<ThinkingTier>(() => readStoredThinkingTier());
  const thinkingTierRef = useRef<ThinkingTier>(thinkingTier);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const attachmentsRef = useRef<Attachment[]>([]);
  const [attachNotice, setAttachNotice] = useState('');
  const [compressingCount, setCompressingCount] = useState(0);
  const pendingImagesRef = useRef<Attachment[] | null>(null);   // 待随本轮请求发送的图片（发送时置入、请求组装时消费清空）
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pmState, setPmState] = useState<{ active: boolean; originalInstruction: string }>({ active: false, originalInstruction: '' });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const historyRef = useRef<Array<{ role: string; content: string }>>([]);        // Planner / Reviewer / Mapper context
  const pmHistoryRef = useRef<Array<{ role: string; content: string }>>([]);       // PM-only conversation (isolated)
  const savedContextRef = useRef<Array<{ role: string; content: string }>>([]);    // saved project context (never pruned)
  const architectureRef = useRef<any>(null);                                        // latest architecture for Mapper
  const plannerUsedTools = useRef(false);
  const tidxRef = useRef(-1);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [timeline]);

  // Auto-resize textarea height — driven by React state, not raw DOM mutation
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const newH = Math.min(el.scrollHeight, 120);
    el.style.height = newH + 'px';
  }, [input]);

  /* ── Helpers ── */

  /* 附件状态与 ref 同步：事件回调（粘贴/拖拽/异步压缩）需要即时读到最新列表，避免闭包过期 */
  const updateAttachments = (next: Attachment[]): void => {
    attachmentsRef.current = next;
    setAttachments(next);
  };

  const removeAttachment = (id: string): void => {
    updateAttachments(attachmentsRef.current.filter(a => a.id !== id));
  };

  /* ① 三入口共用（粘贴/文件选择/拖拽）：压缩后加入待发区；数量/总量超限给出行内提示 */
  const addImageFiles = async (files: File[]): Promise<void> => {
    const images = files.filter(f => f.type.startsWith('image/'));
    if (images.length === 0) return;
    setAttachNotice('');

    const slots = MAX_IMAGES_PER_MESSAGE - attachmentsRef.current.length;
    if (slots <= 0) {
      setAttachNotice(t('chat.imageLimitReached', { count: MAX_IMAGES_PER_MESSAGE }));
      return;
    }
    if (images.length > slots) {
      setAttachNotice(t('chat.imageLimitReached', { count: MAX_IMAGES_PER_MESSAGE }));
    }
    const accepted = images.slice(0, slots);
    setCompressingCount(n => n + accepted.length);
    try {
      for (const file of accepted) {
        const result = await compressImageFile(file);
        if (!result.ok) {
          if (result.reason === 'too-large') setAttachNotice(t('chat.imageTooLarge'));
          else setAttachNotice(t('chat.imageFailed'));
          continue;
        }
        const current = attachmentsRef.current;
        if (current.length >= MAX_IMAGES_PER_MESSAGE) {
          setAttachNotice(t('chat.imageLimitReached', { count: MAX_IMAGES_PER_MESSAGE }));
          break;
        }
        const totalBytes = current.reduce((sum, a) => sum + a.bytes, 0) + result.bytes;
        if (totalBytes > MAX_IMAGE_BYTES_TOTAL) {
          // 总量超限按体积问题提示（与单图超限共用文案）
          setAttachNotice(t('chat.imageTooLarge'));
          continue;
        }
        updateAttachments([...current, {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          dataUrl: result.dataUrl,
          bytes: result.bytes,
        }]);
      }
    } finally {
      setCompressingCount(n => Math.max(0, n - accepted.length));
    }
  };

  /* 切换思考档（②）：ref 供请求体组装即时读取；localStorage 记忆，写入失败不影响当前会话 */
  const changeThinkingTier = (tier: ThinkingTier): void => {
    thinkingTierRef.current = tier;
    setThinkingTier(tier);
    try {
      localStorage.setItem(THINKING_TIER_STORAGE_KEY, tier);
    } catch (err) {
      // 预期可忽略：记忆写入失败仅丢失跨会话持久化，当前会话仍按所选档位生效
      console.warn('[ChatPanel] 写入思考强度记忆失败：', err);
    }
  };

  const parseJson = (text: string): any => {
    if (!text) return null;
    const m = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    // 预期可忽略：代码块内容不保证是合法 JSON，失败则继续后续解析尝试
    if (m) { try { return JSON.parse(m[1]); } catch {} }
    for (const key of ['"architecture"', '"call_graph"', '"plan_summary"', '"passed"']) {
      const idx = text.indexOf(key);
      if (idx !== -1) {
        const start = text.lastIndexOf('{', idx);
        if (start !== -1) {
          let depth = 0, end = -1;
          for (let i = start; i < text.length; i++) {
            if (text[i] === '{') depth++;
            else if (text[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
          }
          // 预期可忽略：提取的片段可能仍非合法 JSON，失败则继续扫描其他候选键
          if (end !== -1) { try { return JSON.parse(text.slice(start, end)); } catch {} }
        }
      }
    }
    const greedy = text.match(/\{[\s\S]*\}/);
    // 预期可忽略：贪婪匹配片段可能非合法 JSON，失败则返回 null 交由调用方兜底
    if (greedy) { try { return JSON.parse(greedy[0]); } catch {} }
    return null;
  };

  /* PM 派发咨询的任务摘要：从 PM 回复原文去掉协议标签后截取前 400 字（原文仍用于 handoff 判定） */
  const briefFrom = (fullText: string): string => cleanProtocolTags(fullText).slice(0, 400);

  /*
   * F3 完成期归零：done.message 非空时，用它（经共享工具清洗兜底）替换当前
   * agent 卡片的流式累积展示文本。fullText 原文不受影响——parseJson 与 PM
   * handoff 判定仍读原文。done.message 清洗后为空时保留累积文本（不空白卡片）。
   */
  const applyDoneMessage = (doneMessage: string): void => {
    if (!doneMessage.trim()) return;
    const cleaned = cleanProtocolTags(doneMessage);
    if (!cleaned) return;
    setTimeline(prev => {
      const next = [...prev];
      const idx = tidxRef.current;
      if (idx < 0) return next;
      const entry = next[idx];
      if (entry?.kind === 'agent') next[idx] = { ...entry, text: cleaned };
      return next;
    });
  };

  /* 完成态标记：流收尾后文本卡进入「✓ 完成 · N 字」终态（完成徽章、停止旋转）。 */
  const markCurrentAgentDone = (): void => {
    setTimeline(prev => {
      const u = [...prev];
      const idx = tidxRef.current;
      if (idx >= 0 && u[idx]?.kind === 'agent') u[idx] = { ...u[idx], status: 'done' };
      return u;
    });
  };

  /* ── SSE stream ── */

  const streamSSE = async (body: Record<string, any>, onToken: (t: string) => void, onReasoning?: (t: string) => void, onTools?: (ops: any[]) => void) => {
    // ① 图片：仅本轮携带（消费即清空，历史重发不重发图片——v1 取舍）；
    // ② 思考强度：所有经本面板的请求（pm/agentLoop/咨询链）一律携带当前档位。
    const carriedAttachments = pendingImagesRef.current;
    pendingImagesRef.current = null;
    // ② 线格式为 { type } 对象（设计 §2.3，与 routes 严格校验一致）；服务端校验后再透传代理
    const requestBody: Record<string, any> = { ...body, project_path: projectPath, locale, thinking: THINKING_PARAM[thinkingTierRef.current] };
    if (carriedAttachments && carriedAttachments.length > 0) {
      requestBody.images = carriedAttachments.map(a => a.dataUrl);
    }

    let res: Response;
    try {
      res = await fetch('/api/v1/agent/chat/stream', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: abortRef.current?.signal,
      });
    } catch (err) {
      // 预期可忽略：网络/中止异常维持既有向上传播语义；带图本轮额外恢复附件并如实提示（用户主动停止不算失败）
      console.error('[streamSSE] 请求发送异常：', err);
      const aborted = err instanceof DOMException && err.name === 'AbortError';
      if (!aborted && carriedAttachments) {
        updateAttachments([...carriedAttachments, ...attachmentsRef.current].slice(0, MAX_IMAGES_PER_MESSAGE));
        setAttachNotice(t('chat.imageFailed'));
      }
      throw err;
    }
    if (!res.ok) {
      const errText = await res.text();
      console.error(`[streamSSE] HTTP ${res.status} 请求被拒：`, errText);
      if (carriedAttachments) {
        // 失败态（设计 §1.1）：本轮带图 → 恢复附件 + 行内提示（可移除重发）；本轮以空结果收束
        updateAttachments([...carriedAttachments, ...attachmentsRef.current].slice(0, MAX_IMAGES_PER_MESSAGE));
        setAttachNotice(t('chat.imageFailed'));
        return { fullText: '', doneMessage: '' };
      }
    }
    const reader = res.body?.getReader();
    if (!reader) return { fullText: '', doneMessage: '' };
    const dec = new TextDecoder();
    let buf = '', full = '', doneMessage = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n');
      buf = parts.pop() || '';
      for (const line of parts) {
        if (!line.trim()) continue;
        const { event, data } = JSON.parse(line);
        if (event === 'token') { full += data; onToken(data); }
        else if (event === 'reasoning') { onReasoning?.(data); }
        else if (event === 'tools') {
          const ops = typeof data === 'string' ? JSON.parse(data).ops : data.ops;
          onTools?.(ops || []);
        }
        else if (event === 'done') {
          // 服务端 done 负载可能是 JSON 字符串（agent.ts yield）或对象（路由兜底）
          let payload: any = data;
          if (typeof data === 'string') {
            try { payload = JSON.parse(data); }
            catch (err) { console.error('[streamSSE] done 事件负载 JSON 解析失败：', err); payload = null; }
          }
          if (payload && typeof payload.message === 'string') doneMessage = payload.message;
        }
      }
    }
    return { fullText: full, doneMessage };
  };

  /* ── Agent loop ── */

  const agentLoop = async (agent: string, systemPrompt: string, ctx: string, history?: Array<{ role: string; content: string }>, maxTurns?: number) => {
    const messages = [...(history || [])];
    let fileTree: any = null;
    // 预期可忽略：文件树仅用于增强 prompt，获取失败仍可继续对话（不附带文件树）
    try { fileTree = await window.tracecrew.file.listDirectory(projectPath!); } catch {}
    messages.push({ role: 'user', content: buildAgentUserContent(ctx, systemPrompt, fileTree) });

    let fullText = '';
    setTimeline(prev => { tidxRef.current = prev.length; return [...prev, { kind: 'agent', agent, text: '', reasoning: '', result: null }]; });

    const body: Record<string, any> = { history: messages, mode: agent };
    // 可选探索轮次预算（design_turn-limit-wrapup 3.5）：仅咨询重试传入；不传则服务端默认 50
    if (maxTurns !== undefined) body.max_turns = maxTurns;
    const { doneMessage } = await streamSSE(body,
      (t) => {
        fullText += t;
        setTimeline(prev => {
          const u = [...prev];
          const idx = tidxRef.current;
          if (idx < 0) return u;
          const entry = u[idx];
          if (entry?.kind === 'agent') u[idx] = { ...entry, text: entry.text + t };
          return u;
        });
      },
      (t) => {
        setTimeline(prev => {
          const u = [...prev];
          const idx = tidxRef.current;
          if (idx < 0) return u;
          const entry = u[idx];
          if (entry?.kind === 'agent') u[idx] = { ...entry, reasoning: (entry.reasoning || '') + t };
          return u;
        });
      },
      (ops) => {
        if (agent === 'planner') plannerUsedTools.current = true;
        console.log(`[onTools] agent=${agent} ops=`, ops.map((o: any) => `${o.type}:${o.file}`));

        // All tool types → attach to current agent entry for in-card display
        if (ops.length > 0) {
          setTimeline(prev => {
            const u = [...prev];
            const idx = tidxRef.current;
            if (idx >= 0 && u[idx]?.kind === 'agent') {
              u[idx] = {
                ...u[idx],
                tools: [...(u[idx].tools || []), ...ops.map((op: any) => ({
                  type: op.type,
                  file: op.file || ''
                }))]
              };
            }
            return u;
          });
        }
      }
    );
    applyDoneMessage(doneMessage);
    markCurrentAgentDone();
    return { fullText };
  };

  /* ════ Pipeline ════ */

  /* ── PM stream helper ── */

  const pmStream = async (messages: Array<{ role: string; content: string }>): Promise<string> => {
    setTimeline(prev => { tidxRef.current = prev.length; return [...prev, { kind: 'agent', agent: 'pm', text: '', reasoning: '', result: null }]; });
    const { fullText, doneMessage } = await streamSSE(
      { history: messages, mode: 'pm' },
      (t) => {
        setTimeline(prev => {
          const u = [...prev], idx = tidxRef.current;
          if (idx >= 0 && u[idx]?.kind === 'agent') u[idx] = { ...u[idx], text: u[idx].text + t };
          return u;
        });
      },
      (t) => {
        setTimeline(prev => {
          const u = [...prev], idx = tidxRef.current;
          if (idx >= 0 && u[idx]?.kind === 'agent') u[idx] = { ...u[idx], reasoning: (u[idx].reasoning || '') + t };
          return u;
        });
      }
    );
    applyDoneMessage(doneMessage);
    markCurrentAgentDone();
    return fullText;
  };

  /* ── PM: first contact ── */

  const runProjectManager = async (instruction: string) => {
    if (!projectPath) return;
    setRunning(true);
    abortRef.current = new AbortController();

    onPipelineChange({ phase: 'clarifying' });

    // PM uses its own isolated history — never polluted by Planner/Reviewer/Mapper context.
    // Each new task starts with a clean PM conversation.
    pmHistoryRef.current = [{ role: 'user', content: instruction }];
    const fullText = await pmStream([...pmHistoryRef.current]);

    // Check if PM is handing off to Planner
    if (/<handoff-to-planner\/>/i.test(fullText)) {
      const reqMatch = fullText.match(/<confirmed-requirement>([\s\S]*?)<\/confirmed-requirement>/i);
      const confirmedReq = reqMatch ? reqMatch[1].trim() : instruction;
      // Bridge: start a clean pipeline cycle — PM summary only.
      // Planner/Architect explore the project via tools, they don't need old history.
      historyRef.current = [{ role: 'assistant', content: `[PM] ${confirmedReq.slice(0, 200)}` }];
      setPmState({ active: false, originalInstruction: '' });
      setRunning(false);
      // Proceed to Architect → Planner pipeline
      setTimeout(() => runArchitect(confirmedReq), 100);
      return;
    } else if (/<handoff-to-architect\/>/i.test(fullText)) {
      // 只读设计咨询：派给 Architect，完成后回报 PM（不进 Planner/Reviewer/执行）
      pmHistoryRef.current.push({ role: 'assistant', content: fullText });
      runArchitectConsult(briefFrom(fullText), fullText, instruction);
      return;
    } else if (/<handoff-to-mapper\/>/i.test(fullText)) {
      // 只读画图咨询：派给 Mapper，完成后回报 PM（不并入流水线 history）
      pmHistoryRef.current.push({ role: 'assistant', content: fullText });
      runMapperConsult(briefFrom(fullText), fullText, instruction);
      return;
    }

    // PM is asking questions — record in PM history, wait for user reply
    pmHistoryRef.current.push({ role: 'assistant', content: fullText });
    setPmState({ active: true, originalInstruction: instruction });
    setRunning(false);
  };

  /* ── PM: follow-up reply ── */

  const runProjectManagerFollowUp = async (reply: string) => {
    if (!projectPath || !pmState.active) return;
    setRunning(true);
    abortRef.current = new AbortController();

    // PM conversation stays in its own isolated history
    pmHistoryRef.current.push({ role: 'user', content: reply });
    const fullText = await pmStream([...pmHistoryRef.current]);

    if (/<handoff-to-planner\/>/i.test(fullText)) {
      const reqMatch = fullText.match(/<confirmed-requirement>([\s\S]*?)<\/confirmed-requirement>/i);
      const confirmedReq = reqMatch ? reqMatch[1].trim() : pmState.originalInstruction;
      // Bridge: start a clean pipeline cycle — PM summary only.
      // Planner/Architect explore the project via tools, they don't need old history.
      historyRef.current = [{ role: 'assistant', content: `[PM] ${confirmedReq.slice(0, 200)}` }];
      setPmState({ active: false, originalInstruction: '' });
      setRunning(false);
      setTimeout(() => runArchitect(confirmedReq), 100);
      return;
    } else if (/<handoff-to-architect\/>/i.test(fullText)) {
      // 只读设计咨询：派给 Architect，完成后回报 PM（不进 Planner/Reviewer/执行）
      pmHistoryRef.current.push({ role: 'assistant', content: fullText });
      runArchitectConsult(briefFrom(fullText), fullText, pmState.originalInstruction);
      return;
    } else if (/<handoff-to-mapper\/>/i.test(fullText)) {
      // 只读画图咨询：派给 Mapper，完成后回报 PM（不并入流水线 history）
      pmHistoryRef.current.push({ role: 'assistant', content: fullText });
      runMapperConsult(briefFrom(fullText), fullText, pmState.originalInstruction);
      return;
    }

    // PM still clarifying — record in PM history only
    pmHistoryRef.current.push({ role: 'assistant', content: fullText });
    setRunning(false);
  };

  /* ── Architect: IoC framework design ── */

  const runArchitect = async (instruction: string) => {
    if (!projectPath) return;

    // Load saved architecture (.md format)
    let savedMd: string | null = null;
    let savedArchitecture: any = null;
    try {
      const fc = await window.tracecrew.file.readFile('.tracecrew/ARCHITECTURE.md');
      if (fc?.content) {
        savedMd = fc.content;
        // Try to extract architecture JSON from saved markdown
        savedArchitecture = parseJson(savedMd)?.architecture || null;
        console.log('[Architect] 已加载 ARCHITECTURE.md, parseJson→architecture:', !!savedArchitecture, '| md长度:', savedMd.length);
      }
    } catch { console.log('[Architect] 无 ARCHITECTURE.md'); }

    setRunning(true);
    abortRef.current = new AbortController();

    onPipelineChange({ phase: 'planning' });

    // Build context: if saved architecture exists, let LLM decide whether to skip
    let ctx = instruction;
    if (savedMd) {
      console.log('[Architect] 已有架构，发送给 LLM 判断是否跳过');
      setTimeline(prev => [...prev, { kind: 'system', text: '框架设计师正在判断是否需要修改架构...' }]);
      ctx = `【已有架构】\n${savedMd}\n\n【新需求】\n${instruction}\n\n请判断：已有架构是否可以直接支撑新需求？如果不需要修改，只输出 <skip-architect/> 即可停止。如果需要修改，请输出完整的架构设计（Markdown + JSON）。`;
    } else {
      console.log('[Architect] 新项目，开始设计架构');
      setTimeline(prev => [...prev, { kind: 'system', text: '框架设计师正在分析架构...' }]);
    }

    // Retry loop: Architect must output valid JSON
    let fullText = '';
    let data: any = null;
    const MAX_RETRIES = 2;
    let retryCtx = ctx;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      console.log(`[Architect] 第${attempt + 1}次调用 agentLoop, ctx长度:`, retryCtx.length);
      const result = await agentLoop('architect', '', '', [...historyRef.current, { role: 'user', content: retryCtx }]);
      fullText = result.fullText;
      console.log(`[Architect] fullText 长度: ${fullText.length}, 末尾200字:`, fullText.slice(-200));
      console.log(`[Architect] 含 <skip-architect/>:`, /<skip-architect\/>/i.test(fullText));
      console.log(`[Architect] 含 \`\`\`json:`, /```json/.test(fullText));
      console.log(`[Architect] 含 "architecture":`, /"architecture"/.test(fullText));

      // Check for skip signal
      if (/<skip-architect\/>/i.test(fullText) && savedArchitecture) {
        console.log('[Architect] → 跳过，复用已有架构');
        architectureRef.current = savedArchitecture;
        historyRef.current.push({ role: 'assistant', content: `[Architect] 架构无需修改，复用已有设计` });
        setTimeline(prev => [...prev, { kind: 'system', text: '架构无需修改，复用已有设计' }]);
        setRunning(false);
        setTimeout(() => runPlanner(instruction, savedArchitecture), 100);
        return;
      }

      data = parseJson(fullText);
      console.log('[Architect] parseJson 结果 keys:', data ? Object.keys(data).join(', ') : 'null');
      if (data?.architecture) {
        console.log('[Architect] → 解析成功, modules:', data.architecture.modules?.length, 'interfaces:', data.architecture.interfaces?.length);
        break;
      }

      console.log(`[Architect] → JSON解析失败，准备重试...`);
      // JSON parse failed — retry with format guidance
      retryCtx = `${ctx}\n\n上一次输出格式无法解析。请确保:\n1. 使用 \`\`\`json 代码块包含 architecture 对象\n2. architecture 必须包含 principle, modules, interfaces, dependency_rules, directory_skeleton\n\n请重新输出完整的架构设计。`;
      setTimeline(prev => [...prev, { kind: 'system', text: `架构 JSON 解析失败，正在重试 (${attempt + 1}/${MAX_RETRIES})...` }]);
    }

    const architecture = data?.architecture || null;

    if (architecture) {
      architectureRef.current = architecture;
      // 预期可忽略：ARCHITECTURE.md 为旁路持久化（尽力而为），写失败不影响流水线
      window.tracecrew.file.writeFile('.tracecrew/ARCHITECTURE.md', fullText).catch(() => {});

      historyRef.current.push({ role: 'assistant', content: `[Architect] ${architecture.principle || '架构设计完成'} — ${(architecture.modules || []).length} 个模块, ${(architecture.interfaces || []).length} 个接口` });
      setTimeline(prev => [...prev, { kind: 'system', text: `✓ 架构设计${savedMd ? '更新' : ''}完成: ${(architecture.modules || []).length} 个模块, ${(architecture.interfaces || []).length} 个接口` }]);
    } else {
      historyRef.current.push({ role: 'assistant', content: `[Architect] JSON 解析失败（已重试 ${MAX_RETRIES} 次）: ${fullText.slice(0, 200)}` });
      setTimeline(prev => [...prev, { kind: 'system', text: `架构 JSON 解析失败（已重试 ${MAX_RETRIES} 次），将直接进入 Planner` }]);
    }

    setRunning(false);
    setTimeout(() => runPlanner(instruction, architecture), 100);
  };

  /* ── Planner ── */

  const runPlanner = async (instruction: string, architecture?: any) => {
    if (!projectPath) return;
    setRunning(true);
    plannerUsedTools.current = false;
    abortRef.current = new AbortController();

    // Build Planner context: include full architecture JSON
    const archCtx = architecture
      ? `\n\n【架构设计 — 由框架设计师产出，你的计划必须遵守此架构中的接口契约和依赖规则】\n\`\`\`json\n${JSON.stringify({ architecture }, null, 2)}\n\`\`\`\n\n请基于以上架构设计，将需求拆分为具体实现步骤。每个步骤必须说明归属哪个模块、实现哪个接口。`
      : '';
    const hist = [...historyRef.current, { role: 'user', content: instruction + archCtx }];
    console.log('[Planner] 收到架构:', !!architecture, '| archCtx长度:', archCtx.length);

    onPipelineChange({ phase: 'planning' });
    const { fullText } = await agentLoop('planner', '', '', hist);
    const plan = parseJson(fullText);
    hist.push({ role: 'assistant', content: `[Plan] ${plan?.plan_summary || fullText}` });
    historyRef.current = hist;

    // Attach plan result to the agent block
    setTimeline(prev => {
      const u = [...prev];
      for (let i = u.length - 1; i >= 0; i--) {
        const e: any = u[i];
        if (e.kind === 'agent' && e.agent === 'planner') {
          u[i] = { ...e, result: { type: 'plan', plan: plan || { plan_summary: fullText.slice(0, 300) } } };
          return u;
        }
      }
      return u;
    });

    if (!plannerUsedTools.current && (fullText || '').length <= 100) {
      setTimeline(prev => [...prev, { kind: 'system', text: t('chat.plannerNoFiles') }]);
      onPipelineChange({ phase: 'done' });
      setRunning(false);
      return;
    }

    await runReviewPlan(instruction, fullText, plan);
  };

  const runReviewPlan = async (instruction: string, plannerText: string, plan: any) => {
    onPipelineChange({ phase: 'reviewing' });
    const { fullText } = await agentLoop('reviewer', '',
      `【需求】${instruction}\n【Planner输出】${plannerText}\n【关键文件】${(plan?.key_files || []).join(', ') || '无'}\n\n请验证 Planner 的分析是否基于实际代码，结论是否有证据支撑。`,
      [...historyRef.current]
    );

    const review = parseJson(fullText) || (() => {
      if (/"passed"\s*:\s*false/i.test(fullText)) return { passed: false, feedback: fullText, issues: [] };
      if (/"passed"\s*:\s*true/i.test(fullText)) return { passed: true, feedback: fullText, issues: [] };
      return { passed: /PASSED/i.test(fullText) && !/FAILED/i.test(fullText), feedback: fullText, issues: [] };
    })();

    // Attach review result
    setTimeline(prev => {
      const u = [...prev];
      for (let i = u.length - 1; i >= 0; i--) {
        const e: any = u[i];
        if (e.kind === 'agent' && e.agent === 'reviewer') {
          u[i] = { ...e, result: { type: 'review', passed: review.passed, feedback: review.feedback, issues: review.issues || [] } };
          return u;
        }
      }
      return u;
    });

    historyRef.current.push({ role: 'assistant', content: `[Reviewer] ${fullText}` });

    if (review.passed) {
      const saved = { plan_summary: plan?.plan_summary || '', steps: plan?.steps || [], key_files: plan?.key_files || [], raw: plannerText };
      onPipelineChange({ savedPlan: saved });

      if (projectPath) {
        const stepsMd = (saved.steps || []).map((s: any, i: number) => `${i + 1}. ${s.description || s.desc || JSON.stringify(s)}`).join('\n');
        // Save plan to .tracecrew/plans/ with versioning
        try {
          const date = new Date().toISOString().slice(0, 10);
          // Let AI generate a short filename
          let slug = 'plan';
          try {
            const res = await fetch('/api/v1/agent/name-plan', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ summary: saved.plan_summary }),
            });
            const data = await res.json();
            slug = data.name || slug;
          } catch { /* fallback to 'plan' */ }
          const planFile = `.tracecrew/plans/${date}-${slug}.md`;
          const planMd = [
            `# Planner Report — ${date}`,
            '',
            `## 需求`,
            instruction,
            '',
            `## 计划摘要`,
            saved.plan_summary,
            '',
            `## 步骤`,
            stepsMd || '(无)',
            '',
            `## 关键文件`,
            saved.key_files.join(', ') || '(无)',
            '',
            `## 原始分析`,
            plannerText,
          ].join('\n');
          await window.tracecrew.file.writeFile(planFile, planMd);
          // Update latest symlink
          await window.tracecrew.file.writeFile('.tracecrew/plans/latest.md', planMd);
          // Update README index
          const entry = `| ${date} | [${saved.plan_summary.slice(0, 60)}](${planFile}) | ${saved.steps?.length || 0} 步骤 |`;
          const readmeHeader = `# Plans\n\n| 日期 | 计划 | 步骤 |\n|------|------|------|`;
          let existing = '';
          // 预期可忽略：README.md 不存在按无历史处理，随后会创建新的索引文件
          try { const fc = await window.tracecrew.file.readFile('.tracecrew/plans/README.md'); if (fc?.content) existing = fc.content; } catch {}
          if (!existing) {
            await window.tracecrew.file.writeFile('.tracecrew/plans/README.md', `${readmeHeader}\n${entry}\n`);
          } else if (!existing.includes(planFile)) {
            const idx = existing.indexOf('\n', existing.indexOf('|---'));
            const before = existing.slice(0, idx + 1);
            const after = existing.slice(idx + 1);
            await window.tracecrew.file.writeFile('.tracecrew/plans/README.md', `${before}\n${entry}${after}`);
          }
        } catch {
          // 预期可忽略：plans 目录落盘为旁路持久化（尽力而为），失败不影响流水线继续
        }
      }

      await runMapper(instruction, plan, plannerText, architectureRef.current);
    } else {
      setTimeline(prev => [...prev, { kind: 'system', text: t('chat.reviewFailed') }]);
      onPipelineChange({ phase: 'rejected' });
      setRunning(false);
      setTimeout(() => runPlanner(instruction), 500);
    }
  };

  const runMapper = async (instruction: string, plan: any, plannerText?: string, architecture?: any) => {
    const archCtx = architecture
      ? `\n【架构设计】\n模块: ${(architecture.modules || []).map((m: any) => `${m.name}(${m.directory})`).join(', ')}\n目录骨架: ${(architecture.directory_skeleton || []).join(', ')}\n依赖规则: ${(architecture.dependency_rules || []).join('; ')}`
      : '';
    const planCtx = plan?.plan_summary
      ? `【计划】${plan.plan_summary}\n【关键文件】${(plan.key_files || []).join(', ')}\n【备注】${plan.notes || ''}${archCtx}`
      : `【Planner 分析】(未输出JSON,以下为原始分析)\n${(plannerText || '').slice(-2000)}${archCtx}`;

    const EDGE_STATUS_MAP: Record<string, 'existing' | 'new' | 'removed' | 'error'> = {
      existing: 'existing', new: 'new', removed: 'removed', error: 'error',
      planned_new: 'new', planned_change: 'existing',
    };
    let fullText = '';
    let data: any = null;
    let graph: CallGraph | null = null;
    const MAX_RETRIES = 2;
    let history = [...historyRef.current];

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const ctx = attempt === 0
        ? `【需求】${instruction}\n${planCtx}`
        : `【需求】${instruction}\n${planCtx}\n\n上一次你的输出格式不正确，无法解析为有效的 JSON。请确保：\n1. 输出包含 \`\`\`json 代码块，其中同时包含 "call_graph" 和 "sequence_graph"\n2. call_graph 和 sequence_graph 各自包含 nodes 和 edges 数组\n3. sequence_graph 的每个 node 必须有 lane 和 step 字段\n\n请重新生成。`;

      const result = await agentLoop('mapper', '', ctx, history);
      fullText = result.fullText;
      data = parseJson(fullText);

      if (data?.call_graph?.nodes?.length > 0) {
        const edges = (data.call_graph.edges || []).map((e: any) => ({ ...e, status: EDGE_STATUS_MAP[e.status] || 'new' }));
        graph = { nodes: data.call_graph.nodes, edges };
        history.push({ role: 'assistant', content: `[Mapper] ${graph.nodes?.length || 0} 个节点, ${graph.edges?.length || 0} 条边` });
        break;
      }

      // Parse failed — record the failed attempt and retry
      const errPreview = fullText.slice(0, 300).replace(/\n/g, ' ');
      history.push({ role: 'assistant', content: `[Mapper] JSON 解析失败 (第${attempt + 1}次): ${errPreview}` });
      history.push({ role: 'user', content: `你的输出无法解析为有效的 call_graph JSON。请严格按照格式重新输出。` });

      setTimeline(prev => [...prev, { kind: 'system', text: `Mapper 输出格式错误，正在重试 (${attempt + 1}/${MAX_RETRIES})...` }]);
    }

    setTimeline(prev => {
      const u = [...prev];
      for (let i = u.length - 1; i >= 0; i--) {
        const e: any = u[i];
        if (e.kind === 'agent' && e.agent === 'mapper') {
          u[i] = { ...e, result: { type: 'graph', nodes: graph?.nodes.length || 0, edges: graph?.edges.length || 0 }, autoCollapse: true };
        }
        // Collapse reviewer when mapper completes
        if (e.kind === 'agent' && e.agent === 'reviewer') {
          u[i] = { ...e, autoCollapse: true };
        }
      }
      return u;
    });

    historyRef.current = history;

    // Parse sequence graph if present
    let sequenceGraph: CallGraph | null = null;
    if (data?.sequence_graph?.nodes?.length > 0) {
      const seqEdges = (data.sequence_graph.edges || []).map((e: any) => ({
        ...e,
        status: (EDGE_STATUS_MAP[e.status] || 'existing') as 'existing' | 'new' | 'removed' | 'error',
      }));
      sequenceGraph = { nodes: data.sequence_graph.nodes, edges: seqEdges };
    }

    if (graph) {
      flushSync(() => onPipelineChange({ phase: 'done', graph, sequenceGraph }));
    } else {
      setTimeline(prev => [...prev, { kind: 'system', text: `✕ ${t('chat.mapperNoGraph')}（已重试 ${MAX_RETRIES} 次）` }]);
      onPipelineChange({ phase: 'done' });
    }

    setRunning(false);
  };

  /* ── PM dispatch: read-only consultations (Architect / Mapper) ── */

  /* Architect 只读设计咨询：产出落咨询卡文本；不写 .tracecrew、不进 Planner/Reviewer/执行。 */
  const runArchitectConsult = async (brief: string, pmText: string, originalInstruction: string) => {
    console.log(`[PM→Architect] 只读咨询派发：brief ${brief.length} 字，PM 派发声明轮 ${pmText.length} 字`);
    setTimeline(prev => [...prev, { kind: 'system', text: t('chat.dispatchArchitect') }]);

    const result = await agentLoop('architect', '',
      `请就以下事项给出**只读**设计分析（Markdown；仅用 list-dir/read-file/search）：\n${brief}`);

    await runConsultReportBack('Architect', result.fullText.slice(0, 2000), false, originalInstruction);
  };

  /* Mapper 只读画图咨询：镜像 runMapper 成功路径（重试环 + EDGE_STATUS_MAP + 画布挂载），
     但历史与产出均隔离于主流水线；咨询卡不设 autoCollapse——图谱同时留存于对话与画布。 */
  const runMapperConsult = async (brief: string, pmText: string, originalInstruction: string) => {
    console.log(`[PM→Mapper] 只读画图派发：brief ${brief.length} 字，PM 派发声明轮 ${pmText.length} 字`);
    setTimeline(prev => [...prev, { kind: 'system', text: t('chat.dispatchMapper') }]);

    const EDGE_STATUS_MAP: Record<string, 'existing' | 'new' | 'removed' | 'error'> = {
      existing: 'existing', new: 'new', removed: 'removed', error: 'error',
      planned_new: 'new', planned_change: 'existing',
    };
    const consultCtx = `请梳理以下目标的调用关系并产出 call_graph + sequence_graph（只读操作）：\n${brief}`;
    let fullText = '';
    let data: any = null;
    let graph: CallGraph | null = null;
    const MAX_RETRIES = 2;
    // 重试预算收窄（design_turn-limit-wrapup 3.5）：首次尝试不传（服务端默认 50 轮），
    // 重试限 15 轮——避免解析失败重试再起一整轮全预算探索。
    const RETRY_MAX_TURNS = 15;
    // 咨询重试历史只在本函数内累积，不写入 historyRef（主流水线上下文零污染）
    const consultHistory: Array<{ role: string; content: string }> = [];

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      let ctx = consultCtx;
      if (attempt > 0) {
        ctx = `${consultCtx}\n\n上一次你的输出格式不正确，无法解析为有效的 JSON。请确保：\n1. 输出包含 \`\`\`json 代码块，其中同时包含 "call_graph" 和 "sequence_graph"\n2. call_graph 和 sequence_graph 各自包含 nodes 和 edges 数组\n3. sequence_graph 的每个 node 必须有 lane 和 step 字段\n\n请重新生成。`;
      }

      let retryMaxTurns: number | undefined;
      if (attempt > 0) retryMaxTurns = RETRY_MAX_TURNS;
      const result = await agentLoop('mapper', '', ctx, [...consultHistory], retryMaxTurns);
      fullText = result.fullText;
      data = parseJson(fullText);

      if (data?.call_graph?.nodes?.length > 0) {
        const edges = (data.call_graph.edges || []).map((e: any) => ({ ...e, status: EDGE_STATUS_MAP[e.status] || 'new' }));
        graph = { nodes: data.call_graph.nodes, edges };
        break;
      }

      const errPreview = fullText.slice(0, 300).replace(/\n/g, ' ');
      consultHistory.push({ role: 'assistant', content: `[Mapper 咨询] JSON 解析失败 (第${attempt + 1}次): ${errPreview}` });
      consultHistory.push({ role: 'user', content: `你的输出无法解析为有效的 call_graph JSON。请优先基于已收集信息直接输出 call_graph + sequence_graph；确需补充探索，最多 ${RETRY_MAX_TURNS} 轮。` });

      setTimeline(prev => [...prev, { kind: 'system', text: `Mapper 输出格式错误，正在重试 (${attempt + 1}/${MAX_RETRIES})...` }]);
    }

    // 序列图解析口径与 runMapper 一致（缺失/失败时保持 null）
    let sequenceGraph: CallGraph | null = null;
    if (data?.sequence_graph?.nodes?.length > 0) {
      const seqEdges = (data.sequence_graph.edges || []).map((e: any) => ({
        ...e,
        status: (EDGE_STATUS_MAP[e.status] || 'existing') as 'existing' | 'new' | 'removed' | 'error',
      }));
      sequenceGraph = { nodes: data.sequence_graph.nodes, edges: seqEdges };
    }

    if (graph) {
      const nodeCount = graph.nodes.length;
      const edgeCount = graph.edges.length;
      // 咨询卡挂结果但保留在对话流中（不设 autoCollapse）
      setTimeline(prev => {
        const u = [...prev];
        for (let i = u.length - 1; i >= 0; i--) {
          const e: any = u[i];
          if (e.kind === 'agent' && e.agent === 'mapper') {
            u[i] = { ...e, result: { type: 'graph', nodes: nodeCount, edges: edgeCount } };
            return u;
          }
        }
        return u;
      });
      flushSync(() => onPipelineChange({ phase: 'done', graph, sequenceGraph }));
      let seqInfo = '；未含序列图';
      if (sequenceGraph) {
        seqInfo = `；序列图 ${sequenceGraph.nodes.length} 节点 · ${sequenceGraph.edges.length} 边`;
      }
      await runConsultReportBack('Mapper', `调用图 ${nodeCount} 节点 · ${edgeCount} 边${seqInfo}\n${fullText.slice(0, 1500)}`, true, originalInstruction);
    } else {
      // 失败终态：不挂结果卡、不挂图谱，如实回报失败
      setTimeline(prev => [...prev, { kind: 'system', text: `✕ ${t('chat.mapperNoGraph')}（已重试 ${MAX_RETRIES} 次）` }]);
      onPipelineChange({ phase: 'done' });
      await runConsultReportBack('Mapper', `未能产出图谱（输出格式重试 ${MAX_RETRIES} 次后仍无法解析）\n${fullText.slice(0, 1500)}`, false, originalInstruction);
    }
  };

  /* 咨询回报回路（唯一实现处）：把产出摘要回注 PM 历史，再跑一轮 PM 输出汇总卡。
     汇报轮直接调用 pmStream、不经过派发判定链——汇报文本即使含 handoff 标签也不会
     触发二次派发（结构上保证每条链「设计、画图」各至多一次）。 */
  const runConsultReportBack = async (agentLabel: string, summary: string, hasGraph: boolean, originalInstruction: string) => {
    pmHistoryRef.current.push({
      role: 'user',
      content: `【系统回报】${agentLabel} 已完成当前咨询任务。产出摘要（截断）：\n${summary}${hasGraph ? '\n（图谱已生成并显示于中央画布）' : ''}\n请向用户简要汇报（要点化，勿复述全文）；除用户显式要求外不再派发；结束时输出 <done/>。`,
    });
    const summaryText = await pmStream([...pmHistoryRef.current]);
    pmHistoryRef.current.push({ role: 'assistant', content: summaryText });
    setPmState({ active: true, originalInstruction });
    setRunning(false);
  };

  const handleSend = () => {
    if (!input.trim() || running) return;
    const msg = input.trim();
    const sentAttachments = attachmentsRef.current;
    const images = sentAttachments.map(a => a.dataUrl);
    setInput('');
    setAttachNotice('');
    if (sentAttachments.length > 0) {
      pendingImagesRef.current = sentAttachments;
      updateAttachments([]);
    }
    // 展示条目带缩略图；历史推送的文本附加「（附图 N 张）」标记（模型侧注入文本，展示文本不加）
    let entryImages: string[] | undefined;
    let historyText = msg;
    if (images.length > 0) {
      entryImages = images;
      historyText = `${msg}（附图 ${images.length} 张）`;
    }
    setTimeline(prev => [...prev, { kind: 'user', text: msg, images: entryImages }]);
    if (pmState.active) {
      runProjectManagerFollowUp(historyText);
    } else {
      runProjectManager(historyText);
    }
  };

function PinnedPlanCard({ plan }: { plan: { plan_summary: string; raw?: string; steps?: any[]; key_files?: string[] } }) {
  const raw = plan.raw || plan.plan_summary || '';
  const [showHistory, setShowHistory] = useState(false);
  const [planFiles, setPlanFiles] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const entries = await window.tracecrew?.file.listDirectory('.tracecrew/plans/');
        const files = (entries || [])
          .filter((e: any) => e.type === 'file' && e.name.endsWith('.md') && e.name !== 'README.md' && e.name !== 'latest.md')
          .map((e: any) => e.name)
          .sort()
          .reverse();
        setPlanFiles(files);
      } catch {
        // 预期可忽略：历史计划列表仅为附加信息，读取失败时保持空列表
      }
    })();
  }, [plan]);

  const openPopup = (content: string) => {
    const cleaned = cleanProtocolTags(content)
      .replace(/([^\n])(#{1,4}\s)/g, '$1\n$2');
    const html = marked.parse(cleaned, { async: false }) as string;
    window.tracecrew?.window.openPlan(html);
  };

  return (
    <div className="shrink-0 border-b" style={{ borderColor: 'var(--color-border-subtle)' }}>
      <div className="flex items-center gap-1.5 px-4 py-1.5">
        <span className="text-[9px] font-semibold uppercase tracking-wider shrink-0 inline-flex items-center gap-1" style={{ color: 'var(--ibm-link)' }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0">
            <rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4.5V3h6v1.5"/><path d="M9 10h6M9 14h4"/>
          </svg>
          Plan
        </span>
        <span className="text-[10px] truncate" style={{ color: 'var(--color-text-secondary)' }}>
          {plan.plan_summary.slice(0, 60)}{plan.plan_summary.length > 60 ? '…' : ''}
        </span>
        <button onClick={() => openPopup(raw)}
          className="shrink-0 text-[9px] px-1.5 py-0.5 rounded transition-colors hover:bg-[rgba(27,42,68,0.045)]"
          style={{ color: 'var(--ibm-link)' }} title="展开当前计划">
          ↗
        </button>
        {/* History dropdown */}
        <div className="relative">
          <button onClick={() => setShowHistory(!showHistory)}
            className="shrink-0 text-[9px] px-1.5 py-0.5 rounded transition-colors hover:bg-[rgba(27,42,68,0.045)] inline-flex items-center gap-1"
            style={{ color: 'var(--color-text-muted)' }} title="历史计划">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            </svg>
            {planFiles.length || ''}
          </button>
          {showHistory && (
            <div className="absolute right-0 top-full mt-1 z-50 rounded-md border overflow-hidden"
              style={{ width: 320, background: 'var(--color-bg-layer)', borderColor: 'var(--color-border-default)', boxShadow: '0 10px 28px rgba(27,42,68,.14)' }}
              onMouseLeave={() => setShowHistory(false)}>
              <div className="px-3 py-2 border-b text-[9px] font-semibold" style={{ borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-muted)' }}>
                历史计划 ({planFiles.length})
              </div>
              <div className="max-h-48 overflow-y-auto">
                {planFiles.length === 0 ? (
                  <div className="px-3 py-4 text-center text-[9px]" style={{ color: 'var(--color-text-muted)' }}>暂无历史</div>
                ) : (
                  planFiles.map(f => {
                    // Parse date and name from filename: 2026-06-25-name.md
                    const datePart = f.slice(0, 10);
                    const namePart = f.slice(11).replace('.md', '').replace(/-/g, ' ');
                    return (
                      <button key={f} onClick={async () => {
                        setShowHistory(false);
                        try {
                          const fc = await window.tracecrew?.file.readFile(`.tracecrew/plans/${f}`);
                          if (fc?.content) openPopup(fc.content);
                        } catch {
                          // 预期可忽略：单条历史计划读取失败时静默跳过（不展开），可稍后重试
                        }
                      }}
                        className="w-full text-left px-3 py-2 hover:bg-[rgba(27,42,68,0.045)] transition-colors border-b last:border-b-0"
                        style={{ borderColor: 'var(--color-border-subtle)' }}>
                        <div className="text-[9px] font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>{namePart}</div>
                        <div className="text-[8px]" style={{ color: 'var(--color-text-muted)' }}>{datePart}</div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

  /* ════ Render ════ */

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--color-bg-primary)' }}>
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b flex items-center gap-2.5"
        style={{ borderColor: 'var(--color-border-subtle)', background: 'var(--color-bg-layer)' }}>
        <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ background: 'rgba(53,96,143,.09)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#35608f" strokeWidth="2">
            <circle cx="12" cy="12" r="3"/><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
            <circle cx="5" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>
            <line x1="12" y1="8" x2="12" y2="9"/><line x1="12" y1="15" x2="12" y2="16"/>
            <line x1="8" y1="12" x2="9" y2="12"/><line x1="15" y1="12" x2="16" y2="12"/>
          </svg>
        </div>
        <div>
          <div className="text-[11px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('chat.pipeline')}</div>
          <div className="text-[9px]" style={{ color: 'var(--color-text-muted)' }}>{t('chat.pipelineFlow')}</div>
        </div>
      </div>

      {/* Pinned PlanCard */}
      {savedPlan?.plan_summary && <PinnedPlanCard plan={savedPlan} />}

      {/* Timeline */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {timeline.length === 0 ? (
          <div className="flex items-center justify-center h-full px-6">
            <div className="text-center">
              <div className="w-14 h-14 mx-auto mb-3 rounded-md flex items-center justify-center"
                style={{ background: 'var(--color-bg-layer)', border: '2px dashed var(--ibm-border-strong)' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" style={{ color: 'var(--color-text-muted)' }}>
                  <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                  <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                </svg>
              </div>
              <div className="text-[11px] font-medium" style={{ color: 'var(--color-text-muted)' }}>{t('chat.describeTask')}</div>
              <div className="mt-1 text-[9px]" style={{ color: 'var(--color-text-muted)' }}>{t('chat.pipelineHint')}</div>
            </div>
          </div>
        ) : (
          <TimelineView timeline={timeline} t={t} thinkingTier={thinkingTier} />
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 px-3 py-2.5 border-t" style={{ borderColor: 'var(--color-border-subtle)', background: 'var(--color-bg-layer)' }}>
        {/* ① 待发预览条：缩略图 chips（含体积标注与 ✕ 移除，方角 3px、发丝边）+ 压缩中占位 */}
        {(attachments.length > 0 || compressingCount > 0) && (
          <div className="flex items-center flex-wrap gap-1.5 px-1 pb-1.5">
            {attachments.map((a) => (
              <div key={a.id} className="relative shrink-0"
                style={{ borderRadius: 3, border: '1px solid var(--ibm-border)', background: 'var(--color-bg-surface)' }}>
                <img src={a.dataUrl} alt="" style={{ height: 44, maxWidth: 110, objectFit: 'cover', display: 'block', borderRadius: 2 }} />
                <span className="absolute left-0 bottom-0 text-[8px] px-1 py-0.5 leading-none"
                  style={{ background: 'rgba(32,48,79,.72)', color: '#fff', borderTopRightRadius: 3 }}>
                  {Math.round(a.bytes / 1024)}KB
                </span>
                <button onClick={() => removeAttachment(a.id)} title="✕"
                  className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 flex items-center justify-center text-[8px] leading-none rounded-full"
                  style={{ background: 'var(--ibm-primary)', color: '#fff' }}>
                  ✕
                </button>
              </div>
            ))}
            {compressingCount > 0 && (
              <div className="shrink-0 flex items-center justify-center"
                style={{ width: 44, height: 44, borderRadius: 3, border: '1px dashed var(--ibm-border-strong)', background: 'var(--color-bg-surface)' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin"
                  style={{ color: 'var(--color-text-muted)' }}>
                  <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                </svg>
              </div>
            )}
          </div>
        )}
        {/* ① 行内提示：数量/体积超限、发送失败（可移除后重发） */}
        {attachNotice && (
          <div className="flex items-center gap-1.5 px-1 pb-1.5">
            <span className="text-[9px]" style={{ color: 'var(--ibm-error)' }}>{attachNotice}</span>
            <button onClick={() => setAttachNotice('')} className="text-[9px] hover:underline shrink-0"
              style={{ color: 'var(--color-text-muted)' }}>
              ✕
            </button>
          </div>
        )}
        <div className="flex items-end gap-2 px-3 py-2 rounded-md border border-[color:var(--color-border-default)] transition-colors focus-within:border-[#35608f] focus-within:shadow-[0_0_0_3px_rgba(53,96,143,0.10)]"
          style={{ background: 'var(--color-bg-surface)' }}
          onDragOver={(e) => { e.preventDefault(); }}
          onDrop={(e) => {
            e.preventDefault();
            const dropped = Array.from(e.dataTransfer?.files || []);
            if (dropped.length > 0) addImageFiles(dropped);
          }}>
          {/* ① 文件选择入口（纯渲染层，无新 IPC） */}
          <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => {
              const picked = Array.from(e.target.files || []);
              e.target.value = ''; // 允许连续选择同一个文件
              addImageFiles(picked);
            }} />
          <textarea ref={textareaRef} value={input} onChange={e => setInput(e.target.value)}
            placeholder={pmState.active ? t('pm.replyPlaceholder') : t('chat.inputPlaceholder')} disabled={running} rows={1}
            className="flex-1 text-[12px] bg-transparent outline-none focus:outline-none focus:ring-0 focus:ring-offset-0 resize-none min-h-[24px] max-h-[120px] leading-relaxed"
            style={{ color: 'var(--color-text-primary)' }}
            onPaste={(e) => {
              // ① 粘贴入口：仅当剪贴板含图片文件时拦截（纯文本粘贴不受影响）
              const items = e.clipboardData?.items;
              if (!items) return;
              const files: File[] = [];
              for (let i = 0; i < items.length; i++) {
                if (items[i].kind === 'file' && items[i].type.startsWith('image/')) {
                  const f = items[i].getAsFile();
                  if (f) files.push(f);
                }
              }
              if (files.length > 0) {
                e.preventDefault();
                addImageFiles(files);
              }
            }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); handleSend(); } }}
          />
          <button onClick={() => fileInputRef.current?.click()} disabled={running}
            className="shrink-0 w-6 h-6 mb-0.5 flex items-center justify-center rounded-md transition-colors hover:bg-[rgba(27,42,68,0.045)] disabled:opacity-30"
            style={{ color: 'var(--color-text-muted)' }}
            title={t('chat.imageAttach')} aria-label={t('chat.imageAttach')}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
            </svg>
          </button>
          {running ? (
            <button onClick={() => { abortRef.current?.abort(); setRunning(false); }}
              className="shrink-0 px-2.5 py-1 rounded-md text-[10px] font-semibold"
              style={{ color: 'var(--ibm-error)', background: 'rgba(194,69,46,.07)', border: '1px solid rgba(194,69,46,.4)' }}>
              {t('chat.stop')}
            </button>
          ) : (
            <button onClick={handleSend} disabled={!input.trim()}
              className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md transition-all duration-150 hover:scale-105 disabled:opacity-20"
              style={{ background: input.trim() ? 'var(--ibm-primary)' : 'var(--color-border-subtle)' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
              </svg>
            </button>
          )}
        </div>
        <div className="flex items-center justify-between mt-1.5 px-1 gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            {/* 思考强度三档分段控件（②）：点击切换即持久化；样式沿用蓝图室 token（墨蓝选中态、方角 3px） */}
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[9px]" style={{ color: 'var(--color-text-muted)' }}>{t('chat.thinkingLabel')}</span>
              <div className="flex overflow-hidden" style={{ border: '1px solid var(--ibm-border)', borderRadius: 3 }}>
                {THINKING_TIERS.map((tier, index) => {
                  const selected = thinkingTier === tier;
                  const segmentStyle: { background: string; color: string; borderLeft?: string } = {
                    background: 'transparent',
                    color: 'var(--color-text-muted)',
                  };
                  if (index > 0) segmentStyle.borderLeft = '1px solid var(--ibm-border)';
                  if (selected) {
                    segmentStyle.background = 'var(--ibm-primary)';
                    segmentStyle.color = '#fff';
                  }
                  return (
                    <button key={tier} onClick={() => changeThinkingTier(tier)}
                      className="px-1.5 py-0.5 flex flex-col items-center leading-none transition-colors"
                      style={segmentStyle}
                      title={t(THINKING_TIER_HINT_KEY[tier])}>
                      <span className="text-[9px] font-medium">{t(THINKING_TIER_LABEL_KEY[tier])}</span>
                      <span className="text-[8px] mt-0.5" style={{ opacity: 0.72 }}>{t(THINKING_TIER_HINT_KEY[tier])}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            {pmState.active ? (
              <button onClick={() => {
                const orig = pmState.originalInstruction;
                setPmState({ active: false, originalInstruction: '' });
                setTimeline(prev => [...prev, { kind: 'system', text: t('pm.skipToPlanner') }]);
                setTimeout(() => runPlanner(orig), 100);
              }}
                className="text-[9px] hover:underline truncate"
                style={{ color: 'var(--color-text-muted)' }}>
                {t('pm.skipToPlanner')}
              </button>
            ) : (
              <span className="text-[9px] truncate" style={{ color: 'var(--color-text-muted)' }}>{t('chat.enterHint')}</span>
            )}
          </div>
          <span className="text-[9px] shrink-0" style={{ color: 'var(--color-text-muted)' }}>{t('chat.charCount', { count: input.length })}</span>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   Timeline renderer — pure, no side effects
   ══════════════════════════════════════════════ */

function TimelineView({ timeline, t, thinkingTier }: { timeline: TimelineEntry[]; t: any; thinkingTier: ThinkingTier }) {
  return (
    <div className="px-4 py-2 space-y-0.5">
      {timeline.map((entry, i) => {
        if (entry.kind === 'system') return <SystemMsg key={i} text={entry.text} />;
        if (entry.kind === 'user') return <UserMsg key={i} text={entry.text} images={entry.images} />;
        if (entry.kind === 'tool') {
          // All tool calls are now embedded inside AgentCard — skip standalone ToolRow
          return null;
        }
        if (entry.kind === 'agent') return <AgentCard key={i} entry={entry} t={t} thinkingTier={thinkingTier} />;
        return null;
      })}
    </div>
  );
}

function SystemMsg({ text }: { text: string }) {
  return (
    <div className="py-1.5 text-center">
      <span className="text-[9px] px-2.5 py-0.5 rounded-full" style={{ color: 'var(--color-text-muted)', background: 'var(--ibm-bg)', border: '1px solid var(--ibm-border-subtle)' }}>
        {text}
      </span>
    </div>
  );
}

function UserMsg({ text, images }: { text: string; images?: string[] }) {
  return (
    <div className="flex justify-end py-1">
      <div className="max-w-[90%] rounded px-3.5 py-2.5"
        style={{ background: 'var(--ibm-layer-02)', border: '1px solid var(--ibm-border)' }}>
        {images && images.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5 mb-1.5">
            {images.map((src, i) => (
              <img key={i} src={src} alt="" className="max-w-full object-contain"
                style={{ maxHeight: 120, borderRadius: 3, border: '1px solid var(--ibm-border)' }} />
            ))}
          </div>
        )}
        <div className="text-[11px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--color-text-primary)' }}>
          {text}
        </div>
      </div>
    </div>
  );
}

function CollapsibleReasoning({ text, t }: { text: string; t: (key: string) => string }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mt-2">
      <div onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[9px] cursor-pointer select-none py-0.5"
        style={{ color: 'var(--color-text-muted)' }}>
        <span>{open ? '▾' : '▸'}</span>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
          <path d="M12 3a6 6 0 0 0-3.5 10.9V17h7v-3.1A6 6 0 0 0 12 3z"/><path d="M10 21h4"/>
        </svg>
        {t('chat.reasoning')}
      </div>
      {open && (
        <div className="opacity-60" onClick={() => setOpen(false)}>
          <Markdown text={text} />
        </div>
      )}
    </div>
  );
}

function CollapsibleTools({ tools }: { tools: Array<{ type: string; file: string }> }) {
  const [open, setOpen] = useState(false);
  if (!tools || tools.length === 0) return null;

  return (
    <div className="mt-2">
      <div onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[9px] cursor-pointer select-none py-0.5"
        style={{ color: 'var(--color-text-muted)' }}>
        <span>{open ? '▾' : '▸'}</span>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/>
        </svg>
        工具调用 ({tools.length})
      </div>
      {open && (
        <div className="mt-1 space-y-0.5">
          {tools.map((tool, i) => {
            const tc = TOOL_COLOR[tool.type] || { bg: 'var(--ibm-layer-02)', c: 'var(--color-text-muted)' };
            return (
              <div key={i} className="flex items-center gap-2 py-0.5 pl-1">
                <span className="text-[9px] font-mono font-medium rounded-sm px-1.5 py-0.5 shrink-0"
                  style={{ background: tc.bg, color: tc.c }}>
                  {TOOL_LABEL[tool.type] || tool.type}
                </span>
                <span className="text-[9px] truncate" style={{ color: 'var(--color-text-muted)' }}>
                  {tool.file}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Agent card ── */

function AgentCard({ entry, t, thinkingTier }: { entry: TimelineEntry & { kind: 'agent' }; t: any; thinkingTier: ThinkingTier }) {
  const cfg = AG[entry.agent] || { name: entry.agent, color: '#8593aa' };
  const [expanded, setExpanded] = useState(true);
  const result = entry.result;

  // ② 思考强度徽标：档=中/高时显示（低档不显示）；文案复用档位副标
  let thinkingBadge = '';
  if (thinkingTier === 'mid') thinkingBadge = t('chat.thinkingMidHint');
  else if (thinkingTier === 'high') thinkingBadge = t('chat.thinkingHighHint');

  // Hide completely after Mapper completes
  if (entry.autoCollapse) return null;
  const hasText = !!(entry.text || '').trim();
  const isThinking = !result && hasText && entry.status !== 'done';

  // Status from result
  let status: 'thinking' | 'done' | 'failed' = isThinking ? 'thinking' : 'done';
  let statusLabel = '';
  if (result?.type === 'review') {
    status = result.passed ? 'done' : 'failed';
    statusLabel = result.passed ? t('chat.done') : t('chat.failed');
  } else if (result?.type === 'plan') {
    statusLabel = t('chat.done');
  } else if (result?.type === 'graph') {
    statusLabel = `${result.nodes}${t('graph.nodes')} · ${result.edges}${t('graph.edges')}`;
  } else if (isThinking) {
    statusLabel = `${t('chat.thinking')} · ${entry.text.length}${t('chat.chars')}`;
  } else if (entry.status === 'done') {
    statusLabel = `${t('chat.done')} · ${entry.text.length}${t('chat.chars')}`;
  }

  // Status pill palette: done = green wash, failed = drafting red wash, running = violet wash
  let pillBg = 'rgba(107,91,149,.07)';
  let pillBorder = '1px solid rgba(107,91,149,.4)';
  let pillColor = '#6b5b95';
  if (status === 'done') {
    pillBg = 'rgba(47,125,95,.07)';
    pillBorder = '1px solid rgba(47,125,95,.4)';
    pillColor = 'var(--ibm-success)';
  } else if (status === 'failed') {
    pillBg = 'rgba(194,69,46,.07)';
    pillBorder = '1px solid rgba(194,69,46,.4)';
    pillColor = 'var(--ibm-error)';
  }

  return (
    <div className="rounded-md overflow-hidden"
      style={{
        background: 'var(--color-bg-surface)',
        borderWidth: '1px 1px 1px 2.5px',
        borderStyle: 'solid',
        borderColor: `var(--ibm-border) var(--ibm-border) var(--ibm-border) ${cfg.color}`,
      }}>
      {/* Header */}
      <button onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-[rgba(27,42,68,0.03)]">
        {/* Dot */}
        <span className="shrink-0 w-[15px] h-[15px] rounded-full flex items-center justify-center"
          style={{ border: `2px solid ${status === 'failed' ? 'var(--ibm-error)' : cfg.color}`, background: 'var(--color-bg-surface)' }}>
          {status === 'thinking' ? (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={cfg.color} strokeWidth="3" className="animate-spin">
              <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
            </svg>
          ) : (
            <span className="w-[6px] h-[6px] rounded-full" style={{ background: status === 'failed' ? 'var(--ibm-error)' : cfg.color }} />
          )}
        </span>
        {/* Name */}
        <span className="text-[11px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{cfg.name}</span>
        {/* Status badge */}
        {statusLabel && (
          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-sm" style={{
            background: pillBg,
            border: pillBorder,
            color: pillColor,
          }}>
            {status === 'failed' ? '✕ ' : status === 'done' ? '✓ ' : ''}{statusLabel}
          </span>
        )}
        {/* 思考强度徽标（复用状态胶囊位、方角 3px） */}
        {thinkingBadge && (
          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-sm" style={{
            background: 'rgba(53,96,143,.07)',
            border: '1px solid rgba(53,96,143,.4)',
            color: '#35608f',
          }}>
            {thinkingBadge}
          </span>
        )}
        <div className="flex-1" />
        <svg width="10" height="10" viewBox="0 0 8 8"
          style={{ transform: expanded ? 'rotate(180deg)' : '', transition: 'transform 0.15s' }}>
          <path d="M2 3 L4 5 L6 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ color: cfg.color }} />
        </svg>
      </button>

      {/* Body */}
      {expanded && (
        <div className="px-3.5 pb-3">
          {/* Reasoning — above main text, collapsible */}
          {entry.reasoning && (
            <CollapsibleReasoning text={entry.reasoning} t={t} />
          )}

          {/* Tools — collapsible file list (read_file) */}
          {entry.tools && entry.tools.length > 0 && (
            <CollapsibleTools tools={entry.tools} />
          )}

          {/* Text content */}
          {(entry.text || '').trim() && <Markdown text={entry.text} />}

          {/* Plan result */}
          {result?.type === 'plan' && (
            <div className={hasText ? 'mt-2 pt-2 border-t' : ''} style={{ borderColor: 'var(--color-border-subtle)' }}>
              <PlanCard planSummary={result.plan?.plan_summary || ''} color={cfg.color} />
            </div>
          )}

          {/* Graph result */}
          {result?.type === 'graph' && (
            <div className={hasText ? 'mt-2 pt-2 border-t' : ''} style={{ borderColor: 'var(--color-border-subtle)' }}>
              <div className="flex items-center gap-2 text-[10px]" style={{ color: cfg.color }}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" opacity="0.6">
                  <rect x="0.5" y="0.5" width="5" height="5" rx="1"/><rect x="10.5" y="0.5" width="5" height="5" rx="1"/>
                  <rect x="0.5" y="10.5" width="5" height="5" rx="1"/><rect x="10.5" y="10.5" width="5" height="5" rx="1"/>
                  <line x1="5.5" y1="3" x2="10.5" y2="3"/><line x1="3" y1="5.5" x2="3" y2="10.5"/>
                </svg>
                <span className="font-medium">{t('chat.callGraph')}</span>
                <span style={{ color: 'var(--color-text-muted)' }}>{statusLabel}</span>
              </div>
            </div>
          )}

          {/* Review result */}
          {result?.type === 'review' && (
            <div className={hasText ? 'mt-2 pt-2 border-t' : ''} style={{ borderColor: 'var(--color-border-subtle)' }}>
              <ReviewCard passed={result.passed} feedback={result.feedback} issues={result.issues} color={cfg.color} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Markdown component ── */

function Markdown({ text }: { text: string }) {
  const cleaned = cleanProtocolTags(text)
    .replace(/([^\n])(#{1,4}\s)/g, '$1\n$2');

  return (
    <div className="mt-1" style={{ fontSize: 11, color: 'var(--ibm-text-secondary)', lineHeight: 1.65 }}>
      <style>{`
        .md-body h1 { font-size:14px; font-weight:700; color:var(--ibm-text-primary); margin:12px 0 6px; }
        .md-body h2 { font-size:13px; font-weight:700; color:var(--ibm-text-primary); margin:10px 0 4px; }
        .md-body h3 { font-size:12px; font-weight:600; color:var(--ibm-text-primary); margin:8px 0 3px; }
        .md-body h4 { font-size:11px; font-weight:600; color:var(--ibm-text-primary); margin:6px 0 2px; }
        .md-body p { margin:0 0 6px; }
        .md-body ul, .md-body ol { padding-left:18px; margin:4px 0 8px; }
        .md-body li { margin-bottom:2px; }
        .md-body code { padding:1px 5px; border-radius:3px; font-size:10px; background:var(--ibm-layer-02); color:var(--ibm-link); }
        .md-body pre { margin:8px 0; padding:10px 12px; border-radius:6px; overflow-x:auto; font-size:10px; background:var(--ibm-layer-02); }
        .md-body pre code { padding:0; background:none; color:inherit; font-size:inherit; }
        .md-body table { width:100%; border-collapse:collapse; font-size:10px; margin:8px 0; }
        .md-body th, .md-body td { border:1px solid var(--ibm-border-subtle); padding:4px 8px; text-align:left; }
        .md-body th { background:var(--ibm-layer-01); font-weight:600; }
        .md-body hr { margin:12px 0; border:none; border-top:1px solid var(--ibm-border-subtle); }
        .md-body blockquote { border-left:2px solid var(--ibm-border); padding-left:10px; margin:8px 0; opacity:0.8; }
        .md-body a { color:var(--ibm-link); }
      `}</style>
      <div
        className="md-body"
        style={{ fontSize: 11, color: 'var(--ibm-text-secondary)', lineHeight: 1.65 }}
        dangerouslySetInnerHTML={{ __html: marked.parse(cleaned, { async: false })! }}
      />
    </div>
  );
}
