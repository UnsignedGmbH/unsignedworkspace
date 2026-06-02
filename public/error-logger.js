// Fehler-Frühwarnsystem ("Rauchmelder") — Firebase-nativ, kein externer Dienst.
//
// Fängt unbehandelte JS-Fehler + Promise-Rejections ab und schreibt einen kompakten
// Eintrag nach rooms/<room>/_errors. Der Owner sieht sie in der Kunden-Ansicht
// (customer.astro). So fällt z.B. ein Crash wie der bi.html-_ROOM-Fehler sofort auf,
// ohne dass ein Kunde sich melden muss.
//
// Eingebunden via: <script src="/error-logger.js"></script>
//   - in src/layouts/BaseLayout.astro (Portal hat einen room)
//   - in den Tool-HTMLs unter public/tools/ (iframes mit room)
//
// Sicherheit/Robustheit:
//  - Schreibt nur, wenn ein room in der URL steht (Kunden-Flächen). Owner-only-Seiten
//    ohne room werden ignoriert (dort sieht der Owner Fehler ohnehin direkt).
//  - Dedupe pro Session + Cap (max. 25 Writes/Session) gegen Fehler-Fluten.
//  - Alle Felder längenbegrenzt. Schlägt der Write fehl (z.B. Rules), wird er still
//    verworfen — der Logger darf die App nie selbst kaputtmachen.

(function () {
  if (window.__uwErrLogger) return;
  window.__uwErrLogger = true;

  var room = null;
  try { room = new URLSearchParams(location.search).get("room"); } catch (e) {}
  if (!room) return; // nur Kunden-Flächen mit Raum

  var role = "";
  try { role = new URLSearchParams(location.search).get("role") || ""; } catch (e) {}

  // Tool-Name aus dem Pfad ableiten: /tools/<name>.html → <name>, sonst "portal"/"app".
  var tool = "app";
  try {
    var m = location.pathname.match(/\/tools\/([a-z0-9_]+)\.html/i);
    if (m) tool = m[1];
    else if (location.pathname.indexOf("/portal") === 0) tool = "portal";
  } catch (e) {}

  var seen = {};
  var written = 0;
  var MAX = 25;

  function db() {
    try {
      if (window.firebase && window.firebase.database) return window.firebase.database();
    } catch (e) {}
    return null;
  }

  function serverTs() {
    try {
      if (window.firebase && window.firebase.database && window.firebase.database.ServerValue) {
        return window.firebase.database.ServerValue.TIMESTAMP;
      }
    } catch (e) {}
    return Date.now();
  }

  function record(kind, msg, src, line, col, stack) {
    try {
      msg = String(msg == null ? "" : msg);
      // "Script error." = cross-origin ohne Details → nutzlos, überspringen.
      if (!msg || msg === "Script error.") return;
      if (written >= MAX) return;
      var sig = kind + "|" + msg.slice(0, 140) + "|" + (line || 0);
      if (seen[sig]) return;
      seen[sig] = 1;
      var d = db();
      if (!d) return;
      written++;
      d.ref("rooms/" + room + "/_errors").push({
        kind: kind,
        msg: msg.slice(0, 300),
        src: String(src || location.href).slice(0, 200),
        line: line || 0,
        col: col || 0,
        stack: String(stack || "").slice(0, 900),
        tool: tool,
        role: role,
        ua: (navigator.userAgent || "").slice(0, 180),
        ts: serverTs(),
      }).catch(function () { /* Rules/Netz → still verwerfen */ });
    } catch (e) { /* niemals die App crashen */ }
  }

  window.addEventListener("error", function (e) {
    if (!e) return;
    record("error", e.message, e.filename, e.lineno, e.colno, e.error && e.error.stack);
  });

  window.addEventListener("unhandledrejection", function (e) {
    var r = e && e.reason;
    var msg = (r && (r.message || (r.toString && r.toString()))) || "unhandledrejection";
    record("promise", msg, "", 0, 0, r && r.stack);
  });

  // Optionaler manueller Hook für gezieltes Logging aus dem App-Code.
  window.logClientError = function (msg, extra) {
    record("manual", msg, (extra && extra.src) || "", 0, 0, (extra && extra.stack) || "");
  };
})();
