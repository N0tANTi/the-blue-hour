// 15 s first-person walk-through clip (real controller, real clock), muted headless.
//   node scripts/walk.mjs [--size 1920x1080] [--out shots/clip/walk.mp4]
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { arg, launch, startPreview, startRecorder, watch } from './lib.mjs';
const [W, H] = String(arg('size', '1920x1080')).split('x').map(Number);
const out = resolve(String(arg('out', 'shots/clip/walk.mp4')));
mkdirSync(dirname(out), { recursive: true });
const server = await startPreview('dist');
const browser = await launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
const w = watch(page, server.url);
await page.goto(`${server.url}?autostart=1&seed=3`);
await page.waitForFunction(() => window.__game?.ready && window.__game.state().phase === 'playing', null, { timeout: 60000 });
await page.evaluate(() => {
	document.getElementById('hud').style.display = 'none';
	const g = window.__game;
	g.game.player.teleport(new g.game.camera.position.constructor(2.9, 0, 2.3), 0.27, 0.02);
});
await page.waitForTimeout(1500);
const rec = await startRecorder(page, out, { fps: 30, width: W, height: H });
await page.evaluate(
	() =>
		new Promise((done) => {
			const g = window.__game;
			const P = g.game.player;
			const V = g.game.camera.position.constructor;
			// [time s, action]: look targets (yaw, pitch) and walk waypoints
			const plan = [
				{ t: 0, look: [0.45, 0.02] },
				{ t: 2.6, look: [-0.25, 0.02] },
				{ t: 3.4, walk: new V(4.3, 0, 0.4) },
				{ t: 6.2, walk: new V(4.4, 0, -3.0) },
				{ t: 9.4, look: [0.95, 0.06] },
				{ t: 11.8, look: [-0.75, 0.04] },
				{ t: 15.0, look: [-0.2, 0.02] },
				{ t: 17.6, end: true },
			];
			let i = 0;
			const t0 = performance.now();
			let yawT = P.yaw,
				pitchT = P.pitch,
				walkTo = null;
			const lerpA = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
			const tick = () => {
				const t = (performance.now() - t0) / 1000;
				while (i < plan.length && plan[i].t <= t) {
					const s = plan[i++];
					if (s.look) {
						yawT = s.look[0];
						pitchT = s.look[1];
						walkTo = null;
						g.release('forward');
					}
					if (s.walk) walkTo = s.walk;
					if (s.end) {
						g.releaseAll();
						return done();
					}
				}
				if (walkTo) {
					const f = P.feet(1);
					const dx = walkTo.x - f.x,
						dz = walkTo.z - f.z;
					if (Math.hypot(dx, dz) > 0.35) {
						yawT = Math.atan2(-dx, -dz);
						pitchT = -0.03;
						g.press('forward');
					} else g.release('forward');
				}
				P.yaw = lerpA(P.yaw, yawT, 0.035);
				P.pitch += (pitchT - P.pitch) * 0.04;
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		}),
);
await rec.stop();
const st = await page.evaluate(() => window.__game.state());
console.log('frames', rec.frames(), 'steps', st.audio.steps, 'pos', JSON.stringify(st.player));
console.log('errors', w.errors.length, w.errors.slice(0, 3));
await browser.close();
server.stop();
