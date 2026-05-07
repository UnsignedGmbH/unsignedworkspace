# Backup & Restore

Die gesamte Kunden-Datenbank liegt in **Firebase Realtime Database**
(`unsignedworkspace-default-rtdb.europe-west1.firebasedatabase.app`).
Der Repo-Code enthält die Daten **nicht**. Verlust oder Korruption ist
ohne Backup unwiederbringlich.

## Automatisches Backup

GitHub Action [`.github/workflows/backup-firebase.yml`](../.github/workflows/backup-firebase.yml)
zieht **täglich um 03:17 UTC** einen vollständigen JSON-Snapshot und legt ihn als
Action-Artifact ab. Standard-Retention: **90 Tage**.

### One-Time Setup

1. **Service Account Key generieren**
   - Firebase Console → ⚙️ Projekt-Einstellungen → Tab **Dienstkonten**
   - "Neuen privaten Schlüssel generieren" → JSON-Datei downloaden
   - Diese Datei hat **Vollzugriff** auf die DB. Niemals committen.

2. **GitHub Secret anlegen**
   - GitHub Repo → Settings → Secrets and variables → **Actions**
   - "New repository secret":
     - Name: `FIREBASE_SERVICE_ACCOUNT`
     - Value: kompletter Inhalt der heruntergeladenen JSON (raw paste)

3. **Test-Run starten**
   - Repo → Actions → "Daily Firebase Backup" → "Run workflow"
   - Nach ~1 Min: Run-Page öffnen → Artifact `firebase-backup-<run-id>` herunterladen

Ab dann läuft der Job nightly automatisch.

## Lokales Backup (manuell, ad-hoc)

Bevor man riskante Änderungen ausprobiert, ein schneller Snapshot:

### Variante A — Firebase Console (klick-und-klick)

Console → Realtime Database → ⋮ (drei Punkte) → "JSON exportieren".

### Variante B — Script (CLI)

```sh
# Service-Account JSON irgendwo lokal liegen haben
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json
export FIREBASE_DATABASE_URL=https://unsignedworkspace-default-rtdb.europe-west1.firebasedatabase.app
node scripts/backup-firebase.mjs ~/Desktop/HTMLSEITEN/backup/firebase-$(date +%F).json
```

Pure Node, keine Dependencies (siehe [`scripts/backup-firebase.mjs`](../scripts/backup-firebase.mjs)).

## Restore

> ⚠️ Restore **überschreibt** die komplette DB. Erst sicher sein, dass kein Live-Schreibzugriff läuft.

1. Backup-JSON entweder von GitHub Actions herunterladen (ZIP entpacken)
   oder aus dem lokalen `backup/`-Ordner nehmen.
2. Firebase Console → Realtime Database → ⋮ → **"JSON importieren"**.
3. Datei auswählen → bestätigen.

Punkt-Restores einzelner Kunden gehen einfacher: JSON öffnen, betroffenen
`rooms/{room}` oder `workspace/customers/{id}`-Eintrag rauskopieren, in der
Console direkt am Pfad einfügen.

## Was ist im Backup drin?

Top-Level-Keys der DB:

- `admins` — Admin-UIDs
- `invites` — offene Einladungs-Tokens
- `presence` — wer ist online (volatil)
- `rooms` — pro Kunde ein Raum mit allen Tool-Daten (Brand Identity, Shooting,
  Creator Guide, Design, Marketing, Shop, Social, AI Guide). **Hier liegt der Großteil.**
- `team` — Team-Profile
- `workspace` — Brand-Settings + Customer-Liste mit Progress-Spiegelwerten
