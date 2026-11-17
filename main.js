const { app, BrowserWindow, ipcMain, safeStorage, Notification, dialog, Menu } = require('electron');
const path = require('path'), fs = require('original-fs'), cp = require('child_process'), crypto = require('crypto'), os = require('os');
const PUB = require('./pubkey'), F = require('./fiscal');
app.setAppUserModelId('ma.cabinet.agendafiscal');
if (!app.requestSingleInstanceLock()) app.quit();

const sha = s => crypto.createHash('sha256').update(s).digest();
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const UI = f => path.join(__dirname, 'ui', f);
let win, alarmWin, alarmItems = [], cache = null, mid = null;

// ---------- ID PC : MachineGuid -> SHA-256 -> XXXX-XXXX ----------
function machineId() {
  if (mid) return mid;
  let g;
  try {
    const o = cp.execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', windowsHide: true });
    g = o.match(/MachineGuid\s+REG_SZ\s+(\S+)/i)[1].toLowerCase();
  } catch { g = os.hostname() + '|' + process.arch; } // repli (moins fort)
  const h = sha(g).toString('hex').toUpperCase();
  return (mid = h.slice(0, 4) + '-' + h.slice(4, 8));
}

// ---------- data.bin chiffré (DPAPI via safeStorage) ----------
const SEED = [
  { id: 's1', nom: 'Atlas Distribution SARL', ice: '001234567000011', couleur: '#1d4ed8', ob: { tva: 'm', delai: 'm', cnss: 1, ir: 1, is: 1, annuel: { bilan: 1, e9421: 1, tp: 1, tsc: 1, timbre: 1, honoraires: 1 }, perso: [] } },
  { id: 's2', nom: 'Sahara Services SA', ice: '002345678000022', couleur: '#059669', ob: { tva: 't', delai: 't', cnss: 1, ir: 1, is: 1, annuel: { bilan: 1, e9421: 1, tp: 1, tsc: 1, timbre: 0, honoraires: 0 }, perso: [] } },
  { id: 's3', nom: 'Rif Négoce SARL AU', ice: '003456789000033', couleur: '#d97706', ob: { tva: 't', delai: null, cnss: 0, ir: 0, is: 1, annuel: { bilan: 1, e9421: 0, tp: 1, tsc: 0, timbre: 0, honoraires: 0 }, perso: [{ nom: 'Déclaration spéciale', per: 'a', jour: 15, mois: 6 }] } }
];
const DB = () => path.join(app.getPath('userData'), 'data.bin');
function load() {
  if (cache) return cache;
  try {
    const b = fs.readFileSync(DB());
    cache = JSON.parse(b[0] === 69 ? safeStorage.decryptString(b.subarray(1)) : b.subarray(1).toString('utf8'));
  } catch { cache = { __meta: {}, societes: null, statuts: {} }; } // illisible (autre PC) => pas de licence
  cache.__meta = cache.__meta || {}; cache.statuts = cache.statuts || {};
  if (!cache.societes) cache.societes = SEED;
  return cache;
}
function save() {
  const j = JSON.stringify(cache), enc = safeStorage.isEncryptionAvailable();
  fs.writeFileSync(DB(), Buffer.concat([Buffer.from(enc ? 'E' : 'P'), enc ? safeStorage.encryptString(j) : Buffer.from(j)]));
}

// ---------- Licence : ECDSA P-256 sur "ID|jours", date masquée par XOR avec SHA-256(ID) ----------
function verify() {
  const d = load(), m = d.__meta;
  try {
    const id = machineId(), b = Buffer.from(m.code || '', 'base64url');
    if (b.length !== 67) return { ok: false, msg: 'Code d’activation invalide.' };
    const h = sha(id), days = ((b[0] ^ h[0]) << 16) | ((b[1] ^ h[1]) << 8) | (b[2] ^ h[2]);
    const ok = crypto.verify('sha256', Buffer.from(`${id}|${days}`), { key: PUB, dsaEncoding: 'ieee-p1363' }, b.subarray(3));
    if (!ok) return { ok: false, msg: 'Code d’activation invalide pour ce PC.' };
    const now = Date.now();
    if (m.last && now < m.last - 7200000) return { ok: false, msg: 'Horloge système modifiée : licence bloquée.' };
    if (Math.floor(now / 864e5) > days) return { ok: false, msg: 'Licence expirée.' };
    if (!m.last || now > m.last) { m.last = now; save(); }
    return { ok: true };
  } catch { return { ok: false, msg: 'Code d’activation invalide.' }; }
}

// ---------- Fenêtres verrouillées ----------
function lock(w) {
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', e => e.preventDefault());
  w.webContents.on('before-input-event', (e, i) => {
    if (i.key === 'F12' || (i.control && i.shift && /^[ijc]$/i.test(i.key)) || (i.control && /^u$/i.test(i.key))) e.preventDefault();
  });
}
const wp = extra => ({ preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: false, ...extra });
const show = () => win.loadFile(UI(verify().ok ? 'app.html' : 'activation.html'));
function mk() {
  win = new BrowserWindow({ width: 1280, height: 800, show: false, autoHideMenuBar: true, title: 'Agenda Fiscal Marocain', webPreferences: wp() });
  lock(win); win.once('ready-to-show', () => win.show()); show();
}
function alarm() {
  if (alarmWin && !alarmWin.isDestroyed()) alarmWin.destroy();
  alarmWin = new BrowserWindow({ width: 540, height: 620, alwaysOnTop: true, autoHideMenuBar: true, title: 'Rappel fiscal', webPreferences: wp({ autoplayPolicy: 'no-user-gesture-required' }) });
  lock(alarmWin); alarmWin.loadFile(UI('alarm.html'));
}

// ---------- IPC protégé : page d'origine + licence valide ----------
const H = (n, page, fn, lic = true) => ipcMain.handle(n, (e, ...a) => {
  if (!e.senderFrame.url.endsWith('/' + page) || (lic && !verify().ok)) throw new Error('Accès refusé');
  return fn(...a);
});
H('lic:id', 'activation.html', () => machineId(), false);
H('lic:activate', 'activation.html', code => {
  const d = load(), old = d.__meta.code;
  d.__meta.code = String(code || '').trim();
  const v = verify();
  if (!v.ok) d.__meta.code = old; else { save(); setTimeout(show, 400); }
  return v;
}, false);
H('vp:get', 'app.html', () => { const { __meta, ...r } = load(); return r; });
H('vp:set', 'app.html', (k, v) => { if (!['societes', 'statuts'].includes(k)) throw new Error('Clé interdite'); load()[k] = v; save(); return true; });
H('ech:list', 'app.html', () => { const d = load(); return F.echeances(d.societes, new Date()).map(e => ({ ...e, etat: (d.statuts[e.key] || {}).etat })); });
H('ech:decl', 'app.html', (k, b) => {
  const d = load(), s = d.statuts[k] = d.statuts[k] || {};
  if (b) { s.etat = 'declare'; delete s.snooze; } else delete s.etat;
  save(); return true;
});
H('exp:pdf', 'app.html', async () => {
  const r = await dialog.showSaveDialog(win, { defaultPath: 'Agenda-Fiscal.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (r.canceled) return false;
  fs.writeFileSync(r.filePath, await win.webContents.printToPDF({ landscape: true, printBackground: true })); return true;
});
H('exp:csv', 'app.html', async rows => {
  const r = await dialog.showSaveDialog(win, { defaultPath: 'Echeances.csv', filters: [{ name: 'Excel (CSV)', extensions: ['csv'] }] });
  if (r.canceled) return false;
  fs.writeFileSync(r.filePath, '\ufeff' + rows.map(x => x.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(';')).join('\r\n')); return true;
});
H('alarm:list', 'alarm.html', () => alarmItems);
const snoozeTs = t => {
  if (t === '1h') return Date.now() + 36e5;
  const n = new Date(), d = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 9);
  if (t === 'lundi') while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  return d.getTime();
};
H('alarm:act', 'alarm.html', (k, t) => {
  const d = load(), s = d.statuts[k] = d.statuts[k] || {};
  if (t === 'ok') { s.etat = 'declare'; delete s.snooze; } else s.snooze = snoozeTs(t);
  save(); alarmItems = alarmItems.filter(x => x.key !== k);
  if (!alarmItems.length && alarmWin && !alarmWin.isDestroyed()) setTimeout(() => alarmWin.close(), 300);
  if (win && !win.isDestroyed() && win.webContents.getURL().endsWith('app.html')) win.webContents.reload();
  return alarmItems;
});

// ---------- Rappels : 3 jours avant à 9h, jour J, puis chaque jour 9h jusqu'à "Déclaré" ----------
function tick() {
  if (!verify().ok) return;
  const n = new Date(); if (n.getHours() < 9) return;
  const d = load(), today = iso(n), fire = [];
  for (const e of F.echeances(d.societes, n)) {
    const s = d.statuts[e.key] || {}; if (s.etat === 'declare') continue;
    const left = F.diff(e.date, today);
    if (s.snooze) { if (Date.now() >= s.snooze) fire.push(e); }
    else if ((left === 3 || left <= 0) && s.last !== today) fire.push(e);
  }
  if (!fire.length) return;
  for (const e of fire) { const s = d.statuts[e.key] = d.statuts[e.key] || {}; delete s.snooze; s.last = today; }
  save();
  alarmItems = fire.concat(alarmItems.filter(a => !fire.some(f => f.key === a.key)));
  new Notification({ title: 'Agenda Fiscal – Échéance', body: fire.slice(0, 3).map(e => `${e.nom} : ${e.label} (${e.date})`).join('\n'), silent: true }).show();
  alarm();
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  if (app.isPackaged) { // intégrité de app.asar
    try {
      const h = crypto.createHash('sha256').update(fs.readFileSync(app.getAppPath())).digest('hex');
      if (h !== fs.readFileSync(path.join(process.resourcesPath, 'app.sha256'), 'utf8').trim()) throw 0;
    } catch { dialog.showErrorBox('Agenda Fiscal', 'Integrity check failed'); return app.quit(); }
    app.setLoginItemSettings({ openAtLogin: true });
  }
  load(); mk();
  setInterval(() => { // re-vérification toutes les 5 minutes
    if (!verify().ok) {
      if (alarmWin && !alarmWin.isDestroyed()) alarmWin.destroy();
      if (win && win.webContents.getURL().endsWith('app.html')) show();
    }
  }, 300000);
  setInterval(tick, 60000); setTimeout(tick, 5000);
});
app.on('window-all-closed', () => app.quit());
