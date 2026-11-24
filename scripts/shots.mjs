// Deterministic screenshots for look and feel tuning: boots with ?autostart&clock=fixed, drives the game
// through window.__game.step(), and saves one PNG per scenario. Edit SCENES for your game.
//   node scripts/shots.mjs [--renderer webgpu] [--out shots/poses-webgpu] [--only name,name] [--size 1920x1080] [--extra "&quality=low"]
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { arg, launch, startPreview, watch } from './lib.mjs';

const kind = String(arg('renderer', 'webgpu'));
const out = resolve(String(arg('out', `shots/poses-${kind}`)));
const only = arg('only', '') ? String(arg('only')).split(',') : null;
const extra = arg('extra', '') || '';
mkdirSync(out, { recursive: true });
const [SW, SH] = String(arg('size', '1280x720')).split('x').map(Number);

/** Each scene runs from a fresh reset. `g` is window.__game inside the page. */
const SCENES = {
	idle: (g) => {
		g.step(30);
	},
	walk: (g) => {
		g.press('forward');
		g.step(42);
	},
	sprint: (g) => {
		g.press('forward');
		g.press('sprint');
		g.step(40);
	},
	ads: (g) => {
		const d = g.state().level.dummy;
		g.aimAt(d.x, d.y + 1.2, d.z);
		g.press('aim');
		g.step(30);
	},
	fire: (g) => {
		const d = g.state().level.dummy;
		g.aimAt(d.x, d.y + 1.2, d.z);
		g.press('fire');
		g.step(13);
	},
	reload: (g) => {
		g.press('fire');
		g.step(10);
		g.release('fire');
		g.press('reload');
		g.step(2);
		g.release('reload');
		g.step(38);
	},
	crates: (g) => {
		g.aimAt(4.85, 0.6, -7);
		g.press('fire');
		g.step(16);
	},
	kill: (g) => {
		const d = g.state().level.dummy;
		g.aimAt(d.x, d.y + 1.85, d.z);
		g.press('aim');
		g.step(16);
		g.press('fire');
		for (let i = 0; i < 40 && g.state().level.dummy.kills === 0; i++) g.step(1);
		g.release('fire');
		g.release('aim');
		g.step(14);
	},
	vista: (g) => {
		g.game.player.teleport({ x: -13, y: 0, z: 13 }, -0.72, -0.08);
		g.step(20);
	},
};

const server = await startPreview(String(arg('dist', 'dist')));
const browser = await launch();
const page = await browser.newPage({ viewport: { width: SW, height: SH } });
const w = watch(page, server.url);
await page.goto(`${server.url}?renderer=${kind}&seed=5&autostart=1&clock=fixed${extra}`);
await page.waitForFunction(() => window.__game?.ready && window.__game.state().phase === 'playing', null, { timeout: 30000 });
await page.waitForTimeout(500); // let the veil fade (CSS runs on real time)
for (const [name, fn] of Object.entries(SCENES)) {
	if (only && !only.includes(name)) continue;
	await page.evaluate((src) => {
		const g = window.__game;
		g.releaseAll();
		g.game.reset();
		const hint = document.getElementById('hint');
		if (hint) hint.style.display = 'none';
		g.step(2);
		// biome-ignore lint: scenario source is ours
		new Function('g', `(${src})(g)`)(g);
	}, fn.toString());
	// render one more frame inside rAF so the compositor presents it before the capture
	const info = await page.evaluate(
		() =>
			new Promise((r) =>
				requestAnimationFrame(() => {
					window.__game.step(1);
					requestAnimationFrame(() => r({ ads: window.__game.game.viewmodel.ads.toFixed(2), fov: window.__game.game.camera.fov.toFixed(1) }));
				}),
			),
	);
	await page.screenshot({ path: join(out, `${name}.png`) });
	console.log(`${name}.png ${JSON.stringify(info)}`);
}
if (w.errors.length) console.log(`errors: ${w.errors.join(' | ')}`);
await browser.close();
server.stop();
