// Shared image helpers for tools (design.html, techpack.html, …).
//
// Loaded via: <script src="/tools/_shared/img-utils.js"></script>
//
// Exposes:
//   window.imgUtils.safeName(s)             slugify for filenames
//   window.imgUtils.compress(file, cb, opts) File → resized base64 jpeg dataURL
//                                             opts: { maxWidth?: number = 2400,
//                                                     quality?:  number = 0.95 }
//   window.imgUtils.downloadImage(src, name) data: or http URL → file download
//
// Also sets window.compress, window.downloadImage as legacy globals so existing
// inline references in older tools keep working without edits.

(function () {
  if (window.imgUtils) return;

  function safeName(s) {
    return (s || "").toString().toLowerCase()
      .replace(/[^a-z0-9äöüß]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "unbenannt";
  }

  function compress(file, cb, opts) {
    if (!file || !cb) return;
    opts = opts || {};
    var maxW = opts.maxWidth || 2400;
    var q = (opts.quality != null) ? opts.quality : 0.95;
    var r = new FileReader();
    r.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        var w = img.width, h = img.height;
        if (w > maxW) {
          h = Math.round(h * maxW / w);
          w = maxW;
        }
        var c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        cb(c.toDataURL("image/jpeg", q));
      };
      img.onerror = function () { cb(null); };
      img.src = e.target.result;
    };
    r.onerror = function () { cb(null); };
    r.readAsDataURL(file);
  }

  function _toast(msg) {
    try {
      if (typeof window.toast === "function") window.toast(msg);
    } catch (e) {}
  }

  function downloadImage(src, name) {
    if (!src) return;
    var fname = (name || "unsigned-image") + ".jpg";
    if (src.indexOf("data:") === 0) {
      // Data-URL: direkt downloadbar, garantiert CORS-frei.
      var a = document.createElement("a");
      a.href = src;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      a.remove();
      _toast("Heruntergeladen ✓");
      return;
    }
    if (src.indexOf("http") === 0) {
      // Externe URL: erst fetch+blob versuchen, bei CORS-Fail neuen Tab oeffnen.
      fetch(src, { mode: "cors" })
        .then(function (r) {
          if (!r.ok) throw new Error("http " + r.status);
          return r.blob();
        })
        .then(function (b) {
          var url = URL.createObjectURL(b);
          var a = document.createElement("a");
          a.href = url;
          a.download = fname;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
          _toast("Heruntergeladen ✓");
        })
        .catch(function () {
          window.open(src, "_blank", "noopener,noreferrer");
          _toast("Tab geöffnet — Rechtsklick → Bild speichern unter…");
        });
      return;
    }
    _toast("Format nicht unterstützt");
  }

  window.imgUtils = {
    safeName: safeName,
    compress: compress,
    downloadImage: downloadImage,
  };

  // Legacy globals so existing inline references keep working
  if (!window.compress) window.compress = compress;
  if (!window.downloadImage) window.downloadImage = downloadImage;
})();
