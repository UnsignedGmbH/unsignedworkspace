# KI-Agent — Einrichtung (Groq, kostenlos)

Der KI-Assistent im Content-Tool (Pilot) ruft **Groq** über die sichere Serverless-Route
`api/ai.js` auf. Der API-Key liegt **ausschließlich serverseitig** (nie im Browser/Repo).
Groq hat ein **kostenloses Kontingent**, das (anders als Gemini) verlässlich verfügbar
ist — kein Region-/„limit 0"-Problem.

## 1. Kostenlosen Groq-Key holen

1. Auf **https://console.groq.com** anmelden (Google/GitHub-Login möglich).
2. Links **„API Keys"** → **„Create API Key"** → Key kopieren (`gsk_...`).
3. Geheim halten — nur in Vercel einfügen.

## 2. Key in Vercel setzen

1. Vercel → Projekt `unsignedworkspace` → **Settings → Umgebungsvariablen**.
2. Neue Variable:
   - Name: **`GROQ_API_KEY`**
   - Value: dein `gsk_...`-Key
   - Environments: Production (+ Preview, falls du dort testen willst)
3. (Optional) **`GROQ_MODEL`** — Default `llama-3.3-70b-versatile`. Bei „model not found"
   eine gültige ID aus der Groq-Console eintragen.
4. (Optional) **`AI_DAILY_LIMIT`** — KI-Aufrufe pro Kundenraum pro Tag (Default **25**).
5. **Redeploy** auslösen (oder nächster Push), damit die Variable aktiv wird.

> Die alte `GEMINI_API_KEY`-Variable kann stehen bleiben (wird nicht mehr genutzt)
> oder gelöscht werden.
>
> Limits: Groqs Gratis-Stufe hat Anfragen-Limits pro Minute/Tag. Für wenige Kunden
> völlig ausreichend; bei sehr hoher Nutzung würdest du anstoßen → dann Tarif erhöhen.

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
| `api/ai.js` (Groq-Route + Rate-Limit) | ✅ im Repo |
| `_shared/ai-utils.js` (Client + Bestätigung) | ✅ im Repo |
| Content-Tool Agent-Leiste | ✅ im Repo |
| `GROQ_API_KEY` in Vercel | ⏳ von dir zu setzen |

Nach dem Pilot rollen wir dasselbe Muster auf **Creator Guide** (Trends) und
**Social Media** (Felder) aus.
