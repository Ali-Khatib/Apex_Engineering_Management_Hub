// node frames.js preview  → a few stills;  node frames.js film → pipes all frames to ffmpeg
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const OUT = '/tmp/claude-0/-home-claude/ebada767-e2ac-566a-a6f4-06e2b42e3360/scratchpad/shots/';
(async () => {
  const mode = process.argv[2];
  const b = await chromium.launch({ args: ['--disable-gpu-vsync'] });
  const p = await (await b.newContext({ viewport: { width: 3840, height: 2160 } })).newPage();
  await p.goto('file://' + __dirname + '/render.html'); await p.evaluate(() => window.ready);
  if (mode === 'preview') {
    for (const t of [0.5, 1.0, 1.45, 1.65, 2.6]) { await p.evaluate(t => render(t), t); await p.screenshot({ path: OUT + `film-${t}.jpg`, type: 'jpeg', quality: 80 }); }
  } else {
    const FPS = 30, DUR = 3.4, N = Math.round(FPS * DUR);
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-tune', 'film', 'tmp-4k.mp4'], { stdio: ['pipe', 'inherit', 'inherit'] });
    const t0 = Date.now();
    for (let i = 0; i < N; i++) {
      await p.evaluate(t => render(t), i / FPS);
      const buf = await p.screenshot({ type: 'jpeg', quality: 92 });
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      if (i % 20 === 0) console.log('frame', i, ((Date.now() - t0) / 1000).toFixed(0) + 's');
    }
    ff.stdin.end();
    await new Promise((res, rej) => ff.on('exit', c => c === 0 ? res() : rej(new Error('ffmpeg ' + c))));
    fs.renameSync('tmp-4k.mp4', 'intro-4k.mp4');
  }
  await b.close();
})();
