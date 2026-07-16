// Vercel Serverless Function — KI-Bildgenerierung fürs Moodboard (kostenlos).
//
// POST { room, prompt } → generiert EIN Bild via Pollinations.ai (Flux, gratis, kein
// Key), holt es serverseitig (kein CORS) und legt es PERMANENT in eurem Firebase
// Storage ab (rooms/<room>/design/ai/<id>.jpg). Liefert die Firebase-Download-URL.
// So hängt das gespeicherte Moodboard NICHT von einem Fremddienst ab.
//
// Schutz: per-Raum-Tageslimit (Bild-Gen ist schwerer). Setup: FIREBASE_SERVICE_ACCOUNT
// (schon vorhanden). Anbieter ist hier zentral austauschbar.

import admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';

const BUCKET = 'unsignedworkspace.firebasestorage.app';
const IMG_DAILY_LIMIT = parseInt(process.env.IMG_DAILY_LIMIT, 10) || 30; // pro Raum/Tag

let _fbInit = false;
function initAdmin() {
  if (_fbInit) return true;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return false;
  try {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(raw)),
      databaseURL: 'https://unsignedworkspace-default-rtdb.europe-west1.firebasedatabase.app',
    });
    _fbInit = true;
    return true;
  } catch (e) { return false; }
}

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const room = (body.room || '').toString();
  const prompt = (body.prompt || '').toString().slice(0, 500);
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(room)) return res.status(400).json({ error: 'Ungültiger room.' });
  if (!prompt.trim()) return res.status(400).json({ error: 'Kein Prompt angegeben.' });

  if (!initAdmin()) {
    return res.status(503).json({ error: 'Bild-KI nicht eingerichtet (FIREBASE_SERVICE_ACCOUNT fehlt).' });
  }

  // ── Rate-Limit pro Raum/Tag ──
  try {
    const day = new Date().toISOString().slice(0, 10);
    const ref = admin.database().ref('rooms/' + room + '/_ai/img_' + day);
    const tx = await ref.transaction(function (cur) { return (cur || 0) + 1; });
    const count = (tx && tx.snapshot && tx.snapshot.val()) || 0;
    if (count > IMG_DAILY_LIMIT) {
      return res.status(429).json({ error: 'Tageslimit für KI-Bilder erreicht (' + IMG_DAILY_LIMIT + '). Morgen wieder.' });
    }
  } catch (e) { /* nicht kritisch */ }

  // ── Bild von Pollinations holen (mit Timeout) ──
  let buffer;
  try {
    const seed = Math.floor(Math.random() * 1e6);
    const url = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(prompt) +
      '?width=768&height=768&model=flux&nologo=true&seed=' + seed;
    const ctrl = new AbortController();
    const to = setTimeout(function () { ctrl.abort(); }, 9000);
    let resp;
    try {
      resp = await fetch(url, { signal: ctrl.signal, headers: { accept: 'image/*' } });
    } finally { clearTimeout(to); }
    if (!resp.ok) return res.status(502).json({ error: 'Bild-Dienst: HTTP ' + resp.status });
    const ab = await resp.arrayBuffer();
    buffer = Buffer.from(ab);
    if (!buffer.length) return res.status(502).json({ error: 'Leeres Bild erhalten.' });
  } catch (e) {
    return res.status(504).json({ error: 'Bild-Generierung dauerte zu lange — bitte erneut.' });
  }

  // ── In Firebase Storage ablegen (permanent, eigene URL) ──
  try {
    const token = randomUUID();
    const path = 'rooms/' + room + '/design/ai/' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7) + '.jpg';
    const file = admin.storage().bucket(BUCKET).file(path);
    await file.save(buffer, {
      resumable: false,
      contentType: 'image/jpeg',
      metadata: { contentType: 'image/jpeg', metadata: { firebaseStorageDownloadTokens: token } },
    });
    const dlUrl = 'https://firebasestorage.googleapis.com/v0/b/' + BUCKET +
      '/o/' + encodeURIComponent(path) + '?alt=media&token=' + token;
    return res.status(200).json({ url: dlUrl });
  } catch (e) {
    return res.status(500).json({ error: 'Speichern fehlgeschlagen: ' + e.message });
  }
}
