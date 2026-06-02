import { spawn, ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { get } from 'http';
import { join } from 'path';
import { app } from 'electron';

let backendProcess: ChildProcess | null = null;
let backendOwned = false;

export function getBackendDir(): string {
  return join(app.getAppPath(), '..', 'backend');
}

function getPythonCmd(backendDir: string): string {
  const venvPython = process.platform === 'win32'
    ? join(backendDir, '.venv312', 'Scripts', 'python.exe')
    : join(backendDir, '.venv312', 'bin', 'python');
  if (existsSync(venvPython)) return venvPython;
  return process.platform === 'win32' ? 'python' : 'python3';
}

function isBackendHealthy(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = get('http://127.0.0.1:19850/api/v1/health', (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

export function startBackend(): Promise<void> {
  return new Promise(async (resolve, reject) => {
    if (await isBackendHealthy()) {
      backendProcess = null;
      backendOwned = false;
      resolve();
      return;
    }

    const backendDir = getBackendDir();
    const pythonCmd = getPythonCmd(backendDir);
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    backendProcess = spawn(pythonCmd, ['-m', 'uvicorn', 'main:app', '--port', '19850'], {
      cwd: backendDir,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
      },
    });
    backendOwned = true;

    backendProcess.stdout?.on('data', (data: Buffer) => {
      const msg = data.toString();
      if (msg.includes('Uvicorn running on')) {
        settle(resolve);
      }
    });

    backendProcess.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString();
      // Uvicorn logs to stderr
      if (msg.includes('Uvicorn running on') || msg.includes('Application startup complete')) {
        settle(resolve);
      }
    });

    backendProcess.on('error', (err) => settle(() => reject(err)));
    backendProcess.on('exit', (code) => {
      backendProcess = null;
      backendOwned = false;
      if (code !== 0 && code !== null) {
        console.error(`Backend exited with code ${code}`);
      }
      if (!settled) {
        settle(() => reject(new Error(`Backend exited before startup with code ${code}`)));
      }
    });

    // Timeout after 15s
    setTimeout(() => settle(resolve), 15000);
  });
}

export function stopBackend(): void {
  if (!backendProcess || !backendOwned) {
    backendProcess = null;
    backendOwned = false;
    return;
  }

  const pid = backendProcess.pid;
  if (!pid) return;

  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true });
    } else {
      // Negative pid targets the detached process group, including uvicorn children.
      process.kill(-pid, 'SIGTERM');
      setTimeout(() => {
        try { process.kill(-pid, 'SIGKILL'); } catch { /* already exited */ }
      }, 1500).unref();
    }
  } catch {
    try { backendProcess.kill('SIGTERM'); } catch { /* ignore */ }
  } finally {
    backendProcess = null;
    backendOwned = false;
  }
}
