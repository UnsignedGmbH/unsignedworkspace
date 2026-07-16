# Welle 3 — Voll-Migration base64 → Storage: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine admin-only Seite `/migrate`, die die bereits erprobte `migrateRoom`-Engine für **alle** Kundenräume auslöst, damit base64-Bilder aus der RTDB in Cloud Storage wandern.

**Architecture:** Kein neuer Migrationscode. Die Seite liest die Raum-Codes aus `workspace/customers`, ruft pro Raum das bestehende `window.storageUtils.migrateRoom()` auf (sequenziell, ein Raum nach dem anderen) und zeigt Live-Fortschritt. Sicherheitsnetze: Voll-Backup davor (serverseitig, ohne 101 MB in den Browser zu ziehen) + Testlauf mit einem Raum.

**Tech Stack:** Astro 5 (MPA), Firebase compat SDK v9.22 (app/auth/database/**storage** — alle schon von `BaseLayout.astro` geladen), Vanilla JS (ES5-Stil wie im Rest des Repos), Vercel Serverless (`api/backup.js`).

**Testing-Realität (wichtig):** Dieses Repo hat **kein** automatisiertes Test-Framework (keine Jest/Vitest, keine CI). Ein Harness nur für diese Einmal-Seite wäre YAGNI und stand nicht in der Spec. Verifikation erfolgt deshalb wie im ganzen Repo etabliert: `node --check` (für JS), `npm run build` (grün), und **Live-Verifikation im Browser gegen Prod-Firebase** — plus das messbare Erfolgskriterium (Backup schrumpft von ~101 MB auf wenige MB).

---

### Task 1: `force`-Option in `migrateRoom` (storage-utils.js)

Der Bulklauf muss einen Raum im selben Tab erneut prüfen können. Aktuell blockt ein
`sessionStorage`-Guard das (er verhindert Mehrfach-Trigger beim Lazy-Pfad). `force` umgeht
**nur** diesen Guard; das Lazy-Verhalten ohne `force` bleibt identisch.

**Files:**
- Modify: `public/tools/_shared/storage-utils.js` (Kopf-Doku ~Z. 14, Guard ~Z. 190-198)

- [ ] **Step 1: Guard hinter `opts.force` legen**

Ersetze in `migrateRoom` diesen Block:

```js
    var sessionKey = "__mig_room_v1_" + room;
    try {
      if (sessionStorage.getItem(sessionKey) === "1") {
        return Promise.resolve({ skipped: true, reason: "session-flag" });
      }
      // Set flag IMMEDIATELY so a second tool-load in the same tab doesn't
      // re-trigger before we even finish reading the root.
      sessionStorage.setItem(sessionKey, "1");
    } catch (e) { /* sessionStorage unavailable, run anyway */ }
```

durch:

```js
    var sessionKey = "__mig_room_v1_" + room;
    // opts.force: der Admin-Bulklauf (/migrate) will einen Raum ggf. mehrfach im selben
    // Tab pruefen/fortsetzen. Der Guard schuetzt nur den Lazy-Pfad vor Mehrfach-Triggern.
    if (!opts.force) {
      try {
        if (sessionStorage.getItem(sessionKey) === "1") {
          return Promise.resolve({ skipped: true, reason: "session-flag" });
        }
        // Set flag IMMEDIATELY so a second tool-load in the same tab doesn't
        // re-trigger before we even finish reading the root.
        sessionStorage.setItem(sessionKey, "1");
      } catch (e) { /* sessionStorage unavailable, run anyway */ }
    }
```

- [ ] **Step 2: Kopf-Doku ergänzen**

Ersetze die Zeile:

```js
//   window.storageUtils.migrateRoom(db, room, tag, opts) — Lazy-Migration aller
//     base64-Bilder eines Customer-Raums nach Storage (idempotent, safe).
```

durch:

```js
//   window.storageUtils.migrateRoom(db, room, tag, opts) — Lazy-Migration aller
//     base64-Bilder eines Customer-Raums nach Storage (idempotent, safe).
//     opts.force = true umgeht den sessionStorage-Guard (fuer den Admin-Bulklauf
//     auf /migrate, der Raeume im selben Tab wiederholen koennen muss).
```

- [ ] **Step 3: Syntax prüfen**

Run: `node --check public/tools/_shared/storage-utils.js`
Expected: keine Ausgabe (Exit 0)

- [ ] **Step 4: Commit**

```bash
git add public/tools/_shared/storage-utils.js
git commit -m "storage-utils: force-Option in migrateRoom (fuer Admin-Bulklauf)"
```

---

### Task 2: `api/backup.js` — POST `{download:false}` speichert nur

Ohne das würde der Backup-Knopf auf `/migrate` die kompletten ~101 MB in den Browser laden,
nur um ein Backup anzulegen. Default bleibt unverändert (der Download-Knopf in den
Einstellungen sendet keinen Body → `download !== false` → Datei-Download wie bisher).

**Files:**
- Modify: `api/backup.js` (POST-Zweig)

- [ ] **Step 1: Body parsen + Zweig einbauen**

Ersetze im POST-Zweig diesen Block:

```js
    try {
      const r = await runBackup();
      try { await pruneOld(); } catch (e) { /* nicht kritisch */ }
      const fname = 'unsigned-backup-' + r.ts.slice(0, 10) + '.json';
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="' + fname + '"');
      res.setHeader('X-Backup-Path', r.path);
      res.setHeader('X-Backup-Bytes', String(r.bytes));
      res.status(200);
      return res.end(r.buffer);
    } catch (e) {
      return res.status(500).json({ error: 'Backup fehlgeschlagen: ' + e.message });
    }
```

durch:

```js
    // { download:false } → nur ablegen + Metadaten zurueck (z.B. /migrate-Sicherheitsnetz;
    // spart es, den kompletten Snapshot in den Browser zu laden). Default = Datei-Download.
    let pbody = req.body;
    if (typeof pbody === 'string') { try { pbody = JSON.parse(pbody); } catch (e) { pbody = {}; } }
    pbody = pbody || {};
    const wantsDownload = pbody.download !== false;

    try {
      const r = await runBackup();
      try { await pruneOld(); } catch (e) { /* nicht kritisch */ }
      if (!wantsDownload) {
        return res.status(200).json({ ok: true, path: r.path, bytes: r.bytes, ts: r.ts });
      }
      const fname = 'unsigned-backup-' + r.ts.slice(0, 10) + '.json';
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="' + fname + '"');
      res.setHeader('X-Backup-Path', r.path);
      res.setHeader('X-Backup-Bytes', String(r.bytes));
      res.status(200);
      return res.end(r.buffer);
    } catch (e) {
      return res.status(500).json({ error: 'Backup fehlgeschlagen: ' + e.message });
    }
```

- [ ] **Step 2: Kopf-Doku ergänzen**

Ersetze die Zeile:

```js
// POST /api/backup            → OWNER-DOWNLOAD. Auth: Bearer <Firebase-ID-Token> eines Admins.
//                               Erzeugt ein frisches Backup, legt es ab UND liefert das JSON
//                               als Datei-Download zurück (Off-Site-Kopie auf das Gerät).
```

durch:

```js
// POST /api/backup            → OWNER-DOWNLOAD. Auth: Bearer <Firebase-ID-Token> eines Admins.
//                               Erzeugt ein frisches Backup, legt es ab UND liefert das JSON
//                               als Datei-Download zurück (Off-Site-Kopie auf das Gerät).
//                               Body { download:false } → nur ablegen, Metadaten als JSON
//                               zurück (kein 100-MB-Transfer in den Browser).
```

- [ ] **Step 3: Syntax prüfen**

Run: `node --check api/backup.js`
Expected: keine Ausgabe (Exit 0)

- [ ] **Step 4: Commit**

```bash
git add api/backup.js
git commit -m "backup: POST {download:false} legt nur ab (Metadaten zurueck)"
```

---

### Task 3: Admin-Seite `src/pages/migrate.astro`

**Files:**
- Create: `src/pages/migrate.astro`

**Kontext für die Umsetzung:**
- `BaseLayout.astro` lädt bereits app/auth/database/**storage** compat v9.22 → `window.firebase.storage()` ist da.
- `window.fb.ref(path)` = DB-Helfer; `window.appUI.onAuth(cb)`, `window.appUI.toast(msg)`,
  `window.appUI.confirm({title, description, okLabel}) → Promise<bool>` existieren (Muster: `settings.astro`).
- Kundensätze: `workspace/customers/<id>` mit `{ name, room, arch, … }` — **`room` ist der Raum-Code**, Daten liegen unter `rooms/<room>`.
- `migrateRoom` braucht die rohe DB-Instanz → `window.firebase.database()`.
- Kein `innerHTML` verwenden (Repo-Konvention/Hook): DOM-Knoten per `createElement` +
  `textContent` bauen, Listen per `removeChild`-Schleife leeren.

- [ ] **Step 1: Seite anlegen**

```astro
---
import AppLayout from "../layouts/AppLayout.astro";
---

<AppLayout title="Bilder-Migration" active="settings">
  <div class="space-y-3 max-w-[720px]">
    <div id="migNotAdmin" class="hidden bg-card border-[0.5px] border-line rounded-[9px] px-4 py-3">
      <div class="text-[13px] font-semibold text-ink">Nur für Admins</div>
      <div class="text-[11px] text-ink-mute mt-[2px]">Diese Seite ist Admins vorbehalten.</div>
    </div>

    <div id="migMain" class="hidden space-y-3">
      <div class="bg-card border-[0.5px] border-line rounded-[9px] px-4 py-3">
        <div class="text-[13px] font-semibold text-ink">Was diese Seite macht</div>
        <div class="text-[11px] text-ink-mute mt-[2px] leading-[1.55]">
          Ältere Kundenbilder liegen als base64 direkt in der Datenbank. Hier werden sie in den
          Storage verschoben: Bild wird kopiert, geprüft — und erst dann wird in der Datenbank
          der Link gesetzt. Geht etwas schief, bleibt das Original unangetastet. Mehrfach
          ausführbar: schon Migriertes wird übersprungen.
        </div>
      </div>

      <div class="bg-card border-[0.5px] border-line rounded-[9px] px-4 py-3 flex items-center gap-3">
        <div class="flex-1">
          <div class="text-[13px] font-semibold text-ink">1. Sicherheitsnetz</div>
          <div id="migBackupStatus" class="text-[11px] text-ink-mute mt-[1px]">
            Zuerst ein frisches Voll-Backup ziehen.
          </div>
        </div>
        <button id="migBackupBtn" type="button" class="text-[11px] font-bold text-white bg-brand hover:bg-brand-dark px-3 py-2 rounded-lg cursor-pointer border-0 shrink-0">🔒 Backup jetzt</button>
      </div>

      <div class="bg-card border-[0.5px] border-line rounded-[9px] px-4 py-3">
        <div class="text-[13px] font-semibold text-ink">2. Testlauf (1 Raum)</div>
        <div id="migTestStatus" class="text-[11px] text-ink-mute mt-[1px] mb-2">
          Migriert genau einen Raum. Danach im Portal prüfen, ob die Bilder normal aussehen.
        </div>
        <div class="flex items-center gap-2">
          <select id="migTestRoom" class="flex-1 text-[12px] border-[1.5px] border-line rounded-lg px-2 py-[6px] bg-white text-ink outline-none focus:border-brand"></select>
          <button id="migTestBtn" type="button" class="text-[11px] font-bold text-white bg-brand hover:bg-brand-dark px-3 py-2 rounded-lg cursor-pointer border-0 shrink-0">🧪 Testlauf</button>
        </div>
      </div>

      <div class="bg-card border-[0.5px] border-line rounded-[9px] px-4 py-3 flex items-center gap-3">
        <div class="flex-1">
          <div class="text-[13px] font-semibold text-ink">3. Alle Räume migrieren</div>
          <div id="migAllStatus" class="text-[11px] text-ink-mute mt-[1px]">Lade Kundenliste…</div>
        </div>
        <button id="migAllBtn" type="button" class="text-[11px] font-bold text-white bg-brand hover:bg-brand-dark px-3 py-2 rounded-lg cursor-pointer border-0 shrink-0">▶ Alle migrieren</button>
      </div>

      <div class="bg-card border-[0.5px] border-line rounded-[9px] px-4 py-3">
        <div class="flex items-center justify-between">
          <div class="text-[13px] font-semibold text-ink">Protokoll</div>
          <div id="migSummary" class="text-[11px] text-ink-mute"></div>
        </div>
        <pre id="migLog" class="mt-2 text-[11px] leading-[1.5] text-ink-soft bg-page rounded-lg p-2 max-h-[320px] overflow-auto whitespace-pre-wrap">–</pre>
      </div>
    </div>
  </div>
</AppLayout>

<script is:inline src="/tools/_shared/storage-utils.js"></script>
<script is:inline>
  (function () {
    var customers = [];
    var running = false;

    function el(id) { return document.getElementById(id); }

    function log(line) {
      var pre = el("migLog");
      if (!pre) return;
      if (pre.textContent === "–") pre.textContent = "";
      pre.textContent += line + "\n";
      pre.scrollTop = pre.scrollHeight;
    }

    function setBusy(b) {
      running = b;
      ["migBackupBtn", "migTestBtn", "migAllBtn"].forEach(function (id) {
        var x = el(id);
        if (!x) return;
        x.disabled = b;
        x.style.opacity = b ? "0.5" : "";
        x.style.cursor = b ? "not-allowed" : "pointer";
      });
    }

    function currentUser() {
      try { return window.firebase && window.firebase.auth().currentUser; }
      catch (e) { return null; }
    }

    // ── Sicherheitsnetz: Voll-Backup (ohne den Snapshot herunterzuladen) ──
    function doBackup() {
      var cu = currentUser();
      if (!cu) {
        window.appUI.toast("Nicht eingeloggt.");
        return Promise.reject(new Error("no-user"));
      }
      el("migBackupStatus").textContent = "Backup läuft…";
      return cu.getIdToken().then(function (tok) {
        return fetch("/api/backup", {
          method: "POST",
          headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" },
          body: JSON.stringify({ download: false }),
        });
      }).then(function (r) {
        if (!r.ok) {
          return r.json().then(function (e) {
            throw new Error((e && e.error) || ("HTTP " + r.status));
          });
        }
        return r.json();
      }).then(function (d) {
        var mb = ((d && d.bytes) || 0) / 1048576;
        var txt = "✓ gesichert (" + mb.toFixed(1) + " MB)";
        el("migBackupStatus").textContent = txt;
        log("[backup] " + txt + " → " + (d && d.path));
        return d;
      }).catch(function (e) {
        el("migBackupStatus").textContent = "Fehler: " + e.message;
        log("[backup] ✗ " + e.message);
        throw e;
      });
    }

    // ── Kundenliste ──
    function loadCustomers() {
      return window.fb.ref("workspace/customers").once("value").then(function (s) {
        var v = s.val() || {};
        customers = Object.keys(v).map(function (id) {
          var c = v[id] || {};
          return { id: id, name: c.name || "(ohne Name)", room: c.room || "" };
        }).filter(function (c) { return !!c.room; });

        var sel = el("migTestRoom");
        while (sel.firstChild) sel.removeChild(sel.firstChild);
        customers.forEach(function (c) {
          var o = document.createElement("option");
          o.value = c.room;
          o.textContent = c.name + " (" + c.room + ")";
          sel.appendChild(o);
        });
        el("migAllStatus").textContent = customers.length + " Kundenräume gefunden.";
        log("[init] " + customers.length + " Kundenräume gefunden.");
        return customers;
      });
    }

    // ── Ein Raum ──
    function migrateOneRoom(c) {
      var db = window.firebase.database();
      return window.storageUtils.migrateRoom(db, c.room, "admin", {
        force: true,
        maxConcurrent: 2,
      }).then(function (r) {
        r = r || {};
        if (r.skipped) {
          log("  " + c.room + " (" + c.name + "): übersprungen — " + (r.reason || "?"));
        } else if (!r.total) {
          log("  " + c.room + " (" + c.name + "): nichts zu tun");
        } else {
          log("  " + c.room + " (" + c.name + "): " + r.migrated + "/" + r.total + " ✓" +
              (r.failed ? " — " + r.failed + " fehlgeschlagen" : ""));
        }
        return r;
      }).catch(function (e) {
        log("  " + c.room + " (" + c.name + "): ✗ " + (e && e.message));
        return { migrated: 0, failed: 0, total: 0 };
      });
    }

    // ── Testlauf ──
    function onTest() {
      if (running) return;
      var room = el("migTestRoom").value;
      var c = customers.filter(function (x) { return x.room === room; })[0];
      if (!c) { window.appUI.toast("Kein Raum gewählt."); return; }
      setBusy(true);
      el("migTestStatus").textContent = "Testlauf läuft…";
      log("[test] Starte Testlauf für " + c.room + " (" + c.name + ")");
      migrateOneRoom(c).then(function (r) {
        el("migTestStatus").textContent =
          "✓ fertig: " + (r.migrated || 0) + " migriert, " + (r.failed || 0) + " fehlgeschlagen";
        log("[test] fertig — jetzt prüfen: /portal?room=" + c.room);
        setBusy(false);
      });
    }

    // ── Alle Räume, sequenziell ──
    function onAll() {
      if (running) return;
      if (!customers.length) { window.appUI.toast("Keine Räume geladen."); return; }
      window.appUI.confirm({
        title: "Alle Räume migrieren?",
        description: customers.length + " Kundenräume werden nacheinander migriert. Das kann " +
          "ein paar Minuten dauern — lass den Tab offen. Der Vorgang ist sicher und beliebig " +
          "wiederholbar; schon Migriertes wird übersprungen.",
        okLabel: "Starten",
      }).then(function (ok) {
        if (!ok) return;
        setBusy(true);
        var totMig = 0, totFail = 0, roomsWithFail = 0, i = 0;
        log("[all] Starte Voll-Migration über " + customers.length + " Räume…");

        function next() {
          if (i >= customers.length) {
            log("[all] FERTIG — " + totMig + " Bilder migriert, " + totFail +
                " fehlgeschlagen, " + roomsWithFail + " Räume mit Fehlern.");
            el("migAllStatus").textContent =
              "✓ Durchlauf fertig. Jetzt ein frisches Backup ziehen — es sollte deutlich kleiner sein.";
            setBusy(false);
            return;
          }
          var c = customers[i++];
          el("migAllStatus").textContent = "Migriere " + i + "/" + customers.length + " — " + c.room;
          migrateOneRoom(c).then(function (r) {
            totMig += (r.migrated || 0);
            totFail += (r.failed || 0);
            if (r.failed) roomsWithFail++;
            el("migSummary").textContent = totMig + " migriert · " + totFail + " Fehler";
            next();
          });
        }
        next();
      });
    }

    // ── Boot ──
    function init(me) {
      if (!me || !me.uid) return;
      if (!window.storageUtils || !window.storageUtils.migrateRoom) {
        log("[init] FEHLER: storage-utils.js nicht geladen.");
        return;
      }
      window.fb.ref("admins/" + me.uid).on("value", function (s) {
        var isAdmin = !!s.val();
        el("migMain").classList.toggle("hidden", !isAdmin);
        el("migNotAdmin").classList.toggle("hidden", isAdmin);
        if (isAdmin && !customers.length) {
          loadCustomers().catch(function (e) {
            log("[init] Kundenliste nicht ladbar: " + (e && e.message));
            el("migAllStatus").textContent = "Kundenliste nicht ladbar.";
          });
        }
      });
    }

    el("migBackupBtn").addEventListener("click", function () {
      if (running) return;
      setBusy(true);
      doBackup().catch(function () {}).then(function () { setBusy(false); });
    });
    el("migTestBtn").addEventListener("click", onTest);
    el("migAllBtn").addEventListener("click", onAll);
    window.appUI.onAuth(init);
  })();
</script>
```

- [ ] **Step 2: Build prüfen**

Run: `npm run build`
Expected: `[build] Complete!`, und `/migrate/index.html` taucht in der Seitenliste auf.

- [ ] **Step 3: Inline-Script-Syntax prüfen**

Run:
```bash
node -e '
const fs=require("fs"), vm=require("vm");
const html=fs.readFileSync("dist/migrate/index.html","utf8");
const re=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
let bad=0,i=0;
for (const m of html.matchAll(re)) {
  i++;
  const c=m[1];
  if(!c.trim()) continue;
  try{ new vm.Script(c); }catch(err){ bad++; console.log("SCRIPT #"+i+":", err.message); }
}
console.log("scripts:",i,"| errors:",bad);
'
```
Expected: `errors: 0`

- [ ] **Step 4: Commit**

```bash
git add src/pages/migrate.astro
git commit -m "Admin-Seite /migrate: Voll-Migration base64 -> Storage"
```

---

### Task 4: Link auf `/migrate` im Admin-Bereich der Einstellungen

**Files:**
- Modify: `src/pages/settings.astro` (Sektion `#adminSection`, im `uw-set-body`)

- [ ] **Step 1: Link-Karte unter die Admin-Status-Karte hängen**

Ersetze in `#adminSection` diesen Block:

```astro
      <div class="bg-card border-[0.5px] border-line rounded-[9px] px-4 py-3 flex items-center gap-3">
        <div class="flex-1">
          <div id="adminStatus" class="text-[13px] font-semibold text-ink">…</div>
          <div id="adminHint" class="text-[11px] text-ink-mute mt-[1px]"></div>
        </div>
        <button
          id="adminAddBtn"
          type="button"
          class="hidden text-[11px] font-bold text-white bg-brand hover:bg-brand-dark px-3 py-2 rounded-lg cursor-pointer border-0"
          >Mich als Admin eintragen</button
        >
      </div>
```

durch:

```astro
      <div class="bg-card border-[0.5px] border-line rounded-[9px] px-4 py-3 flex items-center gap-3">
        <div class="flex-1">
          <div id="adminStatus" class="text-[13px] font-semibold text-ink">…</div>
          <div id="adminHint" class="text-[11px] text-ink-mute mt-[1px]"></div>
        </div>
        <button
          id="adminAddBtn"
          type="button"
          class="hidden text-[11px] font-bold text-white bg-brand hover:bg-brand-dark px-3 py-2 rounded-lg cursor-pointer border-0"
          >Mich als Admin eintragen</button
        >
      </div>

      <div class="bg-card border-[0.5px] border-line rounded-[9px] px-4 py-3 mt-[6px] flex items-center gap-3">
        <div class="flex-1">
          <div class="text-[13px] font-semibold text-ink">Bilder-Migration</div>
          <div class="text-[11px] text-ink-mute mt-[1px]">
            Verschiebt alte Kundenbilder aus der Datenbank in den Storage — macht die
            Datenbank schlank und das Portal schneller.
          </div>
        </div>
        <a
          href="/migrate"
          class="text-[11px] font-bold text-white bg-brand hover:bg-brand-dark px-3 py-2 rounded-lg cursor-pointer border-0 no-underline shrink-0"
          >Öffnen</a
        >
      </div>
```

- [ ] **Step 2: Build prüfen**

Run: `npm run build`
Expected: `[build] Complete!`

- [ ] **Step 3: Commit**

```bash
git add src/pages/settings.astro
git commit -m "settings: Link auf /migrate im Admin-Bereich"
```

---

### Task 5: Live-Verifikation + Durchführung (mit Ben)

Kein Code — das ist der eigentliche, überwachte Lauf. **Wird gemeinsam mit Ben gemacht**,
weil nur er sich als Admin einloggen kann.

- [ ] **Step 1: Deployen**

```bash
git push origin HEAD:main
```
Expected: Vercel-Deploy „Bereit".

- [ ] **Step 2: Seite öffnen + Admin-Gate prüfen**

Ben öffnet `https://unsignedworkspace.vercel.app/migrate` (eingeloggt als Admin).
Expected: Der Inhalt erscheint (nicht „Nur für Admins"), Log zeigt „[init] N Kundenräume gefunden."

- [ ] **Step 3: Sicherheitsnetz — Backup**

Klick **🔒 Backup jetzt**.
Expected: „✓ gesichert (~101 MB)". Das ist der Vorher-Wert — **notieren**.

- [ ] **Step 4: Testlauf**

Raum im Dropdown wählen, **🧪 Testlauf** klicken.
Expected: Log zeigt `<code> (<name>): X/X ✓`.
Dann `/portal?room=<code>` öffnen und prüfen: **Bilder werden normal angezeigt.**
Bei Problemen: STOPP, nichts weiter migrieren (base64 ist ohnehin unangetastet geblieben).

- [ ] **Step 5: Volllauf**

**▶ Alle migrieren** → bestätigen → Tab offen lassen.
Expected: Log läuft Raum für Raum durch, Abschluss „[all] FERTIG — N Bilder migriert, 0 fehlgeschlagen".
Bei Räumen mit Fehlern: einfach nochmal „Alle migrieren" (idempotent, zieht nach).

- [ ] **Step 6: Erfolgskriterium messen**

Klick nochmal **🔒 Backup jetzt**.
Expected: **Größe fällt von ~101 MB auf wenige MB.** Das ist der Beweis, dass die base64-Bilder
raus aus der DB sind.
Falls die Größe *nicht* nennenswert fällt: Es gibt base64 in Räumen, die **nicht** in
`workspace/customers` stehen (z. B. Owner-Scratch-Räume aus dem bi.html-Standalone-Flow).
Dann: Ursache separat untersuchen, nicht raten.

- [ ] **Step 7: Sicht-Check**

2–3 Kundenräume im Portal öffnen → Bilder normal da.
Zusätzlich: `curl -s "https://unsignedworkspace.vercel.app/api/health?full=1"`
Expected: `"backup":"ok"` und `"storage":"ok"`.

---

## Self-Review

**1. Spec-Abdeckung:**
- `force`-Option → Task 1 ✅
- Admin-Seite `/migrate` (admin-gated, lädt storage-utils) → Task 3 ✅
- Kundenliste aus `workspace/customers` → Task 3 (`loadCustomers`) ✅
- Backup-Button / Testlauf / Alle-migrieren / Live-Log / Summary → Task 3 ✅
- Link aus Einstellungen → Task 4 ✅
- Sequenzielle Abarbeitung, `maxConcurrent:2` → Task 3 (`next()`, `migrateOneRoom`) ✅
- Fehlerbehandlung (Raum überspringen, idempotent, wiederholbar) → Task 3 + Task 5 Step 5 ✅
- Erfolgskriterium „Backup schrumpft" → Task 5 Step 6 ✅
- **Abweichung von der Spec (bewusst, einfacher):** `img-utils.js` wird **nicht** geladen —
  `migrateRoom` nutzt `uploadDataUrl`, nicht `compressAndUpload`, braucht also kein `imgUtils`.
  `firebase-storage-compat.js` muss **nicht** ergänzt werden — `BaseLayout.astro` lädt es schon.
- **Ergänzung gegenüber der Spec:** Task 2 (`{download:false}`) — sonst zöge der Backup-Knopf
  ~101 MB in den Browser. In der Spec übersehen.

**2. Placeholder-Scan:** Keine TBD/TODO; jeder Code-Schritt enthält vollständigen Code.

**3. Typ-/Namens-Konsistenz:** `migrateRoom(db, room, tag, opts)` mit `opts.force` (Task 1) wird
in Task 3 exakt so aufgerufen. Rückgabefelder `{migrated, failed, total, skipped, reason}`
stimmen mit `storage-utils.js` überein. Element-IDs (`migLog`, `migSummary`, `migAllStatus`,
`migBackupStatus`, `migTestStatus`, `migTestRoom`, `migBackupBtn`, `migTestBtn`, `migAllBtn`,
`migMain`, `migNotAdmin`) sind zwischen Markup und Script identisch. `{download:false}`
(Task 2) = exakt der Body aus Task 3 `doBackup()`.
