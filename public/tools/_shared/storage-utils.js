// Shared Storage-Upload-Utilities — Migration von base64-in-RTDB zu Cloud Storage.
//
// Loaded via: <script src="/tools/_shared/storage-utils.js"></script>
// Voraussetzung: window.firebase mit storage()-Service (firebase-storage-compat.js).
//
// Exposes:
//   window.storageUtils.uploadDataUrl(dataUrl, path) → Promise<downloadUrl>
//   window.storageUtils.uploadFile(file, path)       → Promise<downloadUrl>
//   window.storageUtils.compressAndUpload(file, path, opts) → Promise<downloadUrl>
//   window.storageUtils.uniqId(prefix)               → kurzer eindeutiger Slug
//   window.storageUtils.isDataUrl(s)                 → boolean
//   window.storageUtils.isStorageUrl(s)              → boolean
//   window.storageUtils.migrateDataUrlField(dbRef, fieldName, storagePath)
//   window.storageUtils.migrateRoom(db, room, tag, opts) — Lazy-Migration aller
//     base64-Bilder eines Customer-Raums nach Storage (idempotent, safe).

(function () {
  if (window.storageUtils) return;

  function uniqId(prefix) {
    var p = prefix || "f";
    return p + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function isDataUrl(s) {
    return typeof s === "string" && s.indexOf("data:") === 0;
  }

  function isStorageUrl(s) {
    return typeof s === "string" && (
      s.indexOf("https://firebasestorage.googleapis.com") === 0 ||
      s.indexOf("https://storage.googleapis.com") === 0
    );
  }

  function getStorage() {
    try {
      if (window.firebase && window.firebase.storage) return window.firebase.storage();
    } catch (e) {}
    return null;
  }

  function dataUrlToBlob(dataUrl) {
    if (!isDataUrl(dataUrl)) return null;
    try {
      var parts = dataUrl.split(",");
      var meta = parts[0];
      var body = parts[1];
      var mimeMatch = /data:([^;]+)/.exec(meta);
      var mime = (mimeMatch && mimeMatch[1]) || "image/jpeg";
      if (meta.indexOf("base64") < 0) {
        var txt = decodeURIComponent(body);
        return new Blob([txt], { type: mime });
      }
      var bin = atob(body);
      var len = bin.length;
      var arr = new Uint8Array(len);
      for (var i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: mime });
    } catch (e) {
      return null;
    }
  }

  function uploadBlob(blob, path) {
    return new Promise(function (resolve, reject) {
      var st = getStorage();
      if (!st) return reject(new Error("storage-not-loaded"));
      if (!blob) return reject(new Error("no-blob"));
      if (!path) return reject(new Error("no-path"));
      try {
        var ref = st.ref(path);
        var task = ref.put(blob, { contentType: blob.type || "image/jpeg" });
        task.then(function (snap) {
          return snap.ref.getDownloadURL();
        }).then(function (url) {
          resolve(url);
        }).catch(function (err) {
          reject(err);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  function uploadDataUrl(dataUrl, path) {
    return new Promise(function (resolve, reject) {
      var blob = dataUrlToBlob(dataUrl);
      if (!blob) return reject(new Error("invalid-data-url"));
      uploadBlob(blob, path).then(resolve).catch(reject);
    });
  }

  function uploadFile(file, path) {
    if (!file) return Promise.reject(new Error("no-file"));
    return uploadBlob(file, path);
  }

  function compressAndUpload(file, path, opts) {
    return new Promise(function (resolve, reject) {
      if (!window.imgUtils || !window.imgUtils.compress) {
        return reject(new Error("img-utils-not-loaded"));
      }
      window.imgUtils.compress(file, function (dataUrl) {
        if (!dataUrl) return reject(new Error("compress-failed"));
        uploadDataUrl(dataUrl, path)
          .then(resolve)
          .catch(function (err) {
            err._dataUrl = dataUrl;
            reject(err);
          });
      }, opts);
    });
  }

  function migrateDataUrlField(dbRef, fieldName, storagePath) {
    if (!dbRef || !fieldName) return Promise.resolve(null);
    return dbRef.child(fieldName).once("value").then(function (snap) {
      var val = snap.val();
      if (!isDataUrl(val)) return null;
      return uploadDataUrl(val, storagePath).then(function (url) {
        return dbRef.child(fieldName).set(url).then(function () {
          return url;
        });
      });
    }).catch(function () { return null; });
  }

  // ─── Lazy-Migration: ganzen Customer-Raum scannen + base64 → Storage ───
  //
  // Sicherheit (kein Datenverlust möglich):
  //  1. Upload zu Storage → liefert URL
  //  2. URL via <img> verifizieren (lädt das Bild wirklich?)
  //  3. NUR DANN: transaction() auf den RTDB-Pfad — ersetzt base64 → URL
  //     transaction() bricht ab, falls der Wert kein data:-String mehr ist
  //     (z.B. weil ein anderes Device schneller war).
  //  4. Bei IRGENDEINEM Fehler: base64 bleibt unverändert in RTDB.
  //
  // Idempotent: kann mehrfach laufen, migriert nur was noch base64 ist.
  // SessionStorage-Flag verhindert Mehrfach-Trigger pro Tab pro Raum.

  function verifyImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var done = false;
      var to = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error("verify-timeout"));
      }, 20000);
      img.onload = function () {
        if (done) return;
        done = true;
        clearTimeout(to);
        resolve();
      };
      img.onerror = function () {
        if (done) return;
        done = true;
        clearTimeout(to);
        reject(new Error("verify-failed"));
      };
      img.src = url;
    });
  }

  function collectDataUrls(value, prefix, out, skipRootKeys) {
    if (value === null || value === undefined) return;
    if (typeof value === "string") {
      if (value.indexOf("data:image") === 0) out.push({ path: prefix, dataUrl: value });
      return;
    }
    if (typeof value !== "object") return;
    for (var k in value) {
      if (!Object.prototype.hasOwnProperty.call(value, k)) continue;
      // Skip ephemeral subtrees at root (e.g. presence, save-pings).
      if (prefix === "" && skipRootKeys && skipRootKeys[k]) continue;
      var childPath = prefix ? prefix + "/" + k : k;
      collectDataUrls(value[k], childPath, out, skipRootKeys);
    }
  }

  function migrateRoom(db, room, tag, opts) {
    opts = opts || {};
    tag = tag || "mig";
    if (!db || !room) return Promise.resolve({ skipped: true, reason: "no-db-or-room" });
    if (!getStorage()) return Promise.resolve({ skipped: true, reason: "no-storage" });

    var sessionKey = "__mig_room_v1_" + room;
    try {
      if (sessionStorage.getItem(sessionKey) === "1") {
        return Promise.resolve({ skipped: true, reason: "session-flag" });
      }
      // Set flag IMMEDIATELY so a second tool-load in the same tab doesn't
      // re-trigger before we even finish reading the root.
      sessionStorage.setItem(sessionKey, "1");
    } catch (e) { /* sessionStorage unavailable, run anyway */ }

    var maxConcurrent = opts.maxConcurrent || 2;
    var onProgress = opts.onProgress || function () {};
    var skipRootKeys = { pres: true, presence: true, _ping: true };

    var rootRef = db.ref("rooms/" + room);

    return rootRef.once("value").then(function (snap) {
      var data = snap.val();
      var items = [];
      collectDataUrls(data, "", items, skipRootKeys);
      var total = items.length;

      if (!total) {
        onProgress({ phase: "empty", total: 0, done: 0, failed: 0 });
        return { migrated: 0, failed: 0, total: 0, skipped: false };
      }

      onProgress({ phase: "start", total: total, done: 0, failed: 0 });

      return new Promise(function (resolve) {
        var done = 0, failed = 0, idx = 0, active = 0;

        function migrateOne(item) {
          var storagePath = "rooms/" + room + "/migrated/" + uniqId("m") + ".jpg";
          return uploadDataUrl(item.dataUrl, storagePath).then(function (url) {
            return verifyImage(url).then(function () { return url; });
          }).then(function (url) {
            // Atomar ersetzen — nur wenn der Wert noch ein data: String ist.
            return rootRef.child(item.path).transaction(function (curr) {
              if (typeof curr === "string" && curr.indexOf("data:") === 0) return url;
              return; // abort, lassen wie es ist
            });
          }).then(function () { return true; })
            .catch(function (err) {
              try { console.warn("[" + tag + "] migrate failed", item.path, err && err.message); } catch (e) {}
              return false;
            });
        }

        function pump() {
          while (active < maxConcurrent && idx < total) {
            var item = items[idx++];
            active++;
            migrateOne(item).then(function (ok) {
              active--;
              if (ok) done++; else failed++;
              onProgress({ phase: "progress", total: total, done: done, failed: failed });
              if (done + failed >= total) {
                resolve({ migrated: done, failed: failed, total: total, skipped: false });
              } else {
                pump();
              }
            });
          }
        }

        pump();
      });
    }).catch(function (err) {
      try { console.error("[" + tag + "] migrate root-read failed", err); } catch (e) {}
      // Flag wieder freigeben damit beim nächsten Page-Load erneut versucht wird.
      try { sessionStorage.removeItem(sessionKey); } catch (e) {}
      return { migrated: 0, failed: 0, total: 0, skipped: true, reason: "read-failed" };
    });
  }

  window.storageUtils = {
    uploadDataUrl: uploadDataUrl,
    uploadFile: uploadFile,
    compressAndUpload: compressAndUpload,
    migrateDataUrlField: migrateDataUrlField,
    migrateRoom: migrateRoom,
    uniqId: uniqId,
    isDataUrl: isDataUrl,
    isStorageUrl: isStorageUrl,
    dataUrlToBlob: dataUrlToBlob,
    verifyImage: verifyImage,
  };
})();
