// Techpack PDF Export
// ====================
// Snapshot-basiertes PDF: jede Page wird via window.tpRender.page() gerendert
// (gleicher Renderer wie der Editor — single source of truth), in fixer 1200x1200
// Größe in einem off-screen-Container montiert, mit html2canvas geschnappt und
// in jsPDF eingefügt. Kein eigenes Layout mehr — wenn der Editor anders aussieht,
// sieht es das PDF auch.
//
// Exposed: window.tpExportPdf(packId, pack)

(function () {
  if (window.tpExportPdf) return;

  var PAGE_PX = 1200; // square page

  function tpExportPdf(packId, pack) {
    if (!pack) {
      if (window.tpToast) window.tpToast('Pack nicht gefunden');
      return;
    }
    if (typeof window.jspdf === 'undefined' || typeof window.html2canvas === 'undefined') {
      if (window.tpToast) window.tpToast('PDF-Library lädt noch — kurz warten und nochmal');
      return;
    }
    if (!window.tpRender || typeof window.tpRender.page !== 'function') {
      if (window.tpToast) window.tpToast('Renderer nicht geladen — Seite refreshen');
      return;
    }
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({
      orientation: 'portrait',
      unit: 'pt',
      format: [PAGE_PX, PAGE_PX],
      compress: true,
    });

    var staging = document.createElement('div');
    staging.style.cssText = 'position:fixed;top:-300vh;left:0;z-index:-1;pointer-events:none;width:' + PAGE_PX + 'px;background:#fff;';
    document.body.appendChild(staging);

    var order = pack.pageOrder || [];
    var pages = pack.pages || {};
    var firstAdded = false;
    var i = 0;

    function next() {
      if (i >= order.length) {
        document.body.removeChild(staging);
        var name = (pack.meta && pack.meta.name) ? pack.meta.name : 'techpack';
        var safe = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        doc.save('techpack-' + (safe || 'unsigned') + '.pdf');
        if (window.tpToast) window.tpToast('PDF heruntergeladen ✓');
        return;
      }
      var pid = order[i++];
      var page = pages[pid];
      if (!page) { next(); return; }

      // Render via shared module — same DOM the editor produces, but read-only.
      var rendered = window.tpRender.page(page, {
        editable: false,
        baseStyle: (pack.meta && pack.meta.baseStyle) || 'custom',
        getMockup: window.tpGetMockupSrc,
      });

      // Force fixed dimensions for canvas capture.
      rendered.style.maxWidth = 'none';
      rendered.style.minHeight = '0';
      rendered.style.width = PAGE_PX + 'px';
      rendered.style.height = PAGE_PX + 'px';
      rendered.style.aspectRatio = '';
      rendered.style.boxShadow = 'none';
      rendered.style.border = '0';
      rendered.style.padding = '40px 40px 56px';

      // Clear staging and mount.
      while (staging.firstChild) staging.removeChild(staging.firstChild);
      staging.appendChild(rendered);

      // Wait for fonts + images, then snapshot.
      var doSnapshot = function () {
        window.html2canvas(rendered, {
          backgroundColor: '#ffffff',
          scale: 2,
          useCORS: true,
          allowTaint: true,
          logging: false,
        }).then(function (canvas) {
          var img = canvas.toDataURL('image/jpeg', 0.92);
          if (firstAdded) doc.addPage([PAGE_PX, PAGE_PX], 'portrait');
          firstAdded = true;
          doc.addImage(img, 'JPEG', 0, 0, PAGE_PX, PAGE_PX);
          next();
        }).catch(function (err) {
          console.error('[techpack-pdf] capture fail', err);
          if (window.tpToast) window.tpToast('Seite konnte nicht gerendert werden');
          next();
        });
      };

      var imgs = rendered.querySelectorAll('img');
      if (!imgs.length) { setTimeout(doSnapshot, 80); return; }
      var pending = imgs.length;
      function tick() { pending--; if (pending <= 0) setTimeout(doSnapshot, 40); }
      [].forEach.call(imgs, function (im) {
        if (im.complete && im.naturalWidth > 0) tick();
        else { im.onload = tick; im.onerror = tick; }
      });
      setTimeout(function () { if (pending > 0) { pending = 0; doSnapshot(); } }, 5000);
    }

    if (window.tpToast) window.tpToast('PDF wird gerendert…');
    next();
  }

  window.tpExportPdf = tpExportPdf;
})();
