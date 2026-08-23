(() => {
  'use strict';

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  const esc = s => String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  async function fetchJSON(url, options = {}, timeoutMs = 15000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: ctrl.signal });
      const data = await res.json();
      return { ok: res.ok, status: res.status, data };
    } finally {
      clearTimeout(timer);
    }
  }

  function formatBytes(b) {
    if (!Number.isFinite(b)) return '';
    if (b >= 1048576) return `${(b / 1048576).toFixed(1)} MB`;
    if (b >= 1024) return `${Math.round(b / 1024)} KB`;
    return `${b} B`;
  }

  function formatDuration(s) {
    if (!Number.isFinite(s)) return '';
    const m = Math.floor(s / 60);
    const sec = Math.round(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  function timeAgo(iso) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '';
    const mins = Math.floor((Date.now() - t) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  const STEM_META = {
    vocals: { label: 'Vocals', accent: '#22d3ee' },
    drums: { label: 'Drums', accent: '#f472b6' },
    bass: { label: 'Bass', accent: '#8b5cf6' },
    other: { label: 'Other', accent: '#fbbf24' }
  };

  const ALLOWED_EXT = ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'opus', 'aac', 'wma', 'aif', 'aiff'];
  const MAX_BYTES = 100 * 1024 * 1024;
  const MODEL_HINTS = {
    htdemucs: 'Quick results, great for previews.',
    htdemucs_ft: 'Two-pass refinement, noticeably cleaner separation.'
  };
  const STATUS_CLASS = { done: 'done', queued: 'processing', separating: 'processing', error: 'error' };
  const STATUS_TEXT = { done: 'Done', queued: 'Queued', separating: 'Separating', error: 'Failed' };

  /* ---------- refs ---------- */

  const header = $('#siteHeader');
  const apiStatus = $('#apiStatus');
  const apiStatusText = $('#apiStatusText');
  const dropzone = $('#dropzone');
  const browseBtn = $('#browseBtn');
  const fileInput = $('#fileInput');
  const fileChip = $('#fileChip');
  const chipName = $('#chipName');
  const chipSize = $('#chipSize');
  const chipClear = $('#chipClear');
  const chipPreview = $('#chipPreview');
  const modelSelect = $('#modelSelect');
  const modelHint = $('#modelHint');
  const separateBtn = $('#separateBtn');
  const uploadNote = $('#uploadNote');

  const pipelinePanel = $('#pipelinePanel');
  const stageQueue = $('[data-stage="queue"]');
  const stageSep = $('[data-stage="separate"]');
  const stageDone = $('[data-stage="done"]');
  const sepPct = $('#sepPct');
  const eqBars = $('#eqBars');
  const progressFill = $('#progressFill');
  const progText = $('#progText');
  const pipelineMeta = $('#pipelineMeta');
  const errorBox = $('#errorBox');
  const errorMsg = $('#errorMsg');

  const resultsPanel = $('#resultsPanel');
  const resultsMeta = $('#resultsMeta');
  const stemsGrid = $('#stemsGrid');
  const historyList = $('#historyList');
  const mixerPanel = $('#mixerPanel');

  const mixerLaunchWrap = $('#mixerLaunchWrap');
  const mixerLaunchBtn = $('#mixerLaunchBtn');
  const mixerLoading = $('#mixerLoading');
  const mixerLoadingText = $('#mixerLoadingText');
  const mixerConsole = $('#mixerConsole');
  const mxPlayBtn = $('#mxPlay');
  const mxCur = $('#mxCur');
  const mxSeek = $('#mxSeek');
  const mxTot = $('#mxTot');
  const mxMaster = $('#mxMaster');
  const mxBus = $('#mxBus');
  const fxRack = $('#fxRack');
  const mixerErrorEl = $('#mixerError');

  const masterNameEl = $('#masterName');
  const sourceSwitch = $('#sourceSwitch');
  const mxPresets = $('#mxPresets');

  let currentFile = null;
  let currentJobId = null;
  let pollTimer = null;
  let failCount = 0;
  let lastJobs = [];
  let previewUrl = null;

  /* ---------- header & health ---------- */

  addEventListener('scroll', () => {
    header.classList.toggle('scrolled', scrollY > 20);
  }, { passive: true });

  async function checkHealth() {
    try {
      const { ok } = await fetchJSON('/api/health', {}, 8000);
      apiStatus.classList.toggle('online', ok);
      apiStatus.classList.toggle('offline', !ok);
      apiStatusText.textContent = ok ? 'API online' : 'API offline';
    } catch {
      apiStatus.classList.remove('online');
      apiStatus.classList.add('offline');
      apiStatusText.textContent = 'API offline';
    }
  }

  /* ---------- dropzone & file selection ---------- */

  dropzone.addEventListener('click', () => fileInput.click());
  browseBtn.addEventListener('click', e => {
    e.stopPropagation();
    fileInput.click();
  });
  dropzone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  ['dragover', 'dragenter'].forEach(ev =>
    dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add('dragover'); }));
  ['dragleave', 'dragend'].forEach(ev =>
    dropzone.addEventListener(ev, () => dropzone.classList.remove('dragover')));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) setFile(file);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) setFile(fileInput.files[0]);
  });
  chipClear.addEventListener('click', clearFile);

  function setFile(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      showNote('Unsupported format. Use MP3, WAV, M4A, FLAC or OGG.', false);
      return;
    }
    if (file.size > MAX_BYTES) {
      showNote('That file exceeds the 100 MB limit.', false);
      return;
    }
    currentFile = file;
    chipName.textContent = file.name;
    chipSize.textContent = formatBytes(file.size);
    fileChip.hidden = false;
    dropzone.hidden = true;
    separateBtn.disabled = false;
    showNote('', true);

    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    previewUrl = URL.createObjectURL(file);
    chipPreview.src = previewUrl;
    chipPreview.onloadedmetadata = () => {
      if (Number.isFinite(chipPreview.duration)) {
        chipSize.textContent = `${formatBytes(file.size)} · ${formatDuration(chipPreview.duration)}`;
      }
    };
  }

  function clearFile() {
    currentFile = null;
    fileInput.value = '';
    fileChip.hidden = true;
    dropzone.hidden = false;
    separateBtn.disabled = true;
    chipPreview.pause?.();
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    chipPreview.removeAttribute('src');
  }

  function showNote(text, ok) {
    uploadNote.textContent = text;
    uploadNote.classList.toggle('ok', !!ok);
    uploadNote.classList.toggle('err', !!text && !ok);
  }

  modelSelect.addEventListener('change', () => {
    modelHint.textContent = MODEL_HINTS[modelSelect.value] || '';
  });

  /* ---------- upload ---------- */

  $('#uploadForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!currentFile || separateBtn.disabled) return;
    separateBtn.disabled = true;
    $('.btn-label', separateBtn).hidden = true;
    $('.btn-loader', separateBtn).hidden = false;
    showNote('', true);

    try {
      const fd = new FormData();
      fd.append('audio', currentFile);
      fd.append('model', modelSelect.value);
      const { ok, data } = await fetchJSON('/api/separate', { method: 'POST', body: fd }, 300000);
      if (ok && data.ok && data.jobId) {
        clearFile();
        startJob(data.jobId);
      } else {
        showNote((data && data.error) || 'Upload failed.', false);
      }
    } catch {
      showNote('Network error. Is the server running?', false);
    } finally {
      $('.btn-label', separateBtn).hidden = false;
      $('.btn-loader', separateBtn).hidden = true;
      separateBtn.disabled = !currentFile;
    }
  });

  /* ---------- pipeline ---------- */

  function startJob(id) {
    currentJobId = id;
    teardownMixer(false);
    errorBox.hidden = true;
    setStages('queued');
    setProgress(0);
    eqBars.classList.add('paused');
    resultsPanel.hidden = true;
    pipelinePanel.hidden = false;
    loadHistory();
    pipelinePanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    startPolling(id);
  }

  function setStages(status) {
    stageQueue.classList.remove('active', 'done');
    stageSep.classList.remove('active', 'done');
    stageDone.classList.remove('active', 'done');
    if (status === 'queued') {
      stageQueue.classList.add('active');
    } else if (status === 'separating') {
      stageQueue.classList.add('done');
      stageSep.classList.add('active');
    } else if (status === 'done') {
      stageQueue.classList.add('done');
      stageSep.classList.add('done');
      stageDone.classList.add('done');
    }
  }

  function setProgress(pct) {
    const p = Math.max(0, pct | 0);
    sepPct.textContent = `${p}%`;
    progText.textContent = `${p}%`;
    progressFill.style.width = `${p}%`;
  }

  function showError(msg) {
    errorMsg.textContent = msg || 'Something went wrong.';
    errorBox.hidden = false;
    eqBars.classList.add('paused');
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function startPolling(id) {
    stopPolling();
    failCount = 0;
    const tick = async () => {
      try {
        const { ok, data } = await fetchJSON(`/api/jobs/${id}`);
        if (!ok || !data.ok || !data.job) throw new Error('bad response');
        failCount = 0;
        applyJob(data.job);
      } catch {
        failCount += 1;
        if (failCount >= 4) {
          stopPolling();
          showError('Lost connection to the server.');
        }
      }
    };
    tick();
    pollTimer = setInterval(tick, 1500);
  }

  function applyJob(job) {
    pipelineMeta.textContent =
      `${job.originalName} · ${job.modelLabel}${job.durationSec ? ` · ${formatDuration(job.durationSec)}` : ''}`;

    if (job.status === 'queued') {
      setStages('queued');
      eqBars.classList.add('paused');
    } else if (job.status === 'separating') {
      setStages('separating');
      eqBars.classList.remove('paused');
      setProgress(Math.max(1, job.progress));
    } else if (job.status === 'done') {
      stopPolling();
      setStages('done');
      setProgress(100);
      eqBars.classList.add('paused');
      renderStems(job);
      loadHistory();
    } else if (job.status === 'error') {
      stopPolling();
      setStages('separating');
      eqBars.classList.add('paused');
      showError(job.error);
      loadHistory();
    }
  }

  /* ---------- results ---------- */

  function renderStems(job) {
    currentResultsJob = job;
    masterNameEl.textContent = `${job.originalName} · Original`;
    sourceSwitch.hidden = !job.hasOriginal;
    resultsMeta.textContent =
      `${job.originalName} · ${job.modelLabel}` +
      (job.durationSec ? ` · ${formatDuration(job.durationSec)}` : '') +
      ' · tap ▶ on a layer to solo it';

    stemsGrid.innerHTML = job.stems.map(s => {
      const stem = s.file.replace('.mp3', '');
      const meta = STEM_META[stem] || { label: stem, accent: '#22d3ee' };
      return `
        <article class="stem-card" data-stem="${esc(stem)}" style="--accent:${meta.accent}">
          <div class="stem-head">
            <span class="stem-name">${esc(meta.label)}</span>
            <span class="stem-size">${formatBytes(s.size)}${job.durationSec ? ` · ${formatDuration(job.durationSec)}` : ''}</span>
          </div>
          <div class="stem-actions">
            <button type="button" class="stem-play" data-stem="${esc(stem)}" aria-label="Solo preview ${esc(meta.label)}">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>
            </button>
            <a class="dl-btn" href="/stems/${esc(job.id)}/${esc(s.file)}?dl=1" download="${esc(job.baseName)}_${stem}.mp3">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v12M6 10l6 6 6-6M5 20h14"/></svg>
              Download MP3
            </a>
          </div>
        </article>`;
    }).join('');

    resultsPanel.hidden = false;
    mixerPanel.hidden = false;

    if (MX.jobId !== job.id || !MX.ready) {
      teardownMixer(true);
      mxPlayBtn.innerHTML = ICON_PLAY;
    } else {
      syncChannelChips();
      refreshPlayButtons();
    }

    setTimeout(() => resultsPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 200);
  }

  stemsGrid.addEventListener('click', e => {
    const btn = e.target.closest('.stem-play');
    if (!btn) return;
    toggleCardPreview(btn);
  });

  /* ---------- stem mixer (streaming engine) ---------- */

  const STEMS_ORDER = ['vocals', 'drums', 'bass', 'other'];
  const ICON_PLAY = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="5" width="4" height="14" rx="1"/></svg>';

  const MX = {
    ctx: null,
    jobId: null,
    elements: [],
    mediaNodes: [],
    chGain: [],
    nodes: null,
    ready: false,
    playing: false,
    faders: [85, 85, 85, 85],
    muted: new Set(),
    solo: new Set(),
    rate: 1,
    abortLoad: false,
    rafId: null,
    originalEl: null,
    originalNode: null,
    originalGain: null,
    sourceMode: 'stems'
  };

  let mxSeekDragging = false;
  let currentResultsJob = null;

  function mixerEnsureCtx() {
    if (!MX.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      MX.ctx = new AC();
    }
    if (MX.ctx.state === 'suspended') MX.ctx.resume();
    return MX.ctx;
  }

  function setFill(input) {
    const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
    input.style.setProperty('--fill', `${pct}%`);
  }

  function synthIR(ctx, dur = 2.6, decay = 2.6) {
    const len = Math.floor(ctx.sampleRate * dur);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return ir;
  }

  function activeEls() {
    return MX.sourceMode === 'original' && MX.originalEl ? [MX.originalEl] : MX.elements;
  }

  function allLoadedEls() {
    const list = [...MX.elements];
    if (MX.originalEl) list.push(MX.originalEl);
    return list;
  }

  function mixerDuration() {
    const el = activeEls()[0];
    return el && isFinite(el.duration) ? el.duration : 0;
  }

  function mixerTime() {
    const el = activeEls()[0];
    return el ? el.currentTime : 0;
  }

  function showMixerState(mode) {
    mixerLaunchWrap.hidden = mode !== 'launch';
    mixerLoading.hidden = mode !== 'loading';
    mixerConsole.hidden = mode !== 'console';
  }

  function showMixerLoading(text) {
    showMixerState('loading');
    if (text) mixerLoadingText.textContent = text;
  }

  function setMixerError(msg) {
    mixerErrorEl.hidden = !msg;
    if (msg) mixerErrorEl.textContent = msg;
  }

  function teardownMixer(resetUi) {
    MX.abortLoad = true;
    cancelAnimationFrame(MX.rafId);
    MX.playing = false;
    MX.elements.forEach(el => {
      try { el.pause(); } catch {}
      try { el.removeAttribute('src'); el.load(); } catch {}
    });
    MX.mediaNodes.forEach(n => { try { n.disconnect(); } catch {} });
    MX.chGain.forEach(g => { try { g.disconnect(); } catch {} });
    Object.values(MX.nodes || {}).forEach(n => { try { n.disconnect(); } catch {} });
    if (MX.originalNode) { try { MX.originalNode.disconnect(); } catch {} }
    if (MX.originalGain) { try { MX.originalGain.disconnect(); } catch {} }
    if (MX.originalEl) {
      try { MX.originalEl.pause(); } catch {}
      try { MX.originalEl.removeAttribute('src'); MX.originalEl.load(); } catch {}
    }
    Object.assign(MX, {
      jobId: null, elements: [], mediaNodes: [], chGain: [],
      nodes: null, ready: false, rate: 1,
      originalEl: null, originalNode: null, originalGain: null,
      sourceMode: 'stems'
    });
    MX.muted.clear();
    MX.solo.clear();
    mxPlayBtn.innerHTML = ICON_PLAY;
    $$('#sourceSwitch .src-btn').forEach(b => b.classList.toggle('active', b.dataset.src === 'stems'));
    if (resetUi) {
      showMixerState('launch');
      setMixerError('');
    }
  }

  async function mixerLoad(job) {
    setMixerError('');
    if (MX.jobId === job.id && MX.ready) { showMixerState('console'); return; }
    teardownMixer(false);
    MX.jobId = job.id;
    MX.abortLoad = false;
    showMixerLoading('Loading stems…');
    try {
      mixerEnsureCtx();
      const els = job.stems.map(s => {
        const el = document.createElement('audio');
        el.crossOrigin = 'anonymous';
        el.preload = 'auto';
        el.src = `/stems/${job.id}/${s.file}`;
        return el;
      });
      MX.elements = els;

      let origEl = null;
      if (job.hasOriginal) {
        origEl = document.createElement('audio');
        origEl.crossOrigin = 'anonymous';
        origEl.preload = 'auto';
        origEl.src = `/original/${job.id}`;
      }

      await Promise.all(els.map((el, i) => new Promise((resolve, reject) => {
        const to = setTimeout(() => reject(new Error('timed out loading a stem')), 90000);
        const done = () => {
          clearTimeout(to);
          showMixerLoading(`Loading stems… ${Math.min(i + 1, els.length)}/${els.length}`);
          resolve();
        };
        el.addEventListener('canplaythrough', done, { once: true });
        el.addEventListener('error', () => {
          clearTimeout(to);
          reject(new Error(el.error && el.error.code === 4 ? 'stem not found (404)' : 'network error loading stem'));
        }, { once: true });
        el.load();
      })));
      if (MX.abortLoad) return;

      buildGraph();
      if (origEl) {
        const srcNode = MX.ctx.createMediaElementSource(origEl);
        const g = MX.ctx.createGain();
        g.gain.value = 0;
        srcNode.connect(g);
        g.connect(MX.nodes.master);
        MX.originalEl = origEl;
        MX.originalNode = srcNode;
        MX.originalGain = g;
        origEl.addEventListener('ended', () => {
          if (MX.playing && MX.sourceMode === 'original') stopTo(0);
        });
      }
      sourceSwitch.hidden = !MX.originalEl;
      buildChannelStrips();
      buildPresetsUI();
      buildFxRack();
      MX.ready = true;
      showMixerState('console');
      updateTransportUI();
      refreshPlayButtons();
    } catch (err) {
      if (MX.abortLoad) return;
      const expired = /not found|404|expired/i.test(err.message);
      setMixerError(expired
        ? 'Stems are kept for 24 hours and this one has expired. Re-upload the song.'
        : `Mixer failed to load: ${err.message}`);
      showMixerState('launch');
    }
  }

  function buildGraph() {
    const ctx = MX.ctx;
    const chGain = STEMS_ORDER.map(() => ctx.createGain());
    const bus = ctx.createGain();
    chGain.forEach(g => g.connect(bus));

    const dry = ctx.createGain(); dry.gain.value = 1;
    const wet = ctx.createGain(); wet.gain.value = 0;
    const conv = ctx.createConvolver(); conv.buffer = synthIR(ctx);
    bus.connect(dry); bus.connect(conv); conv.connect(wet);

    const bassEq = ctx.createBiquadFilter(); bassEq.type = 'lowshelf'; bassEq.frequency.value = 110;
    const trebleEq = ctx.createBiquadFilter(); trebleEq.type = 'highshelf'; trebleEq.frequency.value = 3200;
    dry.connect(bassEq); wet.connect(bassEq); bassEq.connect(trebleEq);

    const echoIn = ctx.createGain();
    const delay = ctx.createDelay(1.5); delay.delayTime.value = 0.32;
    const fb = ctx.createGain(); fb.gain.value = 0.42;
    const echoMix = ctx.createGain(); echoMix.gain.value = 0;
    trebleEq.connect(echoIn);
    echoIn.connect(delay); delay.connect(fb); fb.connect(delay);
    delay.connect(echoMix);

    const master = ctx.createGain();
    master.gain.value = parseInt(mxMaster.value, 10) / 100;
    bassEq.connect(master); echoIn.connect(master); echoMix.connect(master);
    master.connect(ctx.destination);

    MX.chGain = chGain;
    MX.nodes = { bus, dry, wet, bassEq, trebleEq, echoIn, delay, fb, echoMix, master };

    MX.mediaNodes = MX.elements.map((el, i) => {
      const src = ctx.createMediaElementSource(el);
      src.connect(MX.chGain[i]);
      return src;
    });

    MX.elements[0].addEventListener('ended', () => {
      if (MX.playing) stopTo(0);
    });
    applyGains();
  }

  function applyGains() {
    if (!MX.nodes || !MX.ctx) return;
    const now = MX.ctx.currentTime;
    const origActive = MX.sourceMode === 'original';
    MX.chGain.forEach((g, i) => {
      const audible = !origActive && !MX.muted.has(i) && !(MX.solo.size > 0 && !MX.solo.has(i));
      g.gain.setTargetAtTime(audible ? MX.faders[i] / 100 : 0, now, 0.03);
    });
    if (MX.originalGain) {
      MX.originalGain.gain.setTargetAtTime(origActive ? 1 : 0, now, 0.05);
    }
  }

  function syncRate() {
    allLoadedEls().forEach(el => { el.playbackRate = MX.rate; });
  }

  async function resumeAll() {
    mixerEnsureCtx();
    const els = activeEls();
    if (!els.length) return;
    const atEnd = mixerDuration() - els[0].currentTime < 0.05;
    const t = atEnd ? 0 : els[0].currentTime;
    try {
      await Promise.all(els.map(async el => {
        el.currentTime = t;
        await el.play();
      }));
      syncRate();
      MX.playing = true;
      mxPlayBtn.innerHTML = ICON_PAUSE;
      tickTransport();
      refreshPlayButtons();
    } catch (err) {
      MX.playing = false;
      mxPlayBtn.innerHTML = ICON_PLAY;
      refreshPlayButtons();
      setMixerError('Playback was blocked. Press play once more.');
    }
  }

  function pauseAll() {
    activeEls().forEach(el => { try { el.pause(); } catch {} });
    MX.playing = false;
    mxPlayBtn.innerHTML = ICON_PLAY;
    cancelAnimationFrame(MX.rafId);
    refreshPlayButtons();
  }

  function stopTo(t = 0) {
    pauseAll();
    allLoadedEls().forEach(el => { try { el.currentTime = t; } catch {} });
    updateTransportUI();
  }

  function mixerTogglePlay() {
    if (!MX.ready) return;
    if (MX.playing) pauseAll(); else resumeAll();
  }

  function seekMixer(sec) {
    if (!MX.ready) return;
    const d = Math.max(mixerDuration(), MX.originalEl && isFinite(MX.originalEl.duration) ? MX.originalEl.duration : 0);
    const t = Math.max(0, Math.min(sec, d));
    allLoadedEls().forEach(el => { try { el.currentTime = t; } catch {} });
    updateTransportUI();
  }

  function updateTransportUI() {
    if (!MX.ready) return;
    const cur = mixerTime();
    const dur = mixerDuration();
    mxCur.textContent = formatDuration(cur);
    mxTot.textContent = formatDuration(dur);
    const frac = dur ? cur / dur : 0;
    if (!mxSeekDragging) {
      mxSeek.value = Math.round(frac * 1000);
      setFill(mxSeek);
    }
  }

  function tickTransport() {
    cancelAnimationFrame(MX.rafId);
    const loop = () => {
      updateTransportUI();
      if (MX.playing) MX.rafId = requestAnimationFrame(loop);
    };
    MX.rafId = requestAnimationFrame(loop);
  }

  function refreshPlayButtons() {
    $$('.stem-play').forEach(btn => {
      btn.classList.remove('loading');
      const card = btn.closest('.stem-card');
      const i = STEMS_ORDER.indexOf(card.dataset.stem);
      const active = MX.playing && MX.solo.has(i);
      btn.classList.toggle('playing', active);
      btn.innerHTML = active ? ICON_PAUSE : ICON_PLAY;
      card.classList.toggle('solo-active', active);
    });
  }

  function syncChannelChips() {
    $$('#mxBus .channel').forEach(strip => {
      const i = parseInt(strip.dataset.i, 10);
      strip.querySelector('[data-act="mute"]').classList.toggle('m-on', MX.muted.has(i));
      strip.querySelector('[data-act="solo"]').classList.toggle('s-on', MX.solo.has(i));
    });
  }

  async function toggleCardPreview(btn) {
    if (!currentResultsJob) return;
    if (!MX.ready || MX.jobId !== currentResultsJob.id) {
      btn.classList.add('loading');
      btn.innerHTML = '<span class="spinner"></span>';
      try {
        await mixerLoad(currentResultsJob);
      } finally {
        refreshPlayButtons();
      }
      if (!MX.ready) return;
    }
    const i = STEMS_ORDER.indexOf(btn.dataset.stem);
    if (MX.sourceMode === 'original') setSource('stems');
    const isActiveSolo = MX.solo.has(i) && MX.playing;
    if (isActiveSolo) {
      stopTo(mixerTime());
      MX.solo.clear();
      applyGains();
    } else {
      MX.solo.clear();
      MX.muted.clear();
      MX.solo.add(i);
      applyGains();
      syncChannelChips();
      if (!MX.playing) resumeAll();
    }
    refreshPlayButtons();
  }

  function buildChannelStrips() {
    mxBus.innerHTML = STEMS_ORDER.map((stem, i) => {
      const meta = STEM_META[stem];
      return `
        <div class="channel" data-i="${i}" style="--accent:${meta.accent}">
          <div class="channel-top">
            <span class="channel-name">${esc(meta.label)}</span>
            <span class="ms-group">
              <button type="button" class="ms-chip" data-act="mute" aria-label="Mute ${esc(meta.label)}">M</button>
              <button type="button" class="ms-chip" data-act="solo" aria-label="Solo ${esc(meta.label)}">S</button>
            </span>
          </div>
          <input type="range" class="fader channel-fader" min="0" max="100" value="${MX.faders[i]}" style="--fill:${MX.faders[i]}%" aria-label="${esc(meta.label)} volume" />
        </div>`;
    }).join('');
  }

  mxBus.addEventListener('click', e => {
    const chip = e.target.closest('.ms-chip');
    if (!chip) return;
    const strip = chip.closest('.channel');
    const i = parseInt(strip.dataset.i, 10);
    const act = chip.dataset.act;
    const set = act === 'mute' ? MX.muted : MX.solo;
    const other = act === 'mute' ? MX.solo : MX.muted;
    if (set.has(i)) set.delete(i); else set.add(i);
    other.delete(i);
    applyGains();
    syncChannelChips();
    refreshPlayButtons();
  });

  mxBus.addEventListener('input', e => {
    const fader = e.target.closest('.channel-fader');
    if (!fader) return;
    const i = parseInt(fader.closest('.channel').dataset.i, 10);
    MX.faders[i] = parseInt(fader.value, 10);
    setFill(fader);
    applyGains();
    markActivePreset();
  });

  const FX_DEFS = [
    { id: 'reverb', label: 'Reverb', min: 0, max: 100, val: 0, fmt: v => `${v}%`,
      apply: v => {
        const w = v / 100;
        const t = MX.ctx.currentTime;
        MX.nodes.wet.gain.setTargetAtTime(w * 0.9, t, 0.05);
        MX.nodes.dry.gain.setTargetAtTime(1 - w * 0.55, t, 0.05);
      } },
    { id: 'echo', label: 'Echo', min: 0, max: 100, val: 0, fmt: v => `${v}%`,
      apply: v => MX.nodes.echoMix.gain.setTargetAtTime((v / 100) * 0.9, MX.ctx.currentTime, 0.05) },
    { id: 'bass', label: 'Bass', min: -12, max: 12, val: 0, fmt: v => `${v > 0 ? '+' : ''}${v} dB`,
      apply: v => MX.nodes.bassEq.gain.setTargetAtTime(v, MX.ctx.currentTime, 0.05) },
    { id: 'clarity', label: 'Clarity', min: -12, max: 12, val: 0, fmt: v => `${v > 0 ? '+' : ''}${v} dB`,
      apply: v => MX.nodes.trebleEq.gain.setTargetAtTime(v, MX.ctx.currentTime, 0.05) },
    { id: 'speed', label: 'Speed', min: 75, max: 125, val: 100, fmt: v => `${(v / 100).toFixed(2)}Ã×`,
      apply: v => { MX.rate = v / 100; syncRate(); } }
  ];

  function buildFxRack() {
    FX_DEFS.forEach(f => { f.val = f.id === 'speed' ? 100 : 0; });
    fxRack.innerHTML = FX_DEFS.map(f => `
      <div class="fx">
        <label for="fx-${f.id}">${f.label}<b id="fxv-${f.id}">${f.fmt(f.val)}</b></label>
        <input type="range" class="fader fx-fader" id="fx-${f.id}" data-id="${f.id}" min="${f.min}" max="${f.max}" value="${f.val}" />
      </div>`).join('') +
      '<button type="button" class="fx-reset" id="fxReset">Reset FX</button>';
  }

  fxRack.addEventListener('input', e => {
    const input = e.target.closest('.fx-fader');
    if (!input || !MX.nodes) return;
    const def = FX_DEFS.find(f => f.id === input.dataset.id);
    def.val = parseFloat(input.value);
    $('#fxv-' + def.id).textContent = def.fmt(def.val);
    setFill(input);
    try { def.apply(def.val); } catch {}
  });

  fxRack.addEventListener('click', e => {
    if (!e.target.closest('#fxReset')) return;
    FX_DEFS.forEach(def => {
      def.val = def.id === 'speed' ? 100 : 0;
      def.apply(def.val);
      const input = $('#fx-' + def.id);
      const out = $('#fxv-' + def.id);
      if (input) { input.value = def.val; setFill(input); }
      if (out) out.textContent = def.fmt(def.val);
    });
  });

  const PRESETS = [
    { name: 'Full Mix', f: [100, 100, 100, 100] },
    { name: 'No Vocals', f: [0, 100, 100, 100] },
    { name: 'Acapella', f: [100, 0, 0, 0] },
    { name: 'No Drums', f: [100, 0, 100, 100] },
    { name: 'No Bass', f: [100, 100, 0, 100] }
  ];

  function buildPresetsUI() {
    mxPresets.hidden = false;
    mxPresets.innerHTML = PRESETS.map((p, i) =>
      `<button type="button" class="preset-chip${MX.faders.every((v, k) => v === p.f[k]) ? ' on' : ''}" data-i="${i}">${esc(p.name)}</button>`
    ).join('');
  }

  function markActivePreset() {
    if (!mxPresets.children.length) return;
    $$('#mxPresets .preset-chip').forEach((chip, i) => {
      chip.classList.toggle('on', PRESETS[i].f.every((v, k) => MX.faders[k] === v));
    });
  }

  mxPresets.addEventListener('click', e => {
    const chip = e.target.closest('.preset-chip');
    if (!chip || !MX.ready) return;
    const p = PRESETS[parseInt(chip.dataset.i, 10)];
    if (MX.sourceMode === 'original') setSource('stems');
    MX.faders = [...p.f];
    MX.muted.clear();
    MX.solo.clear();
    $$('#mxBus .channel-fader').forEach(f => {
      const i = parseInt(f.closest('.channel').dataset.i, 10);
      f.value = MX.faders[i];
      setFill(f);
    });
    applyGains();
    syncChannelChips();
    markActivePreset();
  });

  function setSource(mode) {
    if (!MX.ready || mode === MX.sourceMode) return;
    if (mode === 'original' && !MX.originalEl) return;
    const wasPlaying = MX.playing;
    const t = mixerTime();
    activeEls().forEach(el => { try { el.pause(); } catch {} });
    MX.sourceMode = mode;
    const dur = mode === 'original' && isFinite(MX.originalEl.duration) ? MX.originalEl.duration : mixerDuration();
    activeEls().forEach(el => { try { el.currentTime = Math.min(t, dur || t); } catch {} });
    $$('#sourceSwitch .src-btn').forEach(b => b.classList.toggle('active', b.dataset.src === mode));
    applyGains();
    updateTransportUI();
    refreshPlayButtons();
    if (wasPlaying) resumeAll();
  }

  sourceSwitch.addEventListener('click', e => {
    const btn = e.target.closest('.src-btn');
    if (btn) setSource(btn.dataset.src);
  });

  mixerLaunchBtn.addEventListener('click', () => {
    if (currentResultsJob) mixerLoad(currentResultsJob);
  });
  mxPlayBtn.addEventListener('click', mixerTogglePlay);
  mxSeek.addEventListener('input', () => {
    mxSeekDragging = true;
    setFill(mxSeek);
    mxCur.textContent = formatDuration((mxSeek.value / 1000) * mixerDuration());
  });
  mxSeek.addEventListener('change', () => {
    seekMixer((mxSeek.value / 1000) * mixerDuration());
    mxSeekDragging = false;
  });
  mxMaster.addEventListener('input', () => {
    setFill(mxMaster);
    if (MX.nodes) MX.nodes.master.gain.setTargetAtTime(mxMaster.value / 100, MX.ctx.currentTime, 0.03);
  });


  /* ---------- history ---------- */

  async function loadHistory() {
    try {
      const { ok, data } = await fetchJSON('/api/jobs');
      if (!ok || !data.ok) return;
      lastJobs = data.jobs || [];
      if (!lastJobs.length) {
        historyList.innerHTML = '<div class="empty-state">No separations yet. Your history will appear here.</div>';
        return;
      }
      historyList.innerHTML = lastJobs.map(j => `
        <article class="hist-row${j.id === currentJobId ? ' current' : ''}" data-id="${esc(j.id)}">
          <div class="hist-main">
            <strong>${esc(j.originalName)}</strong>
            <p class="meta">${esc(j.modelLabel || j.model)} · ${timeAgo(j.createdAt)}${j.durationSec ? ` · ${formatDuration(j.durationSec)}` : ''}</p>
          </div>
          <span class="chip ${STATUS_CLASS[j.status] || ''}">${STATUS_TEXT[j.status] || j.status}</span>
          <div class="hist-actions">
            <button type="button" class="icon-btn open" aria-label="Open job">&#8599;</button>
            <button type="button" class="icon-btn del" aria-label="Delete job">&times;</button>
          </div>
        </article>`).join('');
    } catch {}
  }

  historyList.addEventListener('click', e => {
    const row = e.target.closest('.hist-row');
    if (!row) return;
    const id = row.dataset.id;
    if (e.target.closest('.del')) {
      deleteJob(id);
      return;
    }
    openJob(id);
  });

  async function deleteJob(id) {
    const job = lastJobs.find(j => j.id === id);
    if (!confirm(`Delete "${job ? job.originalName : 'this job'}" and its files?`)) return;
    try {
      await fetchJSON(`/api/jobs/${id}`, { method: 'DELETE' });
      if (id === currentJobId) {
        stopPolling();
        currentJobId = null;
        pipelinePanel.hidden = true;
        resultsPanel.hidden = true;
      }
      loadHistory();
    } catch {}
  }

  async function openJob(id) {
    try {
      const { ok, data } = await fetchJSON(`/api/jobs/${id}`);
      if (!ok || !data.ok) return;
      const job = data.job;
      currentJobId = id;
      if (job.status === 'done') {
        stopPolling();
        pipelinePanel.hidden = true;
        renderStems(job);
      } else if (job.status === 'error') {
        stopPolling();
        resultsPanel.hidden = true;
        pipelinePanel.hidden = false;
        setStages('separating');
        eqBars.classList.add('paused');
        showError(job.error);
      } else {
        errorBox.hidden = true;
        resultsPanel.hidden = true;
        pipelinePanel.hidden = false;
        applyJob(job);
        startPolling(id);
      }
      loadHistory();
    } catch {}
  }

  /* ---------- init ---------- */

  checkHealth();
  loadHistory();
  setFill(mxMaster);
  setFill(mxSeek);
})();
