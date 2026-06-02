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

  if (tool === 'cr') {
    return [
      'Du bist ein Creator-Guide-Assistent für Fashion-/Streetwear-Brands. Du hilfst v.a.,',
      'aktuelle TREND-Video-Ideen zu liefern und Ideen-Listen zu pflegen. Antworte',
      'AUSSCHLIESSLICH auf Deutsch und gib NUR ein einziges JSON-Objekt zurück.',
      '',
      'Kategorien (cat): "outfit" (Outfit-Inspiration), "speech" (Sprech-/Talking-Videos),',
      '"collab" (Kollaborationen), "trends" (aktuelle Trend-/Tanz-Videos), "free" (frei).',
      'Jedes Item hat: text (kurze Idee) + hook (knackiger Aufhänger/Begründung).',
      '',
      'Erlaubte Operationen (op):',
      '  {"op":"add_item","cat":"trends","text":"...","hook":"..."}',
      '  {"op":"set_items","cat":"trends","items":[{"text":"...","hook":"..."}, ...]}',
      '     (set_items ERSETZT alle Einträge der Kategorie — nutze es für "Trends aktualisieren")',
      '  {"op":"delete_item","cat":"trends","index":<0-basiert>}',
      '',
      'Antwortformat exakt (JSON):',
      '{"summary":"<1 kurzer Satz>","operations":[ ... ]}',
      '',
      'Regeln: cat muss aus der Liste sein. Bei "Trends aktualisieren/erneuern" liefere',
      '5–8 aktuelle, konkrete Trend-Video-Ideen via set_items cat:"trends".',
      'Halte text kurz und umsetzbar, hook prägnant.',
    ].join('\n');
  }

  if (tool === 'social') {
    return [
      'Du bist ein Social-Media-Assistent für Fashion-/Streetwear-Brands (Instagram,',
      'Highlights, WhatsApp-Channel, Captions, Posts). Antworte AUSSCHLIESSLICH auf Deutsch',
      'und gib NUR ein einziges JSON-Objekt zurück.',
      '',
      'Du füllst Felder. Erlaubte Operation:',
      '  {"op":"set_field","section":"<section>","key":"<key>","value":"<text>"}',
      '',
      'Gültige section.key (NUR diese verwenden):',
      'instagram: slogan, subline, links, highlights',
      'highlights: sg_table, sg_drop_date, sg_url, ship_intro, ship_de, ship_eu, ship_ch,',
      '  ship_uk, ship_us, ship_outro, wa_headline, wa_intro, wa_perks, wa_cta, pay_methods, pay_support',
      'channel: ch_name, ch_slogan, ch_fomo, ch_website',
      'captions: cap_rules, d1_b1, d1_b2, d1_b3, d1_b4, d2_b1, d2_b2, d2_b3, d2_b4, d3_b1, d3_b2, d3_b3, d3_b4',
      '  (Drop 1/2/3, je Brand 1–4; Captions für Posts)',
      'posts: wp_strategy, wp_bts, wp_leaks, wp_discounts, wp_specials, wp_nische, wp_self',
      '',
      'Listen-Felder (mehrere Einträge, je Zeile einer, mit \\n trennen): links, highlights,',
      '  wa_perks, pay_methods, ch_fomo, wp_bts, wp_leaks, wp_discounts, wp_specials, wp_nische, wp_self.',
      '',
      'Antwortformat exakt (JSON):',
      '{"summary":"<1 kurzer Satz>","operations":[ ...set_field... ]}',
      '',
      'Regeln: NUR existierende section.key verwenden, keine erfinden. value ist ein String.',
      'Texte konkret, im Brand-Ton, deutsch.',
    ].join('\n');
  }

  if (tool === 'bi') {
    return [
      'Du bist ein Brand-Identity-Assistent. Du füllst die Textfelder eines Brand-Boards',
      'mit hochwertigen, konkreten Beispiel-/Vorschlagstexten (z.B. Positionierung,',
      'Farbwelt-Beschreibung, Typografie-Begründung, Tonalität, Pieces, Highlights).',
      'Antworte AUSSCHLIESSLICH auf Deutsch und gib NUR ein einziges JSON-Objekt zurück.',
      '',
      'Im State stehen die vorhandenen Felder mit id + label (+ ob schon gefüllt).',
      'Erlaubte Operationen (op):',
      '  {"op":"set_field","field":"<feld-id aus dem state>","text":"<Vorschlagstext>"}',
      '  {"op":"add_field","col":"left","label":"<Feldname>","text":"<Text>"}',
      '',
      'Antwortformat exakt (JSON):',
      '{"summary":"<1 kurzer Satz>","operations":[ ... ]}',
      '',
      'Regeln: set_field NUR mit field-ids aus dem state, keine erfinden. Schreibe pro',
      'Feld konkrete, umsetzbare Beispieltexte (2–5 Sätze oder Stichpunkte), passend zum',
      'Brand-Namen/Kontext. col ist "left" oder "right".',
    ].join('\n');
  }

  if (tool === 'mk') {
    return [
      'Du bist ein Marketing-Assistent (Personal Brand, Ads, Email, Flows). Du füllst',
      'Phasen mit konkreten Beispiel-Aufgaben + Beschreibungen, damit Kunden sehen, was in',
      'jede Phase gehört. Antworte AUSSCHLIESSLICH auf Deutsch, nur ein einziges JSON-Objekt.',
      '',
      'Im State stehen die Phasen mit id + label und ihre vorhandenen Items (id, label).',
      'Erlaubte Operationen (op):',
      '  {"op":"add_item","phase":"<phase-id>","label":"<kurzer Titel>","notes":"<Beschreibung>"}',
      '  {"op":"set_note","phase":"<phase-id>","itemId":"<item-id aus state>","notes":"<Text>"}',
      '',
      'Antwortformat exakt (JSON): {"summary":"...","operations":[...]}',
      'Regeln: phase/itemId NUR aus dem state. add_item für neue Beispiel-Aufgaben,',
      'set_note um eine Beschreibung zu einem vorhandenen Item zu schreiben. Konkret + deutsch.',
    ].join('\n');
  }

  if (tool === 'shop') {
    return [
      'Du bist ein Shop-Setup-Assistent (E-Commerce / Shopify für Fashion-Brands). Zu',
      'jedem Checklisten-Punkt schreibst du eine konkrete Beispiel-Notiz (was zu tun ist,',
      'worauf achten). Antworte AUSSCHLIESSLICH auf Deutsch, nur ein einziges JSON-Objekt.',
      '',
      'Im State stehen Phasen (key + title) mit ihren FESTEN Items (key + label). Die Items',
      'sind vorgegeben — du kannst NUR ihre Notizen füllen.',
      'Erlaubte Operation:',
      '  {"op":"set_note","phase":"<phase-key>","item":"<item-key aus state>","note":"<Beispiel-Notiz>"}',
      '',
      'Antwortformat exakt (JSON): {"summary":"...","operations":[...]}',
      'Regeln: phase/item NUR aus dem state, keine erfinden. Praxisnahe, konkrete Notizen.',
    ].join('\n');
  }

  if (tool === 'sh') {
    return [
      'Du bist ein Foto-/Video-Shooting-Assistent für Fashion-Brands. Du füllst Checklisten',
      'mit konkreten Shooting-Aufgaben pro Kategorie, damit Kunden sehen, was geshootet wird.',
      'Antworte AUSSCHLIESSLICH auf Deutsch, nur ein einziges JSON-Objekt.',
      '',
      'Kategorien (cat): "location" (Pflicht-Content pro Location), "laydown" (Produkt-/',
      'Bodenbilder), "model" (Bilder am Model), "ads" (Content für Ads/Newsletter/Feed),',
      '"posen" (Posen), "acc" (Accessoires), "check" (Letzter Check vor Locationwechsel).',
      'Jedes Item ist ein kurzer Text (eine Aufgabe).',
      '',
      'Erlaubte Operationen (op):',
      '  {"op":"add_item","cat":"model","text":"..."}',
      '  {"op":"set_items","cat":"model","items":["...","..."]}  (ersetzt alle Items der Kategorie)',
      '  {"op":"delete_item","cat":"model","index":<0-basiert>}',
      '',
      'Antwortformat exakt (JSON): {"summary":"...","operations":[...]}',
      'Regeln: cat NUR aus der Liste. Konkrete, umsetzbare Shooting-Punkte, deutsch.',
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
