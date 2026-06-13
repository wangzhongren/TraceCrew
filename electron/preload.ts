import { contextBridge, ipcRenderer, nativeImage } from 'electron';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// In dev: __dirname = electron/, icon at ../
// In production: __dirname = frontend/dist-electron/, icon at ../../
const iconPath = existsSync(join(__dirname, '..', 'icon.png'))
  ? join(__dirname, '..', 'icon.png')
  : join(__dirname, '..', '..', 'icon.png');
const appIconDataUrl = nativeImage.createFromPath(iconPath).toDataURL();

console.log('[preload] tracecrew API registered');

const api = {
  file: {
    openProject: () => ipcRenderer.invoke('file:openProject'),
    listDirectory: (dirPath: string) => ipcRenderer.invoke('file:listDirectory', dirPath),
    readFile: (filePath: string, startLine?: number, endLine?: number) => ipcRenderer.invoke('file:readFile', filePath, startLine, endLine),
    writeFile: (filePath: string, content: string) => ipcRenderer.invoke('file:writeFile', filePath, content),
    insertLines: (filePath: string, afterLine: number, content: string) =>
      ipcRenderer.invoke('file:insertLines', filePath, afterLine, content),
    replaceLines: (filePath: string, startLine: number, endLine: number, content: string) =>
      ipcRenderer.invoke('file:replaceLines', filePath, startLine, endLine, content),
    deleteLines: (filePath: string, startLine: number, endLine: number) =>
      ipcRenderer.invoke('file:deleteLines', filePath, startLine, endLine),
    deleteFile: (filePath: string) => ipcRenderer.invoke('file:deleteFile', filePath),
search: (query: string, dirPath: string, options?: import('./fileManager').SearchOptions) => ipcRenderer.invoke('file:search', query, dirPath, options),
    restoreBackup: (backupId: string) => ipcRenderer.invoke('file:restoreBackup', backupId),
    getProjectPath: () => ipcRenderer.invoke('file:getProjectPath'),
    onProjectOpened: (cb: (path: string) => void) => {
      ipcRenderer.on('project:opened', (_e, p: string) => cb(p));
    },
  },
  shell: {
    run: (command: string) => ipcRenderer.invoke('shell:run', command) as Promise<string>,
    kill: (id: string) => ipcRenderer.send('shell:kill', id),
    getLogFile: (id: string) => ipcRenderer.invoke('shell:getLogFile', id) as Promise<string | null>,
    readLog: (logFile: string) => ipcRenderer.invoke('shell:readLog', logFile) as Promise<string>,
    onData: (cb: (id: string, data: string) => void) => {
      ipcRenderer.on('shell:data', (_e, data: { id: string; data: string }) => cb(data.id, data.data));
    },
    onDone: (cb: (id: string, code: number | null) => void) => {
      ipcRenderer.on('shell:done', (_e, data: { id: string; code: number | null }) => cb(data.id, data.code));
    },
    onError: (cb: (id: string, error: string) => void) => {
      ipcRenderer.on('shell:error', (_e, data: { id: string; error: string }) => cb(data.id, data.error));
    },
  },
  backend: {
    getUrl: () => 'http://localhost:19850',
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    openTerminal: (projectPath?: string | null) => ipcRenderer.invoke('window:openTerminal', projectPath),
  },
  getAppIcon: () => appIconDataUrl,
};

contextBridge.exposeInMainWorld('tracecrew', api);

export type TraceCrewAPI = typeof api;
