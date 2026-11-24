// Glass-foot z-fight test: look down at glasses on a table from ~45 degrees, nudge the camera through tiny
// steps, and count pixels around each foot that toggle between frames (smoke and grain off). Muted headless.
import { launch, startPreview } from '../scripts/lib.mjs';
const server = await startPreview('dist');
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
await page.goto(`${server.url}?seed=5&autostart=1&clock=fixed`);
await page.waitForFunction(() => window.__game?.ready && window.__game.state().phase === 'playing', null, { timeout: 60000 });
const res = await page.evaluate(async () => {
	const g = window.__game;
	const G = g.game;
	const V = G.camera.position.constructor;
	G.people.root.visible = false;
	G.scene.traverse((o) => { if (o.material && /smoke|beam/.test(o.material.name || '')) o.visible = false; });
	const out = {};
	for (const [name, t] of [['martini', [2.387, 0.742, -0.213]], ['tumbler', [2.042, 0.742, -0.644]], ['ashtray', [2.3 + Math.cos(1.28 + 4.2) * 0.26, 0.742, -0.5 + Math.sin(1.28 + 4.2) * 0.26]]]) {
		const frames = [];
		for (let k = 0; k < 12; k++) {
			const d = 0.35 + k * 0.0011;
			G.shotCam = { pos: new V(t[0] + d * 0.7, t[1] + d * 0.75, t[2] + d * 0.7), target: new V(...t), fov: 30 };
			G.path.look.grain = 0;
			g.step(1);
			const c = document.createElement('canvas');
			c.width = 200; c.height = 200;
			const x = c.getContext('2d');
			x.drawImage(G.canvas, 300, 300, 200, 200, 0, 0, 200, 200); // the centre, around the foot
			frames.push(x.getImageData(0, 0, 200, 200).data);
		}
		let flips = 0;
		const L = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
		for (let k = 1; k < frames.length; k++) {
			const A = frames[k - 1], B = frames[k];
			for (let y = 1; y < 199; y++) for (let xx = 1; xx < 199; xx++) {
				const i = (y * 200 + xx) * 4;
				if (Math.abs(L(A, i) - L(B, i)) < 10) continue;
				let lo = 255, hi = 0;
				for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) { const v = L(A, i + (oy * 200 + ox) * 4); lo = Math.min(lo, v); hi = Math.max(hi, v); }
				const vb = L(B, i);
				if (vb >= lo - 4 && vb <= hi + 4) continue;
				flips++;
			}
		}
		out[name] = flips;
	}
	return out;
});
console.log(JSON.stringify(res));
await page.evaluate(() => { const G = window.__game.game; const V = G.camera.position.constructor; const t = [2.387, 0.742, -0.213]; G.shotCam = { pos: new V(t[0] + 0.245, t[1] + 0.26, t[2] + 0.245), target: new V(...t), fov: 30 }; window.__game.step(2); });
await page.screenshot({ path: process.argv[2] ?? 'shots/calib/glassz.png' });
await browser.close();
server.stop();
