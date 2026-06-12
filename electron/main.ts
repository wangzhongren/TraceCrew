import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { app, BrowserWindow, ipcMain, dialog, nativeImage } from 'electron';
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

  ipcMain.handle('window:openTerminal', (_e, path?: string | null) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const terminalPath = path || projectPath;
    const terminalWin = new BrowserWindow({
      width: 1200, height: 800,
      minWidth: 800, minHeight: 500,
      title: 'AI Terminal — CodeAtlas',
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
    return readFile(resolveProjectPath(filePath), startLine, endLine);
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

  const iconPath = join(__dirname, '..', 'icon.png');
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
    const dockIcon = nativeImage.createFromPath(join(__dirname, '..', 'icon.png'));
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
