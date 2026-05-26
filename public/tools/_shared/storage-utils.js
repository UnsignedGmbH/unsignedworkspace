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

  window.storageUtils = {
    uploadDataUrl: uploadDataUrl,
    uploadFile: uploadFile,
    compressAndUpload: compressAndUpload,
    migrateDataUrlField: migrateDataUrlField,
    uniqId: uniqId,
    isDataUrl: isDataUrl,
    isStorageUrl: isStorageUrl,
    dataUrlToBlob: dataUrlToBlob,
  };
})();
