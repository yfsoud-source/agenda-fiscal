const { contextBridge: c, ipcRenderer: r } = require('electron');
c.exposeInMainWorld('api', {
  id: () => r.invoke('lic:id'), activer: x => r.invoke('lic:activate', x),
  get: () => r.invoke('vp:get'), set: (k, v) => r.invoke('vp:set', k, v),
  ech: () => r.invoke('ech:list'), decl: (k, b) => r.invoke('ech:decl', k, b),
  pdf: () => r.invoke('exp:pdf'), csv: x => r.invoke('exp:csv', x),
  alarmes: () => r.invoke('alarm:list'), agir: (k, t) => r.invoke('alarm:act', k, t)
});
