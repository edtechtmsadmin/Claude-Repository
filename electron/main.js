// Desktop shell: runs the app offline and gives it real Save / Open-in-Excel.
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'Phil-IRI Recorder',
    backgroundColor: '#f1f4f2',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'app', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function filters(name) {
  const ext = path.extname(name).slice(1).toLowerCase();
  const map = { xlsx: 'Excel workbook', zip: 'Zip archive', json: 'Backup file' };
  return [{ name: map[ext] || 'File', extensions: [ext || '*'] }];
}

function uniquePath(dir, name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let p = path.join(dir, name);
  for (let i = 2; fs.existsSync(p); i++) p = path.join(dir, `${base} (${i})${ext}`);
  return p;
}

ipcMain.handle('save-file', async (event, name, bytes) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const res = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('documents'), name),
    filters: filters(name),
  });
  if (res.canceled || !res.filePath) return null;
  fs.writeFileSync(res.filePath, Buffer.from(bytes));
  return res.filePath;
});

// Save into Documents\Phil-IRI Recorder and open with the default program (Excel)
ipcMain.handle('open-in-excel', async (event, name, bytes) => {
  const dir = path.join(app.getPath('documents'), 'Phil-IRI Recorder');
  fs.mkdirSync(dir, { recursive: true });
  const file = uniquePath(dir, name);
  fs.writeFileSync(file, Buffer.from(bytes));
  const err = await shell.openPath(file);
  return err ? null : file;
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
