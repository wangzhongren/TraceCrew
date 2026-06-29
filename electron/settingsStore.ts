import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// server/ → electron/ → CodeAtlas/.env
const ENV_PATH = join(__dirname, '..', '..', '.env');

const KEYS = ['TRACECREW_LLM_API_KEY', 'TRACECREW_LLM_BASE_URL', 'TRACECREW_LLM_MODEL'] as const;

/** Update specific LLM keys in the .env file, preserving all other lines. */
export function updateEnvFile(updates: Record<string, string>): void {
  try {
    const content = readFileSync(ENV_PATH, 'utf-8');
    const lines = content.split('\n');
    const updated = new Set<string>();

    const result = lines.map(line => {
      for (const key of KEYS) {
        if (line.startsWith(key + '=')) {
          updated.add(key);
          return `${key}=${updates[key] || ''}`;
        }
      }
      return line;
    });

    // Append any keys that weren't found
    for (const key of KEYS) {
      if (!updated.has(key) && updates[key]) {
        result.push(`${key}=${updates[key]}`);
      }
    }

    writeFileSync(ENV_PATH, result.join('\n'), 'utf-8');
  } catch (e) {
    console.error('[envStore] Failed to update .env:', e);
  }
}
