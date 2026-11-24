// Look-dev captures: fixed camera views (no player), deterministic clock.
//   node scripts/views.mjs [--size 1920x1080] [--out shots/views] [--only ref,bar] [--extra "&debug=1"] [--view 0..4]
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { arg, launch, startPreview, watch } from './lib.mjs';
import { VIEWS } from './view-list.mjs';

const out = resolve(String(arg('out', 'shots/views')));
const only = arg('only', '') ? String(arg('only')).split(',') : null;
const extra = arg('extra', '') || '';
const dbg = Number(arg('view', 0));
mkdirSync(out, { recursive: true });
const [SW, SH] = String(arg('size', '1920x1080')).split('x').map(Number);

// the views themselves are in view-list.mjs, shared with black-frames.mjs
export { VIEWS };

const server = await startPreview(String(arg('dist', 'dist')));
const browser = await launch();
const page = await browser.newPage({ viewport: { width: SW, height: SH } });
const w = watch(page, server.url);
await page.goto(`${server.url}?seed=5&autostart=1&clock=fixed${extra}`);
await page.waitForFunction(() => window.__game?.ready && window.__game.state().phase === 'playing', null, { timeout: 60000 });
await page.waitForTimeout(1200);
for (const [name, [p, t, fov]] of Object.entries(VIEWS)) {
	if (only && !only.includes(name)) continue;
	await page.evaluate(([p, t, fov, dbg]) => {
		const g = window.__game;
		const G = g.game;
		G.shotCam = { pos: { x: p[0], y: p[1], z: p[2], clone() { return this; } }, target: { x: t[0], y: t[1], z: t[2] }, fov };
		G.shotCam.pos = new G.camera.position.constructor(p[0], p[1], p[2]);
		G.shotCam.target = new G.camera.position.constructor(t[0], t[1], t[2]);
		G.path.debugView.value = dbg;
		document.getElementById('hud').style.display = 'none';
		g.step(90);
	}, [p, t, fov, dbg]);
	await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => { window.__game.step(1); requestAnimationFrame(() => r()); })));
	await page.screenshot({ path: join(out, `${name}.png`) });
	console.log(`${name}.png`);
}
const st = await page.evaluate(() => window.__game.state());
console.log(JSON.stringify({ backend: st.backend, people: st.people, audio: st.audio, marks: st.marks }));
if (w.errors.length) console.log(`errors: ${w.errors.slice(0, 8).join(' | ')}`);
if (w.warnings.length) console.log(`warnings: ${w.warnings.slice(0, 5).join(' | ')}`);
if (w.offHost.length) console.log(`offhost: ${w.offHost.join(' ')}`);
await browser.close();
server.stop();
