/**
 * Shared SSE streaming + shell execution helpers.
 * Used by both AgentPanel (chat) and RunPage (auto-run).
 */

export interface StreamResult {
  message: string;
  reasoning?: string;
  operations: Array<{
    type: string;
    file: string;
    start_line?: number;
    end_line?: number;
    after_line?: number;
    content?: string;
    pending?: boolean;
  }>;
}

/** Stream an agent response via SSE, calling onToken for each token chunk. */
export async function streamAgentResponse(
  body: Record<string, any>,
  signal: AbortSignal | undefined,
  onToken: (token: string) => void,
  onReasoning?: (token: string) => void,
  onTools?: (info: { count: number; ops: Array<{ type: string; file: string }> }) => void,
): Promise<StreamResult> {
  const res = await fetch('/api/v1/agent/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let fullMessage = '';
  let fullReasoning = '';
  let finalOps: any[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';

    for (const part of parts) {
      const lines = part.split('\n');
      let eventType = '', eventData = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) eventType = line.slice(7);
        else if (line.startsWith('data: ')) eventData = line.slice(6);
      }

      if (eventType === 'reasoning') {
        fullReasoning += eventData;
        onReasoning?.(eventData);
      } else if (eventType === 'token') {
        fullMessage += eventData;
        onToken(eventData);
      } else if (eventType === 'tools') {
        try { onTools?.(JSON.parse(eventData)); } catch { /* ignore */ }
      } else if (eventType === 'done') {
        try {
          const d = JSON.parse(eventData);
          fullMessage = d.message || fullMessage;
          finalOps = d.operations || [];
        } catch { /* ignore */ }
      }
    }
  }

  return { message: fullMessage, reasoning: fullReasoning || undefined, operations: finalOps };
}

/** Execute a shell command and wait for completion. Returns output + exit code. */
export function executeShellAndWait(
  command: string,
  onData?: (data: string) => void,
  timeoutMs = 60000,
): Promise<{ output: string; exitCode: number }> {
  return new Promise((resolve) => {
    const shellId = window.codeatlas.shell.run(command);
    let output = '';
    let resolved = false;

    window.codeatlas.shell.onData((id, data) => {
      if (id !== shellId) return;
      output += data;
      onData?.(data);
    });

    window.codeatlas.shell.onDone((id, code) => {
      if (id !== shellId || resolved) return;
      resolved = true;
      resolve({ output, exitCode: code ?? -1 });
    });

    setTimeout(() => {
      if (resolved) return;
      resolved = true;
      resolve({ output: output + '\n[timeout — still running in background]', exitCode: -1 });
    }, timeoutMs);
  });
}

/** Classify user intent: execute or readonly. */
export async function classifyIntent(instruction: string): Promise<'execute' | 'readonly'> {
  try {
    const res = await fetch('/api/v1/agent/classify-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction }),
    });
    const data = await res.json();
    return data.intent === 'execute' ? 'execute' : 'readonly';
  } catch {
    return 'readonly'; // safe default
  }
}

// ── Planner / Sub-agent streaming ──────────────────

export interface PlanData {
  plan: string;
  steps: Array<{ id: number; title: string; description: string; deps: number[] }>;
  raw?: string;
}

/** Stream a planner response via SSE. Returns the parsed plan. */
export async function streamPlan(
  instruction: string,
  signal: AbortSignal | undefined,
  onThinking: (token: string) => void,
): Promise<PlanData> {
  const res = await fetch('/api/v1/agent/plan/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instruction }),
    signal,
  });
  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');
  const decoder = new TextDecoder();
  let buffer = '';
  let planData: PlanData = { plan: '', steps: [] };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';
    for (const part of parts) {
      const lines = part.split('\n');
      let eventType = '', eventData = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) eventType = line.slice(7);
        else if (line.startsWith('data: ')) eventData = line.slice(6);
      }
      if (eventType === 'plan_token') {
        onThinking(eventData);
      } else if (eventType === 'plan') {
        try { planData = JSON.parse(eventData); } catch { /* */ }
      }
    }
  }
  return planData;
}

export interface StepResult {
  step_id: number;
  message: string;
  operations: Array<{ type: string; file: string; content?: string; start_line?: number; end_line?: number; after_line?: number }>;
}

/** Stream a sub-agent step via SSE. Returns step result. */
export async function streamStep(
  task: string,
  stepId: number,
  signal: AbortSignal | undefined,
  onToken: (token: string) => void,
): Promise<StepResult> {
  const res = await fetch('/api/v1/agent/step/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task, step_id: stepId }),
    signal,
  });
  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');
  const decoder = new TextDecoder();
  let buffer = '';
  let result: StepResult = { step_id: stepId, message: '', operations: [] };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';
    for (const part of parts) {
      const lines = part.split('\n');
      let eventType = '', eventData = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) eventType = line.slice(7);
        else if (line.startsWith('data: ')) eventData = line.slice(6);
      }
      if (eventType === 'step_token') {
        onToken(eventData);
      } else if (eventType === 'step_done') {
        try { result = JSON.parse(eventData); } catch { /* */ }
      }
    }
  }
  return result;
}
