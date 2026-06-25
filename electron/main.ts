import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { app, BrowserWindow, ipcMain, dialog, nativeImage, shell } from 'electron';
import { dirname, isAbsolute, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Load .env before any module that uses OpenAI
dotenv.config({ path: join(__dirname, '..', '..', '.env') });

import { createServer } from './server/index';
import type { Server } from 'http';
import {
  listDirectory, readFile, writeFile,
  insertLines, replaceLines, deleteLines, deleteFile,
  searchInFiles,
  runShell, killShell, killAllShells, getShellLogFile, readLogFile,
  restoreBackup,
} from './fileManager';
import { closeDatabase } from './server/services/db';

let mainWindow: BrowserWindow | null = null;
let httpServer: Server | null = null;
let projectPath: string = '';
let cleanedUp = false;

function cleanupProcesses(): void {
  if (cleanedUp) return;
  cleanedUp = true;
  killAllShells();
  if (httpServer) { httpServer.close(); httpServer = null; }
}

function resolveProjectPath(filePath: string): string {
  if (isAbsolute(filePath)) return filePath;
  return join(projectPath, filePath);
}

function registerIpcHandlers(): void {
  // Window controls
  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) { mainWindow?.unmaximize(); }
    else { mainWindow?.maximize(); }
  });
ipcMain.handle('window:close', () => mainWindow?.close());
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false);

  ipcMain.handle('window:openPlan', (_e, html: string) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const planWin = new BrowserWindow({
      width: 700, height: 800, minWidth: 400, minHeight: 500,
      title: 'Plan — TraceCrew', backgroundColor: '#ffffff',
      parent: mainWindow,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false },
    });
    const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Plan — TraceCrew</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:760px;margin:32px auto;padding:0 24px;color:#374151;line-height:1.7;font-size:14px}
.md-body h1{font-size:20px;color:#1a1a2e;margin:16px 0 8px}.md-body h2{font-size:16px;color:#1a1a2e;margin:14px 0 6px}.md-body h3{font-size:14px;color:#1a1a2e}.md-body p{margin:0 0 8px}
.md-body code{background:#f3f4f6;padding:1px 5px;border-radius:3px;font-size:13px;color:#dc2626}
.md-body pre{background:#f3f4f6;padding:12px 16px;border-radius:6px;overflow-x:auto;font-size:12px}
.md-body table{width:100%;border-collapse:collapse;font-size:13px;margin:12px 0}.md-body th,.md-body td{border:1px solid #e5e7eb;padding:6px 10px;text-align:left}.md-body th{background:#f9fafb}
.md-body ul,.md-body ol{padding-left:20px}.md-body hr{border:none;border-top:1px solid #e5e7eb;margin:16px 0}
.md-body blockquote{border-left:3px solid #e5e7eb;padding-left:12px;margin:12px 0;color:#6b7280}.md-body a{color:#3b82f6}</style></head><body><div class="md-body">${html}</div></body></html>`;
    planWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fullHtml)}`);
  });

  ipcMain.handle('window:openTerminal', (_e, path?: string | null) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const terminalPath = path || projectPath;
    const terminalWin = new BrowserWindow({
      width: 1200, height: 800,
      minWidth: 800, minHeight: 500,
      title: 'AI Terminal — TraceCrew',
      backgroundColor: '#0d1117',
      parent: mainWindow,
      webPreferences: {
        preload: getPreloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    const url = mainWindow.webContents.getURL();
    const sep = url.includes('?') ? '&' : '?';
    const encodedPath = encodeURIComponent(terminalPath);
    terminalWin.loadURL(`${url}${sep}terminal=1&path=${encodedPath}`);
  });

  // File operations
  ipcMain.handle('file:getProjectPath', () => projectPath);

  ipcMain.handle('file:openProject', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: '选择项目文件夹',
    });
    if (result.canceled || !result.filePaths.length) return null;
    projectPath = result.filePaths[0];
    mainWindow?.webContents.send('project:opened', projectPath);
    return projectPath;
  });

  ipcMain.handle('file:listDirectory', (_e, dirPath: string) => {
    return listDirectory(resolveProjectPath(dirPath));
  });

  ipcMain.handle('file:readFile', (_e, filePath: string, startLine?: number, endLine?: number) => {
    try {
      return readFile(resolveProjectPath(filePath), startLine, endLine);
    } catch (e: any) {
      return { path: filePath, lines: [], content: '', lineCount: 0, error: e.code === 'ENOENT' ? `文件不存在: ${filePath}` : `读取失败: ${e.message?.slice(0, 200)}` };
    }
  });

  ipcMain.handle('file:writeFile', (_e, filePath: string, content: string) => {
    return writeFile(resolveProjectPath(filePath), content);
  });

  ipcMain.handle('file:insertLines', (_e, filePath: string, afterLine: number, content: string) => {
    return insertLines(resolveProjectPath(filePath), afterLine, content);
  });

  ipcMain.handle('file:replaceLines', (_e, filePath: string, startLine: number, endLine: number, content: string) => {
    return replaceLines(resolveProjectPath(filePath), startLine, endLine, content);
  });

  ipcMain.handle('file:deleteLines', (_e, filePath: string, startLine: number, endLine: number) => {
    return deleteLines(resolveProjectPath(filePath), startLine, endLine);
  });

  ipcMain.handle('file:deleteFile', (_e, filePath: string) => {
    return deleteFile(resolveProjectPath(filePath), projectPath);
  });

  ipcMain.handle('file:search', async (_e, query: string, dirPath: string, options?: import('./fileManager').SearchOptions) => {
    return await searchInFiles(query, resolveProjectPath(dirPath || '.'), options);
  });

  ipcMain.handle('file:restoreBackup', (_e, backupId: string) => {
    return restoreBackup(projectPath, backupId);
  });

// Shell execution — streaming via event
  ipcMain.handle('shell:run', (_event, command: string) => {
    const cwd = projectPath || process.cwd();
    let shellId = '';
    shellId = runShell(
      command, cwd,
      (data) => {
        mainWindow?.webContents.send('shell:data', { id: shellId, data });
      },
      (code) => {
        mainWindow?.webContents.send('shell:done', { id: shellId, code });
      },
      (err) => {
        mainWindow?.webContents.send('shell:error', { id: shellId, error: err });
      },
    );
    return shellId;
  });

  ipcMain.on('shell:kill', (_e, id: string) => {
    killShell(id);
  });

  ipcMain.handle('shell:getLogFile', (_e, id: string) => {
    return getShellLogFile(id);
  });

  ipcMain.handle('shell:readLog', (_e, logFile: string) => {
    return readLogFile(logFile);
  });

  ipcMain.handle('shell:openFile', async (_e, filePath: string) => {
    const full = resolveProjectPath(filePath);
    return shell.openPath(full);
  });
}

function getPreloadPath(): string {
  const path = join(__dirname, 'preload.mjs');
  console.log('[main] preload path:', path);
  return path;
}

function createWindow(): void {
  const preloadPath = getPreloadPath();
  console.log('[main] preload path:', preloadPath);
  console.log('[main] __dirname:', __dirname);

  const iconPath = existsSync(join(__dirname, '..', 'icon.png'))
    ? join(__dirname, '..', 'icon.png')
    : join(__dirname, '..', '..', 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 700,
    title: 'TraceCrew',
    icon,
    backgroundColor: '#1a1c1e',
    frame: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  registerIpcHandlers();

  // Set dock icon on macOS
  if (process.platform === 'darwin') {
    const dockIconPath = existsSync(join(__dirname, '..', 'icon.png'))
      ? join(__dirname, '..', 'icon.png')
      : join(__dirname, '..', '..', 'icon.png');
    const dockIcon = nativeImage.createFromPath(dockIconPath);
    app.dock?.setIcon(dockIcon);
  }

  // Start embedded Express backend
  const frontendDist = join(__dirname, '..', 'dist');
  httpServer = createServer(frontendDist);
  console.log('[main] Express backend started on port 19850');

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  cleanupProcesses();
});

app.on('will-quit', () => {
  cleanupProcesses();
});

process.on('exit', () => {
  cleanupProcesses();
});
