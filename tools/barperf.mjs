// Bar-view frame time with things toggled off, to find the cost. Muted headless.
import { launch, startPreview } from '../scripts/lib.mjs';
const server = await startPreview('dist');
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(`${server.url}?autostart=1`);
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 60000 });
const run = (hide) => page.evaluate(async (hide) => {
	const G = window.__game.game;
	const V = G.camera.position.constructor;
	G.shotCam = { pos: new V(1.6, 1.62, -0.8), target: new V(7.4, 2.0, -9.4), fov: 60 };
	const hidden = [];
	G.scene.traverse((o) => { const n = o.material?.name || o.name || ''; if (hide && new RegExp(hide).test(n) && o.visible) { o.visible = false; hidden.push(o); } });
	await new Promise((r) => setTimeout(r, 800));
	const t = []; let last = performance.now();
	await new Promise((res) => { const end = last + 4000; const f = () => { const n = performance.now(); t.push(n - last); last = n; n < end ? requestAnimationFrame(f) : res(); }; requestAnimationFrame(f); });
	for (const o of hidden) o.visible = true;
	t.sort((a, b) => a - b);
	return { hide, n: hidden.length, fps: +(1000 / (t.reduce((a, b) => a + b, 0) / t.length)).toFixed(1), p95: +t[Math.floor(t.length * 0.95)].toFixed(1) };
}, hide);
for (const h of ['', 'lanternCone', 'lampPool', 'bottles', 'barMirror', 'cityMirror', 'beam', 'smoke', '', 'char']) console.log(JSON.stringify(await run(h)));
await browser.close(); server.stop();
