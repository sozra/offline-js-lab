'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') {
    throw new TypeError('事件监听器必须是函数。');
  }

  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('offlineJsLab', {
  getBootstrap: () => ipcRenderer.invoke('bootstrap:get'),

  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  openWorkspace: () => ipcRenderer.invoke('workspace:open'),

  openFile: () => ipcRenderer.invoke('file:open'),
  saveFile: (payload) => ipcRenderer.invoke('file:save', payload),

  runCode: (payload) => ipcRenderer.invoke('run:start', payload),
  stopRun: (runId) => ipcRenderer.invoke('run:stop', runId),
  onRunOutput: (callback) => subscribe('run:output', callback),
  onRunExit: (callback) => subscribe('run:exit', callback),

  listPackages: () => ipcRenderer.invoke('packages:list'),
  getTypeDefinitions: () => ipcRenderer.invoke('packages:types'),
  installPackages: (payload) => ipcRenderer.invoke('packages:install', payload),
  syncPackages: () => ipcRenderer.invoke('packages:sync'),
  uninstallPackages: (payload) => ipcRenderer.invoke('packages:uninstall', payload),
  stopPackageOperation: () => ipcRenderer.invoke('packages:stop'),
  onPackageOutput: (callback) => subscribe('packages:output', callback),

  onAppCommand: (callback) => subscribe('app:command', callback),
});
