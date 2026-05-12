// Firebase Cloud Messaging Service Worker
// Wird vom Browser registriert um Push-Events im Hintergrund zu empfangen.
// MUSS unter dem Root-Pfad / liegen damit FCM ihn findet.

importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyBsbWPNZ_lUVHsZA5fEGEsZTbAuO6kPmHM',
  authDomain: 'unsignedworkspace.firebaseapp.com',
  databaseURL: 'https://unsignedworkspace-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'unsignedworkspace',
  // messagingSenderId wird beim getToken-Call vom Frontend dynamisch geliefert
  // (oder aus diesem SW-File ergänzt sobald der User die Sender-ID einträgt).
  messagingSenderId: 'TODO_SENDER_ID',
  appId: 'TODO_APP_ID',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function (payload) {
  const title = (payload && payload.notification && payload.notification.title) || 'Unsigned Workspace';
  const body = (payload && payload.notification && payload.notification.body) || '';
  const url = (payload && payload.data && payload.data.url) || '/portal';
  const options = {
    body: body,
    icon: '/brand/v-dark.png',
    badge: '/brand/v-dark.png',
    data: { url: url },
    requireInteraction: false,
    tag: 'unsigned-prod',
  };
  return self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/portal';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) {
      for (const c of cs) {
        if (c.url.includes(url) && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
