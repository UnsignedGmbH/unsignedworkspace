// Vercel Serverless Function — Health-Check für Uptime-Monitoring (z.B. UptimeRobot).
//
// GET /api/health
//   200 { status:'ok',        firebase:'ok'|'unconfigured', ts }  → Seite + (ggf.) DB erreichbar
//   503 { status:'degraded',  firebase:'error', error, ts }       → Firebase konfiguriert, aber nicht erreichbar
//
// Die Firebase-Prüfung ist bewusst GRACEFUL: solange das env var
// FIREBASE_SERVICE_ACCOUNT noch nicht gesetzt ist, meldet der Endpoint trotzdem 200
// (firebase:'unconfigured') — so löst ein frisch eingerichteter Uptime-Monitor keinen
// Fehlalarm aus. Sobald das Service-Account gesetzt ist, schlägt ein echter DB-Ausfall
// als 503 durch.

import admin from 'firebase-admin';

const BUCKET = 'unsignedworkspace.firebasestorage.app';
// Ab wann gilt das letzte Backup als "überfällig"? (Cron läuft täglich → 48h Puffer.)
const BACKUP_STALE_HOURS = parseInt(process.env.BACKUP_STALE_HOURS, 10) || 48;

let _initDone = false;
let _initError = null;
function initAdmin() {
  if (_initDone) return true;
  if (_initError) return false;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return false; // nicht konfiguriert — graceful
  try {
    const svc = JSON.parse(raw);
    admin.initializeApp({
      credential: admin.credential.cert(svc),
      databaseURL: 'https://unsignedworkspace-default-rtdb.europe-west1.firebasedatabase.app',
    });
    _initDone = true;
    return true;
  } catch (e) {
    _initError = e;
    return false;
  }
}

export const config = {
  runtime: 'nodejs',
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ts = new Date().toISOString();

  // Firebase nicht konfiguriert → Seite lebt, DB-Check übersprungen.
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    return res.status(200).json({ status: 'ok', firebase: 'unconfigured', ts });
  }
  if (!initAdmin()) {
    // Service-Account gesetzt, aber ungültiges JSON o.ä. → echter Fehler.
    return res.status(503).json({
      status: 'degraded',
      firebase: 'error',
      error: (_initError && _initError.message) || 'init failed',
      ts,
    });
  }

  // Billiger Reachability-Check: ein winziger, nicht existierender Pfad → liefert null,
  // lädt keine Nutzdaten. Mit 5s-Timeout gegen hängende Verbindungen.
  try {
    const probe = admin.database().ref('health/_ping').once('value');
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('db-timeout-5s')), 5000)
    );
    await Promise.race([probe, timeout]);
  } catch (e) {
    return res.status(503).json({
      status: 'degraded',
      firebase: 'error',
      error: e.message,
      ts,
    });
  }

  // Standard-Ping (UptimeRobot): schnell, nur Firebase-Erreichbarkeit.
  if (!/[?&]full=/.test(req.url || '')) {
    return res.status(200).json({ status: 'ok', firebase: 'ok', ts });
  }

  // ?full=1 → zusätzlich Storage + Backup-Frische prüfen (optionaler zweiter Monitor,
  // der Alarm schlägt, wenn die nächtlichen Backups ausbleiben). Nur unkritische Meta,
  // keine Dateinamen/Daten in der Antwort.
  let storage = 'ok';
  let backup = 'ok';
  let backupAgeH = null;
  try {
    const listed = await admin.storage().bucket(BUCKET).getFiles({ prefix: 'backups/rtdb/' });
    const files = (listed[0] || []).filter((f) => f.name.endsWith('.json'));
    if (files.length === 0) {
      backup = 'none'; // frisch eingerichtet — noch kein Backup, kein Alarm
    } else {
      files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      const md = files[files.length - 1].metadata || {};
      const t = Date.parse(md.timeCreated || (md.metadata && md.metadata.ts) || '');
      if (!isNaN(t)) {
        backupAgeH = Math.round((Date.now() - t) / 3600000);
        if (backupAgeH > BACKUP_STALE_HOURS) backup = 'stale';
      }
    }
  } catch (e) {
    storage = 'error';
  }

  const degraded = storage === 'error' || backup === 'stale';
  return res.status(degraded ? 503 : 200).json({
    status: degraded ? 'degraded' : 'ok',
    firebase: 'ok',
    storage,
    backup,
    backupAgeH,
    ts,
  });
}
