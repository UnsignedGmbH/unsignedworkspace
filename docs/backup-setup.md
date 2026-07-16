# Backup & Monitoring (Welle 2)

Zwei Ziele: (1) **Datenverlust unmöglich machen** — täglich automatisch die ganze
Datenbank sichern; (2) **Ausfälle bemerken, bevor der Kunde anruft** — ein Wächter, der
Alarm schlägt, wenn die Seite/DB down ist oder die Backups ausbleiben.

---

## 1. Was der Code macht (schon gebaut)

- **`api/backup.js`**
  - `GET /api/backup` → **Cron**: liest die komplette RTDB und legt sie als JSON in
    Firebase Storage ab: `backups/rtdb/<zeitstempel>.json`. Danach werden Snapshots älter
    als **14 Tage** gelöscht. Geschützt per `CRON_SECRET` (nur Vercel kann auslösen).
  - `POST /api/backup` → **Owner-Download**: erzeugt ein frisches Backup, speichert es und
    gibt es als Datei-Download zurück. Nur für Admins (Firebase-ID-Token + `admins/<uid>`).
  - `GET /api/backup?status=1` → Frische-Info fürs Dashboard (kein Datenexport).
  - **Sicherheit:** Backups liegen **ohne** öffentlichen Download-Token → nicht über eine
    URL abrufbar, nur via Admin-SDK / Firebase-Console / diesen (auth-geschützten) Endpoint.
- **`vercel.json`** → Cron-Eintrag: `/api/backup` täglich **03:00 UTC**.
- **Dashboard → Einstellungen → „Datensicherung"** (nur Admins): zeigt „Letztes Backup:
  vor X" und hat einen **⬇ Herunterladen**-Knopf für eine Off-Site-Kopie auf deinen Mac.
- **`api/health.js`** → zusätzlicher `?full=1`-Modus prüft auch Storage + Backup-Frische
  (503, wenn das letzte Backup älter als 48 h ist). Der normale `/api/health` bleibt der
  schnelle Up/Down-Ping.

---

## 2. Was DU einrichten musst

### 2a. `CRON_SECRET` in Vercel setzen  ← **Pflicht, sonst läuft das Backup nicht**

Vercel schickt bei Cron-Aufrufen automatisch den Header `Authorization: Bearer <CRON_SECRET>`.
Ohne gesetztes Secret antwortet der Endpoint mit 401 (bewusst — kein offener Endpoint).

1. Vercel → Projekt **unsignedworkspace** → **Settings → Environment Variables**.
2. Neue Variable:
   - **Name:** `CRON_SECRET`
   - **Value:** eine lange Zufallsfolge (z. B. im Terminal `openssl rand -hex 32`, oder
     einfach ~40 zufällige Zeichen).
   - **Environments:** Production (Preview optional).
3. Speichern → einmal **neu deployen** (damit die Variable greift).

Optional (haben sinnvolle Defaults, nur bei Bedarf setzen):
- `BACKUP_RETENTION_DAYS` (Default `14`) — wie viele Tage Snapshots behalten werden.
- `BACKUP_STALE_HOURS` (Default `48`) — ab wann `?full=1` „überfällig" meldet.

> `FIREBASE_SERVICE_ACCOUNT` ist schon gesetzt (nutzt notify/genimage bereits) — nichts zu tun.

### 2b. Ausfall-Wächter: UptimeRobot (gratis)

1. Account auf **uptimerobot.com** anlegen (free reicht).
2. **Add New Monitor:**
   - Type: **HTTP(s)**
   - URL: `https://unsignedworkspace.vercel.app/api/health`
   - Interval: 5 Min
   - Alert Contact: deine E-Mail (optional SMS).
   → Meldet sich, wenn Seite/DB nicht erreichbar (503/kein 200).
3. **Optional, zweiter Monitor** — Alarm, wenn Backups ausbleiben:
   - URL: `https://unsignedworkspace.vercel.app/api/health?full=1`
   - (liefert 503, sobald das letzte Backup älter als 48 h ist)

### 2c. Kosten-Alarm bei Google (gegen Kostenexplosion durch Bug/Angriff)

1. **console.cloud.google.com** → Projekt **unsignedworkspace** → **Billing → Budgets & alerts**.
2. **Create Budget:** Betrag z. B. **20 €/Monat**, Alerts bei 50 % / 90 % / 100 %.
3. Alert-E-Mail eintragen. → Du wirst gewarnt, lange bevor es teuer wird.

---

## 3. Im Notfall: Backup wiederherstellen

Ein Backup ist ein ganz normales RTDB-JSON.

- **Ganze DB zurückspielen:** Firebase-Console → **Realtime Database** → Menü (⋮) oben rechts
  → **JSON importieren** → die Backup-Datei wählen. ⚠️ Überschreibt die komplette DB — nur im
  echten Notfall.
- **Nur einen Kundenraum zurückholen:** die Backup-`.json` lokal öffnen, den Ast
  `rooms/<code>` heraussuchen, in der Console auf `rooms/<code>` navigieren und dort gezielt
  importieren/eintragen. So verlierst du die anderen (aktuelleren) Räume nicht.

**Backup-Dateien holen:** Dashboard → Einstellungen → Datensicherung → ⬇ Herunterladen,
oder in der Firebase-Console unter **Storage → `backups/rtdb/`**.

---

## 4. Verifikation nach dem Deploy

1. `CRON_SECRET` gesetzt + neu deployed.
2. Dashboard → Einstellungen → **Datensicherung** → **⬇ Herunterladen** → eine
   `unsigned-backup-YYYY-MM-DD.json` sollte im Download landen; Statuszeile zeigt „gerade eben".
3. In der Firebase-Console unter **Storage → backups/rtdb/** liegt der Snapshot.
4. Am nächsten Morgen: Ein weiterer Snapshot vom nächtlichen Cron (03:00 UTC) ist da.
