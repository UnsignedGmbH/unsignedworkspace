# KI-Agent — Einrichtung (Google Gemini, kostenlos)

Der KI-Assistent im Content-Tool (Pilot) ruft **Google Gemini** über die sichere
Serverless-Route `api/ai.js` auf. Der API-Key liegt **ausschließlich serverseitig**
(nie im Browser/Repo). Gemini hat ein **kostenloses Kontingent** — für den Umfang
hier reicht das in der Regel aus.

## 1. Kostenlosen Gemini-Key holen

1. Auf **https://aistudio.google.com** mit Google-Account anmelden.
2. Links **„Get API key" / „API-Schlüssel erstellen"** → Key erzeugen.
3. Den Key kopieren (Form: `AIza...`). Geheim halten — nur in Vercel einfügen.

> Hinweis: Die **kostenlose** Stufe nutzt Eingaben evtl. zur Produktverbesserung
> (Training). Für Content-Texte meist unkritisch — falls dir das wichtig wird,
> später auf einen bezahlten Tarif/Anbieter umstellbar (eine Config-Änderung).

## 2. Key in Vercel setzen

1. Vercel → Projekt `unsignedworkspace` → **Settings → Environment Variables**.
2. Neue Variable:
   - Name: **`GEMINI_API_KEY`**
   - Value: dein `AIza...`-Key
   - Environments: Production (+ Preview, falls du dort testen willst)
3. (Optional) **`GEMINI_MODEL`** — Default `gemini-2.0-flash`. Bei „model not found"
   eine gültige ID aus AI Studio eintragen (z.B. `gemini-1.5-flash`).
4. (Optional) **`AI_DAILY_LIMIT`** — KI-Aufrufe pro Kundenraum pro Tag (Default **25**).
5. **Redeploy** auslösen (oder nächster Push), damit die Variable aktiv wird.

> Limits: Die Gratis-Stufe hat Anfragen-Limits pro Minute/Tag. Für wenige Kunden
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
| `api/ai.js` (Gemini-Route + Rate-Limit) | ✅ im Repo |
| `_shared/ai-utils.js` (Client + Bestätigung) | ✅ im Repo |
| Content-Tool Agent-Leiste | ✅ im Repo |
| `GEMINI_API_KEY` in Vercel | ⏳ von dir zu setzen |

Nach dem Pilot rollen wir dasselbe Muster auf **Creator Guide** (Trends) und
**Social Media** (Felder) aus.
