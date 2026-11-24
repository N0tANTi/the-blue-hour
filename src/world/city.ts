// @ts-nocheck: three r186 TSL typings reject valid node graphs; runtime-checked by the captures
// The city across the river, painted in layers like a matte painting: dark navy towers on the near bank of the
// far shore, blue ones behind them, pale blue ones dissolving into the air beyond; stepped Deco silhouettes that
// climb to needles, one tall tower leading them. The stone has form (flutes, a fall of light from the moon's side,
// a pale edge) and the light is soft and amber: small glowing windows gathered in lively patches, a tall slot high
// on some shafts that spills onto the stone around it, columns of light rising from the street, mist between the
// layers. A stone
// viaduct stands on its piers between the towers and another crosses the river. The river is dark and carries
// the waterfront's lights as long broken streaks toward you. Above, a deep blue sky of painted cloud and the moon.
// All of it is self-lit (never banded), and none of it casts or takes the club's light.
import * as THREE from 'three/webgpu';
import { abs, asin, atan, attribute, cameraPosition, color, exp, float, floor, fract, fwidth, hash, max, mix, mx_noise_float, normalLocal, positionLocal, positionWorld, sin, smoothstep, step, texture, uniform, uv, vec2, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng } from '../core/rng';
import { withLights } from './mats';

/** Light added to the air (a glow, a pool on the water): self-lit, so it is never banded with the lit surfaces. */
const glowMat = (name: string, node: unknown) => {
	const m = new THREE.MeshLambertNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
	m.name = name;
	m.colorNode = vec3(0);
	m.emissiveNode = node;
	return m;
};

const GROUND = -32;
const RIVER = { zN: 105, zF: 405 };
const BRIDGE_X = -150;
/** Where the moon hangs: over the city, to the right of the tall tower as you face it. */
const MOON = new THREE.Vector3(-0.19, 0.47, 0.86).normalize();
/** The river's light profile covers this much of the far bank, in metres either side of the middle. */
const PROFILE_HALF = 1300;
const AMBER = '#ff9c2c';

interface Tower {
	x: number;
	z: number;
	w: number;
	d: number;
	h: number;
	/** 0 none .. 1 a tall lit slot up the shaft */
	slot: number;
	low?: boolean;
	/** one of the hand-placed leaders */
	lead?: boolean;
	/** the near row: more flat tops and short pyramids than needles */
	blocky?: boolean;
}

export class City {
	readonly root = new THREE.Group();
	private uTime = uniform(0);
	private boats: { obj: THREE.Object3D; speed: number; x0: number; span: number }[] = [];

	constructor(scene: THREE.Scene) {
		const rng = new Rng(1931);
		const towers: Tower[] = [];
		const clear = (x: number, z: number, r: number) => !towers.some((t) => Math.hypot(t.x - x, t.z - z) < r + t.w * 0.5);

		// ---------- where the towers stand ----------
		// the leaders, placed by hand for the view from the rail and through the doors (+x is to your left)
		for (const [x, z, w, h, slot] of [
			[8, 522, 42, 330, 1],
			[-92, 512, 32, 232, 0],
			[118, 516, 32, 214, 0],
			[-205, 530, 34, 250, 1],
			[236, 534, 34, 262, 0],
			[-332, 518, 32, 204, 0],
			[352, 526, 34, 226, 1],
			[-474, 536, 36, 268, 0],
			[504, 540, 36, 250, 1],
			[-640, 524, 34, 236, 0],
			[676, 530, 34, 252, 1],
		] as number[][])
			towers.push({ x, z, w, d: w, h, slot: slot * 2, lead: true });
		// the crowd around them, mid distance
		for (let i = 0; i < 900 && towers.length < 120; i++) {
			const z = 572 + rng.next() * 150;
			const x = rng.spread(1050);
			const w = 24 + rng.next() * 16;
			if (!clear(x, z, w * 0.5 + 9)) continue;
			towers.push({ x, z, w, d: w * (0.8 + rng.next() * 0.4), h: 96 + rng.next() ** 1.3 * 150, slot: rng.chance(0.1) ? 1 : 0 });
		}
		// the near row along the far bank: the darkest, lowest silhouettes, with gaps between them
		for (let x = -960; x < 960; x += 64 + rng.next() * 84) {
			if (rng.chance(0.2)) continue;
			const w = 22 + rng.next() * 15;
			const z = 452 + rng.next() * 46;
			if (!clear(x, z, w * 0.5 + 4)) continue;
			towers.push({ x, z, w, d: w * (0.8 + rng.next() * 0.3), h: 36 + rng.next() ** 1.4 * 78, slot: rng.chance(0.05) ? 1 : 0, blocky: true });
		}
		// the far city: pale shapes in the air, wider and taller so they still read
		const farStart = towers.length;
		for (let i = 0; i < 1800 && towers.length < farStart + 190; i++) {
			const z = 730 + rng.next() * 400;
			const x = rng.spread(1050 + (z - 730) * 0.9);
			const w = 28 + rng.next() * 22;
			if (!clear(x, z, w * 0.5 + 10)) continue;
			towers.push({ x, z, w, d: w, h: 170 + rng.next() ** 1.3 * 250, slot: rng.chance(0.14) ? 1 : 0 });
		}
		// low blocks on the waterfront itself
		for (let x = -1000; x < 1000; x += 17 + rng.next() * 16) {
			if (Math.abs(x - BRIDGE_X) < 16) continue;
			const w = 13 + rng.next() * 12;
			towers.push({ x, z: 416 + rng.next() * 12, w, d: 12, h: 7 + rng.next() ** 1.6 * 17, slot: 0, low: true });
		}

		// ---------- geometry: every piece carries its building (centre, half width, top) and a seed ----------
		// (and its own block: centre, half width and depth, foot and top, for the light along its edges)
		let cur = { cx: 0, cz: 0, hw: 1, top: 0, seed: 0, slot: 0 };
		const KEEP = ['position', 'normal', 'binfo', 'bmeta', 'bblock', 'bspan'];
		const tag = (g0: THREE.BufferGeometry, plain = 0, block: number[] = [0, 0, 1e4, 1e4, -1e4, 1e4]) => {
			const g = g0.index ? g0.toNonIndexed() : g0;
			const n = g.attributes.position.count;
			const info = new Float32Array(n * 4),
				meta = new Float32Array(n * 3),
				blk = new Float32Array(n * 4),
				span = new Float32Array(n * 2);
			for (let i = 0; i < n; i++) {
				info.set([cur.cx, cur.cz, cur.hw, cur.top], i * 4);
				meta.set([cur.seed, plain, cur.slot], i * 3);
				blk.set(block.slice(0, 4), i * 4);
				span.set(block.slice(4, 6), i * 2);
			}
			g.setAttribute('binfo', new THREE.BufferAttribute(info, 4));
			g.setAttribute('bmeta', new THREE.BufferAttribute(meta, 3));
			g.setAttribute('bblock', new THREE.BufferAttribute(blk, 4));
			g.setAttribute('bspan', new THREE.BufferAttribute(span, 2));
			return g;
		};
		const box = (list: THREE.BufferGeometry[], x: number, y: number, z: number, w: number, h: number, d: number, plain = 0) => {
			const g = new THREE.BoxGeometry(w, h, d);
			g.translate(x, y + h / 2, z);
			list.push(tag(g, plain, [x, z, w / 2, d / 2, y, y + h]));
		};
		const strip = (gs: THREE.BufferGeometry[]) => {
			for (const g of gs) for (const k of Object.keys(g.attributes)) if (!KEEP.includes(k)) g.deleteAttribute(k);
			return mergeGeometries(gs, false) as THREE.BufferGeometry;
		};

		// the river's light profile: what stands lit on the far bank, by where it is along the bank as you see it
		// (red: lamps and doorways at the water's edge, short bright streaks; green: light higher up, long soft ones)
		// (blue: the broad glow of everything lit behind, lying wide and soft on the water)
		const PW = 2048;
		const profile = new Float32Array(PW * 3);
		const shine = (x: number, z: number, sigma: number, low: number, high: number, broad = 0) => {
			const xb = (x * (RIVER.zF - 12)) / (z - 12);
			const c = ((xb + PROFILE_HALF) / (PROFILE_HALF * 2)) * PW,
				s = Math.max(0.8, (sigma / (PROFILE_HALF * 2)) * PW);
			for (let i = Math.max(0, Math.floor(c - s * 3)); i <= Math.min(PW - 1, Math.ceil(c + s * 3)); i++) {
				const k = Math.exp(-((i - c) ** 2) / (2 * s * s));
				profile[i * 3] += low * k;
				profile[i * 3 + 1] += high * k;
				profile[i * 3 + 2] += broad * k;
			}
		};

		const body: THREE.BufferGeometry[] = [];
		/** A stepped Deco tower: a shaft with lower shoulders, setbacks that taper it, a needle. */
		const deco = (t: Tower) => {
			const { x, z, w, d, h } = t;
			cur = { cx: x, cz: z, hw: w / 2, top: GROUND + h, seed: rng.next(), slot: t.slot };
			if (t.low) {
				box(body, x, GROUND, z, w, h, d);
				if (rng.chance(0.45)) box(body, x + rng.spread(w * 0.2), GROUND + h, z, w * 0.45, 2 + rng.next() * 5, d * 0.6);
				if (rng.chance(0.3)) shine(x, z, w * 0.12, 0.15 + rng.next() * 0.2, 0);
				return;
			}
			// the crown: a slim needle, a short pyramid, or a flat cap with a mast
			const crown = t.lead ? rng.next() * 0.6 : t.blocky ? 0.5 + rng.next() * 0.5 : rng.next();
			const tip = crown < 0.74 ? h * (0.09 + rng.next() * 0.07) : crown < 0.9 ? w * 0.34 : 0;
			const shaft = (h - tip) * (t.lead ? 0.36 + rng.next() * 0.1 : 0.42 + rng.next() * 0.16);
			box(body, x, GROUND, z, w, shaft, d);
			if (t.lead) {
				for (const s of [-1, 1]) box(body, x + s * w * 0.4, GROUND, z, w * 0.36, shaft * (0.7 + rng.next() * 0.16), d * 0.84);
			} else if (rng.chance(0.8)) {
				const sh = shaft * (0.52 + rng.next() * 0.3);
				for (const s of [-1, 1]) box(body, x + s * w * 0.5, GROUND, z, w * 0.5, sh * (s > 0 ? 1 : 0.82 + rng.next() * 0.3), d * 0.78);
				if (!t.lead && rng.chance(0.6)) {
					const sh2 = sh * (0.45 + rng.next() * 0.25);
					for (const s of [-1, 1]) box(body, x + s * w * 0.86, GROUND, z, w * 0.42, sh2 * (s > 0 ? 0.85 + rng.next() * 0.3 : 1), d * 0.6);
				}
			}
			if (rng.chance(0.5)) box(body, x, GROUND, z - d * 0.5, w * 0.6, shaft * (0.3 + rng.next() * 0.3), d * 0.5);
			// setbacks: the shoulders step in quickly, then a slender upper tower climbs to the needle
			const steps = t.lead ? 7 + rng.int(0, 2) : 4 + rng.int(0, 3);
			const rest = h - tip - shaft;
			const waist = 0.24 + rng.next() * 0.12,
				curve = 0.6 + rng.next() * 0.35;
			let y = GROUND + shaft,
				cw = w,
				cd = d,
				sum = 0;
			for (let i = 0; i < steps; i++) sum += (i + 1.5) ** 0.5;
			const finned = !t.blocky && z < 760 && (t.lead || rng.chance(0.65));
			for (let i = 0; i < steps; i++) {
				const pw0 = cw,
					pd0 = cd;
				const k = 1 - ((i + 1) / steps) ** curve * (1 - waist);
				cw = w * k;
				cd = d * k;
				const th = (rest * (i + 1.5) ** 0.5) / sum;
				box(body, x, y, z, cw, th, cd);
				if (finned && pw0 - cw > 1.2) {
					const fw = Math.max(0.9, pw0 * 0.07),
						fh = th * (0.35 + rng.next() * 0.3);
					for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(body, x + sx * (pw0 / 2 - fw / 2), y, z + sz * (pd0 / 2 - fw / 2), fw, fh, fw, 1);
				}
				y += th;
			}
			if (tip > 0) {
				const cone = new THREE.ConeGeometry(Math.max(cw, cd) * (crown < 0.74 ? 0.5 : 0.66), tip, 4);
				cone.rotateY(Math.PI / 4);
				cone.translate(x, y + tip / 2, z);
				body.push(tag(cone, 1));
			} else box(body, x, y, z, cw * 0.55, 2.5 + rng.next() * 4, cd * 0.55, 1);
			box(body, x, y + tip - 0.5, z, 0.45, 5 + rng.next() * 12, 0.45, 1);
			// what it throws on the water: the slot, and a little from its windows
			if (z < 700) {
				if (t.slot) shine(x, z, w * 0.07, 0, 0.3 + rng.next() * 0.25);
				if (rng.chance(0.6)) shine(x, z, w * 0.45, 0, 0, 0.1 + rng.next() * 0.2);
			}
		};
		for (const t of towers) deco(t);

		// ---------- the look of a tower face ----------
		const pw = positionWorld;
		const p = positionLocal;
		const n = normalLocal;
		const info = attribute('binfo', 'vec4');
		const meta = attribute('bmeta', 'vec3');
		const bs = meta.x;
		const dist = pw.sub(cameraPosition).length();
		// how far into the air a thing is: 0 on the far bank, 1 at the back of the city
		const air = smoothstep(430, 1150, dist);
		// how squarely a face is turned to you: 0 edge-on, 1 once it is well in view. A sliver of a tower's side that
		// comes into view as you walk keeps the front's tone and carries no light, so it never flashes
		const turned = smoothstep(0.06, 0.4, abs(n.dot(cameraPosition.sub(pw).normalize())));
		/** The tone of stone at this distance: dark navy near, blue, then pale blue; lighter on the moon's side. */
		const stone = (() => {
			const tone = mix(mix(mix(color('#030820'), color('#0a1836'), smoothstep(545, 640, dist)), color('#16284a'), smoothstep(660, 900, dist)), color('#283a5c'), smoothstep(900, 1180, dist));
			const shade = mix(float(1), float(1.7), smoothstep(0.3, 0.7, n.x.negate()).mul(turned))
				.mul(mix(float(1), float(0.66), smoothstep(0.3, 0.7, n.x).mul(turned)))
				.mul(mix(float(1), float(1.35), smoothstep(0.5, 0.9, n.y)))
				.mul(mix(float(1), float(0.6), smoothstep(0.5, 0.9, n.y.negate())));
			return tone.mul(shade);
		})();
		const faceZ = step(0.5, abs(n.z));
		const u = mix(p.z.sub(info.y), p.x.sub(info.x), faceZ);
		const v = p.y.sub(GROUND);
		const hgt = info.w.sub(GROUND);
		const sideK = step(abs(n.y), 0.3).mul(float(1).sub(meta.y));
		const bay = mix(float(2.2), float(2.9), fract(bs.mul(7.31)));
		const flr = mix(float(3.0), float(3.5), fract(bs.mul(3.17)));
		const uu = u.div(bay).add(0.5);
		const ci = floor(uu),
			fx = fract(uu);
		const vv = v.div(flr);
		const ri = floor(vv),
			fy = fract(vv);
		// this block of the tower: where across its face a point is (-1 the moon's edge .. 1 the far edge), and how
		// far below its top and above its foot
		const blk = attribute('bblock', 'vec4');
		const span = attribute('bspan', 'vec2');
		const across = mix(p.z.sub(blk.y).div(blk.w), p.x.sub(blk.x).div(blk.z), faceZ).clamp(-1, 1);
		const halfFace = mix(blk.w, blk.z, faceZ);
		const below = span.y.sub(p.y),
			above = p.y.sub(span.x);
		// edges soften with distance by about half a pixel, so small windows never shimmer
		const aa = dist.mul(0.0001).clamp(0.012, 0.14);
		const perPxU = fwidth(uu),
			perPxV = fwidth(vv);
		const eu = max(aa, perPxU.mul(0.6)).min(0.5),
			ev = max(aa, perPxV.mul(0.6)).min(0.5);
		const seen = float(1).sub(smoothstep(0.45, 1.0, perPxU)).mul(float(1).sub(smoothstep(0.45, 1.0, perPxV)));
		const fine = float(1).sub(smoothstep(0.2, 0.45, perPxU));
		const rect = (f: ReturnType<typeof float>, a: number, b: number, e: ReturnType<typeof float>) => smoothstep(float(a).sub(e), float(a).add(e), f).mul(smoothstep(float(b).add(e), float(b).sub(e), f));
		// whole numbers only, and never negative: the hash works on integers
		const sI = floor(bs.mul(997));
		const h3 = (a: ReturnType<typeof float>, b: ReturnType<typeof float>, c: number) => hash(a.add(600).mul(127).add(b.add(64).mul(311)).add(sI.mul(7)).add(c));
		// lit windows: most of a tower is dark; light gathers in clusters, and in runs of floors up one bay
		const litShare = mix(float(0.3), float(1.0), fract(bs.mul(5.71)));
		// where a face is lively: a soft field over it, so lit windows gather and the stone there takes a little warmth
		const lively = smoothstep(-0.05, 0.42, mx_noise_float(vec3(u.div(13), v.div(26), bs.mul(40))));
		const pLit = mix(float(0.025), float(0.5), lively).add(float(1).sub(smoothstep(6, 40, v)).mul(0.22)).mul(litShare).mul(float(1).sub(air.mul(0.75)));
		const pairI = floor(ci.div(2));
		const litCell = step(h3(pairI, ri, 23), pLit).mul(step(0.25, h3(ci, ri, 29)));
		const litRun = step(float(1).sub(litShare.mul(0.05)), h3(pairI, floor(ri.div(6)), 37));
		const litAny = max(litCell, litRun);
		// soft-edged, never a hard rectangle, and no two the same strength
		const su = max(eu, float(0.11)),
			sw = max(ev, float(0.1));
		const win = rect(fx, 0.36, 0.64, su).mul(rect(fy, 0.3, 0.74, sw)).mul(seen);
		const halo = rect(fx, 0.2, 0.8, float(0.3)).mul(rect(fy, 0.15, 0.9, float(0.3))).mul(seen);
		const winCol = mix(color('#ff9424'), color('#ffc860'), h3(pairI, ri, 41));
		const winFar = float(1).sub(smoothstep(800, 1040, dist));
		const strength = h3(pairI, ri, 53).pow(1.5).mul(1.0).add(0.3);
		const windows = winCol.mul(win.add(halo.mul(0.16)).mul(litAny).mul(strength).mul(winFar));
		// the slot: a tall lit window up the middle of the shaft, three bays on a wide tower, one on a slender one
		const slotHalf = bay.mul(mix(float(0.5), float(1.5), step(bay.mul(4), info.z)));
		const sv = v.div(hgt);
		// (where on the shaft it sits, and how long it is, differ from tower to tower)
		const s0 = mix(float(0.3), float(0.44), fract(bs.mul(11.3))).add(meta.z.sub(1).max(0).mul(0.16)),
			s1 = s0.add(mix(float(0.1), float(0.2), fract(bs.mul(17.9))));
		const hasSlot = meta.z.min(1);
		const slotOn = step(abs(u), slotHalf).mul(smoothstep(s0, s0.add(0.004), sv)).mul(smoothstep(s1, s1.sub(0.004), sv)).mul(hasSlot);
		const slotFall = mix(float(1.5), float(0.8), smoothstep(s0, s1, sv)).mul(sin(fy.mul(Math.PI)).mul(0.12).add(0.94));
		const slot = color(AMBER).mul(slotFall).mul(mix(float(0.4), rect(fx, 0.3, 0.7, max(eu, float(0.08))), seen)).mul(float(1).sub(smoothstep(1.2, 3.5, perPxU))).mul(slotOn);
		// (the spill: amber on the stone beside, above and below the slot, gone within a few metres)
		const beside = max(abs(u).sub(slotHalf), 0),
			beyond = max(max(s0.sub(sv), sv.sub(s1)), 0).mul(hgt);
		const spill = color('#e87c1e').mul(exp(beside.div(-4.5))).mul(exp(beyond.div(-9))).mul(hasSlot).mul(0.13);
		// light rising from the street: soft columns of amber up the lower floors, each a different height, brightest
		// at the foot and fading out upward and to the sides (no edges anywhere)
		const cu = u.div(bay.mul(2)).add(0.5);
		const upI = floor(cu),
			upF = fract(cu);
		const upTop = h3(upI, float(1), 71).mul(80).add(22);
		const upOn = step(h3(upI, float(2), 73), litShare.mul(0.2)).mul(mix(float(0.08), float(1.0), smoothstep(480, 560, pw.z)));
		const uplight = color('#ff8e24')
			.mul(sin(upF.mul(Math.PI)).pow(2))
			.mul(float(1).sub(v.div(upTop).clamp(0, 1)).pow(1.7))
			.mul(upOn)
			.mul(float(1).sub(smoothstep(0.5, 1.2, fwidth(cu))))
			.mul(winFar)
			.mul(0.5);
		// the streets' glow climbing the faces, amber at the ground and a dim rose higher up: faint on the near row
		// (it stands against the glow), stronger behind it
		const street = float(1).sub(smoothstep(0, 90, v)).pow(2.2);
		const streetGlow = mix(color('#2a2420'), color('#c8762e'), street)
			.mul(street)
			.mul(mix(float(0.0), float(0.08), smoothstep(480, 560, pw.z)))
			.mul(mix(float(0.3), float(1.4), fract(bs.mul(6.1))))
			.mul(float(1).sub(air.mul(0.7)));
		// the form of a block: flutes down each bay, a fall of light across the face from the moon's edge, a pale
		// line under its top where the moon catches the ledge, and shade where it rises out of the block below
		const flutes = mix(float(1), sin(fx.mul(Math.PI)).mul(0.3).add(0.78), fine.mul(float(1).sub(air.mul(0.6))));
		const pierLines = float(1).sub(rect(fx, 0.14, 0.86, max(eu, float(0.05)))).mul(fine).mul(step(0.35, h3(ci, float(5), 61)));
		const fall = mix(float(1.2), float(0.86), across.mul(0.5).add(0.5));
		const edgeLight = exp(across.add(1).mul(halfFace).div(-1.6)).mul(faceZ);
		const ledge = exp(below.div(-1.1)).mul(float(1).sub(smoothstep(0.6, 1.6, fwidth(p.y))));
		const foot = mix(float(0.82), float(1), smoothstep(0, 6, above));
		const rise = mix(float(0.92), float(1.08), smoothstep(0.05, 1.0, sv));
		const moonLight = color('#466a9c').mul(edgeLight.mul(0.34).add(ledge.mul(0.13)).add(pierLines.mul(0.22))).mul(smoothstep(0.1, 0.5, sv)).mul(float(1).sub(air.mul(0.5)));
		// (a fall of light: a soft amber streak hanging on a face somewhere between its foot and its shoulders)
		const fallAt = h3(upI, float(3), 83).mul(0.5).add(0.1).mul(hgt),
			fallLen = h3(upI, float(4), 89).mul(46).add(26);
		const fallOn = step(h3(upI, float(6), 97), litShare.mul(0.2)).mul(smoothstep(520, 600, pw.z));
		const falls = color('#ff9a30')
			.mul(sin(upF.mul(Math.PI)).pow(2))
			.mul(exp(v.sub(fallAt).div(fallLen).pow(2).negate()))
			.mul(fallOn)
			.mul(float(1).sub(smoothstep(0.5, 1.2, fwidth(cu))))
			.mul(0.95);
		const light = max(max(windows, uplight), falls).mul(float(1).sub(slotOn)).add(slot);
		const cityLook = stone
			.mul(flutes)
			.mul(fall)
			.mul(foot)
			.mul(rise)
			.mul(mix(float(0.85), float(1.15), fract(bs.mul(2.3))))
			.add(moonLight.mul(sideK))
			.add(color('#8a4a18').mul(lively).mul(litShare).mul(0.04).mul(sideK).mul(float(1).sub(air)).mul(smoothstep(480, 560, pw.z)))
			.add(streetGlow)
			.add(light.add(spill).mul(sideK).mul(turned).mul(float(1).sub(air.mul(0.45))));
		const cityMat = new THREE.MeshLambertNodeMaterial({ color: 0x000000 });
		cityMat.name = 'city';
		cityMat.emissiveNode = cityLook;
		this.root.add(new THREE.Mesh(strip(body), cityMat));
		const stoneMat = new THREE.MeshLambertNodeMaterial({ color: 0x000000 });
		stoneMat.name = 'cityStone';
		stoneMat.emissiveNode = stone
			.mul(mix(float(1.5), float(2.4), smoothstep(0, 84, v)))
			.add(color('#c8621a').mul(float(1).sub(smoothstep(0, 60, v)).pow(2)).mul(mix(float(0.03), float(0.14), smoothstep(470, 560, pw.z))));
		const lampMat = new THREE.MeshLambertNodeMaterial({ color: 0x000000 });
		lampMat.name = 'cityLamps';
		lampMat.emissiveNode = color('#ffae48').mul(2.0);

		// ---------- the waterfront: a quay wall, its lamps, and lit doorways between the blocks ----------
		{
			const quay: THREE.BufferGeometry[] = [];
			const lamps: THREE.BufferGeometry[] = [];
			const doors: THREE.BufferGeometry[] = [];
			cur = { cx: 0, cz: 0, hw: 1, top: 0, seed: 0, slot: 0 };
			box(quay, 0, GROUND, RIVER.zF + 4, 2400, 3.2, 8);
			for (let x = -1000; x < 1000; x += 8 + rng.next() * 13) {
				const b = 0.35 + rng.next() * 0.65;
				const l = new THREE.SphereGeometry(0.55 + b * 0.5, 6, 4);
				l.translate(x, GROUND + 6.2, RIVER.zF + 2);
				lamps.push(tag(l));
				box(quay, x, GROUND + 3.2, RIVER.zF + 2, 0.22, 3, 0.22);
				if (b > 0.62) shine(x, RIVER.zF + 2, 0.7, (b - 0.45) * 1.5, 0);
				else if (b > 0.5) shine(x, RIVER.zF + 2, 0.7, 0, (b - 0.4) * 0.8);
			}
			// doorways and arcades glowing at street level: where the eye finds the brightest amber
			for (let x = -900; x < 900; x += 26 + rng.next() * 70) {
				const w = 5 + rng.next() * 7,
					h = 8 + rng.next() * 16,
					z = 433 + rng.next() * 14;
				const g = new THREE.PlaneGeometry(w, h);
				g.rotateY(Math.PI);
				g.translate(x, GROUND + h / 2, z);
				doors.push(tag(g));
				shine(x, z, w * 0.14, 0.2, 0.22, 0.04);
			}
			const dm = glowMat('cityDoors', color('#ff8e22').mul(float(1).sub(smoothstep(0.35, 1.0, uv().y))).mul(smoothstep(0.0, 0.3, uv().x)).mul(smoothstep(1.0, 0.7, uv().x)).mul(1.25));
			const dg = mergeGeometries(doors, false) as THREE.BufferGeometry;
			const doorMesh = new THREE.Mesh(dg, dm);
			doorMesh.renderOrder = 4;
			this.root.add(new THREE.Mesh(strip(quay), stoneMat), new THREE.Mesh(strip(lamps), lampMat), doorMesh);
		}

		// ---------- viaducts: tall round arches on piers that reach the ground ----------
		{
			const arches: THREE.BufferGeometry[] = [];
			const lamps: THREE.BufferGeometry[] = [];
			cur = { cx: 0, cz: 0, hw: 1, top: 0, seed: 0, slot: 0 };
			/** A row of arches `h` tall on piers, a deck over them, small lamps along the deck. */
			const viaduct = (cx: number, cz: number, len: number, turn: number, h: number, bays: number, depth: number, lampEvery: number) => {
				const bay = len / bays;
				const ow = bay * 0.8,
					top = GROUND + h,
					spring = top - ow / 2 - 2.5;
				const shp = new THREE.Shape();
				shp.moveTo(-len / 2, top);
				shp.lineTo(len / 2, top);
				shp.lineTo(len / 2, GROUND);
				for (let i = bays - 1; i >= 0; i--) {
					const xc = -len / 2 + bay * (i + 0.5);
					shp.lineTo(xc + ow / 2, GROUND);
					shp.lineTo(xc + ow / 2, spring);
					shp.absarc(xc, spring, ow / 2, 0, Math.PI, false);
					shp.lineTo(xc - ow / 2, GROUND);
				}
				shp.lineTo(-len / 2, GROUND);
				const g = new THREE.ExtrudeGeometry(shp, { depth, bevelEnabled: false, curveSegments: 14 });
				g.translate(0, 0, -depth / 2);
				const deck = new THREE.BoxGeometry(len + 2, 1.6, depth + 1.6);
				deck.translate(0, top + 0.8, 0);
				const parts = [g, deck];
				const ls: THREE.BufferGeometry[] = [];
				for (let t = -len / 2 + lampEvery / 2; t < len / 2; t += lampEvery) {
					const l = new THREE.SphereGeometry(0.6, 6, 4);
					l.translate(t, top + 3.4, -depth / 2);
					ls.push(l);
				}
				for (const q of [...parts, ...ls]) {
					q.rotateY(turn);
					q.translate(cx, 0, cz);
				}
				for (const q of parts) arches.push(tag(q));
				for (const q of ls) lamps.push(tag(q));
			};
			const { zN, zF } = RIVER;
			// across the river, off to the right
			viaduct(BRIDGE_X, (zN + zF) / 2 + 15, zF - zN + 90, Math.PI / 2, 27, 8, 11, 16.5);
			// between the towers, behind the near row: it runs from tower to tower and stands on the ground
			viaduct(-70, 560, 600, 0.05, 84, 14, 7, 21.4);
			this.root.add(new THREE.Mesh(strip(arches), stoneMat), new THREE.Mesh(strip(lamps), lampMat));
		}

		// ---------- the river ----------
		const t = this.uTime;
		{
			const { zN, zF } = RIVER;
			const data = new Uint8Array(PW * 4);
			for (let i = 0; i < PW; i++) {
				data[i * 4] = Math.min(255, profile[i * 3] * 255);
				data[i * 4 + 1] = Math.min(255, profile[i * 3 + 1] * 255);
				data[i * 4 + 2] = Math.min(255, profile[i * 3 + 2] * 255);
				data[i * 4 + 3] = 255;
			}
			const profTex = new THREE.DataTexture(data, PW, 1, THREE.RGBAFormat);
			profTex.magFilter = THREE.LinearFilter;
			profTex.minFilter = THREE.LinearFilter;
			profTex.needsUpdate = true;
			const river = new THREE.Mesh(new THREE.PlaneGeometry(3000, zF - zN + 8), new THREE.MeshLambertNodeMaterial({ color: 0x000000 }));
			river.rotation.x = -Math.PI / 2;
			river.position.set(0, GROUND + 0.3, (zN + zF) / 2 + 4);
			const m = river.material as THREE.MeshLambertNodeMaterial;
			m.name = 'river';
			const C = cameraPosition;
			const hc = C.y.sub(GROUND);
			const dz = max(pw.z.sub(C.z), 1);
			// the spot on the far bank that this piece of water mirrors, and how far this side of the bank it is
			const xb = C.x.add(pw.x.sub(C.x).mul(float(zF).sub(C.z).div(dz)));
			const along = max(float(zF).sub(pw.z), 0);
			// ripples: long thin shapes lying across the view, of even height on screen (they are laid out by the angle
			// below the horizon), drifting slowly; they break the light softly and nudge the streaks sideways
			const phi = hc.div(dz);
			const rip = mx_noise_float(vec3(xb.mul(0.03), phi.mul(300), t.mul(0.3))).mul(0.75).add(mx_noise_float(vec3(xb.mul(0.09).add(31), phi.mul(620), t.mul(0.45))).mul(0.4));
			const broken = smoothstep(-0.34, 0.02, rip).mul(0.8).add(0.2);
			const sway = rip.mul(along.mul(0.012).add(0.4));
			const pr = texture(profTex, vec2(xb.add(sway).add(PROFILE_HALF).div(PROFILE_HALF * 2), 0.5));
			const streaks = pr.r.mul(exp(along.div(-110))).mul(2.8).add(pr.g.mul(exp(along.div(-220))).mul(1.8));
			const wide = pr.b.mul(exp(along.div(-230))).mul(smoothstep(-0.45, 0.35, rip));
			const water = mix(color('#0a1228'), color('#1a284c'), smoothstep(zN, zF, pw.z).pow(1.1));
			const sheen = color('#1a2e58').mul(smoothstep(-0.05, 0.4, rip)).mul(smoothstep(zN, zF, pw.z).mul(0.7).add(0.25)).mul(0.8);
			m.emissiveNode = water.add(sheen).add(color('#84584a').mul(wide).mul(0.12)).add(color(AMBER).mul(streaks).mul(broken));
			this.root.add(river);
		}

		// boats: a lit ferry and two barges drifting along the river
		for (const [z, len, speed, ferry] of [
			[220, 34, 2.2, true],
			[310, 46, -1.3, false],
			[160, 28, 1.6, false],
		] as [number, number, number, boolean][]) {
			const g = new THREE.Group();
			cur = { cx: 0, cz: 0, hw: 1, top: 0, seed: 0, slot: 0 };
			const hull: THREE.BufferGeometry[] = [];
			const lit: THREE.BufferGeometry[] = [];
			box(hull, 0, GROUND + 0.3, 0, len, 2.2, len * 0.22);
			if (ferry) {
				box(hull, 0, GROUND + 2.5, 0, len * 0.7, 2.6, len * 0.18);
				box(hull, len * 0.12, GROUND + 5.1, 0, len * 0.3, 2.2, len * 0.14);
				for (const sz of [-len * 0.09 - 0.06, len * 0.09 + 0.06]) for (let i = 0; i < 9; i++) box(lit, -len * 0.3 + i * len * 0.075, GROUND + 3.4, sz, len * 0.045, 0.9, 0.1);
				box(hull, len * 0.12, GROUND + 7.3, 0, 1.2, 4, 1.2); // funnel
			} else box(hull, -len * 0.38, GROUND + 2.5, 0, 4, 3, len * 0.18);
			const mast = new THREE.SphereGeometry(0.6, 6, 4);
			mast.translate(ferry ? len * 0.12 : -len * 0.38, GROUND + (ferry ? 12 : 7), 0);
			lit.push(tag(mast));
			const hm = new THREE.MeshLambertNodeMaterial({ color: 0x000000 });
			hm.emissiveNode = color('#02030a');
			hm.name = 'boat';
			// its lights on the water: a soft amber pool beside the hull
			const pool = new THREE.Mesh(new THREE.PlaneGeometry(len * 1.1, 16), glowMat('boatGlow', color(AMBER).mul(smoothstep(0.0, 0.3, uv().x)).mul(smoothstep(1.0, 0.7, uv().x)).mul(uv().y.clamp(0, 1).pow(2)).mul(ferry ? 0.5 : 0.18)));
			pool.rotation.x = -Math.PI / 2;
			pool.position.set(0, GROUND + 0.45, -9);
			g.add(new THREE.Mesh(strip(hull), hm), new THREE.Mesh(strip(lit), lampMat), pool);
			const x0 = -500 + rng.next() * 200;
			g.position.set(x0, 0, z);
			this.root.add(g);
			this.boats.push({ obj: g, speed, x0, span: 1000 });
		}

		// the ground: under the city, and our own bank below the tower
		for (const [z, w, c] of [
			[RIVER.zF + 8 + 400, 800, '#030409'],
			[70, 70, '#020308'],
		] as [number, number, string][]) {
			const bank = new THREE.Mesh(new THREE.PlaneGeometry(3000, w), new THREE.MeshLambertNodeMaterial({ color: 0x000000 }));
			bank.rotation.x = -Math.PI / 2;
			bank.position.set(0, GROUND + 0.2, z);
			(bank.material as THREE.MeshLambertNodeMaterial).emissiveNode = color(c);
			this.root.add(bank);
		}

		// mist between the layers: a soft blue that lifts each layer off the one in front of it
		for (const [z, hgt, k] of [
			[550, 135, 0.95],
			[730, 210, 0.85],
			[905, 320, 0.45],
		] as [number, number, number][]) {
			const drift = smoothstep(-0.7, 0.7, mx_noise_float(vec3(pw.x.mul(0.006), pw.y.mul(0.012), z * 0.21))).mul(0.6).add(0.4);
			const m = glowMat('cityMist', color('#262f48').mul(float(1).sub(uv().y).clamp(0, 1).pow(1.5)).mul(drift).mul(k));
			const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3400, hgt), m);
			mesh.position.set(0, GROUND + hgt / 2, z);
			mesh.renderOrder = 5;
			this.root.add(mesh);
		}
		// the streets' light in the air between the layers: amber at the ground, gone a little way up
		for (const [z, hgt, k] of [
			[446, 28, 0.16],
			[552, 46, 0.1],
			[700, 80, 0.04],
		] as [number, number, number][]) {
			// (clamped before the power: at the sheet's top edge the uv can pass 1, and a power of a negative number is
			// not a number, which drew a black line there)
			const patchy = smoothstep(-0.5, 0.6, mx_noise_float(vec3(pw.x.mul(0.011), z * 0.37, 1.3)));
			const m = glowMat('cityGlow', color('#c07c3c').mul(float(1).sub(uv().y).clamp(0, 1).pow(2.4)).mul(patchy).mul(k));
			const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3400, hgt), m);
			mesh.position.set(0, GROUND + hgt / 2, z);
			mesh.renderOrder = 5;
			this.root.add(mesh);
		}

		// ---------- the sky: deep blue, banks of painted cloud lit from the moon's side, the moon in a clearing ----------
		{
			const cloudTex = cloudField(1536, 384);
			const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), new THREE.MeshLambertNodeMaterial({ color: 0x000000, side: THREE.BackSide }));
			const sm = sky.material as THREE.MeshLambertNodeMaterial;
			sm.name = 'sky';
			const dir = pw.normalize();
			const az = atan(dir.x, dir.z);
			const el = asin(dir.y.clamp(-1, 1));
			// the cloud map wraps once around the horizon and runs from 6 degrees below it to 69 above
			const EL0 = -0.105,
				ELR = 1.31;
			const suv = vec2(az.div(Math.PI * 2).add(0.5).add(t.mul(0.00035)), el.sub(EL0).div(ELR));
			const moonAz = Math.atan2(MOON.x, MOON.z),
				moonEl = Math.asin(MOON.y);
			// toward the moon, in the map's own coordinates (a short step: the slope of the cloud's edge that way)
			const toMoon = vec2(float(moonAz).sub(az).div(Math.PI * 2), float(moonEl).sub(el).div(ELR));
			const stepUv = toMoon.div(max(toMoon.length(), 0.0001)).mul(vec2(0.006, 0.02));
			const f0 = texture(cloudTex, suv).r;
			const f1 = texture(cloudTex, suv.add(stepUv)).r;
			const md = dir.sub(vec3(MOON.x, MOON.y, MOON.z)).length();
			const rough = mx_noise_float(dir.mul(46)).mul(0.03).add(mx_noise_float(dir.mul(110)).mul(0.018)).add(mx_noise_float(dir.mul(250)).mul(0.009));
			const dens = f0.add(rough).sub(smoothstep(0.17, 0.05, md).mul(0.45)).sub(smoothstep(0.75, 1.0, dir.y).mul(0.3));
			const THR = 0.35;
			const cloud = smoothstep(THR, THR + 0.01, dens);
			// inside a cloud: its lit side (the slope that faces the moon), its body, and the shade on its far side and
			// in its thick middle
			const slope = f0.sub(f1).add(rough.mul(0.35));
			const lit = smoothstep(0.03, 0.06, slope);
			const shade = max(smoothstep(-0.004, -0.03, slope), smoothstep(THR + 0.13, THR + 0.15, dens).mul(0.7));
			const nearMoon = smoothstep(0.62, 0.08, md);
			const skyCol = mix(color('#050f2a'), color('#0a1c42'), float(1).sub(smoothstep(0.0, 0.62, dir.y)))
				.add(color('#28508c').mul(exp(md.mul(md).div(-0.02))).mul(0.42))
				.add(color('#143068').mul(exp(md.mul(md).div(-0.2))).mul(0.28));
			const body = mix(color('#142d58'), color('#22406c'), nearMoon);
			const cloudCol = mix(mix(body, mix(color('#0a1c3c'), color('#102a52'), nearMoon), shade), mix(color('#1c3662'), color('#4a6088'), nearMoon.pow(1.5)), lit.mul(float(1).sub(shade)));
			// the moon: a pale disc with grey seas
			const R = 0.027;
			const tx = new THREE.Vector3(0, 1, 0).cross(MOON).normalize(),
				ty = MOON.clone().cross(tx).normalize();
			const off = dir.sub(vec3(MOON.x, MOON.y, MOON.z));
			const lx = off.dot(vec3(tx.x, tx.y, tx.z)).div(R),
				ly = off.dot(vec3(ty.x, ty.y, ty.z)).div(R);
			const seas = smoothstep(-0.02, 0.2, mx_noise_float(vec3(lx.mul(1.5), ly.mul(1.5), 3.7)).add(mx_noise_float(vec3(lx.mul(3.4), ly.mul(3.4), 9.1)).mul(0.45)));
			const moonCol = mix(color('#e6e0d2'), color('#b4b0a6'), seas.mul(0.6)).mul(1.08).mul(mix(float(1), float(0.82), smoothstep(0.6, 1.0, vec2(lx, ly).length())));
			const disc = smoothstep(R, R - 0.0011, md);
			const sc = floor(dir.mul(520));
			const stars = step(0.9991, hash(sc.x.add(700).add(sc.y.add(700).mul(57)).add(sc.z.add(700).mul(131)))).mul(smoothstep(0.3, 0.7, dir.y)).mul(0.0);
			sm.emissiveNode = mix(mix(skyCol.add(vec3(stars)), moonCol, disc), cloudCol, cloud);
			sm.depthWrite = false;
			sky.renderOrder = -10;
			this.root.add(sky);
		}

		this.root.traverse((o) => {
			const m = (o as THREE.Mesh).material as THREE.Material | undefined;
			if (m) withLights(m, null);
		});
		scene.add(this.root);
	}

	update(t: number) {
		this.uTime.value = t;
		for (const b of this.boats) b.obj.position.x = b.x0 + ((((t * b.speed) % b.span) + b.span) % b.span);
	}
}

/**
 * The cloud map: how thick the cloud is, wrapped once around the horizon. Billows come from cell noise (each cell
 * a round puff) at three sizes, gathered into banks by a broad slow noise. The sky's shader draws the edges, so
 * the map itself can be small.
 */
function cloudField(W: number, H: number): THREE.DataTexture {
	const rnd = (ix: number, iy: number, s: number) => {
		let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(s, 1442695041)) | 0;
		h = Math.imul(h ^ (h >>> 13), 1274126177);
		h ^= h >>> 16;
		return (h >>> 0) / 4294967296;
	};
	const wrap = (i: number, n: number) => ((i % n) + n) % n;
	/** Distance to the nearest puff centre, 0..~1, on a grid `px` cells around. */
	const cells = (x: number, y: number, px: number, s: number) => {
		const xi = Math.floor(x),
			yi = Math.floor(y);
		let best = 9;
		for (let dy = -1; dy <= 1; dy++)
			for (let dx = -1; dx <= 1; dx++) {
				const cx = xi + dx,
					cy = yi + dy,
					wx = wrap(cx, px);
				const ex = cx + rnd(wx, cy, s) - x,
					ey = cy + rnd(wx, cy, s + 7) - y;
				const d = ex * ex + ey * ey;
				if (d < best) best = d;
			}
		return Math.min(1, Math.sqrt(best));
	};
	const smooth = (x: number, y: number, px: number, s: number) => {
		const xi = Math.floor(x),
			yi = Math.floor(y),
			fx = x - xi,
			fy = y - yi;
		const ux = fx * fx * (3 - 2 * fx),
			uy = fy * fy * (3 - 2 * fy);
		const a = rnd(wrap(xi, px), yi, s),
			b = rnd(wrap(xi + 1, px), yi, s),
			c = rnd(wrap(xi, px), yi + 1, s),
			d = rnd(wrap(xi + 1, px), yi + 1, s);
		return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
	};
	const data = new Uint8Array(W * H * 4);
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const a = x / W,
				e = y / H;
			const puffs = 0.42 * (1 - cells(a * 30, e * 9, 30, 1)) + 0.3 * (1 - cells(a * 70, e * 21, 70, 2)) + 0.19 * (1 - cells(a * 160, e * 47, 160, 3)) + 0.09 * (1 - cells(a * 380, e * 110, 380, 4));
			const banks = 0.7 * smooth(a * 9, e * 3.6, 9, 5) + 0.3 * smooth(a * 22, e * 8.5, 22, 6);
			const f = puffs + (banks - 0.5) * 0.9;
			const i = (y * W + x) * 4;
			data[i] = Math.max(0, Math.min(255, ((f + 0.2) / 1.7) * 255));
			data[i + 3] = 255;
		}
	const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
	tex.wrapS = THREE.RepeatWrapping;
	tex.wrapT = THREE.ClampToEdgeWrapping;
	tex.magFilter = THREE.LinearFilter;
	tex.minFilter = THREE.LinearFilter;
	tex.needsUpdate = true;
	return tex;
}
