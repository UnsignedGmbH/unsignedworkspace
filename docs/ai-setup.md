# KI-Agent — Einrichtung (Anthropic / Claude)

Der KI-Assistent im Content-Tool (Pilot) ruft Claude über die sichere Serverless-Route
`api/ai.js` auf. Der API-Key liegt **ausschließlich serverseitig** (nie im Browser/Repo).
Damit die KI live funktioniert, muss einmalig ein Anthropic-Key in Vercel gesetzt werden.

## 1. Anthropic-Account + API-Key

1. Account auf **https://console.anthropic.com** anlegen.
2. **Billing** → ein kleines Guthaben aufladen (z.B. 5–10 $) — Abrechnung ist
   nutzungsbasiert (Cent-Bereich pro Generierung bei unseren begrenzten Antworten).
3. **API Keys** → **Create Key** → den Key kopieren (Form: `sk-ant-...`).
   Der Key ist geheim — nur in Vercel einfügen, nirgends sonst.

## 2. Key in Vercel setzen

1. Vercel → Projekt `unsignedworkspace` → **Settings → Environment Variables**.
2. Neue Variable:
   - Name: **`ANTHROPIC_API_KEY`**
   - Value: dein `sk-ant-...`-Key
   - Environments: Production (+ Preview, falls du dort testen willst)
3. (Optional) **`ANTHROPIC_MODEL`** setzen, falls der Standard nicht passt — bei einem
   Fehler „model not found" eine gültige Modell-ID aus der Anthropic-Console eintragen.
4. (Optional) **`AI_DAILY_LIMIT`** — KI-Aufrufe pro Kundenraum pro Tag (Default **25**).
5. **Redeploy** auslösen (oder nächster Push), damit die Variable aktiv wird.

## 3. So funktioniert es (für dich & deine Kunden)

- Im **Content-Tool** gibt es oben die Leiste **„✨ … KI fragen"**.
- Beispiel-Befehle:
  - „Bau eine Content-Strategie für eine Streetwear-Brand und 4 Video-Ideen."
  - „Schreib 3 Hooks für Drop 2 und leg passende Videos an."
  - „Lösch die leeren Videos." / „Überschreib die Story der aktiven Strategie mit …"
- **Hinzufügen & leere Felder füllen** passiert direkt. **Löschen/Überschreiben** von
  Vorhandenem zeigt vorher ein **Bestätigungs-Fenster** — die gerade arbeitende Person
  (Kunde oder du) klickt „Übernehmen" oder „Verwerfen". Nichts geht ungefragt verloren.
- Alles Generierte ist danach **ganz normal editierbar** und wird live synchronisiert.

## Sicherheit & Kosten

- Key nur in Vercel (serverseitig). Niemals im Browser/Repo.
- **Limit pro Kundenraum/Tag** (`AI_DAILY_LIMIT`, Default 25) + begrenzte Antwortlänge
  → kalkulierbare Kosten, Schutz vor Missbrauch (Kunden dürfen die KI auslösen).
- Tägliches Firebase-Backup als zusätzliches Netz.

## Status

| Baustein | Status |
|----------|--------|
| `api/ai.js` (Claude-Route + Rate-Limit) | ✅ im Repo |
| `_shared/ai-utils.js` (Client + Bestätigung) | ✅ im Repo |
| Content-Tool Agent-Leiste | ✅ im Repo |
| `ANTHROPIC_API_KEY` in Vercel | ⏳ von dir zu setzen |

Nach dem Pilot rollen wir dasselbe Muster auf **Creator Guide** (Trends) und
**Social Media** (Felder) aus.
