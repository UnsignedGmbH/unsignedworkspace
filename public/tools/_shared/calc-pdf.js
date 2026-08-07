/* calc-pdf.js — generischer A4-Sheet→PDF-Export für die Kalkulatoren.
 * window.calcExportPdf(sheetEl, filename) rendert das (versteckte) Sheet-DOM
 * per html2canvas und speichert es als einseitiges A4-PDF (jsPDF).
 * jsPDF + html2canvas werden erst beim ersten Klick vom CDN geladen
 * (gleiches Pattern wie techpack.html). */
(function () {
  "use strict";

  var CDN = [
    "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
  ];
  var libsPromise = null;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error("Ladefehler: " + src)); };
      document.head.appendChild(s);
    });
  }

  function ensureLibs() {
    if (window.jspdf && window.html2canvas) return Promise.resolve();
    if (!libsPromise) {
      libsPromise = Promise.all(CDN.map(loadScript)).catch(function (e) {
        libsPromise = null; // nächster Klick versucht es erneut
        throw e;
      });
    }
    return libsPromise;
  }

  function notify(msg, kind) {
    try { window.toast(msg, kind || "info"); } catch (e) {}
  }

  // sheetEl: DOM-Node des A4-Sheets (darf display:none-Parent haben — wird geklont)
  // filename: z.B. "Angebot_Fulfillment_Kunde_2026-08-06.pdf"
  window.calcExportPdf = function (sheetEl, filename) {
    notify("PDF wird erstellt …");
    var stage = null;
    return ensureLibs()
      .then(function () {
        return document.fonts && document.fonts.ready
          ? document.fonts.ready
          : Promise.resolve();
      })
      .then(function () {
        // Off-screen-Staging: sichtbar für html2canvas, unsichtbar für den User.
        stage = document.createElement("div");
        stage.style.cssText =
          "position:fixed;left:0;top:-400vh;width:794px;background:#0E0E0E;z-index:-1;";
        var clone = sheetEl.cloneNode(true);
        clone.style.display = "block";
        stage.appendChild(clone);
        document.body.appendChild(stage);
        return window.html2canvas(clone, {
          scale: 2,
          backgroundColor: "#0E0E0E",
          useCORS: true,
          logging: false,
        });
      })
      .then(function (canvas) {
        var jsPDF = window.jspdf.jsPDF;
        var doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
        // Seite komplett füllen; Sheet ist im A4-Verhältnis aufgebaut.
        var img = canvas.toDataURL("image/jpeg", 0.92);
        doc.addImage(img, "JPEG", 0, 0, 210, 297, undefined, "FAST");
        doc.save(filename);
        notify("PDF gespeichert: " + filename, "success");
      })
      .catch(function (err) {
        console.error("[calc-pdf]", err);
        notify("PDF-Export fehlgeschlagen: " + ((err && err.message) || err), "error");
      })
      .finally(function () {
        if (stage && stage.parentNode) stage.parentNode.removeChild(stage);
      });
  };
})();
