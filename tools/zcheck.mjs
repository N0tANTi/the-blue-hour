// Z-fighting checks, muted headless:
//  1. coplanar scan: every static opaque triangle bucketed by plane; same-facing coplanar pairs whose
//     projections overlap (area > 1e-5 m^2) are reported with where they are and which material
//  2. grazing flicker: grazing views rendered twice 0.3 mm apart with animation, smoke and grain off;
//     pixels that flip by more than 0.2 luma (away from depth edges) are counted
//   node tools/zcheck.mjs [--out shots/zcheck]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { arg, launch, startPreview, watch } from '../scripts/lib.mjs';

const out = resolve(String(arg('out', 'shots/zcheck')));
mkdirSync(out, { recursive: true });
const server = await startPreview('dist');
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const w = watch(page, server.url);
await page.goto(`${server.url}?seed=5&autostart=1&clock=fixed`);
await page.waitForFunction(() => window.__game?.ready && window.__game.state().phase === 'playing', null, { timeout: 60000 });

const scan = await page.evaluate(() => {
	const G = window.__game.game;
	const V = G.camera.position.constructor;
	const skip = (m) => {
		const mat = m.material;
		if (!mat || Array.isArray(mat)) return true;
		if (m.isSkinnedMesh || mat.transparent || mat.blending !== 1) return true;
		const n = mat.name || '';
		return /city|sky|river|bridge|bank|spires|moon|stainedGlass/.test(n);
	};
	const tris = [];
	G.scene.updateMatrixWorld(true);
	G.scene.traverse((m) => {
		if (!m.isMesh || skip(m) || !m.visible) return;
		let vis = true;
		for (let p = m; p; p = p.parent) if (!p.visible) vis = false;
		if (!vis) return;
		const g = m.geometry;
		const pos = g.attributes.position;
		const idx = g.index;
		const n = idx ? idx.count : pos.count;
		const a = new V(),
			b = new V(),
			c = new V();
		for (let i = 0; i < n; i += 3) {
			const ia = idx ? idx.getX(i) : i,
				ib = idx ? idx.getX(i + 1) : i + 1,
				ic = idx ? idx.getX(i + 2) : i + 2;
			a.fromBufferAttribute(pos, ia).applyMatrix4(m.matrixWorld);
			b.fromBufferAttribute(pos, ib).applyMatrix4(m.matrixWorld);
			c.fromBufferAttribute(pos, ic).applyMatrix4(m.matrixWorld);
			const nrm = new V().subVectors(b, a).cross(new V().subVectors(c, a));
			const area = nrm.length() / 2;
			if (area < 1e-6) continue;
			nrm.normalize();
			tris.push({ a: a.clone(), b: b.clone(), c: c.clone(), n: nrm, d: nrm.dot(a), area, name: m.material.name || m.name, mesh: m.uuid });
		}
	});
	// bucket by quantised normal and plane distance (2 mm), check neighbouring distance buckets too
	const key = (t, dd) => `${Math.round(t.n.x * 200)},${Math.round(t.n.y * 200)},${Math.round(t.n.z * 200)},${Math.round(t.d / 0.002) + dd}`;
	const buckets = new Map();
	for (const t of tris) {
		const k = key(t, 0);
		(buckets.get(k) ?? buckets.set(k, []).get(k)).push(t);
	}
	const clip = (poly, a, b) => {
		// keep the part of poly left of the directed edge a->b (2D)
		const out = [];
		const side = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
		for (let i = 0; i < poly.length; i++) {
			const p = poly[i],
				q = poly[(i + 1) % poly.length];
			const sp = side(p),
				sq = side(q);
			if (sp >= 0) out.push(p);
			if (sp * sq < 0) {
				const t = sp / (sp - sq);
				out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
			}
		}
		return out;
	};
	const area2 = (poly) => {
		let s = 0;
		for (let i = 0; i < poly.length; i++) {
			const p = poly[i],
				q = poly[(i + 1) % poly.length];
			s += p[0] * q[1] - q[0] * p[1];
		}
		return Math.abs(s) / 2;
	};
	const hits = [];
	const seen = new Set();
	for (const [k, list] of buckets) {
		const parts = k.split(',');
		const cand = [...list];
		for (const dd of [-1, 1]) {
			const nb = buckets.get(`${parts[0]},${parts[1]},${parts[2]},${Number(parts[3]) + dd}`);
			if (nb) cand.push(...nb);
		}
		if (cand.length < 2) continue;
		const n = list[0].n;
		// 2D basis in the plane
		const t1 = Math.abs(n.y) < 0.9 ? new V(0, 1, 0).cross(n).normalize() : new V(1, 0, 0).cross(n).normalize();
		const t2 = n.clone().cross(t1);
		const to2 = (p) => [p.dot(t1), p.dot(t2)];
		const P = cand.map((t) => {
			const tri = [to2(t.a), to2(t.b), to2(t.c)];
			// counter-clockwise
			const s = (tri[1][0] - tri[0][0]) * (tri[2][1] - tri[0][1]) - (tri[1][1] - tri[0][1]) * (tri[2][0] - tri[0][0]);
			if (s < 0) tri.reverse();
			const xs = tri.map((p) => p[0]),
				ys = tri.map((p) => p[1]);
			return { t, tri, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
		});
		for (let i = 0; i < list.length; i++) {
			const A = P[i];
			for (let j = 0; j < P.length; j++) {
				if (j === i) continue;
				const B = P[j];
				if (B.x0 >= A.x1 || B.x1 <= A.x0 || B.y0 >= A.y1 || B.y1 <= A.y0) continue;
				if (A.t.n.dot(B.t.n) < 0.999) continue;
				const id = A.t < B.t ? `${i}:${j}` : `${j}:${i}`;
				let poly = A.tri;
				for (let e = 0; e < 3 && poly.length; e++) poly = clip(poly, B.tri[e], B.tri[(e + 1) % 3]);
				const ov = poly.length >= 3 ? area2(poly) : 0;
				if (ov > 1e-5) {
					const c = A.t.a.clone().add(A.t.b).add(A.t.c).divideScalar(3);
					const tag = `${A.t.name}|${B.t.name}|${c.x.toFixed(1)},${c.y.toFixed(1)},${c.z.toFixed(1)}`;
					if (seen.has(tag) || seen.has(id)) continue;
					seen.add(tag);
					seen.add(id);
					hits.push({ at: [+c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2)], n: [+A.t.n.x.toFixed(2), +A.t.n.y.toFixed(2), +A.t.n.z.toFixed(2)], area: +ov.toFixed(5), a: A.t.name, b: B.t.name, sameMesh: A.t.mesh === B.t.mesh });
				}
			}
		}
	}
	return { triangles: tris.length, planes: buckets.size, overlaps: hits.length, hits };
});
console.log(`coplanar scan: ${scan.triangles} triangles, ${scan.planes} planes, ${scan.overlaps} overlaps`);
for (const h of scan.hits.slice(0, 10)) console.log('  ', JSON.stringify(h));

if (process.argv.includes('--scan-only')) { writeFileSync(join(out, 'report.json'), JSON.stringify({ scan }, null, 1)); await browser.close(); server.stop(); process.exit(0); }
// grazing flicker grid
const VIEWS = [
	['floor-grazing', [3.0, 0.35, 6.0], [-4, 0.0, -6]],
	['stage-steps', [0.5, 0.6, -3.2], [-6, 0.6, -5.4]],
	['bar-front', [3.6, 0.9, -5.8], [9.5, 0.7, -7.0]],
	['wall-west', [-8.6, 1.4, 6.0], [-9.5, 1.2, -4]],
	['wall-east', [8.6, 1.4, 6.0], [9.5, 1.3, -3]],
	['arch-face', [1.5, 3.5, -4.6], [-9, 4.0, -6.2]],
	['card-room', [-10.2, 0.4, 3.0], [-16, 0.2, -3]],
	['balcony-floor', [-5.5, 0.35, 10.2], [6, 0.0, 14]],
	['booth-tops', [-3.0, 1.0, 7.4], [-3.4, 0.9, 0]],
	['ceiling', [0, 7.9, 6], [0, 8.4, -6]],
	['table-glasses', [3.25, 0.765, -0.05], [2.3, 0.742, -0.5]],
	['table-glasses-2', [1.4, 0.76, -0.95], [2.3, 0.742, -0.5]],
	['table-booth', [-3.4, 0.77, -1.6], [-3.4, 0.742, -2.6]],
	['bar-counter', [5.4, 1.14, -6.6], [7.6, 1.122, -7.45]],
	['bar-shelf', [6.0, 1.06, -9.2], [8.0, 1.045, -10.0]],
	['card-table', [-11.5, 0.78, 0.8], [-13.1, 0.762, 0.0]],
];
await page.evaluate(() => {
	const G = window.__game.game;
	G.people.root.visible = false;
	G.scene.traverse((o) => {
		if (o.material && /smoke|beam/.test(o.material.name || '')) o.visible = false;
	});
	G.path.look.grain = 0;
	G.city.lights?.forEach?.((b) => (b.visible = false));
});
const flick = [];
for (const [name, p, t] of VIEWS) {
	const r = await page.evaluate(
		async ([p, t]) => {
			const g = window.__game;
			const G = g.game;
			const V = G.camera.position.constructor;
			const grab = () => {
				const c = document.createElement('canvas');
				c.width = 640;
				c.height = 360;
				const x = c.getContext('2d');
				x.drawImage(G.canvas, 0, 0, 640, 360);
				return x.getImageData(0, 0, 640, 360).data;
			};
			const shot = (dx) => {
				G.shotCam = { pos: new V(p[0] + dx, p[1], p[2]), target: new V(t[0] + dx, t[1], t[2]), fov: 60 };
				G.path.look.grain = 0;
				g.step(1);
				return grab();
			};
			shot(0);
			const A = shot(0);
			const B = shot(0.0003);
			let flips = 0;
			const L = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
			for (let y = 1; y < 359; y++)
				for (let x = 1; x < 639; x++) {
					const i = (y * 640 + x) * 4;
					const dl = Math.abs(L(A, i) - L(B, i)) / 255;
					if (dl < 0.2) continue;
					// ignore real edges: the neighbourhood in A already spans the new value
					let lo = 255,
						hi = 0;
					for (let oy = -1; oy <= 1; oy++)
						for (let ox = -1; ox <= 1; ox++) {
							const v = L(A, i + (oy * 640 + ox) * 4);
							lo = Math.min(lo, v);
							hi = Math.max(hi, v);
						}
					const vb = L(B, i);
					if (vb >= lo - 8 && vb <= hi + 8) continue;
					flips++;
				}
			return flips;
		},
		[p, t],
	);
	await page.screenshot({ path: join(out, `${name}.png`) });
	flick.push({ name, flips: r });
	console.log(`flicker ${name}: ${r} flipping pixels`);
}
writeFileSync(join(out, 'report.json'), JSON.stringify({ scan, flicker: flick }, null, 1));
if (w.errors.length) console.log('errors', w.errors.slice(0, 5));
await browser.close();
server.stop();
