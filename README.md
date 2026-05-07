# Unsigned Workspace

Live unter [unsignedworkspace.vercel.app](https://unsignedworkspace.vercel.app) — Brand-Identity- und Production-Workspace für Unsigned GmbH und ihre Kunden. Echte zahlende Kunden, **kein Test-Spielfeld**.

## Was es ist

Ein zwei-seitiger Workspace mit Live-Sync zwischen **Owner-Portal** (Unsigned-Team) und **Customer-Portal** (Kundenmarken). Beide Seiten editieren gemeinsame Daten, Änderungen erscheinen in Echtzeit auf der jeweils anderen Seite.

| Seite | URL | Wer |
|---|---|---|
| Login | `/` | Alle |
| Dashboard | `/dashboard` | Owner |
| Kundenliste | `/customers` | Owner |
| Kunden-Detail | `/customer?id=…` | Owner |
| Team | `/team` | Owner |
| Settings | `/settings` | Owner |
| **Kunden-Portal** | `/portal?room=…` | **Kunde** |

Pro Kunde gibt es 8 Tools: Brand Identity, Shooting Check, Creator Guide, Design, Marketing Plan, Shop, Social Media, AI Guide.

## Stack

- **[Astro 5](https://astro.build/)** — Static-Site-Generator, alles wird statisch gebaut.
- **Tailwind 4** — Styling, brand-spezifische CSS-Variablen in `src/styles/global.css`.
- **Firebase Auth + Realtime Database** — Browser schreibt direkt, **kein Backend / kein API-Layer**.
- **Vercel** — Hosting + Auto-Deploy auf jeden `git push` zu `main`.
- **Tools** als statische HTML-Files unter `public/tools/` — eingebettet via `<iframe>` mit Room-Code als Query-Param.

## Architektur

```
                   Browser-Tab (Owner)              Browser-Tab (Customer)
                   ──────────────────               ──────────────────────
                   /dashboard                       /portal?room=XYZ
                   /customer?id=…                   tool-iframes
                   tool-iframes                            │
                          │                                │
                          └──────────────┬─────────────────┘
                                         │
                              direct read/write
                                         │
                                         ▼
                          ┌──────────────────────────┐
                          │  Firebase Realtime DB    │
                          │  europe-west1            │
                          └──────────────────────────┘
```

**Top-Level Firebase-Pfade:**

- `admins/{uid}` — Admin-UIDs
- `team/{uid}` — Team-Profile
- `presence/{uid}` — Online-Status (siehe Heartbeat unten)
- `invites/{token}` — Einladungs-Tokens
- `workspace/brand` — Brand-Settings
- `workspace/customers/{id}` — Kunden-Liste mit Progress-Spiegelwerten (`shP`, `crP`, …)
- `rooms/{room}` — eigentliche Tool-Daten pro Kunde:
  - `data/fields/{key}` — Brand-Identity-Antworten
  - `design/…` — Design-Tool-Daten
  - `{tool}_pct` — Tool-Fortschritt (0–100)
  - `clientProfile/{uid}` — Kunden-Profil (Name, Brand)
  - `clientActivity` — Heartbeat des Customer (60s-Tick)
  - `_closed` — Sperr-Flag wenn Owner den Kunden löscht

## Live-Sync-Pattern

Owner-Seite (customer.astro) hängt `.on('value', …)` Listener auf:

- `workspace/customers/{id}` — Kunden-Stamm
- `rooms/{room}/data/fields` — leitet `biP` ab
- `rooms/{room}/design` — leitet `dP` ab
- `rooms/{room}/sh_pct` (+ `cr_pct`, `ag_pct`, `mk_pct`, `shop_pct`, `social_pct`) — direkter Mirror
- `rooms/{room}/clientProfile` + `clientActivity` — Live-Badge

Tools (in iframes auf beiden Seiten) schreiben Progress via `postMessage` zur Parent-Page, die schreibt nach Firebase. Der Listener auf der **anderen** Seite feuert und aktualisiert die UI.

## Setup (lokal entwickeln)

```sh
# Abhaengigkeiten installieren
npm install

# Dev-Server (Port 4321)
npm run dev
```

Öffne http://localhost:4321/ — Login mit Firebase-Account. Achtung: lokal arbeitest du gegen die **echte Production-DB**. Kein Schaden bei reinen Read-Tests. Aber **Schreiboperationen verändern Live-Daten**.

```sh
# Production-Build pruefen (gleiche Files wie Vercel baut)
npm run build

# Build-Output lokal anschauen
npm run preview
```

## Sicherheit & Datenintegrität

- **Production hat echte Kundendaten.** Code-Pushes gehen direkt live über Vercel.
- Firebase RTDB ist die einzige Datenquelle. Vercel-Previews schreiben in dieselbe DB — Previews ≠ sichere Sandbox.
- **`window.fb.safeSet/safeUpdate/safeRemove/safePush`** wrappen Writes mit `.catch()` + sichtbarem Toast + 1× Retry. Für Owner-Hot-Paths (rename/archive/delete) verwendet.
- **`window.toast(msg, kind)`** für brand-konforme User-Feedbacks (success/info/error).
- **Listener-Cleanup** auf `pagehide` in customer.astro verhindert Memory-Leaks.
- **Presence-TTL**: 30s-Heartbeat schreibt `presence/<uid>/lastSeen`, Owner-Filter (`appUI.isPresenceFresh`) markiert Einträge älter als 5min als offline.
- **postMessage Origin-Filter** auf customer.astro — verhindert Cross-Origin-Forge von Progress.
- **Online/Offline-Banner** global (BaseLayout) signalisiert Verbindungsverlust nach 2s Debounce.

## Backup

Tägliches Auto-Backup via GitHub Action **„Daily Firebase Backup"** um 03:17 UTC. Backups als 90-Tage-Artifact downloadbar.

Setup + Restore-Anleitung: [docs/BACKUP.md](docs/BACKUP.md).

Manueller Lokal-Backup:

```sh
GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
FIREBASE_DATABASE_URL=https://unsignedworkspace-default-rtdb.europe-west1.firebasedatabase.app \
node scripts/backup-firebase.mjs ./backup-$(date +%F).json
```

## Deploy

Push auf `main` → Vercel deployed automatisch. Kein PR-Workflow notwendig.

PR-Build-Check (verhindert kaputte Pushes auf main): Workflow `.github/workflows/build.yml`.

Rollback: `vercel rollback <deployment-url>` oder über das Vercel-Dashboard mit einem Klick.

## Coding-Konventionen

- Inline-Scripts via `<script is:inline>` — Astro packagebundelt sie nicht, sie laufen im Browser exakt wie geschrieben. Daher kein TypeScript im Browser-Code, IIFE-Pattern üblich.
- Firebase-Compat-SDK 9.22.0 (kein modulares SDK) — Calls wie `window.fb.ref(…).on(…)`.
- `window.fb`, `window.appUI`, `window.toast`, `window.ME` sind globale Kontrakte. In neuen Pages immer über die nutzen, nie eigene Auth- oder DB-Helper bauen.
- Schreib-Operationen auf User-Klick: **immer** `safeSet/safeUpdate/safeRemove/safePush` benutzen, nie nackte `set/update/remove/push`. So bekommt der User bei Fehlern automatisch einen Toast.
- Listener (`.on(…)`): bei Pages mit vielen Listenern eine Tracking-Registry mit Cleanup auf `pagehide` (Pattern wie in customer.astro `trackOn`).

## Roadmap

Plan-Datei mit detailliertem Audit + Roadmap: `~/.claude/plans/dynamic-beaming-balloon.md` (lokal).

Phasen 1–3 abgeschlossen (Safety Net, Sync-Hardening, UX-Polish). Phase 4 (Dev-Infra) läuft.

## Verzeichnisstruktur

```
src/
  components/
    AppHelpers.astro     # window.appUI Toolkit (Modals, Toasts, Auth-Hook, Helpers)
    AuthGuard.astro      # Auth-Check + Presence-Heartbeat
    Sidebar.astro        # Owner-Navigation
    StandaloneTool.astro # iframe-Wrapper für /shop, /shooting, etc.
    PortalFrame.astro    # Tool-iframe für Customer-Portal
    BrandworkTimeline.astro  # Roadmap-Visualisierung
  layouts/
    BaseLayout.astro     # Firebase-Init, window.toast, safeWrite, Offline-Banner
    AppLayout.astro      # Owner-Shell mit Sidebar
  pages/                 # 16 Astro-Pages (siehe Tabelle oben)
  styles/
    global.css           # Tailwind + Brand-Tokens (Farben, Fonts)
public/
  tools/                 # 8 Tool-HTML-Files (eingebettet via iframe)
  brand/                 # Logos, Wordmarks
  fonts/                 # Self-hosted Fraunces
scripts/
  backup-firebase.mjs    # Pure-Node Backup-Script
docs/
  BACKUP.md              # Backup + Restore-Verfahren
```
