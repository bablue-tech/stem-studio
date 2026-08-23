const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const b = await puppeteer.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true
  });
  const pg = await b.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));

  await pg.goto('http://localhost:3010', { waitUntil: 'networkidle2' });
  await pg.evaluate(() => {
    [...document.querySelectorAll('.hist-row')].find(r => /input\.wav/i.test(r.textContent)).click();
  });
  await sleep(800);
  await pg.evaluate(() => document.getElementById('mixerLaunchBtn').click());
  await sleep(6000);

  const loaded = await pg.evaluate(() => !document.getElementById('mixerConsole')?.hidden);
  console.log('mixer console visible:', loaded);

  // engage echo at 60%
  await pg.evaluate(() => {
    const i = document.getElementById('fx-echo');
    i.value = 60;
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(300);
  const readout = await pg.evaluate(() => ({
    sliderVal: document.getElementById('fx-echo').value,
    label: document.getElementById('fxv-echo')?.textContent,
    fillSet: document.getElementById('fx-echo').style.getPropertyValue('--fill')
  }));
  console.log('echo slider state:', JSON.stringify(readout));

  // play with echo engaged
  await pg.evaluate(() => document.getElementById('mxPlay').click());
  await sleep(3000);

  // also flip reverb on simultaneously to stress the shared FX chain
  await pg.evaluate(() => {
    const i = document.getElementById('fx-reverb');
    i.value = 40;
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(2000);
  const t = await pg.evaluate(() => document.getElementById('mxCur')?.textContent);
  console.log('playback time after 5s with echo+reverb:', t);

  console.log('PAGE ERRORS:', errs.length ? errs : 'none');
  await b.close();
})();
