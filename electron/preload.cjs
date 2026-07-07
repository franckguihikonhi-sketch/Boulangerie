// Pont sécurisé entre l'interface (navigateur) et la base locale (processus
// principal). L'interface n'accède JAMAIS directement au disque : elle passe
// par ces méthodes contrôlées.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('boulangeAPI', {
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload)
});
