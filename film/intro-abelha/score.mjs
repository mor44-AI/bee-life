// Renders the page's own score (window.__FILM.score) offline in headless Chrome and writes score.wav.
// Same thing the in-page "export score.wav" button does, without the click.
import puppeteer from 'puppeteer-core'; import {writeFileSync} from 'node:fs'; import path from 'node:path'; import {pathToFileURL} from 'node:url';
const file = process.argv[2] || 'intro-abelha.html';
const b = await puppeteer.launch({executablePath: process.env.CHROME, headless: true}); const p = await b.newPage();
p.on('pageerror', e => { console.error(e); process.exitCode = 1; });
await p.goto(pathToFileURL(path.resolve(file)).href + '?bare=1&ar=9:16'); await p.waitForFunction('window.__ready');
const b64 = await p.evaluate(async () => {
  const sr = 48000, oac = new OfflineAudioContext(2, Math.ceil(sr * FILM.DUR), sr); FILM.score(oac, 0, oac.destination); const buf = await oac.startRendering();
  const n = buf.length, out = new DataView(new ArrayBuffer(44 + n * 4)), ws = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); out.setUint32(4, 36 + n * 4, true); ws(8, 'WAVE'); ws(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true); out.setUint32(24, sr, true); out.setUint32(28, sr * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true); ws(36, 'data'); out.setUint32(40, n * 4, true);
  const L = buf.getChannelData(0), R = buf.getChannelData(1); let o = 44; for (let i = 0; i < n; i++) { out.setInt16(o, clamp(L[i], -1, 1) * 32767, true); out.setInt16(o + 2, clamp(R[i], -1, 1) * 32767, true); o += 4; }
  const u8 = new Uint8Array(out.buffer); let s = ''; for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode(...u8.subarray(i, i + 32768)); return btoa(s);
});
writeFileSync('score.wav', Buffer.from(b64, 'base64')); await b.close(); console.log('score.wav written');
