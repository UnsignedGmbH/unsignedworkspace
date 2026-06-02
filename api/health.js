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
    return res.status(200).json({ status: 'ok', firebase: 'ok', ts });
  } catch (e) {
    return res.status(503).json({
      status: 'degraded',
      firebase: 'error',
      error: e.message,
      ts,
    });
  }
}
