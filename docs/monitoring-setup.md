# Monitoring & Frühwarnsystem — Einrichtung

Diese Datei dokumentiert die einmaligen Setup-Schritte für das Frühwarnsystem
(Phase 1 der Professionalisierungs-Roadmap). Code-Teile (`api/health.js`, Sentry-Loader)
sind bereits im Repo — hier stehen nur die Schritte, die einen Login erfordern.

Ziel: Du erfährst **automatisch**, wenn etwas kaputt geht — bevor ein Kunde sich meldet.

---

## 1. Sentry — Fehler-Tracking (fängt JS-Crashes live ab)

> Hätte den bi.html-`_ROOM`-Crash in dem Moment gemeldet, in dem der erste Kunde
> ihn ausgelöst hat — statt Tage später per Zuruf.

1. Account anlegen auf https://sentry.io (kostenloser „Developer"-Plan reicht locker).
2. **Create Project** → Plattform **„Browser JavaScript"** → Projektname z.B. `unsigned-workspace`.
3. Sentry zeigt dir danach eine **DSN** an — eine URL der Form
   `https://abc123...@o12345.ingest.de.sentry.io/67890`.
4. **Diese DSN an Claude/den Entwickler geben** → wird in `BaseLayout.astro` und alle
   Tool-HTMLs eingebaut. Die DSN ist nicht geheim (läuft im Browser, ist public-safe).
5. (Optional) In Sentry → Alerts → Mail/Slack-Benachrichtigung bei neuen Fehlern aktivieren.

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
| Sentry-Fehler       | ⏳ wartet auf DSN  | Account + DSN liefern |
| Budget-/Quota-Alarm | — (Console)        | GCP/Firebase Console |
| Tägliches Backup    | ✅ Workflow        | Secret + Lauf prüfen |
