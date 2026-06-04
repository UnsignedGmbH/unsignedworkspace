// Techpack-PDF — VEKTORISIERT (jsPDF, A4 Querformat, mm-Koordinaten).
// Zeichnet die Seiten 1:1 wie die Design-Vorlagen (Boxen, Header-Balken, Texte, Bilder)
// statt eines html2canvas-Screenshots → gestochen scharf, A4, druckfertig.
//
// Eingebunden via <script src="/tools/_shared/techpack-pdf-vector.js" defer></script>.
// Aufruf: window.tpExportPdfVector(packId, pack)  (pack aus techpack.html).
//
// Datenmodell pro Seite: page.type, page.fields{}, page.images{}, page.notes{}.
// Stand: TP_START exakt; übrige Typen über generisches (ebenfalls vektorisiertes,
// scharfes A4-)Layout, das danach Seite für Seite an die jeweilige Vorlage angeglichen wird.

(function () {
  var PW = 297, PH = 210;      // A4 quer (mm)
  var M = 8;                    // Außenrand
  var FOOTER = '/tools/_shared/unsigned-footer.png';

  // ── Bild laden (CORS-fähig → kann in jsPDF-Canvas) ──
  function loadImg(src) {
    return new Promise(function (resolve) {
      if (!src) return resolve(null);
      var im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = function () { resolve(im); };
      im.onerror = function () {
        // Fallback ohne CORS (kann Canvas „tainten" → addImage scheitert dann still)
        var im2 = new Image();
        im2.onload = function () { resolve(im2); };
        im2.onerror = function () { resolve(null); };
        im2.src = src;
      };
      im.src = src;
    });
  }

  // ── Toolkit ──────────────────────────────────────────────────────────────
  function box(doc, x, y, w, h, lw) {
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(lw == null ? 1.0 : lw);
    doc.rect(x, y, w, h);
  }
  // Schwarzer Header-Balken + weißes Label (wie BRAND/STYLE/COLOR …)
  function headerLabel(doc, x, y, w, text) {
    var barH = 6.2;
    doc.setFillColor(0, 0, 0);
    doc.rect(x, y, w, barH, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text(String(text || '').toUpperCase(), x + 1.6, y + barH - 1.8);
    doc.setTextColor(0, 0, 0);
    return barH;
  }
  // Fettes schwarzes Label oben-links (PRODUCT, EXTRA NOTE, MOCK UP …)
  function plainLabel(doc, x, y, text, size) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(size || 11);
    doc.setTextColor(0, 0, 0);
    doc.text(String(text || '').toUpperCase(), x, y);
  }
  // Feldwert (fett, uppercase, Umbruch)
  function value(doc, x, y, w, text, size, bold) {
    var t = (text == null ? '' : String(text)).trim();
    if (!t) return;
    doc.setFont('helvetica', bold === false ? 'normal' : 'bold');
    doc.setFontSize(size || 12);
    doc.setTextColor(0, 0, 0);
    var lines = doc.splitTextToSize(t.toUpperCase(), w);
    doc.text(lines, x, y);
  }
  // Bild contain-eingepasst in Box, zentriert (keine Verzerrung)
  function imageFit(doc, img, x, y, w, h) {
    if (!img) return;
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;
    var r = Math.min(w / iw, h / ih);
    var dw = iw * r, dh = ih * r;
    try { doc.addImage(img, 'PNG', x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); }
    catch (e) { try { doc.addImage(img, 'JPEG', x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); } catch (e2) {} }
  }
  function footer(doc, logo) {
    if (!logo) return;
    var iw = logo.naturalWidth || logo.width, ih = logo.naturalHeight || logo.height;
    if (!iw || !ih) return;
    var h = 7, w = iw * (h / ih);
    try { doc.addImage(logo, 'PNG', (PW - w) / 2, PH - h - 2.5, w, h); } catch (e) {}
  }
  // Feldbox = Rahmen + Header-Balken + Wert
  function fieldBox(doc, x, y, w, h, label, val) {
    box(doc, x, y, w, h, 1.0);
    headerLabel(doc, x, y, w, label);
    value(doc, x + 2, y + 13, w - 4, val, 12);
  }

  // ── Layout: TP_START (1:1 wie (1)TP START.png) ──────────────────────────
  function layoutTP_START(doc, page, imgs) {
    var f = page.fields || {}, n = page.notes || {};
    var LW = M, LWid = 137, RX = 152, RWid = 137;
    // Linke Hälfte
    fieldBox(doc, LW, 8, 66, 15, 'Brand', f.brand);
    fieldBox(doc, LW, 25, 66, 27, 'Style', f.style);
    fieldBox(doc, LW + 70, 25, 67, 27, 'Collection Drop', f.drop);
    fieldBox(doc, LW, 54, 66, 27, 'Sample Size', f.sampleSize);
    fieldBox(doc, LW + 70, 54, 67, 27, 'Sample Quantity', f.sampleQty);
    // Rechte Hälfte
    fieldBox(doc, RX, 8, 67, 33, 'Color', f.color);
    fieldBox(doc, RX + 70, 8, 67, 33, 'Pantone Code', f.pantone);
    fieldBox(doc, RX, 47, 67, 34, 'Surface', f.surface);
    fieldBox(doc, RX + 70, 47, 67, 34, 'Quality', f.quality);
    // PRODUCT (groß, volle Breite) — Label schwarz oben-links, Bild darunter
    var px = M, py = 86, pw = PW - 2 * M, ph = 94;
    box(doc, px, py, pw, ph, 1.2);
    plainLabel(doc, px + 3, py + 7, 'Product', 12);
    imageFit(doc, imgs.product, px + 4, py + 11, pw - 8, ph - 15);
    // EXTRA NOTE (Streifen)
    var ey = py + ph + 2, eh = 16;
    box(doc, px, ey, pw, eh, 1.2);
    plainLabel(doc, px + 3, ey + 7, 'Extra Note', 11);
    value(doc, px + 3, ey + 13, pw - 6, n.extra, 10, false);
  }

  // ── Generisches Vektor-Layout (übrige Typen, interim — scharf + A4) ──────
  var TYPE_LABEL = {
    TP_PRINT: 'PRINT', TP_PRINT_SIZE: 'PRINT (SIZE)', TP_PRINT_INFO: 'PRINT INFO',
    TP_MOLD_INFO: 'MOLD INFO', TP_WASH_INFO: 'WASH INFO', TP_FABRIC_INFO: 'FABRIC INFO',
    TP_MEASUREMENTS: 'MOCK UP (WITH MEASURMENTS)', TP_LABELS: 'LABELS',
    TP_EXTRA_INFO: 'EXTRA INFO', TP_PACKAGING: 'PACKAGING',
  };
  function layoutGeneric(doc, page, imgs) {
    var f = page.fields || {}, n = page.notes || {};
    var x = M, w = PW - 2 * M;
    // Felder als Header-Boxen-Reihe oben
    var keys = Object.keys(f).filter(function (k) { return f[k] != null && String(f[k]).trim() && typeof f[k] !== 'object'; });
    var y = 8;
    if (keys.length) {
      var per = Math.min(keys.length, 4), bw = (w - (per - 1) * 4) / per, bh = 24;
      keys.slice(0, 4).forEach(function (k, i) {
        fieldBox(doc, x + i * (bw + 4), y, bw, bh, k, f[k]);
      });
      y += bh + 5;
    }
    // EXTRA NOTE oben (wie Vorlagen) wenn vorhanden
    if (n.extra && String(n.extra).trim()) {
      var nh = 22; box(doc, x, y, w, nh, 1.1); plainLabel(doc, x + 3, y + 7, 'Extra Note');
      value(doc, x + 3, y + 13, w - 6, n.extra, 10, false); y += nh + 5;
    }
    // Bild(er) groß darunter
    var imgKeys = Object.keys(imgs).filter(function (k) { return imgs[k]; });
    var bigH = (PH - 14) - y;
    box(doc, x, y, w, bigH, 1.2);
    plainLabel(doc, x + 3, y + 7, TYPE_LABEL[page.type] || 'CONTENT');
    if (imgKeys.length) imageFit(doc, imgs[imgKeys[0]], x + 4, y + 11, w - 8, bigH - 15);
  }

  var LAYOUTS = { TP_START: layoutTP_START };

  // ── Build (gibt das jsPDF-doc zurück, ohne zu speichern) ──────────────────
  function buildDoc(packId, pack) {
    return new Promise(function (resolve) {
      if (!pack || !pack.pages) return resolve(null);
      var jsPDF = window.jspdf && window.jspdf.jsPDF;
      if (!jsPDF) return resolve(null);
      var doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
      var order = (pack.pageOrder && pack.pageOrder.length) ? pack.pageOrder : Object.keys(pack.pages);
      order = order.filter(function (pid) { return pack.pages[pid]; });
      if (!order.length) return resolve(null);

      loadImg(FOOTER).then(function (logo) {
        var i = 0;
        function step() {
          if (i >= order.length) { return resolve(doc); }
          var page = pack.pages[order[i]];
          var imageSrcs = page.images || {};
          if (page.type === 'TP_START' && !imageSrcs.product && window.tpGetMockupSrc) {
            imageSrcs = Object.assign({}, imageSrcs, { product: window.tpGetMockupSrc(pack.meta && pack.meta.baseStyle) });
          }
          var keys = Object.keys(imageSrcs);
          Promise.all(keys.map(function (k) { return loadImg(imageSrcs[k]); })).then(function (loaded) {
            var imgs = {}; keys.forEach(function (k, idx) { imgs[k] = loaded[idx]; });
            if (i > 0) doc.addPage('a4', 'landscape');
            var layout = LAYOUTS[page.type] || layoutGeneric;
            try { layout(doc, page, imgs); } catch (e) { try { layoutGeneric(doc, page, imgs); } catch (e2) {} }
            footer(doc, logo);
            i++;
            step();
          });
        }
        step();
      });
    });
  }
  window.tpBuildPdfDoc = buildDoc; // für Tests/Vorschau

  // ── Entry ────────────────────────────────────────────────────────────────
  window.tpExportPdfVector = function (packId, pack) {
    buildDoc(packId, pack).then(function (doc) {
      if (doc) doc.save(((pack.meta && pack.meta.name) || 'techpack') + '.pdf');
      else if (window.tpToast) window.tpToast('PDF-Export fehlgeschlagen');
    });
  };
})();
