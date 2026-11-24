// Live frame rate at a size (default 1920x1080), from a few views, real clock, muted headless.
import { arg, launch, startPreview, watch, PROBE_INIT } from './lib.mjs';
const [W, H] = String(arg('size', '1920x1080')).split('x').map(Number);
const server = await startPreview('dist');
const browser = await launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.addInitScript(PROBE_INIT);
const w = watch(page, server.url);
const t0 = Date.now();
await page.goto(`${server.url}?autostart=1${arg('extra', '') || ''}`);
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 60000 });
const readyMs = Date.now() - t0;
const views = { ref: [[4.2, 1.66, 4.2], [0.4, 2.5, -8.6]], bar: [[1.6, 1.62, -0.8], [7.4, 2.0, -9.4]], cards: [[-9.8, 1.62, 0.2], [-13.2, 1.1, 0.0]], balcony: [[-1.2, 1.65, 10.8], [-6.0, -2.0, 60]] };
const out = {};
for (const [name, [p, t]] of Object.entries(views)) {
	out[name] = await page.evaluate(async ([p, t]) => {
		const G = window.__game.game;
		const V = G.camera.position.constructor;
		G.shotCam = { pos: new V(...p), target: new V(...t), fov: 60 };
		await new Promise((r) => setTimeout(r, 1500));
		const times = [];
		let last = performance.now();
		await new Promise((res) => {
			const end = last + 6000;
			const tick = () => {
				const n = performance.now();
				times.push(n - last);
				last = n;
				if (n < end) requestAnimationFrame(tick);
				else res();
			};
			requestAnimationFrame(tick);
		});
		times.sort((a, b) => a - b);
		const avg = times.reduce((a, b) => a + b, 0) / times.length;
		const s = G.path.stats();
		return { fps: +(1000 / avg).toFixed(1), p95ms: +times[Math.floor(times.length * 0.95)].toFixed(1), calls: s.calls, tris: s.triangles, cpuMs: +G.perf().cpuAvg.toFixed(2) };
	}, [p, t]);
}
const st = await page.evaluate(() => ({ marks: window.__game.state().marks, backend: window.__game.state().backend, pr: window.__game.game.path.renderer.getPixelRatio(), probe: window.__probe }));
console.log(JSON.stringify({ size: `${W}x${H}`, readyMs, ...st, views: out }, null, 1));
console.log('errors', w.errors.length, w.errors.slice(0, 3), 'offHost', w.offHost.length);
await browser.close();
server.stop();
