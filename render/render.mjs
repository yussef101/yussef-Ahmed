// Headless renderer: serves the repo over HTTP, drives render/index.html in
// Chromium (SwiftShader WebGL) and pipes JPEG frames into ffmpeg.
//
//   node render/render.mjs --from 0 --to 1800 --out build/video.mp4 [--workers 2] [--w 1920]
//   node render/render.mjs --stills 12.5,95,130 --out build/stills
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1] ?? true]] : a), []));
const W = +(args.w || 1920);
const FPS = +(args.fps || 24);
const CHROME = process.env.CHROME_PATH || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.ttf': 'font/ttf' };
function serve() {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(rsp);
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

async function openPage(browser, port) {
  const page = await browser.newPage({ viewport: { width: W, height: Math.round(W * 9 / 16) } });
  page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()); });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto(`http://127.0.0.1:${port}/render/index.html?w=${W}&aa=${args.aa || 0}${args.lineup ? '&lineup=' + args.lineup : ''}`);
  await page.waitForFunction('window.ready || window.bootError', null, { timeout: 180000 });
  const err = await page.evaluate('window.bootError');
  if (err) throw new Error(err);
  return page;
}

async function main() {
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    if (args.stills) {
      const out = path.resolve(ROOT, args.out || 'build/stills');
      fs.mkdirSync(out, { recursive: true });
      const page = await openPage(browser, port);
      for (const t of String(args.stills).split(',').map(Number)) {
        const b64 = await page.evaluate((tt) => window.renderAt(tt), t);
        const f = path.join(out, `still_${String(t.toFixed(2)).padStart(8, '0')}.jpg`);
        fs.writeFileSync(f, Buffer.from(b64, 'base64'));
        console.log(f);
      }
      return;
    }
    const from = +(args.from || 0), to = +(args.to || 1800);
    const f0 = Math.round(from * FPS), f1 = Math.round(to * FPS);
    const out = path.resolve(ROOT, args.out || 'build/video.mp4');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', args.preset || 'medium', '-crf', String(args.crf || 18), '-pix_fmt', 'yuv420p', '-r', String(FPS), out],
      { stdio: ['pipe', 'inherit', 'inherit'] });
    const page = await openPage(browser, port);
    const t0 = Date.now();
    for (let f = f0; f < f1; f++) {
      const b64 = await page.evaluate((tt) => window.renderAt(tt), f / FPS);
      const buf = Buffer.from(b64, 'base64');
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      if ((f - f0) % 240 === 0) {
        const done = f - f0 + 1, el = (Date.now() - t0) / 1000;
        console.log(`frame ${f} / ${f1}  ${(done / el).toFixed(2)} fps  eta ${((f1 - f) / (done / el) / 60).toFixed(1)} min`);
      }
    }
    ff.stdin.end();
    await new Promise((r) => ff.on('close', r));
    console.log('wrote', out);
  } finally {
    await browser.close();
    srv.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
