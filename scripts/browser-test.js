const fs = require('fs');
const puppeteer = require('puppeteer-core');

const EDGE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const exe = EDGE_PATHS.find(p => fs.existsSync(p));
  const browser = await puppeteer.launch({ executablePath: exe, headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 950 });

  const logs = [];
  page.on('console', m => logs.push(`[console.${m.type()}] ${m.text().slice(0, 140)}`));
  page.on('pageerror', e => logs.push(`[PAGEERROR] ${e.message}`));
  page.on('requestfailed', r => logs.push(`[REQFAIL] ${r.url().slice(0, 110)}`));

  await page.goto('http://localhost:3010', { waitUntil: 'networkidle2', timeout: 30000 });

  // open freshest job with original retained (43d745f0…)
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.hist-row')];
    const target = rows.find(r => /input\.wav/i.test(r.textContent)) || rows[0];
    target.click();
  });
  await sleep(1000);

  const pre = await page.evaluate(() => {
    const sw = document.getElementById('sourceSwitch');
    return {
      cards: document.querySelectorAll('.stem-card').length,
      masterName: document.getElementById('masterName')?.textContent,
      switchVisible: sw && !sw.hidden,
      presetsHidden: document.getElementById('mxPresets')?.hidden,
      presetChips: document.querySelectorAll('#mxPresets .preset-chip').length
    };
  });
  console.log('PRE-STATE:', JSON.stringify(pre));

  await page.evaluate(() => document.getElementById('mixerLaunchBtn')?.click());
  console.log('LAUNCHING…');
  await sleep(6000);

  const loaded = await page.evaluate(() => ({
    consoleVisible: !document.getElementById('mixerConsole')?.hidden,
    strips: document.querySelectorAll('#mxBus .channel').length,
    fx: document.querySelectorAll('#fxRack .fx').length,
    err: !document.getElementById('mixerError')?.hidden ? document.getElementById('mixerError').textContent : null
  }));
  console.log('LOADED:', JSON.stringify(loaded));

  // preset test: No Vocals → faders [0,100,100,100]
  await page.evaluate(() => {
    [...document.querySelectorAll('#mxPresets .preset-chip')]
      .find(c => /no vocals/i.test(c.textContent)).click();
  });
  await sleep(400);
  const presetState = await page.evaluate(() =>
    [...document.querySelectorAll('.channel-fader')].map(f => f.value).join('/')
  );
  console.log('PRESET "No Vocals" faders [v/d/b/o]:', presetState);

  // play + verify progress
  await page.evaluate(() => document.getElementById('mxPlay')?.click());
  await sleep(2500);
  const play1 = await page.evaluate(() => ({
    t1: document.getElementById('mxCur')?.textContent,
    playing: document.querySelectorAll('.stem-play.playing').length
  }));

  // A/B switch to Original mid-playback
  await page.evaluate(() => {
    [...document.querySelectorAll('#sourceSwitch .src-btn')]
      .find(b => b.dataset.src === 'original').click();
  });
  await sleep(2000);
  const ab = await page.evaluate(() => ({
    activeSrc: document.querySelector('#sourceSwitch .src-btn.active')?.dataset.src,
    t2: document.getElementById('mxCur')?.textContent
  }));
  await page.evaluate(() => {
    [...document.querySelectorAll('#sourceSwitch .src-btn')]
      .find(b => b.dataset.src === 'stems').click();
  });
  await sleep(800);
  const backStems = await page.evaluate(() =>
    document.querySelector('#sourceSwitch .src-btn.active')?.dataset.src
  );

  // card solo preview while playing
  await page.evaluate(() => document.querySelector('.stem-play[data-stem="drums"]')?.click());
  await sleep(1500);
  const solo = await page.evaluate(() => {
    const strips = [...document.querySelectorAll('#mxBus .channel')];
    const drumStrip = strips.find(c => c.dataset.i === '1');
    return {
      soloOnDrums: drumStrip.querySelector('[data-act="solo"]').classList.contains('s-on'),
      vocalsSoloOff: !strips[0].querySelector('[data-act="solo"]').classList.contains('s-on'),
      drumsCardPlaying: document.querySelector('.stem-play[data-stem="drums"]').classList.contains('playing')
    };
  });
  console.log('PLAYBACK:', JSON.stringify(play1), '| A/B:', JSON.stringify(ab), '| back→', backStems, '| SOLO:', JSON.stringify(solo));

  // regression: card solo while in Original mode must flip back to Stem Mix
  await page.evaluate(() => {
    [...document.querySelectorAll('#sourceSwitch .src-btn')]
      .find(b => b.dataset.src === 'original').click();
  });
  await sleep(500);
  await page.evaluate(() => document.querySelector('.stem-play[data-stem="vocals"]')?.click());
  await sleep(1000);
  const reg = await page.evaluate(() => ({
    backToStems: document.querySelector('#sourceSwitch .src-btn.active').dataset.src,
    vocalsSoloOn: [...document.querySelectorAll('#mxBus .channel')][0]
      .querySelector('[data-act="solo"]').classList.contains('s-on'),
    masterFill: document.getElementById('mxMaster').style.getPropertyValue('--fill')
  }));
  console.log('REGRESSION:', JSON.stringify(reg));

  await page.screenshot({ path: 'debug-final.png' });
  console.log('\n=== ERRORS ===');
  logs.length ? logs.forEach(l => console.log(l)) : console.log('(none)');
  await browser.close();
})().catch(e => { console.error('HARNESS FAIL:', e.message); process.exit(1); });
