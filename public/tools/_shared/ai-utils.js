// Gemeinsamer Client-Helfer für den KI-Agenten (Pilot: content.html).
//
// Eingebunden via: <script src="/tools/_shared/ai-utils.js"></script>
// Ruft /api/ai auf, wendet "ungefährliche" Operationen direkt an und holt für
// destruktive (löschen / vorhandenes überschreiben) eine Bestätigung der GERADE
// arbeitenden Person (Kunde oder Owner) ein.
//
// Verwendung im Tool:
//   window.aiUtils.execute({
//     room, tool, instruction, state, brand,
//     onStatus: function(text, kind){...},   // kind: 'busy'|'done'|'error'
//     handlers: {
//       isDestructive: function(op){ return bool; },  // löscht/überschreibt Vorhandenes?
//       describe:      function(op){ return 'Video „X" löschen'; },
//       applyOp:       function(op){ /* op anwenden (add/update/delete) */ }
//     }
//   });

(function () {
  if (window.aiUtils) return;

  function run(opts) {
    return fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room: opts.room,
        tool: opts.tool || 'content',
        instruction: opts.instruction || '',
        state: opts.state || {},
        brand: opts.brand || {},
      }),
    }).then(function (r) {
      return r.text().then(function (txt) {
        var j = null;
        try { j = JSON.parse(txt); } catch (e) {}
        if (!r.ok) throw new Error((j && j.error) || ('KI nicht erreichbar (Status ' + r.status + ')'));
        if (!j) throw new Error('KI gerade nicht verfügbar — bitte später erneut.');
        return j;
      });
    });
  }

  // ── Bestätigungs-Panel (self-styled, funktioniert in jedem iframe) ──────────
  function confirmPanel(lines, onConfirm, onCancel) {
    var ov = document.createElement('div');
    ov.setAttribute('style', [
      'position:fixed', 'inset:0', 'z-index:2147483000',
      'background:rgba(0,0,0,.45)', 'display:flex',
      'align-items:center', 'justify-content:center', 'padding:18px',
      'font-family:inherit', 'animation:aiFade .15s ease both',
    ].join(';'));

    var card = document.createElement('div');
    card.setAttribute('style', [
      'background:#fff', 'color:#1a1a1a', 'border-radius:14px', 'max-width:440px',
      'width:100%', 'padding:18px 18px 14px', 'box-shadow:0 20px 60px rgba(0,0,0,.3)',
      'animation:aiPop .18s cubic-bezier(.25,1,.5,1) both',
    ].join(';'));

    var h = document.createElement('div');
    h.textContent = '⚠️ Der Assistent möchte Folgendes ändern:';
    h.setAttribute('style', 'font-weight:800;font-size:13px;margin-bottom:10px;');
    card.appendChild(h);

    var ul = document.createElement('div');
    ul.setAttribute('style', 'display:flex;flex-direction:column;gap:6px;margin-bottom:14px;max-height:240px;overflow:auto;');
    lines.forEach(function (t) {
      var row = document.createElement('div');
      row.textContent = '• ' + t;
      row.setAttribute('style', 'font-size:12px;line-height:1.4;color:#333;background:#f6f3ee;border-radius:8px;padding:7px 10px;');
      ul.appendChild(row);
    });
    card.appendChild(ul);

    var btns = document.createElement('div');
    btns.setAttribute('style', 'display:flex;gap:8px;justify-content:flex-end;');
    var cancel = document.createElement('button');
    cancel.textContent = 'Verwerfen';
    cancel.setAttribute('style', 'font:inherit;font-size:12px;font-weight:700;padding:8px 14px;border-radius:8px;border:.5px solid #ddd;background:#fff;color:#555;cursor:pointer;');
    var ok = document.createElement('button');
    ok.textContent = 'Übernehmen';
    ok.setAttribute('style', 'font:inherit;font-size:12px;font-weight:700;padding:8px 16px;border-radius:8px;border:0;background:#c13030;color:#fff;cursor:pointer;');
    btns.appendChild(cancel); btns.appendChild(ok);
    card.appendChild(btns);
    ov.appendChild(card);

    if (!document.getElementById('aiUtilsKeyframes')) {
      var st = document.createElement('style');
      st.id = 'aiUtilsKeyframes';
      st.textContent = '@keyframes aiFade{from{opacity:0}to{opacity:1}}@keyframes aiPop{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}';
      document.head.appendChild(st);
    }

    function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }
    cancel.onclick = function () { close(); if (onCancel) onCancel(); };
    ok.onclick = function () { close(); if (onConfirm) onConfirm(); };
    ov.onclick = function (e) { if (e.target === ov) { close(); if (onCancel) onCancel(); } };
    document.body.appendChild(ov);
  }

  function execute(opts) {
    var onStatus = opts.onStatus || function () {};
    var h = opts.handlers || {};
    onStatus('KI denkt …', 'busy');
    return run(opts).then(function (res) {
      var ops = (res && res.operations) || [];
      var direct = [], destructive = [];
      ops.forEach(function (op) {
        if (h.isDestructive && h.isDestructive(op)) destructive.push(op);
        else direct.push(op);
      });
      // Ungefährliche sofort anwenden
      direct.forEach(function (op) { try { h.applyOp && h.applyOp(op); } catch (e) {} });

      if (destructive.length) {
        var lines = destructive.map(function (op) {
          return (h.describe && h.describe(op)) || (op.op || 'Änderung');
        });
        confirmPanel(lines, function () {
          destructive.forEach(function (op) { try { h.applyOp && h.applyOp(op); } catch (e) {} });
          onStatus(res.summary || 'Erledigt ✓', 'done');
        }, function () {
          onStatus(direct.length ? (res.summary || 'Teilweise übernommen') : 'Abgebrochen', 'done');
        });
      } else {
        onStatus(res.summary || 'Erledigt ✓', 'done');
      }
      return res;
    }).catch(function (err) {
      onStatus((err && err.message) || 'KI-Fehler', 'error');
      throw err;
    });
  }

  window.aiUtils = { run: run, execute: execute, confirmPanel: confirmPanel };
})();
