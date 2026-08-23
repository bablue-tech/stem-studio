const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function loadEnv() {
  try {
    for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m || line.trim().startsWith('#')) continue;
      if (!(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
}
loadEnv();

const CLOUD = process.env.CLOUDINARY_CLOUD_NAME;
const KEY = process.env.CLOUDINARY_API_KEY;
const SECRET = process.env.CLOUDINARY_API_SECRET;
const PUBLIC_ID = 'stem-studio-cred-check';

if (!CLOUD || !KEY || !SECRET) {
  console.error('Missing CLOUDINARY_* values in .env');
  process.exit(1);
}

function sign(params) {
  return crypto.createHash('sha1').update(`${params}${SECRET}`).digest('hex');
}

async function main() {
  const file = process.argv[2];
  if (!file || !fs.existsSync(file)) {
    console.error('Usage: node scripts/cloud-check.js <audio-file>');
    process.exit(1);
  }

  const ts = Math.floor(Date.now() / 1000);
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(file)], { type: 'audio/mpeg' }), 'check.mp3');
  form.append('public_id', PUBLIC_ID);
  form.append('timestamp', String(ts));
  form.append('api_key', KEY);
  form.append('signature', sign(`public_id=${PUBLIC_ID}&timestamp=${ts}`));

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/video/upload`, { method: 'POST', body: form });
  const j = await res.json();
  if (!res.ok) {
    console.error(`UPLOAD FAILED (${res.status}): ${(j.error && j.error.message) || res.statusText}`);
    process.exit(1);
  }
  console.log(`UPLOAD OK -> ${j.secure_url}`);
  console.log(`bytes: ${j.bytes} | duration: ${j.duration}s | format: ${j.format}`);

  const dts = Math.floor(Date.now() / 1000);
  const df = new URLSearchParams({
    invalidate: 'true',
    public_id: PUBLIC_ID,
    timestamp: String(dts),
    api_key: KEY,
    signature: sign(`invalidate=true&public_id=${PUBLIC_ID}&timestamp=${dts}`)
  });
  const dr = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/video/destroy`, { method: 'POST', body: df });
  const dj = await dr.json();
  console.log(dj.result === 'ok' ? 'CLEANUP OK (test asset deleted)' : `cleanup result: ${dj.result}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
