// @ts-nocheck: three r186 TSL typings reject valid node graphs; runtime-checked by the captures
// The hero props on every table, made to be seen up close: a veined black marble top on a fluted gold
// pedestal, a glowing cone lamp (red, amber or a frosted dome) with lit rims and a crisp pool of light,
// a cut-crystal tumbler with ice and amber whisky, a martini, and a black ashtray with a burning cigarette.
import * as THREE from 'three/webgpu';
import { abs, atan, attribute, cameraPosition, color, float, fract, max, mix, mx_noise_float, normalView, positionLocal, positionViewDirection, positionWorld, pow, sin, smoothstep, step, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Builder } from './build';
import { lathe } from './build';
import { additive, glow, gloss, lambert } from './mats';

const mats: Record<string, THREE.Material> = {};
const once = <T extends THREE.Material>(k: string, f: () => T): T => (mats[k] ??= f()) as T;

/** Polished black marble: near-black with faint pale veins, very glossy. */
export function marbleMat() {
	return once('marble', () => {
		const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.07, metalness: 0 });
		const p = positionWorld.mul(3.1);
		const n1 = mx_noise_float(p.mul(vec3(1, 1, 1)));
		const n2 = mx_noise_float(p.mul(2.7).add(n1.mul(1.7)));
		const warp = p.add(vec3(n1, n2, n1).mul(0.25));
		const vein = pow(max(float(0), float(1).sub(abs(mx_noise_float(warp.mul(1.4))))), float(22)).add(pow(max(float(0), float(1).sub(abs(mx_noise_float(warp.mul(3.8).add(7))))), float(30)).mul(0.5));
		m.colorNode = mix(color('#050303'), color('#3a3430'), vein.mul(0.3)).add(color('#120b08').mul(n1.mul(0.5).add(0.5)).mul(0.35));
		m.name = 'marble';
		return m;
	});
}

/**
 * All tabletops as one mesh. Each vertex carries its table's lamp (centre, radius, colour); the marble shader
 * reflects the view ray off the top and tests it against that lamp, so each top mirrors its own lamp shade,
 * with a soft edge and a dim warm room sheen at grazing angles.
 */
export function marbleTops(tops: { x: number; y: number; z: number; r: number; lamp: THREE.Vector3; lampR: number; hex: string }[]) {
	const geos: THREE.BufferGeometry[] = [];
	for (const t of tops) {
		const g = new THREE.CylinderGeometry(t.r, t.r, 0.04, 64).toNonIndexed();
		g.translate(t.x, t.y, t.z);
		const n = g.attributes.position.count;
		const lp = new Float32Array(n * 4),
			lc = new Float32Array(n * 3);
		const c = new THREE.Color(t.hex);
		for (let i = 0; i < n; i++) {
			lp.set([t.lamp.x, t.lamp.y, t.lamp.z, t.lampR], i * 4);
			lc.set([c.r, c.g, c.b], i * 3);
		}
		g.setAttribute('lampPos', new THREE.BufferAttribute(lp, 4));
		g.setAttribute('lampCol', new THREE.BufferAttribute(lc, 3));
		g.deleteAttribute('uv');
		geos.push(g);
	}
	const geo = mergeGeometries(geos, false) as THREE.BufferGeometry;
	const m = marbleMat() as THREE.MeshStandardNodeMaterial;
	const lpA = attribute('lampPos', 'vec4');
	const lcA = attribute('lampCol', 'vec3');
	const V = positionWorld.sub(cameraPosition).normalize();
	const R = vec3(V.x, V.y.negate(), V.z); // reflect off the horizontal top
	const toL = lpA.xyz.sub(positionWorld);
	const tC = max(toL.dot(R), float(0));
	const miss = toL.sub(R.mul(tC)).length();
	// the shade's profile: a cone (w > 0.5) narrowing upward, or a dome (w < 0.5) above its rim
		const q = positionWorld.add(R.mul(tC));
		const dy = q.y.sub(lpA.y);
		const radial = q.xz.sub(lpA.xz).length();
		const coneR = mix(float(0.15), float(0.066), dy.add(0.09).div(0.18).clamp(0, 1));
		const domeR = float(0.12).mul(float(1).sub(dy.add(0.04).div(0.13).clamp(0, 1).pow(2)).max(0).sqrt());
		const isCone = step(0.5, lpA.w);
		const inY = mix(step(-0.04, dy).mul(step(dy, 0.09)), step(-0.09, dy).mul(step(dy, 0.09)), isCone);
		const rr = mix(domeR, coneR, isCone);
		const hit = float(1).sub(smoothstep(rr.mul(0.85), rr.mul(1.02), radial)).mul(inY).mul(step(0.001, R.y));
	const up = smoothstep(0.0, 0.25, positionWorld.y.sub(lpA.y.sub(0.5)).abs().oneMinus()); void up;
	const grazing = pow(float(1).sub(abs(V.y)).clamp(0, 1), float(4));
	const dl = positionWorld.xz.sub(lpA.xz);
	const side = vec3(V.z, 0, V.x.negate()).normalize();
	const across = dl.x.mul(side.x).add(dl.y.mul(side.z));
	const streak = smoothstep(0.5, 0.58, sin(across.mul(15)).mul(0.5).add(sin(across.mul(41).add(1.3)).mul(0.32)).add(0.5));
	const near = float(1).sub(smoothstep(0.06, 0.46, dl.length()));
	const sheen = near.mul(0.12).add(near.mul(streak).mul(0.24)).mul(grazing.mul(2.2).add(0.6));
	m.emissiveNode = lcA.mul(hit).mul(0.4).add(lcA.mul(grazing).mul(0.08)).add(mix(lcA, vec3(1.0, 0.5, 0.1), 0.8).mul(sheen));
	const mesh = new THREE.Mesh(geo, m);
	mesh.name = 'tabletops';
	mesh.receiveShadow = true;
	return mesh;
}

/** A fluted gold pedestal: a flared stepped foot, a reeded column, a collar under the top. */
export function pedestal(b: Builder, x: number, z: number, top: number, gold: THREE.Material, dark: THREE.Material) {
	b.at(gold, lathe([[0, 0], [0.3, 0], [0.31, 0.02], [0.24, 0.045], [0.2, 0.05], [0.16, 0.09], [0.1, 0.12], [0, 0.12]], 40), x, 0, z);
	const col = new THREE.CylinderGeometry(0.055, 0.075, top - 0.22, 24, 1);
	const pa = col.attributes.position;
	for (let i = 0; i < pa.count; i++) {
		const px = pa.getX(i),
			pz = pa.getZ(i);
		const r = Math.hypot(px, pz);
		if (r < 1e-4) continue;
		const a = Math.atan2(pz, px);
		const k = 1 - 0.12 * (1 - Math.abs(Math.cos(a * 6)));
		pa.setX(i, px * k);
		pa.setZ(i, pz * k);
	}
	col.computeVertexNormals();
	b.at(dark, col, x, 0.12 + (top - 0.22) / 2, z);
	b.at(gold, lathe([[0, 0], [0.085, 0], [0.13, 0.05], [0.14, 0.07], [0, 0.07]], 32), x, top - 0.1, z);
}

export type LampKind = 'red' | 'amber' | 'dome';

/** A table lamp: gold base and stem, a glowing shade with crisp lit rims; returns where its light sits. */
export function tableLamp(b: Builder, x: number, y: number, z: number, kind: LampKind, line: THREE.Material, gold: THREE.Material) {
	b.at(gold, lathe([[0, 0], [0.06, 0], [0.065, 0.01], [0.04, 0.03], [0.014, 0.05], [0, 0.05]], 24), x, y, z);
	b.cyl(gold, x, y + 0.15, z, 0.009, 0.011, 0.22, 10);
	b.cyl(gold, x, y + 0.115, z, 0.02, 0.02, 0.02, 12); // a knurled collar half way up
	if (kind === 'dome') {
		const shade = new THREE.SphereGeometry(0.12, 32, 12, 0, Math.PI * 2, 0, Math.PI * 0.5);
		b.at(shadeMat('dome'), shade, x, y + 0.24, z);
		b.at(line, new THREE.TorusGeometry(0.121, 0.006, 6, 40).rotateX(Math.PI / 2), x, y + 0.24, z);
		b.cyl(gold, x, y + 0.365, z, 0.012, 0.018, 0.02, 10);
		return new THREE.Vector3(x, y + 0.22, z);
	}
	// an octagonal cone shade with ribs
	const shade = new THREE.CylinderGeometry(0.065, 0.15, 0.18, 8, 1, true);
	b.at(shadeMat(kind), shade, x, y + 0.31, z, Math.PI / 8);
	for (let i = 0; i < 8; i++) {
		const a = (i / 8) * Math.PI * 2;
		const top = new THREE.Vector3(x + Math.cos(a) * 0.066, y + 0.4, z + Math.sin(a) * 0.066);
		const bot = new THREE.Vector3(x + Math.cos(a) * 0.152, y + 0.22, z + Math.sin(a) * 0.152);
		b.add(lambert('shadeRib', '#1c0804'), new THREE.TubeGeometry(new THREE.LineCurve3(top, bot), 1, 0.0035, 3, false));
	}
	b.cyl(line, x, y + 0.402, z, 0.068, 0.068, 0.008, 16, { open: true });
	b.cyl(line, x, y + 0.222, z, 0.154, 0.154, 0.012, 16, { open: true });
	return new THREE.Vector3(x, y + 0.26, z);
}

/** The height of the middle of a table lamp's shade: table top (0.74) + the lamp's foot + 0.31. */
const SHADE_Y = 1.051;

/** Lamp shades glow brightest near the bulb and at the lower rim, like lit parchment. */
function shadeMat(kind: LampKind) {
	return once(`shade-${kind}`, () => {
		const m = new THREE.MeshLambertNodeMaterial({ color: 0x000000, side: THREE.DoubleSide });
		const base = { red: color('#f2461a'), amber: color('#ff8a28'), dome: color('#ff9638') }[kind];
		const hot = { red: color('#ffb45c'), amber: color('#ffc070'), dome: color('#ffc070') }[kind];
		// (every shade is merged into one mesh, so its own height is the room's height less where shades hang)
		const y = positionLocal.y.sub(SHADE_Y);
		const facing = abs(normalView.dot(positionViewDirection));
		let glowK, heat;
		if (kind === 'dome') {
			// frosted: a hot core where it faces you, fading to warm amber at the top and the silhouette
			heat = pow(facing, float(2.2)).mul(smoothstep(0.13, 0.02, y));
			glowK = float(0.55).add(heat.mul(1.1)).add(smoothstep(0.03, 0.0, y).mul(0.5));
		} else {
			// cones: dark at the top, brightest at the bottom rim, with soft vertical ribs
			const t = smoothstep(0.09, -0.09, y);
			const rib = sin(atan(positionLocal.z, positionLocal.x).mul(8)).mul(0.5).add(0.5);
			// (the heart: brightest low on the side that faces you, where the bulb sits behind the parchment)
			heat = smoothstep(0.09, -0.06, y).mul(pow(facing.clamp(0, 1), float(1.6))).mul(1.15);
			glowK = float(0.34).add(t.mul(0.8)).mul(float(0.9).add(rib.mul(0.1))).add(smoothstep(-0.078, -0.09, y).mul(0.35));
		}
		m.emissiveNode = mix(base, hot, heat.clamp(0, 1)).mul(glowK).mul(2.7);
		m.name = `shade-${kind}`;
		return m;
	});
}

/** Cut crystal: faceted, nearly clear, bright on its edges and facets; amber whisky with ice inside. */
export function tumbler(b: Builder, x: number, y: number, z: number, rot: number) {
	const outer = new THREE.LatheGeometry(
		[
			[0.036, 0],
			[0.038, 0.012],
			[0.04, 0.09],
			[0.041, 0.092],
			[0.037, 0.092],
			[0.036, 0.016],
			[0, 0.016],
		].map(([r, h]) => new THREE.Vector2(r, h)),
		12,
		rot,
	);
	b.at(crystalMat(), outer, x, y, z);
	b.noShadow.add(crystalMat());
	b.at(whiskyMat(), lathe([[0, 0.019], [0.0345, 0.019], [0.0355, 0.055], [0, 0.055]], 12), x, y, z); // clear of the glass's inner floor (0.016)
	// two ice cubes breaking the surface
	for (const [dx, dz, s, r] of [
		[-0.01, 0.006, 0.022, 0.4],
		[0.011, -0.008, 0.019, 1.1],
	] as [number, number, number, number][]) {
		const g = new THREE.BoxGeometry(s, s, s);
		g.rotateX(r * 0.6);
		g.rotateY(r);
		b.at(iceMat(), g, x + dx, y + 0.054, z + dz);
	}
}

function crystalMat() {
	return once('crystal', () => {
		const facing = abs(normalView.dot(positionViewDirection));
		const edge = smoothstep(0.5, 0.58, float(1).sub(facing));
		const facet = smoothstep(0.92, 1.0, fract(positionLocal.y.mul(36)));
		return additive('crystal', '#ffcf98', 1, { opacityNode: edge.mul(0.55).add(facet.mul(0.2)).add(0.03) });
	});
}
function whiskyMat() {
	return once('whisky', () => {
		const m = glow('whisky', '#d87a20', 1.1);
		return m;
	});
}
function iceMat() {
	return once('ice', () => additive('ice', '#fff0dc', 1, { opacityNode: pow(float(1).sub(abs(normalView.dot(positionViewDirection))).clamp(0, 1), float(1.5)).mul(0.8).add(0.2) }));
}

/** A heavy black ashtray with a cigarette resting on its lip; returns the tip (smoke source). */
export function ashtray(b: Builder, x: number, y: number, z: number, rot: number, gold: THREE.Material) {
	const black = once('ashBlack', () => gloss('ashBlack', '#0a0807', 0.18, 0.1));
	b.at(black, lathe([[0, 0], [0.065, 0], [0.068, 0.012], [0.066, 0.026], [0.05, 0.026], [0.046, 0.012], [0, 0.012]], 24), x, y, z);
	b.at(gold, new THREE.TorusGeometry(0.067, 0.0025, 4, 32).rotateX(Math.PI / 2), x, y + 0.026, z);
	// the cigarette: paper, a filter, a glowing tip, leaning out over the rim
	const dir = new THREE.Vector3(Math.cos(rot), 0, Math.sin(rot));
	const paper = once('cigPaper', () => lambert('cigPaper', '#e8e0d0'));
	const filter = once('cigFilter', () => lambert('cigFilter', '#c08a50'));
	const tipMat = once('cigTip', () => glow('cigTip', '#ff5a18', 4));
	const len = 0.075;
	const c = new THREE.Vector3(x, y + 0.03, z).addScaledVector(dir, 0.035);
	const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().add(new THREE.Vector3(0, 0.12, 0)).normalize());
	const put = (mat: THREE.Material, l: number, off: number) => {
		const g = new THREE.CylinderGeometry(0.0042, 0.0042, l, 8);
		g.applyQuaternion(q);
		const at = c.clone().addScaledVector(dir, off);
		g.translate(at.x, at.y + off * 0.12, at.z);
		b.add(mat, g);
	};
	put(filter, 0.02, -len / 2 + 0.01);
	put(paper, len - 0.02, 0.01);
	put(tipMat, 0.004, len / 2 + 0.002);
	return c.clone().addScaledVector(dir, len / 2 + 0.006).add(new THREE.Vector3(0, (len / 2) * 0.12 + 0.004, 0));
}

/** A crisp pool of lamplight on a tabletop: bright inside, a hard edge, a soft brighter core. */
export function poolMat(hex: string) {
	return once(`pool-${hex}`, () => {
		const r = positionLocal.xz.length();
		const inside = float(1).sub(smoothstep(0.24, 0.26, r));
		const core = float(1).sub(smoothstep(0.0, 0.22, r));
		return additive(`pool-${hex}`, hex, 1, { opacityNode: inside.mul(float(0.06).add(core.mul(0.16))) });
	});
}

export const LAMP_COLOURS: Record<LampKind, string> = { red: '#ff5a28', amber: '#ffa050', dome: '#ffab58' };
