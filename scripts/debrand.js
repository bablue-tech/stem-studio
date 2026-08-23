const fs = require('fs');

function patch(file, pairs) {
  let s = fs.readFileSync(file, 'utf8');
  let misses = 0;
  for (const [from, to] of pairs) {
    if (!s.includes(from)) { console.log(`MISS in ${file}: "${from.slice(0, 60)}"`); misses++; continue; }
    s = s.split(from).join(to);
  }
  fs.writeFileSync(file, s, 'utf8');
  const left = (s.match(/\u2014/g) || []).length;
  console.log(`${file}: patched, ${misses} misses, ${left} em-dashes remaining`);
}

const html = [
  ['STEM\u00b7STUDIO \u2014 AI Music Separator', 'STEM\u00b7STUDIO \u00b7 AI Music Separator'],
  [' as MP3s. Powered by Demucs."', ' as MP3s."'],
  ['AI Source Separation \u00b7 Demucs v4', 'AI Music Stem Separation'],
  ['as separate MP3s \u2014 rendered on the server, delivered to your browser.', 'as separate MP3s, rendered on the server and delivered to your browser.'],
  ['FLAC \u00b7 OGG \u2014 up to', 'FLAC \u00b7 OGG \u00b7 up to'],
  ['Quick results \u2014 great for previews.', 'Quick results, great for previews.'],
  ['perfectly in sync \u2014 reduce a layer to hear the rest.', 'perfectly in sync: reduce a layer to hear the rest.'],
  [`    <p>Powered by Meta's <a href="https://github.com/adefossez/demucs" target="_blank" rel="noopener noreferrer">Demucs</a> \u00b7 runs fully local \u00b7 files auto-delete after 24 hours</p>`,
   `    <p class="footer-note">Files auto-delete after 24 hours.</p>
    <div class="footer-credits">
      <span>\u00a9 2026 Sai Charan Sandeveni \u00b7 All rights reserved</span>
      <span class="credit-sep">\u00b7</span>
      <span>Developed by <a href="https://www.linkedin.com/in/saicharan-sandeveni/" target="_blank" rel="noopener noreferrer">Sai Charan Sandeveni</a></span>
    </div>`]
];

const js = [
  ["'Quick results \u2014 great for previews.'", "'Quick results, great for previews.'"],
  ["'Two-pass refinement \u2014 noticeably cleaner separation.'", "'Two-pass refinement, noticeably cleaner separation.'"],
  ["showNote('Unsupported format \u2014 use MP3, WAV, M4A, FLAC or OGG.', false);", "showNote('Unsupported format. Use MP3, WAV, M4A, FLAC or OGG.', false);"],
  ["showNote('Network error \u2014 is the server running?', false);", "showNote('Network error. Is the server running?', false);"],
  ['`${job.originalName} \u2014 Original`', '`${job.originalName} \u00b7 Original`'],
  ["'Stems are kept for 24 hours and this one has expired \u2014 re-upload the song.'", "'Stems are kept for 24 hours and this one has expired. Re-upload the song.'"],
  ["'Playback was blocked \u2014 press play once more.'", "'Playback was blocked. Press play once more.'"],
  ["'<div class=\"empty-state\">No separations yet \u2014 your history will appear here.</div>'", "'<div class=\"empty-state\">No separations yet. Your history will appear here.</div>'"]
];

patch('public/index.html', html);
patch('public/js/main.js', js);

for (const f of ['public/index.html', 'public/js/main.js', 'public/css/style.css']) {
  const c = fs.readFileSync(f, 'utf8');
  console.log(`${f}: em-dashes left = ${(c.match(/\u2014/g) || []).length}, provider mentions = ${/Demucs|Meta's/i.test(c) ? 'FOUND' : 0}`);
}
