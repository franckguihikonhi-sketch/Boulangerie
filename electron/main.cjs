// Processus principal Electron : ouvre la fenêtre, initialise la base locale,
// expose les opérations à l'interface, et fait une sauvegarde quotidienne.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const database = require('./database.cjs');

function backupDatabase(dbPath, backupDir) {
  try {
    if (!fs.existsSync(dbPath)) return;
    fs.mkdirSync(backupDir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    const dest = path.join(backupDir, `boulangerie-${day}.db`);
    if (!fs.existsSync(dest)) fs.copyFileSync(dbPath, dest); // 1 sauvegarde/jour
    // Ne conserve que les 30 dernières sauvegardes.
    const files = fs.readdirSync(backupDir).filter((f) => f.endsWith('.db')).sort();
    while (files.length > 30) fs.unlinkSync(path.join(backupDir, files.shift()));
  } catch (e) {
    console.error('Sauvegarde impossible :', e.message);
  }
}

function registerHandlers() {
  const wrap = (fn) => (_e, payload) => {
    try {
      return { ok: true, data: fn(payload) };
    } catch (err) {
      return { ok: false, error: err.message, shortages: err.shortages };
    }
  };
  ipcMain.handle('db:getState', wrap(() => database.getState()));
  ipcMain.handle('db:addIngredient', wrap((p) => database.addIngredient(p)));
  ipcMain.handle('db:updateIngredient', wrap((p) => database.updateIngredient(p)));
  ipcMain.handle('db:deleteIngredient', wrap((p) => database.deleteIngredient(p)));
  ipcMain.handle('db:adjustStock', wrap((p) => database.adjustStock(p)));
  ipcMain.handle('db:saveProduct', wrap((p) => database.saveProduct(p)));
  ipcMain.handle('db:deleteProduct', wrap((p) => database.deleteProduct(p)));
  ipcMain.handle('db:saveRecipe', wrap((p) => database.saveRecipe(p)));
  ipcMain.handle('db:recordPurchase', wrap((p) => database.recordPurchase(p)));
  ipcMain.handle('db:deletePurchase', wrap((p) => database.deletePurchase(p)));
  ipcMain.handle('db:recordProduction', wrap((p) => database.recordProduction(p)));
  ipcMain.handle('db:recordSale', wrap((p) => database.recordSale(p)));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'Boulangerie ERP',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(() => {
  const dbPath = path.join(app.getPath('userData'), 'boulangerie.db');
  backupDatabase(dbPath, path.join(app.getPath('userData'), 'sauvegardes'));
  database.init(dbPath);
  registerHandlers();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
