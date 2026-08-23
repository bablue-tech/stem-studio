const puppeteer = require('puppeteer-core');
(async () => {
  const b = await puppeteer.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true
  });
  const pg = await b.newPage();
  await pg.setViewport({ width: 1280, height: 400 });
  await pg.goto('http://localhost:3010', { waitUntil: 'networkidle2' });
  const f = await pg.$('footer.site-footer');
  if (f) { await f.screenshot({ path: 'debug-footer.png' }); console.log('footer captured'); }
  else console.log('no footer');
  const txt = await pg.evaluate(() => document.querySelector('footer.site-footer')?.innerText);
  console.log('FOOTER TEXT:\n' + txt);
  await b.close();
})();
