// Vercel Serverless Function — Push Notification Sender
// Liest FCM-Tokens aus rooms/<room>/fcmTokens und sendet via Firebase Admin SDK.
//
// Setup: env var FIREBASE_SERVICE_ACCOUNT muss den ganzen Service-Account-JSON enthalten.

import admin from 'firebase-admin';

let _initDone = false;
function initAdmin() {
  if (_initDone) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT env var fehlt — bitte in Vercel setzen.');
  }
  let svc;
  try {
    svc = JSON.parse(raw);
  } catch (e) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT ist kein gültiges JSON: ' + e.message);
  }
  admin.initializeApp({
    credential: admin.credential.cert(svc),
    databaseURL: 'https://unsignedworkspace-default-rtdb.europe-west1.firebasedatabase.app',
  });
  _initDone = true;
}

export const config = {
  runtime: 'nodejs',
};

export default async function handler(req, res) {
  // CORS headers — same-origin only for safety
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    initAdmin();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  // Body kann string oder bereits-parsed object sein (je nach Vercel-Runtime)
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};
  const room = (body.room || '').toString();
  const title = (body.title || '').toString().slice(0, 200);
  const text = (body.body || '').toString().slice(0, 500);
  const url = (body.url || '/portal').toString();

  if (!room) {
    return res.status(400).json({ error: 'room fehlt' });
  }
  if (!title) {
    return res.status(400).json({ error: 'title fehlt' });
  }

  let tokens = [];
  try {
    const db = admin.database();
    const snap = await db.ref('rooms/' + room + '/fcmTokens').once('value');
    const v = snap.val() || {};
    tokens = Object.keys(v);
  } catch (e) {
    return res.status(500).json({ error: 'Token-Lookup fehlgeschlagen: ' + e.message });
  }

  if (tokens.length === 0) {
    return res.status(200).json({ sent: 0, reason: 'no tokens' });
  }

  const message = {
    notification: { title: title, body: text },
    webpush: {
      fcmOptions: { link: url },
      notification: {
        icon: '/brand/v-dark.png',
        badge: '/brand/v-dark.png',
        requireInteraction: false,
      },
    },
    data: { url: url },
    tokens: tokens,
  };

  let result;
  try {
    result = await admin.messaging().sendEachForMulticast(message);
  } catch (e) {
    return res.status(500).json({ error: 'Send fehlgeschlagen: ' + e.message });
  }

  // Cleanup invalid tokens
  const invalid = [];
  result.responses.forEach((r, i) => {
    if (!r.success) {
      const code = r.error && r.error.code;
      if (code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-argument' ||
          code === 'messaging/invalid-registration-token') {
        invalid.push(tokens[i]);
      }
    }
  });
  if (invalid.length > 0) {
    try {
      const db = admin.database();
      const updates = {};
      invalid.forEach(function (t) { updates['rooms/' + room + '/fcmTokens/' + t] = null; });
      await db.ref().update(updates);
    } catch (e) {
      // non-fatal
    }
  }

  return res.status(200).json({
    sent: result.successCount,
    failed: result.failureCount,
    invalid: invalid.length,
  });
}
