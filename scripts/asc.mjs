#!/usr/bin/env node
// asc.mjs: a tiny App Store Connect API client for Xcode Cloud and TestFlight checks.
//
//   node scripts/asc.mjs builds                 latest TestFlight builds and their state
//   node scripts/asc.mjs runs                   latest Xcode Cloud runs
//   node scripts/asc.mjs run <runId> [--wait]   one run's actions and issues (--wait: until it finishes)
//   node scripts/asc.mjs GET /v1/...            any read-only API path
//
// The key never lives in this repo. It reads $ASC_ENV (default /Volumes/Storage/AI/secrets/asc.env) with
// ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_FILE (the .p8). Zero dependencies: ES256 JWT via node:crypto.

import { readFileSync } from 'node:fs';
import { createSign, createPrivateKey } from 'node:crypto';

const APP_ID = '6816595457';
const CI_PRODUCT = 'a63584bc-ff6e-460d-a5cc-b493f657dd9d';
const envFile = process.env.ASC_ENV ?? '/Volumes/Storage/AI/secrets/asc.env';
const env = Object.fromEntries(readFileSync(envFile, 'utf8').trim().split('\n').map((l) => l.split('=')));

function token() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'ES256', kid: env.ASC_KEY_ID, typ: 'JWT' });
  const body = b64({ iss: env.ASC_ISSUER_ID, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' });
  const sig = createSign('SHA256').update(`${head}.${body}`)
    .sign({ key: createPrivateKey(readFileSync(env.ASC_KEY_FILE)), dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${sig.toString('base64url')}`;
}

export async function asc(path) {
  const r = await fetch(`https://api.appstoreconnect.apple.com${path}`, { headers: { authorization: `Bearer ${token()}` } });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function builds() {
  const b = await asc(`/v1/builds?filter[app]=${APP_ID}&sort=-uploadedDate&limit=5&include=preReleaseVersion,buildBetaDetail`);
  const inc = Object.fromEntries((b.included ?? []).map((x) => [x.type + x.id, x.attributes]));
  for (const x of b.data) {
    const v = inc[`preReleaseVersions${x.relationships.preReleaseVersion.data.id}`]?.version;
    const beta = inc[`buildBetaDetails${x.relationships.buildBetaDetail.data.id}`]?.internalBuildState;
    console.log(`${v} (${x.attributes.version})  ${x.attributes.processingState}  ${beta}  ${x.attributes.uploadedDate}`);
  }
}

async function runs() {
  const r = await asc(`/v1/ciProducts/${CI_PRODUCT}/buildRuns?limit=5&sort=-number`);
  for (const b of r.data) {
    const a = b.attributes;
    console.log(`#${a.number}  ${b.id}  ${a.executionProgress}/${a.completionStatus ?? '-'}  ${a.sourceCommit?.commitSha?.slice(0, 7)}  ${a.createdDate}`);
  }
}

async function run(id, wait) {
  for (;;) {
    const a = await asc(`/v1/ciBuildRuns/${id}/actions`);
    const done = a.data.every((x) => x.attributes.executionProgress === 'COMPLETE');
    if (done || !wait) {
      for (const x of a.data) {
        console.log(`${x.attributes.name}: ${x.attributes.executionProgress}/${x.attributes.completionStatus ?? '-'}`);
        const issues = await asc(`/v1/ciBuildActions/${x.id}/issues?limit=50`);
        for (const i of issues.data) console.log(`  ${i.attributes.issueType}: ${i.attributes.message?.slice(0, 300)}`);
      }
      return;
    }
    await new Promise((r) => setTimeout(r, 20_000));
  }
}

const [cmd, arg, flag] = process.argv.slice(2);
if (cmd === 'builds') await builds();
else if (cmd === 'runs') await runs();
else if (cmd === 'run') await run(arg, flag === '--wait');
else if (cmd === 'GET') console.log(JSON.stringify(await asc(arg), null, 1));
else console.log('usage: node scripts/asc.mjs builds | runs | run <id> [--wait] | GET /v1/...');
