const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const b = await puppeteer.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true
  });
  const pg = await b.newPage();

  // Desktop pass
  await pg.setViewport({ width: 1280, height: 900 });
  await pg.goto('http://localhost:3010', { waitUntil: 'networkidle2' });
  await pg.screenshot({ path: 'audit-top.png' });

  // open a job to audit the mixer UI
  await pg.evaluate(() => {
    [...document.querySelectorAll('.hist-row')].find(r => /input\.wav/i.test(r.textContent)).click();
  });
  await sleep(700);
  await pg.evaluate(() => document.getElementById('mixerLaunchBtn').click());
  await sleep(5000);
  const el = await pg.$('#mixerPanel');
  if (el) await el.screenshot({ path: 'audit-mixer.png' });

  // measure alignment facts
  const facts = await pg.evaluate(() => {
    const r = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width), c: Math.round(b.left + b.width / 2) }; };
    const card = r('.studio-card');
    return {
      cardCenter: card?.c,
      modelSelect: r('#modelSelect'),
      dropzone: r('#dropzone'),
      presets: r('#mxPresets'),
      channels: r('#mxBus'),
      transport: r('.transport'),
      sourceSwitch: r('#sourceSwitch'),
      masterStrip: r('.master-strip')
    };
  });
  console.log('MIXER ALIGNMENT FACTS:', JSON.stringify(facts, null, 2));

  // Mobile pass
  await pg.setViewport({ width: 390, height: 844 });
  await sleep(600);
  await pg.screenshot({ path: 'audit-mobile.png' });

  await b.close();
})();
