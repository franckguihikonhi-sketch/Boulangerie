// ---------------------------------------------------------------------------
// Processus principal Electron — application de bureau « Wave → SAGE ».
//
// L'application est une SPA React entièrement côté client (aucun serveur) : on
// charge simplement le build Vite (dossier dist/) dans une fenêtre. Les données
// restent en local (localStorage), l'app fonctionne hors ligne ; l'export SAGE
// (téléchargement de fichier) et l'import Wave fonctionnent comme dans le
// navigateur.
// ---------------------------------------------------------------------------

const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#eef2ff',
    title: 'Wave → SAGE',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Menu minimal (recharger, quitter, zoom) en français.
  const menu = Menu.buildFromTemplate([
    {
      label: 'Fichier',
      submenu: [{ role: 'quit', label: 'Quitter' }]
    },
    {
      label: 'Affichage',
      submenu: [
        { role: 'reload', label: 'Recharger' },
        { role: 'resetZoom', label: 'Zoom normal' },
        { role: 'zoomIn', label: 'Zoom +' },
        { role: 'zoomOut', label: 'Zoom −' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Plein écran' }
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);

  // Les liens externes s'ouvrent dans le navigateur par défaut.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
