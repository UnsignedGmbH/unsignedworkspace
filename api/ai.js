// Vercel Serverless Function — KI-Agent (Groq, kostenloses Kontingent).
//
// Nimmt einen Freitext-Befehl + den aktuellen Tool-Zustand entgegen und liefert eine
// Liste von OPERATIONEN (add/update/delete) zurück, die der Client anwendet. Der
// API-Key liegt ausschließlich serverseitig (env GROQ_API_KEY).
//
// Groq ist OpenAI-API-kompatibel (chat/completions, JSON-Modus). Gratis-Kontingent
// ist verlässlich verfügbar (kein Region-/„limit 0"-Theater wie bei Gemini).
//
// Sicherheit/Kosten: per-Raum-Tageslimit (Kunden dürfen die KI auslösen) + max_tokens.
// Single-Turn (kein autonomer Loop) → planbar, bleibt unter Vercel-Timeout.
//
// Setup: env vars in Vercel:
//   GROQ_API_KEY   (Pflicht)  — kostenloser Key von console.groq.com
//   GROQ_MODEL     (optional) — Default unten. Bei "model not found" eine gültige
//                               ID aus der Groq-Console setzen.
//   FIREBASE_SERVICE_ACCOUNT  — schon vorhanden (für das Rate-Limit)

import admin from 'firebase-admin';

const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const MAX_TOKENS = 2000;
const DAILY_LIMIT = parseInt(process.env.AI_DAILY_LIMIT, 10) || 25; // pro Raum pro Tag

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
  } catch (e) {
    return false;
  }
}

// ── Prompt-Templates pro Tool (bleiben serverseitig) ──────────────────────────
function systemPromptFor(tool) {
  if (tool === 'content') {
    return [
      'Du bist ein Content-Strategie-Assistent für Fashion-/Streetwear-Brands und arbeitest',
      'INNERHALB eines Tools. Du antwortest AUSSCHLIESSLICH auf Deutsch und gibst NUR ein',
      'einziges JSON-Objekt zurück — keinen Fließtext, keine Markdown-Codeblöcke.',
      '',
      'Datenmodell:',
      'STRATEGIE-Felder: richtung, nische, ueberthemen, story, accountTyp',
      '  (accountTyp ist Pipe-getrennt aus: "Personal Brand|Brand Account|Ads"),',
      '  variation, werblichkeit, hooks (mehrere Hooks je eigene Zeile),',
      '  creator_ugc, creator_mikro, creator_inf. Optional "name" (kurzer Titel).',
      'VIDEO-Felder: title, videoTyp ("Personal Brand"|"Brand Account"|"Ads"|',
      '  "Content Creator / Influencer"), hook, idee (= Skript/Idee), link, status',
      '  ("Idee"|"In Arbeit"|"Gedreht"|"Live"). Neue Videos: status="Idee".',
      '',
      'Erlaubte Operationen (op):',
      '  {"op":"add_strategy","data":{...Strategie-Felder...}}',
      '  {"op":"update_strategy","id":"<vorhandene id>","data":{...nur zu ändernde Felder...}}',
      '  {"op":"delete_strategy","id":"<vorhandene id>"}',
      '  {"op":"add_video","data":{...Video-Felder...}}',
      '  {"op":"update_video","id":"<vorhandene id>","data":{...}}',
      '  {"op":"delete_video","id":"<vorhandene id>"}',
      '',
      'Antwortformat exakt (JSON):',
      '{"summary":"<1 kurzer Satz, was du gemacht hast>","operations":[ ...Operationen... ]}',
      '',
      'Regeln: Beziehe dich bei update/delete NUR auf ids, die im State vorkommen.',
      'Erfinde keine ids. Halte Texte konkret, praxistauglich und im Brand-Ton.',
      'Wenn der Befehl unklar ist, mache den sinnvollsten kleinen Schritt und erkläre ihn in "summary".',
    ].join('\n');
  }
  return 'Antworte ausschließlich mit einem JSON-Objekt {"summary":"","operations":[]}.';
}

function buildUserMessage(instruction, state, brand) {
  const parts = [];
  if (brand && Object.keys(brand).length) {
    parts.push('BRAND-KONTEXT:\n' + JSON.stringify(brand).slice(0, 4000));
  }
  parts.push('AKTUELLER ZUSTAND (ids + Kurzfelder):\n' + JSON.stringify(state || {}).slice(0, 8000));
  parts.push('BEFEHL DES NUTZERS:\n' + String(instruction || '').slice(0, 2000));
  return parts.join('\n\n');
}

function extractJson(text) {
  if (!text) return null;
  let t = String(text).trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  try { return JSON.parse(t); } catch (e) { return null; }
}

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'KI noch nicht eingerichtet (GROQ_API_KEY fehlt).' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const room = (body.room || '').toString();
  const tool = (body.tool || 'content').toString();
  const instruction = (body.instruction || '').toString();
  if (!room) return res.status(400).json({ error: 'room fehlt' });
  if (!instruction.trim()) return res.status(400).json({ error: 'Kein Befehl angegeben.' });

  // ── Rate-Limit pro Raum/Tag ────────────────────────────────────────────────
  if (initAdmin()) {
    try {
      const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const ref = admin.database().ref('rooms/' + room + '/_ai/' + day);
      const tx = await ref.transaction(function (cur) { return (cur || 0) + 1; });
      const count = (tx && tx.snapshot && tx.snapshot.val()) || 0;
      if (count > DAILY_LIMIT) {
        return res.status(429).json({
          error: 'Tageslimit für KI in diesem Raum erreicht (' + DAILY_LIMIT + '). Morgen wieder verfügbar.',
        });
      }
    } catch (e) { /* Limit nicht kritisch — im Zweifel durchlassen */ }
  }

  // ── Groq-Call (OpenAI-kompatibel, JSON-Modus) ───────────────────────────────
  let apiJson;
  try {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.7,
        max_tokens: MAX_TOKENS,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPromptFor(tool) },
          { role: 'user', content: buildUserMessage(instruction, body.state, body.brand) },
        ],
      }),
    });
    apiJson = await resp.json();
    if (!resp.ok) {
      const msg = (apiJson && apiJson.error && (apiJson.error.message || apiJson.error)) || ('HTTP ' + resp.status);
      return res.status(502).json({ error: 'KI-Dienst: ' + msg });
    }
  } catch (e) {
    return res.status(502).json({ error: 'KI nicht erreichbar: ' + e.message });
  }

  let text = '';
  try {
    text = apiJson && apiJson.choices && apiJson.choices[0] &&
      apiJson.choices[0].message && apiJson.choices[0].message.content;
  } catch (e) {}

  const parsed = extractJson(text);
  if (!parsed || !Array.isArray(parsed.operations)) {
    return res.status(502).json({ error: 'KI-Antwort konnte nicht verarbeitet werden.' });
  }

  return res.status(200).json({
    summary: (parsed.summary || '').toString().slice(0, 400),
    operations: parsed.operations.slice(0, 30),
  });
}
