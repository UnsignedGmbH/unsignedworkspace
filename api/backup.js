// Vercel Serverless Function — RTDB-Backup (automatisch via Cron + Admin-Download).
//
// GET  /api/backup            → CRON (Vercel). Auth: Header "Authorization: Bearer <CRON_SECRET>".
//                               Liest die KOMPLETTE RTDB und legt sie als JSON-Snapshot in
//                               Firebase Storage ab (backups/rtdb/<zeitstempel>.json), löscht
//                               danach Snapshots älter als BACKUP_RETENTION_DAYS.
//                               Antwort: { ok, path, bytes, pruned, ts }.
// GET  /api/backup?status=1   → OWNER. Auth: Bearer <Firebase-ID-Token> eines Admins.
//                               Liefert Meta zum letzten Backup (Frische), OHNE Daten.
// POST /api/backup            → OWNER-DOWNLOAD. Auth: Bearer <Firebase-ID-Token> eines Admins.
//                               Erzeugt ein frisches Backup, legt es ab UND liefert das JSON
//                               als Datei-Download zurück (Off-Site-Kopie auf das Gerät).
//
// WICHTIG: Backups enthalten ALLE Kundendaten. Sie werden OHNE öffentlichen Download-Token
// abgelegt → nur über das Admin-SDK / die Firebase-Console / diesen (auth-geschützten)
// Endpoint erreichbar. Niemals einen firebaseStorageDownloadTokens setzen.

import admin from 'firebase-admin';

const BUCKET = 'unsignedworkspace.firebasestorage.app';
const DB_URL = 'https://unsignedworkspace-default-rtdb.europe-west1.firebasedatabase.app';
const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS, 10) || 30;

let _init = false;
let _initErr = null;
function initAdmin() {
  if (_init) return true;
  if (_initErr) return false;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) { _initErr = new Error('FIREBASE_SERVICE_ACCOUNT fehlt'); return false; }
  try {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(raw)),
      databaseURL: DB_URL,
    });
    _init = true;
    return true;
  } catch (e) { _initErr = e; return false; }
}

export const config = { runtime: 'nodejs', maxDuration: 60 };

// Konstantzeit-Vergleich (kein früher Abbruch → kein Timing-Leak beim Secret-Check).
function safeEqual(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

// Kern: ganze DB lesen (Admin-SDK umgeht die Rules) und als JSON in Storage ablegen.
async function runBackup() {
  const db = admin.database();
  const readP = db.ref('/').once('value');
  let timer;
  const timeout = new Promise(function (_, rej) {
    timer = setTimeout(function () { rej(new Error('db-timeout-45s')); }, 45000);
  });
  let snap;
  try {
    snap = await Promise.race([readP, timeout]);
  } finally {
    clearTimeout(timer);
  }
  const data = snap.val();
  const buf = Buffer.from(JSON.stringify(data == null ? {} : data), 'utf8');

  const iso = new Date().toISOString();
  const stamp = iso.replace(/[:.]/g, '-'); // 2026-07-16T12-30-00-000Z
  const path = 'backups/rtdb/' + stamp + '.json';

  const file = admin.storage().bucket(BUCKET).file(path);
  await file.save(buf, {
    resumable: false,
    contentType: 'application/json',
    metadata: {
      contentType: 'application/json',
      cacheControl: 'no-store',
      // Eigene Meta, damit die Frische-Anzeige nicht vom Namen parsen muss.
      metadata: { ts: iso, bytes: String(buf.length) },
    },
  });

  return { path: path, bytes: buf.length, buffer: buf, ts: iso };
}

// Snapshots älter als RETENTION_DAYS löschen. Fehler hier sind nicht kritisch.
async function pruneOld() {
  const bucket = admin.storage().bucket(BUCKET);
  const res = await bucket.getFiles({ prefix: 'backups/rtdb/' });
  const files = res[0] || [];
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let pruned = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!f.name.endsWith('.json')) continue;
    // Tag aus dem Namen: backups/rtdb/2026-07-16T...
    const m = f.name.match(/rtdb\/(\d{4}-\d{2}-\d{2})T/);
    if (!m) continue;
    const day = Date.parse(m[1] + 'T00:00:00Z');
    if (!isNaN(day) && day < cutoff) {
      try { await f.delete(); pruned++; } catch (e) { /* egal */ }
    }
  }
  return pruned;
}

// Meta zum jüngsten Backup (für die Frische-Anzeige im Dashboard).
async function latestInfo() {
  const bucket = admin.storage().bucket(BUCKET);
  const res = await bucket.getFiles({ prefix: 'backups/rtdb/' });
  const files = (res[0] || []).filter(function (f) { return f.name.endsWith('.json'); });
  // Namen enthalten einen sortierbaren ISO-Zeitstempel → alphabetisch = chronologisch.
  files.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
  const latest = files[files.length - 1];
  let info = null;
  if (latest) {
    const md = latest.metadata || {};
    const custom = md.metadata || {};
    info = {
      ts: md.timeCreated || custom.ts || null,
      bytes: md.size ? parseInt(md.size, 10) : (custom.bytes ? parseInt(custom.bytes, 10) : null),
    };
  }
  return { count: files.length, latest: info, retentionDays: RETENTION_DAYS };
}

// ID-Token prüfen + Admin-Status. Gibt uid zurück oder wirft (mit .code).
async function requireAdmin(bearer) {
  if (!bearer) { const e = new Error('kein Token'); e.code = 401; throw e; }
  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(bearer);
  } catch (x) { const e = new Error('Token ungültig'); e.code = 401; throw e; }
  let isAdmin = false;
  try {
    const s = await admin.database().ref('admins/' + decoded.uid).once('value');
    isAdmin = s.val() === true;
  } catch (x) { /* isAdmin bleibt false */ }
  if (!isAdmin) { const e = new Error('Nur Admins dürfen Backups verwalten.'); e.code = 403; throw e; }
  return decoded.uid;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!initAdmin()) {
    return res.status(503).json({ error: 'Backup nicht eingerichtet (FIREBASE_SERVICE_ACCOUNT fehlt).' });
  }

  const authz = req.headers.authorization || '';
  const bearer = authz.indexOf('Bearer ') === 0 ? authz.slice(7) : '';
  const isStatus = /[?&]status=/.test(req.url || '');

  // ── GET ?status=1 → Owner-Frische-Abfrage ──
  if (req.method === 'GET' && isStatus) {
    try {
      await requireAdmin(bearer);
    } catch (e) {
      return res.status(e.code || 401).json({ error: e.message });
    }
    try {
      const info = await latestInfo();
      return res.status(200).json(info);
    } catch (e) {
      return res.status(500).json({ error: 'Status fehlgeschlagen: ' + e.message });
    }
  }

  // ── GET → Cron (Vercel schickt Authorization: Bearer <CRON_SECRET>) ──
  if (req.method === 'GET') {
    const secret = process.env.CRON_SECRET;
    if (!secret || !safeEqual(bearer, secret)) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    try {
      const r = await runBackup();
      let pruned = 0;
      try { pruned = await pruneOld(); } catch (e) { /* nicht kritisch */ }
      return res.status(200).json({ ok: true, path: r.path, bytes: r.bytes, pruned: pruned, ts: r.ts });
    } catch (e) {
      return res.status(500).json({ error: 'Backup fehlgeschlagen: ' + e.message });
    }
  }

  // ── POST → Owner-Download (frisches Backup ablegen + als Datei zurückgeben) ──
  if (req.method === 'POST') {
    try {
      await requireAdmin(bearer);
    } catch (e) {
      return res.status(e.code || 401).json({ error: e.message });
    }
    try {
      const r = await runBackup();
      try { await pruneOld(); } catch (e) { /* nicht kritisch */ }
      const fname = 'unsigned-backup-' + r.ts.slice(0, 10) + '.json';
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="' + fname + '"');
      res.setHeader('X-Backup-Path', r.path);
      res.setHeader('X-Backup-Bytes', String(r.bytes));
      res.status(200);
      return res.end(r.buffer);
    } catch (e) {
      return res.status(500).json({ error: 'Backup fehlgeschlagen: ' + e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
