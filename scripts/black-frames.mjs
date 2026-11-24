// Looks for frames that come out black (or far darker than their neighbours) while the view sweeps over the city
// from the balcony, and elsewhere. Headless, muted, the live loop with real time.
//   node scripts/black-frames.mjs [--size 1920x1080] [--seconds 40] [--views balcony,bridge,terrace,ref,bar,cards] [--extra "&renderer=webgl2"]
//   [--shots shots/black] saves the first few bad frames and the good frame before each
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { arg, launch, startPreview, watch } from './lib.mjs';
import { VIEWS } from './view-list.mjs';

const [SW, SH] = String(arg('size', '1920x1080')).split('x').map(Number);
const seconds = Number(arg('seconds', 40));
const names = String(arg('views', 'balcony,bridge,terrace,ref,bar,cards')).split(',');
const extra = arg('extra', '') || '';
const shots = arg('shots', '') ? resolve(String(arg('shots'))) : null;
if (shots) mkdirSync(shots, { recursive: true });

const server = await startPreview(String(arg('dist', 'dist')));
const browser = await launch();
const page = await browser.newPage({ viewport: { width: SW, height: SH } });
const w = watch(page, server.url);
await page.goto(`${server.url}?seed=5&autostart=1${extra}`);
await page.waitForFunction(() => window.__game?.ready && window.__game.state().phase === 'playing', null, { timeout: 60000 });
await page.waitForTimeout(1500);
console.log(`backend: ${await page.evaluate(() => window.__game.state().backend)}`);

// every frame: the picture's mean brightness, read straight after it is drawn
await page.evaluate(() => {
	const G = window.__game.game;
	const c = document.createElement('canvas');
	c.width = 64;
	c.height = 36;
	const g = c.getContext('2d', { willReadFrequently: true });
	const log = (window.__frames = []);
	window.__bad = [];
	const draw = G.path.render.bind(G.path);
	G.path.render = () => {
		draw();
		g.drawImage(G.canvas, 0, 0, 64, 36);
		const px = g.getImageData(0, 0, 64, 36).data;
		let sum = 0,
			dark = 0;
		for (let i = 0; i < px.length; i += 4) {
			const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
			sum += l;
			if (l < 2) dark++;
		}
		const f = { t: performance.now(), mean: sum / (px.length / 4), dark: dark / (px.length / 4), view: window.__view };
		log.push(f);
		const prev = log[log.length - 2];
		if (prev && prev.view === f.view && (f.dark > 0.9 || f.mean < prev.mean * 0.35) && window.__bad.length < 6) window.__bad.push({ ...f, was: prev.mean, url: G.canvas.toDataURL('image/jpeg', 0.8), n: log.length });
	};
	document.getElementById('hud').style.display = 'none';
});

for (const name of names) {
	const [p, t, fov] = VIEWS[name];
	await page.evaluate(
		([name, p, t, fov, ms]) =>
			new Promise((done) => {
				const G = window.__game.game;
				const V = G.camera.position.constructor;
				window.__view = name;
				const t0 = performance.now();
				const tick = () => {
					const s = (performance.now() - t0) / 1000;
					// a slow look around the view's own direction, as a player would
					const d = new V(t[0] - p[0], t[1] - p[1], t[2] - p[2]);
					const len = d.length();
					const yaw = Math.atan2(d.x, d.z) + Math.sin(s * 0.7) * 0.9;
					const pitch = Math.asin(d.y / len) + Math.sin(s * 0.43) * 0.35;
					G.shotCam = { pos: new V(p[0] + Math.sin(s * 0.3) * 0.4, p[1], p[2] + Math.cos(s * 0.23) * 0.4), target: new V(), fov };
					G.shotCam.target.set(G.shotCam.pos.x + Math.sin(yaw) * Math.cos(pitch) * 50, G.shotCam.pos.y + Math.sin(pitch) * 50, G.shotCam.pos.z + Math.cos(yaw) * Math.cos(pitch) * 50);
					if (performance.now() - t0 < ms) requestAnimationFrame(tick);
					else done();
				};
				tick();
			}),
		[name, p, t, fov, (seconds * 1000) / names.length],
	);
	const r = await page.evaluate((name) => {
		const f = window.__frames.filter((x) => x.view === name).slice(5);
		const means = f.map((x) => x.mean).sort((a, b) => a - b);
		const med = means[Math.floor(means.length / 2)];
		const black = f.filter((x) => x.dark > 0.9).length;
		const dips = f.filter((x, i) => i > 0 && x.mean < f[i - 1].mean * 0.35).length;
		return { frames: f.length, median: +med.toFixed(1), lowest: +means[0].toFixed(1), black, dips };
	}, name);
	console.log(`${name}: ${JSON.stringify(r)}`);
}
const bad = await page.evaluate(() => window.__bad);
for (const b of bad) {
	console.log(`bad frame ${b.n} in ${b.view}: mean ${b.mean.toFixed(1)} after ${b.was.toFixed(1)}, ${(b.dark * 100).toFixed(0)}% black`);
	if (shots) (await import('node:fs')).writeFileSync(join(shots, `${b.view}-${b.n}.jpg`), Buffer.from(b.url.split(',')[1], 'base64'));
}
if (w.errors.length) console.log(`errors: ${[...new Set(w.errors)].slice(0, 8).join(' | ')}`);
if (w.warnings.length) console.log(`warnings: ${[...new Set(w.warnings)].slice(0, 8).join(' | ')}`);
await browser.close();
server.stop();
