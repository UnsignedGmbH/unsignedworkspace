// Dynamic PWA Manifest — pro Customer eine eigene start_url.
// Wenn ein Kunde sein Portal mit ?room=XYZ aufruft und „Zum Home-Bildschirm"
// klickt, soll das Homescreen-Icon das Portal mit GENAU diesem Raum öffnen,
// nicht das Owner-Dashboard.
//
// Aufruf: /api/manifest?room=XYZ   (oder ohne param → Standard-Manifest)

export const config = {
  runtime: 'nodejs',
};

export default function handler(req, res) {
  const room = (req.query && req.query.room ? String(req.query.room) : '').trim();
  const startUrl = room
    ? '/portal?room=' + encodeURIComponent(room) + '&pwa=1'
    : '/';

  const manifest = {
    name: 'Unsigned Workspace',
    short_name: 'Unsigned',
    description: room
      ? 'Dein persönlicher Brand-Workspace'
      : 'Brand Identity & Production Workspace',
    lang: 'de',
    dir: 'ltr',
    start_url: startUrl,
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    theme_color: '#c13030',
    background_color: '#f4f3f0',
    icons: [
      { src: '/brand/v-dark.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/v-dark.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/v-dark.png', sizes: '1080x1080', type: 'image/png', purpose: 'any maskable' },
    ],
  };

  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, must-revalidate');
  res.status(200).send(JSON.stringify(manifest));
}
