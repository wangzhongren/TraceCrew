import { createHash } from 'crypto';
import { upsertFileSummary } from './db';
import type { FileSummary } from './db';

interface SummarizeJob {
  projectPath: string;
  filePath: string;
  content: string;
  totalLines: number;
}

const SUMMARIZE_PROMPT = `你是代码摘要专家。请分析以下代码，输出 JSON（直接输出纯 JSON，不要 markdown 包裹）：

{
  "summary": "一句话描述这个文件做了什么，100字以内",
  "key_exports": [
    {"name": "函数/类名", "kind": "function|class|interface|type|const", "signature": "完整签名", "line": 行号}
  ],
  "dependencies": [
    {"file": "依赖的相对路径", "reason": "原因（import了什么/调用了什么）"}
  ]
}

只输出 JSON，不要解释。`;

export class SummarizerService {
  private queue: SummarizeJob[] = [];
  private processing = false;

  constructor(
    private callLLM: (messages: Array<{ role: string; content: string }>) => Promise<string>,
    private modelName: string = '',
  ) {}

  /** External: called after read_file (non-blocking) */
  enqueue(projectPath: string, filePath: string, content: string, totalLines: number): void {
    this.queue.push({ projectPath, filePath, content, totalLines });
    if (!this.processing) {
      this.processQueue();
    }
  }

  private async processQueue(): Promise<void> {
    this.processing = true;
    while (this.queue.length > 0) {
      const job = this.queue.shift()!;
      try {
        await this.summarizeFile(job);
      } catch (e: any) {
        console.log(`[summarizer] Failed for ${job.filePath} | model=${this.modelName} | content=${job.content.length}c | lines=${job.totalLines} | ${e.message?.slice(0, 120)}`);
      }
    }
    this.processing = false;
  }

  private async summarizeFile(job: SummarizeJob): Promise<void> {
    const { projectPath, filePath, content } = job;

    // Hash check — skip if unchanged
    const fileHash = createHash('sha256').update(content).digest('hex').slice(0, 16);
    const existing = await this.getExistingSummary(projectPath, filePath);
    if (existing && existing.file_hash === fileHash) {
      return; // already up to date
    }

    // Truncate content for LLM (max ~8000 chars to stay within token limits)
    const truncated = content.length > 8000
      ? content.slice(0, 4000) + '\n...(truncated)...\n' + content.slice(-4000)
      : content;

    const response = await this.callLLM([
      { role: 'system', content: SUMMARIZE_PROMPT },
      { role: 'user', content: truncated },
    ]);

    if (!response || response.trim().length === 0) {
      console.log(`[summarizer] Empty LLM response for ${filePath} | model=${this.modelName} | content=${content.length} chars | truncated=${truncated.length} chars`);
      return;
    }

    const summary = this.parseSummaryResponse(response, filePath);
    if (!summary) return;

    // Save to DB
    upsertFileSummary({
      project_path: projectPath,
      file_path: filePath,
      summary: summary.summary,
      key_exports: summary.key_exports,
      dependencies: summary.dependencies,
      file_hash: fileHash,
      tokens: Math.ceil(content.length / 3),
      summary_tokens: Math.ceil(JSON.stringify(summary).length / 3),
      total_lines: job.totalLines,
    });

    console.log(`[summarizer] Saved summary for ${filePath} (${summary.key_exports.length} exports, ${summary.dependencies.length} deps)`);
  }

  private parseSummaryResponse(response: string, filePath: string): { summary: string; key_exports: any[]; dependencies: any[] } | null {
    try {
      const cleaned = response
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/gi, '')
        .trim();

      // Find first '{' and track brace balance to find matching '}'
      const startIdx = cleaned.indexOf('{');
      if (startIdx === -1) {
        console.log(`[summarizer] No JSON object found in response for ${filePath}`);
        return null;
      }

      let depth = 0;
      let endIdx = -1;
      for (let i = startIdx; i < cleaned.length; i++) {
        if (cleaned[i] === '{') depth++;
        else if (cleaned[i] === '}') {
          depth--;
          if (depth === 0) { endIdx = i; break; }
        }
      }

      if (endIdx === -1) {
        console.log(`[summarizer] Unmatched braces in response for ${filePath}`);
        return null;
      }

      const json = JSON.parse(cleaned.slice(startIdx, endIdx + 1));
      return {
        summary: json.summary || '',
        key_exports: json.key_exports || [],
        dependencies: json.dependencies || [],
      };
    } catch (e: any) {
      console.log(`[summarizer] Failed to parse JSON for ${filePath}: ${e.message?.slice(0, 80)} | raw: ${response.slice(0, 150)}`);
      return null;
    }
  }

  /** Sync wrapper — DB is not async (better-sqlite3) */
  private getExistingSummary(projectPath: string, filePath: string): { file_hash: string } | null {
    try {
      const { getFileSummary } = require('./db');
      const s = getFileSummary(projectPath, filePath);
      return s ? { file_hash: s.file_hash } : null;
    } catch {
      return null;
    }
  }
}
