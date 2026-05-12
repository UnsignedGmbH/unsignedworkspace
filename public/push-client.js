// Push-Client — wird vom Customer-Portal geladen.
// Registriert den Service-Worker, holt FCM-Token, speichert ihn in RTDB unter dem Raum.
//
// Voraussetzungen:
//   - public/firebase-messaging-sw.js liegt am Root-Pfad
//   - Apple/iOS: App muss zum Homescreen hinzugefuegt sein (PWA-Mode)
//   - VAPID-Key + messagingSenderId muessen in der Firebase-Konsole erstellt sein

window.UWPush = (function () {
  // ─── KONFIGURATION ────────────────────────────────────────
  // VAPID Public Key (aus Firebase Console -> Cloud Messaging -> Web Push)
  var VAPID_KEY = 'BLhQElVSG_tl3STNtC034BZLYkQ_P4laQ_S3-fnvrzFxzqgoMs7JBlIR5zABMvKoQivhJPGZU6mUspsc-yHEoZg';
  // Cloud Messaging Sender-ID (aus Firebase Console -> Project Settings -> General)
  // !!! TODO: Hier den Sender-ID Wert einsetzen (ist die "Project number") !!!
  var MESSAGING_SENDER_ID = 'TODO_SENDER_ID';
  // App-ID (auch aus Project Settings -> Allgemein, am Ende des Snippets)
  var APP_ID = 'TODO_APP_ID';

  // ─── State ────────────────────────────────────────────────
  var _ready = false;
  var _msg = null;
  var _swReg = null;

  function isSupported() {
    return ('serviceWorker' in navigator) && ('Notification' in window) && ('PushManager' in window);
  }

  function isIOSStandalone() {
    return (window.navigator.standalone === true) ||
           (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }

  function permState() {
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission;  // 'default' | 'granted' | 'denied'
  }

  function loadFirebaseSDK() {
    return new Promise(function (resolve, reject) {
      if (window.firebase && window.firebase.messaging) return resolve();
      var sa = document.createElement('script');
      sa.src = 'https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js';
      sa.onload = function () {
        var sb = document.createElement('script');
        sb.src = 'https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js';
        sb.onload = function () { resolve(); };
        sb.onerror = function () { reject(new Error('messaging SDK load failed')); };
        document.head.appendChild(sb);
      };
      sa.onerror = function () { reject(new Error('app SDK load failed')); };
      document.head.appendChild(sa);
    });
  }

  function ensureInit() {
    if (_ready) return Promise.resolve();
    return loadFirebaseSDK().then(function () {
      if (!firebase.apps || firebase.apps.length === 0) {
        firebase.initializeApp({
          apiKey: 'AIzaSyBsbWPNZ_lUVHsZA5fEGEsZTbAuO6kPmHM',
          authDomain: 'unsignedworkspace.firebaseapp.com',
          databaseURL: 'https://unsignedworkspace-default-rtdb.europe-west1.firebasedatabase.app',
          projectId: 'unsignedworkspace',
          messagingSenderId: MESSAGING_SENDER_ID,
          appId: APP_ID,
        });
      }
      _msg = firebase.messaging();
      _ready = true;
    });
  }

  function registerSW() {
    if (_swReg) return Promise.resolve(_swReg);
    return navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' })
      .then(function (reg) {
        _swReg = reg;
        return reg;
      });
  }

  function persistToken(room, token) {
    if (!room || !token || !window.firebase) return Promise.resolve();
    try {
      var db = firebase.database();
      var payload = {
        ts: Date.now(),
        ua: (navigator.userAgent || '').slice(0, 200),
      };
      return db.ref('rooms/' + room + '/fcmTokens/' + token).set(payload);
    } catch (e) {
      return Promise.reject(e);
    }
  }

  // Hauptfunktion: Permission anfragen + Token holen + speichern
  function subscribe(room) {
    if (!isSupported()) {
      return Promise.reject(new Error('Browser unterstuetzt keine Push-Notifications.'));
    }
    if (MESSAGING_SENDER_ID === 'TODO_SENDER_ID') {
      return Promise.reject(new Error('Setup unvollstaendig: messagingSenderId fehlt in push-client.js.'));
    }
    return ensureInit()
      .then(registerSW)
      .then(function () {
        return Notification.requestPermission();
      })
      .then(function (perm) {
        if (perm !== 'granted') throw new Error('Benachrichtigungen wurden abgelehnt.');
        return _msg.getToken({
          vapidKey: VAPID_KEY,
          serviceWorkerRegistration: _swReg,
        });
      })
      .then(function (token) {
        if (!token) throw new Error('Kein FCM-Token erhalten.');
        return persistToken(room, token).then(function () { return token; });
      });
  }

  // Refresh: bei jedem App-Boot ausfuehren wenn Permission schon granted ist
  function refresh(room) {
    if (!isSupported()) return Promise.resolve(null);
    if (permState() !== 'granted') return Promise.resolve(null);
    if (MESSAGING_SENDER_ID === 'TODO_SENDER_ID') return Promise.resolve(null);
    return ensureInit()
      .then(registerSW)
      .then(function () {
        return _msg.getToken({
          vapidKey: VAPID_KEY,
          serviceWorkerRegistration: _swReg,
        });
      })
      .then(function (token) {
        if (!token) return null;
        return persistToken(room, token).then(function () { return token; });
      })
      .catch(function () { return null; });
  }

  return {
    isSupported: isSupported,
    isIOSStandalone: isIOSStandalone,
    permState: permState,
    subscribe: subscribe,
    refresh: refresh,
  };
})();
