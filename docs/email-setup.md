# E-Mail-Versand einrichten (Kunden-Zugang per Mail)

Damit Kunden sich im Portal ihren persönlichen Zugangs-Link **per E-Mail** schicken können
(„Zugang sichern → ✉ Per E-Mail sichern"), brauchst du einen Mail-Versanddienst. Wir nutzen
**[Resend](https://resend.com)** (kostenlose Stufe: ~3.000 Mails/Monat, ~100/Tag).

Ohne diese Einrichtung bleibt der Button im Portal sichtbar, meldet aber sauber
„E-Mail-Versand ist noch nicht eingerichtet." — es geht also nichts kaputt.

## 1. Resend-Account + API-Key

1. Auf <https://resend.com> kostenlos registrieren.
2. Links auf **API Keys** → **Create API Key** → Name z. B. `unsigned-portal` → **Sending access**.
3. Den Key (beginnt mit `re_…`) kopieren — **wird nur einmal angezeigt.**

## 2. Absender-Domain verifizieren (wichtig gegen Spam)

Damit Mails an deine Kunden ankommen (statt im Spam zu landen), muss der Absender von **deiner
eigenen Domain** kommen, z. B. `unsigned-global.com`.

1. In Resend: **Domains** → **Add Domain** → `unsigned-global.com` eingeben.
2. Resend zeigt ein paar **DNS-Einträge** (TXT/MX/CNAME für SPF, DKIM). Diese bei deinem
   Domain-Anbieter (wo `unsigned-global.com` verwaltet wird) eintragen.
3. Zurück in Resend auf **Verify** klicken — kann ein paar Minuten dauern, bis „Verified".

> Zum schnellen Testen geht auch Resends Test-Absender `onboarding@resend.dev` — der schickt
> aber **nur an deine eigene** (im Resend-Account hinterlegte) Adresse. Für echte Kunden ist
> die verifizierte Domain Pflicht.

## 3. Variablen in Vercel hinterlegen

Vercel → dein Projekt → **Settings → Environment Variables** → für **Production** (und Preview)
anlegen:

| Name | Pflicht | Wert / Beispiel |
|------|---------|-----------------|
| `RESEND_API_KEY` | ✅ | dein `re_…`-Key aus Schritt 1 |
| `MAIL_FROM` | ✅ (empfohlen) | `Unsigned Workspace <portal@unsigned-global.com>` — die Adresse muss zur **verifizierten Domain** gehören |
| `LINK_DAILY_LIMIT` | optional | Max. E-Mails pro Raum/Tag (Standard `5`, Anti-Spam) |

`FIREBASE_SERVICE_ACCOUNT` ist bereits gesetzt (für die anderen Functions) — nichts zu tun.

Nach dem Speichern: **einmal neu deployen** (Vercel → Deployments → Redeploy), damit die
Variablen aktiv werden.

## 4. Testen (nach Deploy)

1. Ein Portal öffnen (`/portal?room=<CODE>`) → Karte **„Dein Zugang"** → **✉ Per E-Mail sichern**
   → deine eigene E-Mail eingeben → **Link senden**.
2. Postfach prüfen (auch Spam): Mail mit Button „Zu meinem Workspace →" + Zugangs-Code.
3. Der Link führt direkt in den Raum. Die eingegebene Adresse wird unter
   `rooms/<CODE>/contact` gespeichert (Kontakt für dich).

## Fehlermeldungen

- **„noch nicht eingerichtet"** → `RESEND_API_KEY` fehlt oder Deploy nach dem Setzen vergessen.
- **„… Domain verifizieren"** → `MAIL_FROM` nutzt eine in Resend nicht verifizierte Domain.
- **„Tageslimit erreicht"** → mehr als `LINK_DAILY_LIMIT` Mails für denselben Raum heute.
