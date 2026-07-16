// Vercel Serverless Function — schickt dem Kunden seinen persönlichen Portal-Link
// per E-Mail (Recovery), damit er seinen Zugang von jedem Gerät behält und nicht
// jedes Mal beim Owner nachfragen muss.
//
// POST { room, email } → mailt den Link via Resend (REST, kein npm-Paket) und legt
// die E-Mail unter rooms/<room>/contact ab (Kontakt für den Owner).
//
// Setup (siehe docs/email-setup.md): FIREBASE_SERVICE_ACCOUNT (schon da),
// RESEND_API_KEY, MAIL_FROM (verifizierte Absender-Domain). Ohne Key meldet die
// Function sauber "noch nicht eingerichtet" — der Button im Portal bleibt nutzbar.

import admin from 'firebase-admin';

const LINK_DAILY_LIMIT = parseInt(process.env.LINK_DAILY_LIMIT, 10) || 5; // pro Raum/Tag
const FALLBACK_HOST = 'unsignedworkspace.vercel.app';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const room = (body.room || '').toString().trim();
  const email = (body.email || '').toString().trim();
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(room)) return res.status(400).json({ error: 'Ungültiger room.' });
  if (!EMAIL_RE.test(email) || email.length > 200) {
    return res.status(400).json({ error: 'Bitte eine gültige E-Mail-Adresse eingeben.' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'E-Mail-Versand ist noch nicht eingerichtet.' });
  }
  if (!initAdmin()) {
    return res.status(503).json({ error: 'E-Mail-Versand nicht verfügbar (Server-Config fehlt).' });
  }

  // ── Rate-Limit pro Raum/Tag (Anti-Spam) ──
  try {
    const day = new Date().toISOString().slice(0, 10);
    const ref = admin.database().ref('rooms/' + room + '/_email/link_' + day);
    const tx = await ref.transaction(function (cur) { return (cur || 0) + 1; });
    const count = (tx && tx.snapshot && tx.snapshot.val()) || 0;
    if (count > LINK_DAILY_LIMIT) {
      return res.status(429).json({ error: 'Tageslimit für E-Mails erreicht (' + LINK_DAILY_LIMIT + '). Morgen wieder.' });
    }
  } catch (e) { /* nicht kritisch */ }

  // ── Portal-Link aus dem Request ableiten (funktioniert auf Preview + Prod) ──
  const host = (req.headers['x-forwarded-host'] || req.headers.host || FALLBACK_HOST).toString();
  const link = 'https://' + host + '/portal?room=' + encodeURIComponent(room);
  const from = process.env.MAIL_FROM || 'Unsigned Workspace <portal@unsigned-global.com>';

  const text =
    'Hey,\n\nhier ist dein persönlicher Zugang zu deinem Unsigned-Workspace:\n\n' +
    link + '\n\nDein Zugangs-Code: ' + room + '\n\n' +
    'Tipp: Speichere dir diese Mail oder den Link als Lesezeichen — dann kommst du ' +
    'von jedem Gerät wieder rein. Auf dem Handy kannst du die Seite auch über ' +
    '"Teilen → Zum Home-Bildschirm" als App installieren.\n\n— Unsigned';
  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;color:#111">' +
    '<h2 style="font-size:18px;margin:0 0 12px">Dein Zugang zu Unsigned</h2>' +
    '<p style="font-size:14px;line-height:1.5;color:#333">Hier ist dein persönlicher Link zu deinem Workspace. ' +
    'Speichere dir diese Mail — dann kommst du von <b>jedem Gerät</b> wieder rein.</p>' +
    '<p style="margin:18px 0"><a href="' + esc(link) + '" style="background:#c13030;color:#fff;' +
    'text-decoration:none;font-weight:bold;font-size:15px;padding:12px 20px;border-radius:10px;display:inline-block">' +
    'Zu meinem Workspace →</a></p>' +
    '<p style="font-size:13px;color:#555">Dein Zugangs-Code: <b style="letter-spacing:1px">' + esc(room) + '</b></p>' +
    '<p style="font-size:12px;color:#888;line-height:1.5">Tipp: Auf dem Handy über „Teilen → Zum Home-Bildschirm" ' +
    'als App installieren. Link: <br><span style="color:#555">' + esc(link) + '</span></p>' +
    '<p style="font-size:12px;color:#aaa;margin-top:18px">— Unsigned Workspace</p>' +
    '</div>';

  // ── Senden via Resend REST ──
  try {
    const ctrl = new AbortController();
    const to = setTimeout(function () { ctrl.abort(); }, 9000);
    let resp;
    try {
      resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: from, to: [email], subject: 'Dein Zugang zu deinem Unsigned-Workspace', html: html, text: text }),
      });
    } finally { clearTimeout(to); }

    if (!resp.ok) {
      let detail = '';
      try { const j = await resp.json(); detail = (j && (j.message || j.error || j.name)) || ''; } catch (e) {}
      // Häufigster Fall: Absender-Domain nicht verifiziert.
      return res.status(502).json({
        error: 'E-Mail konnte nicht gesendet werden' + (detail ? (': ' + detail) : '') +
          '. (Tipp: Absender-Domain in Resend verifizieren.)',
      });
    }
  } catch (e) {
    return res.status(504).json({ error: 'E-Mail-Versand dauerte zu lange — bitte erneut.' });
  }

  // ── E-Mail als Kontakt unter dem Raum ablegen (für den Owner) ──
  try {
    await admin.database().ref('rooms/' + room + '/contact').update({
      email: email,
      ts: admin.database.ServerValue.TIMESTAMP,
    });
  } catch (e) { /* nicht kritisch */ }

  return res.status(200).json({ ok: true });
}
