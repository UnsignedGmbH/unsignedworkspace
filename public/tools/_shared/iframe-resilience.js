/* Tool-iframe Firebase-Resilience
 * ─────────────────────────────────
 * Jede Tool-Datei (content.html, design.html, sh.html, …) initialisiert ihre
 * eigene Firebase-Instance im iframe. Auf iOS-PWA können diese WebSockets
 * in den "Zombie-State" gehen: .info/connected = true, aber Daten kommen
 * nicht durch. Listener feuern nicht mehr. Folge: Owner schreibt was, Kunde
 * sieht's nicht.
 *
 * Dieser Loader sitzt in JEDEM Tool-iframe und prüft proaktiv ob die DB
 * noch antwortet. Falls nicht: WebSocket recyclen, im Worst-Case Reload.
 *
 * Pattern (analog zu BaseLayout.astro):
 *   1. Boot-Watchdog: nach 8s erste Probe
 *   2. Periodisch alle 60s: Probe wenn sichtbar
 *   3. Visibility-Change visible (nach >20s hidden): sofortige Probe
 *   4. Probe-Timeout (5s) → goOffline+goOnline → Re-Probe (5s)
 *   5. Re-Probe-Timeout → location.reload() (max 2 Reloads/5min via sessionStorage)
 *
 * Daten-Sicherheit:
 *   - goOffline+goOnline queued lokale Writes, flusht beim Reconnect
 *   - reload verliert höchstens die letzten 350ms (Input-Debounce-Window)
 *   - Counter bricht bei echtem Outage nach 2 Reloads ab — kein Endlos-Loop
 */
(function () {
  if (window.__UW_IFRAME_RESILIENCE) return;
  window.__UW_IFRAME_RESILIENCE = true;

  var KEY_RELOADS = 'uw.iframe_reload_attempts';
  var WINDOW_MS = 10 * 60 * 1000;
  var MAX_RELOADS = 0;            // 0 = kein Auto-Reload mehr (zerstoert Userarbeit)
  var PROBE_TIMEOUT_MS = 8000;    // Probe mehr Zeit geben
  var PROBE_INTERVAL_MS = 120 * 1000; // 2min statt 1min
  var BOOT_WATCHDOG_MS = 20000;   // 20s statt 8s — selten unter realer Netzlast
  var HIDDEN_RECOVER_MS = 30 * 1000; // 30s im Hintergrund vor Recovery

  function recentReloads() {
    try {
      var raw = sessionStorage.getItem(KEY_RELOADS);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      var cut = Date.now() - WINDOW_MS;
      return arr.filter(function (t) { return t > cut; });
    } catch (e) { return []; }
  }
  function recordReload() {
    try {
      var arr = recentReloads();
      arr.push(Date.now());
      sessionStorage.setItem(KEY_RELOADS, JSON.stringify(arr));
    } catch (e) {}
  }
  function clearReloads() {
    try { sessionStorage.removeItem(KEY_RELOADS); } catch (e) {}
  }

  function getDb() {
    try {
      if (window.firebase && window.firebase.database) return window.firebase.database();
    } catch (e) {}
    return null;
  }

  function probeOnce(timeoutMs) {
    return new Promise(function (resolve) {
      var db = getDb();
      if (!db) return resolve(false);
      var settled = false;
      var to = setTimeout(function () {
        if (settled) return;
        settled = true;
        resolve(false);
      }, timeoutMs);
      try {
        db.ref('.info/serverTimeOffset').once('value').then(function () {
          if (settled) return;
          settled = true;
          clearTimeout(to);
          resolve(true);
        }).catch(function () {
          if (settled) return;
          settled = true;
          clearTimeout(to);
          resolve(false);
        });
      } catch (e) {
        if (settled) return;
        settled = true;
        clearTimeout(to);
        resolve(false);
      }
    });
  }

  function softReconnect() {
    var db = getDb();
    if (!db) return;
    try {
      db.goOffline();
      setTimeout(function () {
        try { db.goOnline(); } catch (e) {}
      }, 200);
    } catch (e) {}
  }

  function hardReload() {
    // Auto-Reload deaktiviert — zu destruktiv für laufende User-Eingaben.
    // Tools sollten via eigener setWithTimeout + forceReconnect die
    // Recovery selbst handhaben.
    console.warn('[iframe-resilience] zombie WebSocket erkannt — Reload deaktiviert, Tool muss selbst recoveren');
  }

  // Recovery-Kette: probe → softReconnect → re-probe → hardReload
  var recovering = false;
  function recover(reason) {
    if (recovering) return;
    recovering = true;
    console.warn('[iframe-resilience] recovery start:', reason);
    softReconnect();
    setTimeout(function () {
      probeOnce(PROBE_TIMEOUT_MS).then(function (ok) {
        recovering = false;
        if (ok) {
          console.warn('[iframe-resilience] soft-reconnect erfolgreich');
          clearReloads();
        } else {
          hardReload();
        }
      });
    }, 2000);
  }

  // Periodische Probe wenn sichtbar
  function periodicProbe() {
    if (document.visibilityState !== 'visible') return;
    if (recovering) return;
    probeOnce(PROBE_TIMEOUT_MS).then(function (ok) {
      if (!ok) recover('periodic probe timeout');
    });
  }
  setInterval(periodicProbe, PROBE_INTERVAL_MS);

  // Visibility-Change-Recovery
  var hiddenAt = null;
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
    } else if (document.visibilityState === 'visible' && hiddenAt) {
      var awayMs = Date.now() - hiddenAt;
      hiddenAt = null;
      if (awayMs > HIDDEN_RECOVER_MS) {
        // Nach längerem Hintergrund: probe sofort
        probeOnce(PROBE_TIMEOUT_MS).then(function (ok) {
          if (!ok) recover('back from background ' + Math.round(awayMs / 1000) + 's');
          else clearReloads();
        });
      }
    }
  });

  // Boot-Watchdog: 8s nach Load, eine erste Probe
  function startBootWatchdog() {
    setTimeout(function () {
      if (recovering) return;
      probeOnce(PROBE_TIMEOUT_MS).then(function (ok) {
        if (!ok) recover('boot watchdog: keine Connection nach ' + (BOOT_WATCHDOG_MS / 1000) + 's');
        else clearReloads();
      });
    }, BOOT_WATCHDOG_MS);
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    startBootWatchdog();
  } else {
    document.addEventListener('DOMContentLoaded', startBootWatchdog);
  }
})();
