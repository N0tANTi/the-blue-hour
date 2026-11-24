// Band hands over time: close-ups from several angles, sampled across 30 s, plus a flip detector
// (largest frame-to-frame rotation of any arm or hand bone). Muted headless.
import { mkdirSync } from 'node:fs';
import { launch, startPreview, watch } from '../scripts/lib.mjs';
const out = process.argv[2] ?? 'shots/hands';
mkdirSync(out, { recursive: true });
const server = await startPreview('dist');
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 640, height: 640 } });
const w = watch(page, server.url);
await page.goto(`${server.url}?seed=5&autostart=1&clock=fixed`);
await page.waitForFunction(() => window.__game?.ready && window.__game.state().phase === 'playing', null, { timeout: 60000 });
await page.evaluate(() => (document.getElementById('hud').style.display = 'none'));
// flip detector over 30 s at 60 fps
const flip = await page.evaluate(() => {
	const g = window.__game;
	const P = g.game.people.people;
	const band = P.filter((p) => p.role === 'pianist' || p.role === 'sax');
	const names = ['Spine2', 'LeftShoulder', 'RightShoulder', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand', 'LeftHandIndex1', 'RightHandIndex1'];
	const prev = new Map();
	let worst = { deg: 0, bone: '', role: '', t: 0 };
	for (let f = 0; f < 1800; f++) {
		g.step(1);
		for (const p of band)
			for (const n of names) {
				const b = p.bones.get(n);
				if (!b) continue;
				const q = b.getWorldQuaternion(b.quaternion.clone()).normalize();
				const k = p.role + n;
				const last = prev.get(k);
				if (last) {
					const d = (q.angleTo(last) * 180) / Math.PI;
					if (d > worst.deg) worst = { deg: +d.toFixed(2), bone: n, role: p.role, t: +(f / 60).toFixed(2) };
				}
				prev.set(k, q);
			}
	}
	return worst;
});
console.log('largest frame-to-frame bone rotation over 30 s:', JSON.stringify(flip));
// aim at the hands themselves: centre between the two hand bones of each player, offsets in world space
const aims = await page.evaluate(() => {
	const P = window.__game.game.people.people;
	const mid = (p) => {
		const a = p.bones.get('LeftHand').getWorldPosition(p.bones.get('LeftHand').position.clone());
		const b = p.bones.get('RightHand').getWorldPosition(p.bones.get('RightHand').position.clone());
		return [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2];
	};
	return { sax: mid(P.find((p) => p.role === 'sax')), piano: mid(P.find((p) => p.role === 'pianist')) };
});
console.log('hand centres', JSON.stringify(aims));
const off = (c, d) => [c[0] + d[0], c[1] + d[1], c[2] + d[2]];
const views = {
	saxFront: [off(aims.sax, [0.55, 0.1, 0.95]), aims.sax, 34],
	saxSide: [off(aims.sax, [1.1, 0.15, -0.2]), aims.sax, 34],
	pianoSide: [off(aims.piano, [0.75, 0.25, 0.95]), aims.piano, 36],
	pianoTop: [off(aims.piano, [0.35, 0.9, 0.1]), aims.piano, 40],
};
for (let i = 0; i < 6; i++) {
	await page.evaluate((n) => window.__game.step(n), i === 0 ? 1 : 300);
	for (const [name, [p, t, fov]] of Object.entries(views)) {
		await page.evaluate(([p, t, fov]) => {
			const G = window.__game.game;
			const V = G.camera.position.constructor;
			G.shotCam = { pos: new V(...p), target: new V(...t), fov };
			window.__game.step(2);
		}, [p, t, fov]);
		await page.screenshot({ path: `${out}/${name}-${i}.png` });
	}
}
console.log('errors', w.errors.length, w.errors.slice(0, 2));
await browser.close();
server.stop();
