import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('tkdDesktop', {
  getStatus: () => ipcRenderer.invoke('desktop:get-status'),
  retry: () => ipcRenderer.invoke('desktop:retry'),
  openOperator: () => ipcRenderer.invoke('desktop:open-operator'),
  openData: () => ipcRenderer.invoke('desktop:open-data'),
  openLogs: () => ipcRenderer.invoke('desktop:open-logs'),
  openExternal: (url: string) => ipcRenderer.invoke('desktop:open-external', url),
  onStatus: (callback: (status: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: unknown) => callback(status);
    ipcRenderer.on('desktop:status', listener);
    return () => ipcRenderer.removeListener('desktop:status', listener);
  },
});
