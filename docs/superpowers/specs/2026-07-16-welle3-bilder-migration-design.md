# Welle 3 — Voll-Migration base64 → Storage (Design)

**Datum:** 2026-07-16
**Status:** freigegeben (Design), Umsetzungsplan folgt

## Ziel

Alle bestehenden base64-Bilder aus der RTDB (`rooms/<code>/…`) proaktiv nach Firebase
Cloud Storage migrieren, sodass die Datenbank schlank wird. Nutzen:

- **Zuverlässigkeit:** kleinere Räume laden schneller, weniger Druck auf die IndexedDB
  (die bei den Kunden-Hängern Probleme machte).
- **Limits:** Firebase-Spark-RTDB ist auf 1 GB begrenzt; aktuell ~101 MB (10 %), steigend.
- **Backup:** das nächtliche RTDB-Backup schrumpft von ~101 MB auf wenige MB.

Backup-Kosten sind **nicht** die Hauptmotivation (die sind Cent-Beträge) — DB-Gesundheit ist es.

## Ausgangslage (wichtig)

Welle 3 ist zu ~90 % bereits gebaut und **live in Produktion**:

- `public/tools/_shared/storage-utils.js` — erprobtes Migrations-Toolkit:
  `uploadDataUrl`, `compressAndUpload`, und `migrateRoom(db, room, tag, opts)` (scannt einen
  Raum, lädt jedes base64 nach Storage, **verifiziert per `<img>`**, ersetzt dann **atomar per
  `transaction()`** base64 → URL; bei jedem Fehler bleibt base64 unangetastet; idempotent).
- Die **6 Bild-Tools** (bi, sh, design, ads, techpack, ai_guide) laden das Toolkit, speichern
  **neue** Bilder direkt in Storage und triggern beim Öffnen `migrateRoom` (lazy, pro Raum,
  15 s verzögert, per `sessionStorage` gegen Mehrfach-Trigger geschützt).

**Die einzige Lücke:** Die Lazy-Migration läuft nur, wenn ein Kunde das jeweilige Tool öffnet.
Inaktive Kunden → ihre Bilder bleiben base64. Das sind die ~101 MB. Es gibt **keine**
serverseitige/proaktive Massen-Migration.

## Ansatz (gewählt: A)

Das riskante Stück — die Migrationslogik — existiert und ist erprobt. Wir bauen es **nicht neu**,
sondern **lösen es für alle Räume aus einer Admin-Oberfläche aus**.

Verworfen: (B) serverseitiger `/api/migrate` — müsste die Logik komplett neu im Admin-SDK
nachbauen (kein `<img>`/Blob im Node), mehr Risiko + mehr Arbeit für einen Einmal-Job.
(C) Lazy zusätzlich aufs Portal-Login legen — löst inaktive Kunden nicht.

## Komponenten

1. **`storage-utils.js` — additive `force`-Option** in `migrateRoom(opts)`:
   Wenn `opts.force === true`, wird der `sessionStorage`-Guard übersprungen (nötig, damit der
   Admin-Bulklauf einen Raum im selben Tab erneut prüfen/fortsetzen kann). Das bestehende
   Lazy-Verhalten (ohne `force`) bleibt unverändert.

2. **Neue Admin-Seite `/migrate`** (Astro, unter `AppLayout` → AuthGuard, also nur eingeloggte
   Owner; Inhalt zusätzlich admin-gegated über `admins/<uid>`). Lädt zusätzlich zum üblichen
   Firebase-Setup: `firebase-storage-compat.js`, `img-utils.js`, `storage-utils.js`.
   Erreichbar über einen kleinen Link im Einstellungen→Admin-Bereich.

## Datenfluss / Ablauf

1. Seite liest `workspace/customers` (nur Admins dürfen das) → Liste aller Raum-Codes + Namen.
2. **„🔒 Backup jetzt"** → `POST /api/backup` (Admin-Token) → frisches Voll-Backup als
   Sicherheitsnetz, zeigt „✓ gesichert".
3. **„🧪 Testlauf (1 Raum)"** → `migrateRoom(db, <ersterRaum>, 'admin', {force:true})` →
   Ergebnis „X migriert, Y fehlgeschlagen". Admin prüft die Bilder im Portal.
4. **„▶ Alle migrieren"** → iteriert die Räume **sequenziell** (ein Raum nach dem anderen,
   schont Browser-Speicher), je Raum `migrateRoom(..., {force:true, maxConcurrent:2})`.
   **Live-Log** pro Raum: „Raum ABC123 (Name): 12/12 ✓ (0 failed)".
5. **Abschluss-Summary:** gesamt migriert / fehlgeschlagen / Räume mit Fehlern.

## Fehlerbehandlung

- **Pro Bild:** kopieren → per `<img>` verifizieren → erst dann atomar tauschen. Jeder Fehler →
  base64 bleibt liegen (bestehende Logik, kein Zwischenzustand mit Datenverlust).
- **Raum nicht lesbar:** überspringen, loggen, weiter.
- **Tab zu / Netz weg:** idempotent + fortsetzbar → Seite neu öffnen, „Alle migrieren" erneut;
  bereits Migriertes (URLs) wird übersprungen.
- **Wiederholung mop-up:** Räume mit `failed > 0` können durch erneutes „Alle migrieren"
  nachgezogen werden.

## Sicherheit (kein Datenverlust)

- Bilder werden **kopiert, nicht gelöscht** — nur der DB-Feldwert wechselt von base64 → URL,
  und das **erst nach** erfolgreichem, verifiziertem Upload.
- **Frisches Voll-Backup direkt vor** dem Lauf.
- **Testlauf mit 1 Raum** vor dem Volllauf.

## Erfolgskriterium (messbar)

Nach dem Lauf ein frisches Backup ziehen: Größe fällt von **~101 MB auf wenige MB** → Beweis,
dass die base64-Bilder aus der DB raus sind. Zusätzlich Sicht-Check in 2–3 Kundenräumen
(Bilder werden normal angezeigt).

## Test-/Verifikationsplan

1. Preview gegen Prod-Firebase, als Admin einloggen, `/migrate` öffnen.
2. Backup-Button → 200, Snapshot in Storage.
3. Testlauf auf 1 Raum → Log zeigt migrierte Bilder; Portal-Sichtcheck: Bilder ok.
4. Volllauf → Summary ohne (oder mit wenigen erklärbaren) Fehlern.
5. Frisches Backup → Größe drastisch kleiner (`/api/health?full=1` bzw. Backup-Status).
6. `npm run build` grün.

## Nicht im Scope (YAGNI)

- Kein serverseitiger Migrations-Code.
- Keine neue Migrationslogik (nur `force`-Flag additiv).
- **Kein Storage-Backup** — sinnvolle spätere Ergänzung (nach der Migration liegen die Bilder in
  Storage, das aktuelle Backup sichert nur die RTDB/Links). Separater Schritt.
- Keine Änderung an den 6 Tools (die migrieren/speichern bereits korrekt).
- `cr.html` / Marken-Logo (`workspace/brand/logo`): kein per-Kunde-Bild-Upload bzw. nur ein
  kleines Logo → nicht Teil dieses Laufs.
