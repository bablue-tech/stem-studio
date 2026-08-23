const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const { spawn } = require('child_process');

function loadEnv() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m || line.trim().startsWith('#')) continue;
      if (!(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
}
loadEnv();

const app = express();
const PORT = process.env.PORT || 3010;
const ROOT = __dirname;
const JOBS_DIR = path.join(ROOT, 'jobs');
const VENV_PYTHON = process.env.PYTHON || path.join(ROOT, '.venv', 'Scripts', 'python.exe');
const FFMPEG_DIR = path.join(ROOT, 'tools', 'ffmpeg');

const STEMS = ['vocals', 'drums', 'bass', 'other'];
const CLOUD_CDN = process.env.CLOUDINARY_CLOUD_NAME
  ? `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}`
  : '';
const MODELS = {
  htdemucs: 'Standard · fast',
  htdemucs_ft: 'Fine-tuned · best quality'
};
const ALLOWED_EXT = new Set(['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.opus', '.aac', '.wma', '.aif', '.aiff']);
const MAX_BYTES = 100 * 1024 * 1024;
const TTL_MS = 24 * 60 * 60 * 1000;

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; ` +
    `font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self' ${CLOUD_CDN}; media-src 'self' ${CLOUD_CDN}; ` +
    `object-src 'none'; base-uri 'self'; form-action 'self'`
  );
  if (req.path.startsWith('/api/')) console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});
app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(ROOT, 'public'), {
  etag: true,
  setHeaders(res) {
    res.setHeader('Cache-Control', 'no-cache');
  }
}));
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

/* ---------- job store ---------- */

const jobs = new Map();

function saveMeta(job) {
  try {
    fs.writeFileSync(path.join(JOBS_DIR, job.id, 'meta.json'), JSON.stringify(job, null, 2));
  } catch {}
}

async function hydrate() {
  await fsp.mkdir(JOBS_DIR, { recursive: true });
  for (const entry of await fsp.readdir(JOBS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const metaPath = path.join(JOBS_DIR, entry.name, 'meta.json');
    try {
      const meta = JSON.parse(await fsp.readFile(metaPath, 'utf8'));
      if (meta && meta.id === entry.name) {
        if (meta.status === 'queued' || meta.status === 'separating') {
          meta.status = 'error';
          meta.error = 'Interrupted by server restart.';
        }
        jobs.set(meta.id, meta);
      }
    } catch {}
  }
}

function sanitizeName(name) {
  return String(name || '').replace(/[^\w\s.\-()&']/g, '_').slice(0, 120).trim() || 'song';
}

/* ---------- queue ---------- */

const queue = [];
let activeChild = null;

function enqueue(jobId) {
  queue.push(jobId);
  setImmediate(pump);
}

function pump() {
  if (activeChild) return;
  while (queue.length) {
    const id = queue.shift();
    const job = jobs.get(id);
    if (!job || job.status !== 'queued') continue;
    runJob(job);
    return;
  }
}

function childEnv() {
  return { ...process.env, PATH: `${FFMPEG_DIR};${process.env.PATH || ''}`, HF_HUB_DISABLE_SYMLINKS_WARNING: '1' };
}

/* ---------- cloud storage ---------- */

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || '';
const CLOUD_KEY = process.env.CLOUDINARY_API_KEY || '';
const CLOUD_SECRET = process.env.CLOUDINARY_API_SECRET || '';
const cloudEnabled = () => !!(CLOUD_NAME && CLOUD_KEY && CLOUD_SECRET);

async function cloudUpload(filePath, publicId) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHash('sha1')
    .update(`public_id=${publicId}&timestamp=${timestamp}${CLOUD_SECRET}`)
    .digest('hex');
  const bytes = await fsp.readFile(filePath);
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'audio/mpeg' }), path.basename(filePath));
  form.append('public_id', publicId);
  form.append('timestamp', String(timestamp));
  form.append('api_key', CLOUD_KEY);
  form.append('signature', signature);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/video/upload`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`cloudinary ${res.status}`);
  return (await res.json()).secure_url;
}

function attachmentUrl(url, name) {
  return url.replace('/upload/', `/upload/fl_attachment:${encodeURIComponent(name)}/`);
}

function probeDuration(filePath) {
  return new Promise(resolve => {
    const p = spawn(path.join(FFMPEG_DIR, 'ffprobe.exe'), [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath
    ]);
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.on('error', () => resolve(null));
    p.on('close', code => {
      const n = parseFloat(String(out).trim());
      resolve(code === 0 && Number.isFinite(n) ? Math.round(n * 10) / 10 : null);
    });
  });
}

async function runJob(job) {
  const jobDir = path.join(JOBS_DIR, job.id);
  const sepDir = path.join(jobDir, '.sep');
  const inputPath = path.join(jobDir, `track${job.ext}`);
  job.status = 'separating';
  job.startedAt = new Date().toISOString();
  saveMeta(job);

  await new Promise(resolve => {
    const args = ['-m', 'demucs', '--mp3', '-n', job.model, '-o', sepDir, inputPath];
    const child = spawn(VENV_PYTHON, args, { env: childEnv(), windowsHide: true });
    activeChild = child;

    let errTail = '';
    let frameBuf = '';
    let bagTotal = 1;
    let barPct = 0;
    let barsDone = 0;

    const consumeFrame = frame => {
      const bag = frame.match(/bag of (\d+) models/i);
      if (bag) bagTotal = Math.max(1, parseInt(bag[1], 10));
      const m = [...frame.matchAll(/(\d{1,3})\s*%/g)].pop();
      if (!m) return;
      const p = parseInt(m[1], 10);
      if (barPct > 60 && p < barPct - 15) barsDone += 1;
      barPct = p;
      const overall = Math.min(99, Math.round((barsDone * 100 + p) / bagTotal));
      if (overall > job.progress) job.progress = overall;
    };

    const collect = chunk => {
      const text = String(chunk);
      errTail = (errTail + text).slice(-8000);
      frameBuf += text;
      const parts = frameBuf.split(/\r\n|\r|\n/);
      frameBuf = parts.pop();
      parts.forEach(consumeFrame);
    };
    child.stderr.on('data', collect);
    child.stdout.on('data', collect);

    child.on('error', async err => {
      job.status = 'error';
      job.error = `Failed to launch python: ${err.message}`;
      resolve();
    });

    child.on('close', async code => {
      consumeFrame(frameBuf);
      try {
        if (code === 0) {
          const srcDir = path.join(sepDir, job.model, 'track');
          const stems = [];
          for (const stem of STEMS) {
            const src = path.join(srcDir, `${stem}.mp3`);
            const dest = path.join(jobDir, `${stem}.mp3`);
            await fsp.copyFile(src, dest);
            const size = (await fsp.stat(dest)).size;
            stems.push({ file: `${stem}.mp3`, size });
          }
          job.stems = stems;
          if (cloudEnabled()) {
            try {
              for (const s of job.stems) {
                const dest = path.join(jobDir, s.file);
                s.url = await cloudUpload(dest, `${job.id}/${s.file.replace('.mp3', '')}`);
                await fsp.rm(dest, { force: true });
              }
              job.cloud = true;
              console.log(`[job ${job.id.slice(0, 8)}] stems uploaded to cloud storage`);
            } catch (err) {
              console.error(`[job ${job.id.slice(0, 8)}] cloud upload failed (${err.message}) — keeping local copies`);
            }
          }
          const origName = `original${job.ext}`;
          const origPath = path.join(jobDir, origName);
          await fsp.rename(inputPath, origPath).catch(() => {});
          try {
            job.original = { file: origName, size: (await fsp.stat(origPath)).size };
          } catch {}
          if (cloudEnabled()) {
            try {
              job.original.url = await cloudUpload(origPath, `${job.id}/original`);
              await fsp.rm(origPath, { force: true });
              console.log(`[job ${job.id.slice(0, 8)}] original uploaded to cloud storage`);
            } catch (err) {
              console.error(`[job ${job.id.slice(0, 8)}] original upload failed (${err.message}) — keeping local copy`);
            }
          }
          job.progress = 100;
          job.status = 'done';
        } else {
          job.status = 'error';
          const lines = errTail.split(/\r?\n|\r/).map(l => l.trim()).filter(Boolean);
          job.error = lines[lines.length - 1] || `Demucs exited with code ${code}`;
        }
      } catch (err) {
        job.status = 'error';
        job.error = `Post-processing failed: ${err.message}`;
      } finally {
        fsp.rm(sepDir, { recursive: true, force: true }).catch(() => {});
      }
      resolve();
    });
  });

  if (job.status === 'done' || job.status === 'error') job.finishedAt = new Date().toISOString();
  saveMeta(job);
  console.log(`[job ${job.id.slice(0, 8)}] ${job.status}${job.status === 'error' ? ` — ${job.error}` : ''}`);
  activeChild = null;
  pump();
}

/* ---------- upload ---------- */

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, req.jobDir),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname || '') || '.mp3').toLowerCase();
    req.uploadExt = ALLOWED_EXT.has(ext) ? ext : '';
    cb(null, `track${req.uploadExt}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = (path.extname(file.originalname || '') || '').toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return cb(new Error('UNSUPPORTED_FORMAT'));
    cb(null, true);
  }
});

app.post('/api/separate', (req, res, next) => {
  req.jobId = crypto.randomUUID();
  req.jobDir = path.join(JOBS_DIR, req.jobId);
  fs.mkdirSync(req.jobDir, { recursive: true });
  next();
}, upload.single('audio'), async (req, res) => {
  const { jobId, jobDir, file } = req;

  const fail = async status => {
    await fsp.rm(jobDir, { recursive: true, force: true }).catch(() => {});
    res.status(status).json({ ok: false, error: status === 413 ? 'File exceeds the 100 MB limit.' : 'Please provide a valid audio file.' });
  };

  if (!file || !req.uploadExt) return void (await fail(400));

  const model = MODELS[req.body.model] ? req.body.model : 'htdemucs';
  const originalName = sanitizeName(file.originalname);
  const baseName = originalName.replace(/\.[^.]+$/, '');

  const job = {
    id: jobId,
    originalName,
    baseName,
    model,
    modelLabel: MODELS[model],
    ext: req.uploadExt,
    status: 'queued',
    progress: 0,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    error: null,
    durationSec: await probeDuration(file.path),
    sizeBytes: file.size,
    stems: []
  };

  jobs.set(jobId, job);
  saveMeta(job);
  enqueue(jobId);
  res.status(202).json({ ok: true, jobId, model, modelLabel: MODELS[model] });
});

/* ---------- api reads ---------- */

function jobPublic(job) {
  const { id, originalName, baseName, model, modelLabel, status, progress, createdAt, startedAt, finishedAt, error, durationSec, sizeBytes, stems } = job;
  return { id, originalName, baseName, model, modelLabel, status, progress, createdAt, startedAt, finishedAt, error, durationSec, sizeBytes, stems, hasOriginal: !!job.original };
}

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ ok: false, error: 'Job not found.' });
  res.json({ ok: true, job: jobPublic(job) });
});

app.get('/api/jobs', (req, res) => {
  const list = [...jobs.values()]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map(jobPublic);
  res.json({ ok: true, count: list.length, jobs: list });
});

app.delete('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ ok: false, error: 'Job not found.' });
  if (job.status === 'queued' || job.status === 'separating') {
    return res.status(409).json({ ok: false, error: 'Job is still in progress.' });
  }
  jobs.delete(job.id);
  fsp.rm(path.join(JOBS_DIR, job.id), { recursive: true, force: true }).catch(() => {});
  res.json({ ok: true });
});

app.get('/stems/:id/:file', (req, res) => {
  const { id, file } = req.params;
  const job = jobs.get(id);
  const stemMatch = STEMS.map(s => `${s}.mp3`).includes(file);
  if (!job || job.status !== 'done' || !stemMatch) {
    return res.status(404).json({ ok: false, error: 'Stem not found.' });
  }
  const entry = (job.stems || []).find(s => s.file === file);
  if (!entry) return res.status(404).json({ ok: false, error: 'Stem not found.' });

  if (entry.url) {
    if (req.query.dl) {
      const stem = path.basename(file, '.mp3');
      return res.redirect(302, attachmentUrl(entry.url, `${job.baseName}_${stem}`));
    }
    return res.redirect(302, entry.url);
  }

  const filePath = path.join(JOBS_DIR, id, file);
  if (req.query.dl) {
    const stem = path.basename(file, '.mp3');
    res.setHeader('Content-Type', 'audio/mpeg');
    res.attachment(`${job.baseName}_${stem}.mp3`);
  }
  res.sendFile(filePath);
});

app.get('/original/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== 'done' || !job.original) {
    return res.status(404).json({ ok: false, error: 'Original not found.' });
  }
  const ext = path.extname(job.original.file) || '.mp3';
  if (job.original.url) {
    if (req.query.dl) {
      return res.redirect(302, attachmentUrl(job.original.url, `${job.baseName}_original${ext}`));
    }
    return res.redirect(302, job.original.url);
  }
  const filePath = path.join(JOBS_DIR, job.id, job.original.file);
  if (req.query.dl) res.attachment(`${job.baseName}_original${ext}`);
  res.sendFile(filePath);
});

/* ---------- ttl sweeper ---------- */

setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.status === 'queued' || job.status === 'separating') continue;
    const t = Date.parse(job.finishedAt || job.createdAt);
    if (Number.isFinite(t) && now - t > TTL_MS) {
      jobs.delete(id);
      fsp.rm(path.join(JOBS_DIR, id), { recursive: true, force: true }).catch(() => {});
    }
  }
}, 30 * 60 * 1000).unref();

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'stem-studio-api',
    storage: cloudEnabled() ? 'cloudinary' : 'local',
    queueDepth: queue.length,
    busy: !!activeChild,
    uptime: process.uptime()
  });
});

app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, error: 'Endpoint not found' });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error(err);
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ ok: false, error: 'File exceeds the 100 MB limit.' });
  }
  const msg = err && err.message === 'UNSUPPORTED_FORMAT'
    ? 'Unsupported format. Use mp3, wav, m4a, flac, ogg, opus, aac or wma.'
    : 'Internal server error';
  res.status(err && err.message === 'UNSUPPORTED_FORMAT' ? 400 : 500).json({ ok: false, error: msg });
});

hydrate().then(() => {
  const server = app.listen(PORT, () => {
    console.log(`\n  STEM STUDIO running → http://localhost:${PORT}\n`);
  });
  server.on('error', err => {
    console.error(`Failed to start server: ${err.message}`);
    process.exit(1);
  });
});

process.on('SIGINT', () => {
  if (activeChild) activeChild.kill();
  process.exit(0);
});
