'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('zorix', Object.freeze({
  auth: Object.freeze({
    status: () => ipcRenderer.invoke('zorix:auth:status'),
    captcha: () => ipcRenderer.invoke('zorix:auth:captcha'),
    login: (payload) => ipcRenderer.invoke('zorix:auth:login', payload),
    logout: () => ipcRenderer.invoke('zorix:auth:logout')
  }),
  models: Object.freeze({
    list: () => ipcRenderer.invoke('zorix:models:list')
  }),
  chat: Object.freeze({
    start: (payload) => ipcRenderer.invoke('zorix:chat:start', payload),
    cancel: (requestId) => ipcRenderer.invoke('zorix:chat:cancel', requestId),
    onDelta: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('zorix:chat:delta', handler);
      return () => ipcRenderer.removeListener('zorix:chat:delta', handler);
    },
    onDone: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('zorix:chat:done', handler);
      return () => ipcRenderer.removeListener('zorix:chat:done', handler);
    },
    onError: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('zorix:chat:error', handler);
      return () => ipcRenderer.removeListener('zorix:chat:error', handler);
    }
  }),
  openExternal: (url) => ipcRenderer.invoke('zorix:open-external', url),
  platform: process.platform
}));