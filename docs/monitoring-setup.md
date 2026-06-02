# Monitoring & Frühwarnsystem — Einrichtung

Diese Datei dokumentiert die einmaligen Setup-Schritte für das Frühwarnsystem
(Phase 1 der Professionalisierungs-Roadmap). Code-Teile (`api/health.js`, Sentry-Loader)
sind bereits im Repo — hier stehen nur die Schritte, die einen Login erfordern.

Ziel: Du erfährst **automatisch**, wenn etwas kaputt geht — bevor ein Kunde sich meldet.

---

## 1. Fehler-Frühwarnsystem — EINGEBAUT, nichts einzurichten ✅

> Statt eines externen Dienstes (Sentry) ist ein eigener „Rauchmelder" direkt in der
> App verbaut. Hätte den bi.html-`_ROOM`-Crash in dem Moment gemeldet, in dem der
> erste Kunde ihn ausgelöst hat — statt Tage später per Zuruf.

- `public/error-logger.js` fängt JS-Fehler + Promise-Rejections bei Kunden ab und
  schreibt sie nach `rooms/<room>/_errors` in **dein eigenes Firebase**.
- Eingebunden in `BaseLayout.astro` (Portal) und alle Tool-HTMLs (iframes).
- **Sichtbar machen:** Öffne im Dashboard einen Kunden (`/customer?id=…`). Gibt es
  technische Fehler, erscheint unter den Tools das Panel **„⚠️ Technische Fehler"**
  mit Tool, Zeitpunkt und Meldung. Button **„Als erledigt markieren"** löscht sie.
- Kein externer Account, keine DSN, keine Kosten. Die Fehlerdaten bleiben bei dir.

---

## 2. UptimeRobot — Verfügbarkeits-Überwachung

> Pingt die Seite alle 5 Minuten. Meldet dir, wenn die App down ist oder Firebase klemmt.

1. Account anlegen auf https://uptimerobot.com (kostenlos: 50 Monitore, 5-min-Intervall).
2. **Add New Monitor**:
   - Monitor Type: **HTTP(s)**
   - Friendly Name: `unsigned-workspace`
   - URL: `https://unsignedworkspace.vercel.app/api/health`
   - Monitoring Interval: 5 Minuten
3. **Alert Contacts**: deine E-Mail (und/oder die UptimeRobot-App fürs Handy) hinzufügen.
4. Der Endpoint liefert `200` wenn alles läuft, `503` wenn Firebase nicht erreichbar ist.

---

## 3. Firebase Budget- & Nutzungs-Alarm

> Hätte die 10-GB-Download-Krise früh gemeldet, statt erst beim Service-Stopp.

**Budget-Alarm (Kosten):**
1. Google Cloud Console → https://console.cloud.google.com/billing → Projekt
   `unsignedworkspace` → **Budgets & Alerts** → **Budget erstellen**.
2. Betrag z.B. **5 €/Monat**. Schwellen bei 50 % / 90 % / 100 % → E-Mail-Alarm.

**Nutzungs-Alarm (RTDB-Downloads):**
1. Firebase Console → `unsignedworkspace` → Realtime Database → **Nutzung**.
2. Falls verfügbar: Alarm auf Download-Volumen setzen (sonst deckt der Budget-Alarm via
   Blaze-Abrechnung das indirekt mit ab).

---

## 4. Tägliches Backup — wirklich aktiv?

> Der Workflow `.github/workflows/backup-firebase.yml` existiert, läuft aber nur,
> wenn das Secret gesetzt ist.

1. GitHub → Repo `UnsignedGmbH/unsignedworkspace` → **Settings → Secrets and variables
   → Actions**. Prüfen: existiert das Secret **`FIREBASE_SERVICE_ACCOUNT`**?
   - Falls nicht: Firebase Console → Projekt-Einstellungen → Dienstkonten →
     „Neuen privaten Schlüssel generieren" → JSON-Inhalt komplett als Secret-Wert einfügen.
2. GitHub → **Actions** → Workflow „Daily Firebase Backup" → prüfen ob der letzte Lauf
   **grün** ist. Falls noch nie gelaufen: „Run workflow" für einen manuellen Test-Lauf.
3. Erfolgreicher Lauf legt ein verschlüsseltes Backup-Artefakt an (90 Tage Aufbewahrung).

---

## Status-Übersicht

| Baustein            | Code im Repo | Einrichtung (du) |
|---------------------|--------------|------------------|
| Health-Endpoint     | ✅ `api/health.js` | UptimeRobot draufsetzen |
| Fehler-Frühwarnung  | ✅ `error-logger.js` + Viewer | nichts — siehe Kunden-Ansicht |
| Budget-/Quota-Alarm | — (Console)        | GCP/Firebase Console |
| Tägliches Backup    | ✅ Workflow        | Secret + Lauf prüfen |
