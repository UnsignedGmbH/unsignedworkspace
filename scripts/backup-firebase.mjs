#!/usr/bin/env node
// Firebase RTDB Backup — pure Node, keine Dependencies.
//
// Liest einen Google Service-Account-Key (JSON) und exportiert die komplette
// Realtime Database als JSON. Ausgabe-Pfad als zweites Argument oder stdout.
//
// Auth-Flow (ohne firebase-admin):
//   1. Service-Account JSON laden (private_key, client_email).
//   2. JWT signieren mit RS256 für audience oauth2.googleapis.com.
//   3. JWT gegen Google OAuth2 Token-Endpoint tauschen → access_token.
//   4. GET https://<databaseURL>/.json?access_token=<token> → JSON.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
//   FIREBASE_DATABASE_URL=https://<id>-default-rtdb.<region>.firebasedatabase.app \
//   node scripts/backup-firebase.mjs [output-path]
//
// In GitHub Actions kommt der SA über ein Secret und wird in eine Datei
// geschrieben (siehe .github/workflows/backup-firebase.yml).

import { createSign } from "node:crypto";
import { writeFileSync, readFileSync } from "node:fs";
import { request } from "node:https";

const SA_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const DB_URL = process.env.FIREBASE_DATABASE_URL;
const OUT_PATH = process.argv[2];

if (!SA_PATH) die("GOOGLE_APPLICATION_CREDENTIALS env var fehlt (Pfad zur SA-JSON).");
if (!DB_URL) die("FIREBASE_DATABASE_URL env var fehlt.");

const sa = JSON.parse(readFileSync(SA_PATH, "utf8"));
if (!sa.client_email || !sa.private_key) die("SA-JSON unvollständig (client_email/private_key fehlen).");

const SCOPE = [
  "https://www.googleapis.com/auth/firebase.database",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

main().catch((e) => die(e.stack || String(e)));

async function main() {
  const token = await getAccessToken(sa);
  const url = new URL("/.json", DB_URL);
  url.searchParams.set("access_token", token);
  const json = await httpGet(url);
  const sizeMB = (json.length / 1024 / 1024).toFixed(2);
  if (OUT_PATH) {
    writeFileSync(OUT_PATH, json);
    console.error(`✓ Backup geschrieben: ${OUT_PATH} (${sizeMB} MB)`);
  } else {
    process.stdout.write(json);
    console.error(`✓ Backup geliefert via stdout (${sizeMB} MB)`);
  }
}

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    scope: SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const encHeader = b64url(JSON.stringify(header));
  const encPayload = b64url(JSON.stringify(payload));
  const signingInput = `${encHeader}.${encPayload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  const signature = signer.sign(sa.private_key);
  const jwt = `${signingInput}.${b64url(signature)}`;

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  }).toString();

  const res = await httpPost(
    new URL("https://oauth2.googleapis.com/token"),
    body,
    { "content-type": "application/x-www-form-urlencoded" }
  );
  const parsed = JSON.parse(res);
  if (!parsed.access_token) {
    die("OAuth-Tausch fehlgeschlagen: " + JSON.stringify(parsed));
  }
  return parsed.access_token;
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = request({
      method: "GET",
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: { accept: "application/json" },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(buf.toString("utf8"));
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${buf.toString("utf8").slice(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function httpPost(url, body, headers) {
  return new Promise((resolve, reject) => {
    const req = request({
      method: "POST",
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: { ...headers, "content-length": Buffer.byteLength(body) },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(text);
        else reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 200)}`));
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function b64url(input) {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function die(msg) {
  console.error("Backup-Fehler:", msg);
  process.exit(1);
}
