// The Blue Hour: one floor at the top of a tower, 1929. A compact hall (stage north-west, stained glass and the
// bar north-east, booths and tables in between), the card room through the west door, the balcony over the
// city through the south doors. Metres, Y up, hall floor at y = 0. Set pieces are flat colour, baked per zone.
import * as THREE from 'three/webgpu';
import { abs, atan, attribute, color, float, fract, hash, max, min, mix, mx_noise_float, normalView, positionLocal, positionViewDirection, positionWorld, pow, reflector, screenUV, smoothstep, step, uniform, vec2, vec3, vertexColor } from 'three/tsl';
import { stainedGlass } from './art';
import { Builder, bottomless, fluted, lathe, ringSector } from './build';
import { additive, C, gloss, glow, glowSoft, lambert, PAL, velvet, withLights } from './mats';
import { ashtray, LAMP_COLOURS, type LampKind, marbleTops, pedestal, poolMat as tablePool, tableLamp, tumbler } from './tableware';

export interface Seat {
	pos: THREE.Vector3;
	yaw: number;
	/** seat surface height */
	seatY: number;
	zone: Zone;
	table: THREE.Vector3;
	chair?: boolean;
}

export type Zone = 'hall' | 'cards' | 'balcony';

export interface Club {
	root: THREE.Group;
	colliders: Builder['colliders'];
	zoneLights: Record<Zone, THREE.Light[]>;
	seats: Seat[];
	barSpots: { pos: THREE.Vector3; yaw: number }[];
	stage: { piano: THREE.Vector3; pianoYaw: number; bench: THREE.Vector3; sax: THREE.Vector3; saxYaw: number; barman: THREE.Vector3 };
	spawn: { pos: THREE.Vector3; yaw: number; pitch: number };
	lights: THREE.Light[];
	spot: THREE.SpotLight;
	lamps: THREE.Vector3[];
	ashtrays: THREE.Vector3[];
	palms: { pos: THREE.Vector3; yaw: number; s: number }[];
	stools: THREE.Vector3[];
	cardTable: THREE.Vector3;
	zoneAt(p: THREE.Vector3): Zone;
	update(t: number): void;
	floorReflect: { strength: { value: number } };
	ceiling: number;
}

export const HALL = { x0: -9.5, x1: 9.5, z0: -10.5, z1: 9.5, h: 8.4 };
export const STAGE = { x0: -9.1, x1: 0.9, z0: -10.5, z1: -5.6, top: 1.08 };
export const CARDS = { x0: -16.5, x1: -9.5, z0: -3.6, z1: 3.6, h: 3.6 };
export const BALC = { x0: -7, x1: 7, z0: 9.5, z1: 15.0 };
export const BAR = { x0: 5.3, x1: 9.5, z: -7.4, top: 1.12, back: -10.5 };

export function buildClub(scene: THREE.Scene): Club {
	const b = new Builder();
	const bc = new Builder();
	const bb = new Builder();
	const lights: THREE.Light[] = [];
	const cardLights: THREE.Light[] = [];
	const balcLights: THREE.Light[] = [];
	const lamps: THREE.Vector3[] = [];
	const ashtrays: THREE.Vector3[] = [];
	const seats: Seat[] = [];
	const pools: { p: THREE.Vector3; hex: string }[] = [];
	const tops: Parameters<typeof marbleTops>[0] = [];
	const cones: THREE.Vector3[] = [];

	const M = {
		wall: lambert('wall', '#5a1c12'),
		wallDark: lambert('wallDark', '#3c120c'),
		wood: lambert('wood', PAL.wood),
		woodDark: lambert('woodDark', PAL.woodDark),
		trim: lambert('trim', '#6a3418'),
		gold: gloss('gold', PAL.gold, 0.35, 0.6),
		goldMatte: lambert('goldMatte', PAL.goldDark),
		curtain: lambert('curtain', PAL.curtain),
		curtainDeep: lambert('curtainDeep', PAL.curtainDeep),
		stageFloor: gloss('stageFloor', '#2a120a', 0.45),
		leather: velvet('leather', PAL.leather),
		leatherDark: velvet('leatherDark', PAL.leatherDark),
		lacquer: gloss('lacquer', PAL.lacquer, 0.22),
		ceiling: glow('ceiling', '#2c0a06', 1),
		shade: glow('shade', '#ff9a4a', 1.9, THREE.DoubleSide),
		shadeIn: glow('shadeIn', '#ffbc70', 5),
		bulb: glow('bulb', '#ffc880', 9),
		lantern: glowSoft('lantern', '#ff9620', 0.8),
		lanternBand: lambert('lanternBand', '#2a1408'),
		backlight: glow('backlight', '#ff7a2a', 0.5),
		felt: lambert('felt', PAL.felt),
		carpetCards: lambert('carpetCards', '#1c0c1c'),
		wallCards: lambert('wallCards', '#2a1426'),
		stone: lambert('stone', PAL.stone),
		stoneDark: lambert('stoneDark', PAL.stoneDark),
		ash: gloss('ash', '#3a2a20', 0.3, 0.2),
		chrome: gloss('chrome', '#d0c8c0', 0.2, 0.9),
		liquid: glow('liquid', '#b84a1c', 0.6),
		olive: lambert('olive', '#3a4a10'),
		line: glow('goldLine', '#e0a050', 0.7),
		lineDim: glow('goldLineDim', '#c08038', 0.38),
	};
	/** A thin gold line along a polyline (a square tube): the graphic line work. */
	const goldLine = (pts: THREE.Vector3[], r = 0.018, mat: THREE.Material = M.line, bld: Builder = b) => {
		const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.0);
		bld.add(mat, new THREE.TubeGeometry(curve, Math.max(8, pts.length * 3), r, 4, false));
	};

	// ---------- hall shell ----------
	// floor: glossy dark parquet; a planar reflection smeared vertically goes into emissive (never banded)
	// biome-ignore lint: TSL node types
	let floorSeam: any = color('#000000');
	const refl = reflector({ resolutionScale: 0.5 });
	const reflStrength = uniform(1.15);
	// long warm reflections: the mirror image smeared downward on screen (the floor is wet-glossy marble)
	const streak = (() => {
		let acc = refl.sample(screenUV.flipX()).rgb.mul(0.32);
		for (const o of [0.005, 0.012, 0.022, 0.035, 0.05, 0.068, 0.09]) acc = acc.add(refl.sample(screenUV.flipX().add(vec2(0, o))).rgb.mul(0.11));
		return acc;
	})();
	const floorMat = new THREE.MeshLambertNodeMaterial({ color: C(PAL.floor) });
	{
		// large black marble tiles with fine pale veins and thin seams; curved inlay bands arcing from the stage
		const T = 1.25;
		const wp = positionWorld.xz;
		const tile = wp.div(T).floor();
		const tf = wp.div(T).fract();
		const tileTone = hash(tile.x.mul(31.7).add(tile.y.mul(17.3))).mul(0.4).add(0.8);
		const n1 = mx_noise_float(vec3(wp.x, 0, wp.y).mul(0.9).add(vec3(tile.x, 0, tile.y).mul(3.3)));
		const vein = pow(max(float(0), float(1).sub(abs(mx_noise_float(vec3(wp.x, n1, wp.y).mul(1.6))))), float(26));
		const check = tile.x.add(tile.y).mod(2);
		const marble = mix(mix(color('#160a07'), color('#4a2212'), check), color('#5a4636'), vein.mul(0.4)).mul(tileTone);
		const seamT = float(1).sub(smoothstep(0.0, 0.006, min(min(tf.x, float(1).sub(tf.x)), min(tf.y, float(1).sub(tf.y)))));
		const fp = wp.sub(vec2((STAGE.x0 + STAGE.x1) / 2, STAGE.z1 + 0.6));
		const rr = fp.length();
		const bandPos = fract(rr.div(3.4));
		const inBand = step(0.86, bandPos).mul(step(rr, 13.5)).mul(step(2.6, rr));
		const bandEdge = float(1).sub(smoothstep(0.0, 0.015, min(abs(bandPos.sub(0.86)), abs(bandPos.sub(1.0))).mul(3.4))).mul(step(rr, 13.5)).mul(step(2.6, rr));
		floorMat.colorNode = mix(marble.mul(float(1).sub(seamT.mul(0.6))), mix(color('#3a1c0c'), color('#5a2e14'), vein), inBand);
		floorSeam = color('#c08038').mul(bandEdge.mul(0.5));
	}
	floorMat.name = 'floor';
	(floorMat as unknown as { emissiveNode: unknown }).emissiveNode = streak.mul(reflStrength).add(floorSeam);
	const floorGeo = new THREE.PlaneGeometry(HALL.x1 - HALL.x0, HALL.z1 - HALL.z0);
	floorGeo.rotateX(-Math.PI / 2);
	const floor = new THREE.Mesh(floorGeo, floorMat);
	floor.position.set((HALL.x0 + HALL.x1) / 2, 0, (HALL.z0 + HALL.z1) / 2);
	floor.receiveShadow = true;
	floor.add(refl.target);
	refl.target.rotateX(-Math.PI / 2);
	b.root.add(floor);
	b.collideBox(0, -0.25, 0, 60, 0.5, 60);

	// ceiling with coffers
	b.aabb(M.ceiling, HALL.x0, HALL.h, HALL.z0, HALL.x1, HALL.h + 0.3, HALL.z1);
	for (const [x, z] of [
		[-4.5, 0],
		[4.5, 0],
		[-4.5, 6],
		[4.5, 6],
	]) {
		b.aabb(M.woodDark, x - 2.6, HALL.h - 0.35, z - 2.6, x + 2.6, HALL.h + 0.01, z + 2.6);
		// a stepped recess in each coffer, and gold lines round its edges (the ceiling's pattern, seen from below)
		b.aabb(M.ceiling, x - 1.9, HALL.h - 0.36, z - 1.9, x + 1.9, HALL.h - 0.345, z + 1.9);
		b.aabb(M.woodDark, x - 1.1, HALL.h - 0.37, z - 1.1, x + 1.1, HALL.h - 0.355, z + 1.1);
		for (const r of [2.6, 1.9, 1.1]) {
			const y = HALL.h - 0.375;
			b.aabb(M.lineDim, x - r, y, z - r, x + r, y + 0.012, z - r + 0.03);
			b.aabb(M.lineDim, x - r, y, z + r - 0.03, x + r, y + 0.012, z + r);
			b.aabb(M.lineDim, x - r, y, z - r + 0.03, x - r + 0.03, y + 0.012, z + r - 0.03);
			b.aabb(M.lineDim, x + r - 0.03, y, z - r + 0.03, x + r, y + 0.012, z + r - 0.03);
		}
	}

	const wall = (x0: number, z0: number, x1: number, z1: number, y0 = 0, y1 = HALL.h, mat = M.wall) => b.aabb(mat, x0, y0, z0, x1, y1, z1, true);
	wall(STAGE.x1 + 0.4, HALL.z0 - 0.4, HALL.x1 + 0.4, HALL.z0); // north, right of the stage (glass + bar)
	wall(HALL.x1, HALL.z0, HALL.x1 + 0.4, HALL.z1); // east
	wall(HALL.x0 - 0.4, HALL.z1, -2.2, HALL.z1 + 0.4); // south, left of the doors
	wall(2.2, HALL.z1, HALL.x1 + 0.4, HALL.z1 + 0.4); // south, right of the doors
	wall(-2.2, HALL.z1, 2.2, HALL.z1 + 0.4, 3.6, HALL.h); // over the doors
	wall(HALL.x0 - 0.4, STAGE.z1 + 0.6, HALL.x0, -1.6); // west, north part
	wall(HALL.x0 - 0.4, HALL.z0, HALL.x0, STAGE.z1 + 0.6); // west, beside the stage (it was open to the night here)
	wall(HALL.x0 - 0.4, 1.6, HALL.x0, HALL.z1); // west, south part
	wall(HALL.x0 - 0.4, -1.6, HALL.x0, 1.6, 3.3, HALL.h); // over the card door
	// thresholds: the floors stop at the walls' faces, so each doorway gets a sill across the wall's thickness
	// (without one you see down through the gap to the night below)
	b.aabb(M.woodDark, HALL.x0 - 0.4, -0.3, -1.58, HALL.x0, 0, 1.58);
	b.aabb(M.woodDark, -2.1, -0.3, HALL.z1, 2.1, 0, HALL.z1 + 0.4);
	// wainscot (6 cm proud; ends stop short of corners so no faces are shared)
	const wains = (x0: number, z0: number, x1: number, z1: number) => b.aabb(M.woodDark, x0, 0, z0, x1, 1.25, z1);
	wains(HALL.x1 - 0.06, BAR.z + 0.7, HALL.x1, HALL.z1 - 0.01);
	wains(HALL.x0, HALL.z1 - 0.06, -2.25, HALL.z1);
	wains(2.25, HALL.z1 - 0.06, HALL.x1 - 0.07, HALL.z1);
	wains(HALL.x0, 1.65, HALL.x0 + 0.06, HALL.z1 - 0.07);
	wains(HALL.x0, STAGE.z1 + 0.61, HALL.x0 + 0.06, -1.65);
	// gold pilaster strips and a cornice
	for (const z of [-3.6, 4.6]) for (const dz of [-0.09, 0.09]) b.aabb(M.lineDim, HALL.x0, 1.29, z + dz - 0.015, HALL.x0 + 0.05, HALL.h - 0.4, z + dz + 0.015);
	for (const x of [-7.4, -4.4, 4.4, 7.4]) for (const dx of [-0.09, 0.09]) b.aabb(M.lineDim, x + dx - 0.015, 1.29, HALL.z1 - 0.05, x + dx + 0.015, HALL.h - 0.4, HALL.z1);
	for (const z of [-3.6, 1.0, 5.6]) for (const dz of [-0.09, 0.09]) b.aabb(M.lineDim, HALL.x1 - 0.05, 1.29, z + dz - 0.015, HALL.x1, HALL.h - 0.4, z + dz + 0.015);
	// a gold line along the top of the wainscot
	b.aabb(M.lineDim, HALL.x1 - 0.075, 1.25, BAR.z + 0.7, HALL.x1 - 0.045, 1.28, HALL.z1 - 0.08);
	b.aabb(M.lineDim, HALL.x0 + 0.045, 1.25, 1.66, HALL.x0 + 0.075, 1.28, HALL.z1 - 0.08);
	b.aabb(M.lineDim, HALL.x0 + 0.045, 1.25, STAGE.z1 + 0.62, HALL.x0 + 0.075, 1.28, -1.66);

	// wall panels: a gold inlay rectangle with a fan at its head, between the pilasters
	const panel = (ax: 'x' | 'z', wallPos: number, nrm: number, c0: number, w: number, y0: number, y1: number) => {
		const off = wallPos + nrm * 0.012;
		const P = (u: number, y: number) => (ax === 'x' ? new THREE.Vector3(off, y, u) : new THREE.Vector3(u, y, off));
		goldLine([P(c0 - w / 2, y0), P(c0 + w / 2, y0), P(c0 + w / 2, y1), P(c0 - w / 2, y1), P(c0 - w / 2, y0)], 0.01, M.lineDim);
		goldLine([P(c0 - w / 2 + 0.12, y0 + 0.12), P(c0 + w / 2 - 0.12, y0 + 0.12), P(c0 + w / 2 - 0.12, y1 - 0.12), P(c0 - w / 2 + 0.12, y1 - 0.12), P(c0 - w / 2 + 0.12, y0 + 0.12)], 0.007, M.lineDim);
		for (let i = 0; i < 7; i++) {
			const a = Math.PI * (0.1 + (i / 6) * 0.8);
			goldLine([P(c0, y1 - 0.14), P(c0 + Math.cos(a) * 0.42, y1 - 0.14 + Math.sin(a) * 0.42 * 0.0 - 0.0 + 0)], 0.007, M.lineDim);
		}
		const arc: THREE.Vector3[] = [];
		for (let i = 0; i <= 16; i++) {
			const a = Math.PI * (i / 16);
			arc.push(P(c0 + Math.cos(a) * 0.45, y1 - 0.14 - Math.sin(a) * 0.45));
		}
		goldLine(arc, 0.008, M.line);
	};
	for (const zc of [-1.3, 3.3, 7.6]) panel('x', HALL.x1, -1, zc, 3.6, 1.6, 5.8);
	for (const zc of [3.1, 7.4]) panel('x', HALL.x0, 1, zc, 3.0, 1.6, 5.8);

	// ---------- stage ----------
	const cx = (STAGE.x0 + STAGE.x1) / 2;
	let curtainMat: THREE.Material | null = null;
	b.aabb(M.wood, STAGE.x0, 0, STAGE.z0, STAGE.x1, STAGE.top - 0.06, STAGE.z1 - 0.04, true);
	b.aabb(M.stageFloor, STAGE.x0 + 0.01, STAGE.top - 0.06, STAGE.z0, STAGE.x1 - 0.01, STAGE.top, STAGE.z1 - 0.06);
	b.aabb(M.line, STAGE.x0 + 0.02, STAGE.top - 0.1, STAGE.z1 - 0.06, STAGE.x1 - 0.02, STAGE.top + 0.012, STAGE.z1 + 0.02);
	// brass handrails either side of the steps: posts and a rail sloping down the stair
	for (const sx of [STAGE.x0 + 0.42, STAGE.x1 - 0.42]) {
		const pts = [new THREE.Vector3(sx, STAGE.top + 0.9, STAGE.z1 - 0.2), new THREE.Vector3(sx, 0.9 + 0.27, STAGE.z1 + 1.2), new THREE.Vector3(sx, 0.9, STAGE.z1 + 1.5)];
		b.add(M.gold, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.022, 8, false));
		for (const pt of pts) b.cyl(M.gold, pt.x, pt.y / 2, pt.z, 0.015, 0.02, pt.y, 8);
	}
	// four steps of 0.27, each narrower than the one above so no side planes are shared, a gold line on every nosing
	for (let i = 0; i < 3; i++) {
		const top = STAGE.top - 0.27 * (i + 1);
		const inset = 0.5 + i * 0.3;
		const z0 = STAGE.z1 - 0.3 + i * 0.42,
			z1 = STAGE.z1 + 0.42 * (i + 1);
		b.aabb(M.wood, STAGE.x0 + inset, 0, z0, STAGE.x1 - inset, top, z1, true);
		b.aabb(M.lineDim, STAGE.x0 + inset + 0.01, top - 0.03, z1, STAGE.x1 - inset - 0.01, top + 0.005, z1 + 0.02);
	}
	wall(STAGE.x0 - 0.5, STAGE.z0, STAGE.x0 + 0.01, STAGE.z1 - 1.3, 0, HALL.h, M.wallDark);
	wall(STAGE.x1 - 0.01, STAGE.z0, STAGE.x1 + 0.4, STAGE.z1 - 1.3, 0, HALL.h, M.wallDark);
	wall(STAGE.x0, STAGE.z0 - 0.4, STAGE.x1, STAGE.z0, 0, HALL.h, M.wallDark);

	// curtain: heavy velvet in deep irregular folds; a swagged pelmet across the top with a gold fringe band
	{
		const W = STAGE.x1 - STAGE.x0 - 0.2,
			H = 6.9;
		const g = new THREE.PlaneGeometry(W, H, Math.round(W * 18), 30);
		const p = g.attributes.position;
		for (let i = 0; i < p.count; i++) {
			const x = p.getX(i),
				y = p.getY(i);
			const ph = (x / 0.62) * Math.PI * 2 + Math.sin(x * 1.3) * 0.9;
			const amp = 0.05 + 0.02 * Math.sin(x * 0.53 + 1.0);
			const fold = Math.sin(ph);
			p.setZ(i, Math.sign(fold) * Math.pow(Math.abs(fold), 0.7) * amp * (0.8 + 0.25 * (1 - (y + H / 2) / H)));
		}
		g.computeVertexNormals();
		g.translate(cx, H / 2 + STAGE.top - 0.05, STAGE.z0 + 0.5);
		// its own mesh: the spot's light is painted on it, a clean diagonal wedge falling from high on the bar's side
		// down across the players (the same crisp shape from every seat, never banded), over the room's low wash
		const cm = new THREE.MeshLambertNodeMaterial({ color: C('#1c0703') });
		cm.name = 'stageCurtain';
		{
			const px = positionWorld.x.sub(cx),
				py = positionWorld.y.sub(STAGE.top);
			const q = px.mul(0.768).sub(py.mul(0.64)).add(1.15);
			const half = float(0.7).add(float(7.2).sub(py).max(0).mul(0.17));
			const wedge = smoothstep(half.add(0.03), half.sub(0.03), abs(q));
			// (its folds drawn as fine dark lines: where the cloth turns back into a fold)
			const folds = positionLocal.z.mul(6).add(0.84).clamp(0.74, 1.08).mul(smoothstep(-0.05, -0.04, positionLocal.z).mul(0.36).add(0.64));
			(cm as unknown as { emissiveNode: unknown }).emissiveNode = color('#ff7e22').mul(wedge).mul(folds.mul(0.75).add(0.25)).mul(0.92).add(color('#9a200a').mul(folds).mul(mix(float(0.3), float(0.52), smoothstep(6.5, 0.5, py))));
		}
		curtainMat = cm;
		const curtainMesh = new THREE.Mesh(g, cm);
		curtainMesh.receiveShadow = true;
		b.root.add(curtainMesh);
		// pelmet: five swags hanging between gathered points, a dark backing board and a fringe of gold
		const pz = STAGE.z0 + 1.25,
			py = 7.55;
		b.box(M.curtainDeep, cx, py + 0.25, pz - 0.15, W + 0.2, 0.6, 0.1);
		const swags = 5;
		for (let i = 0; i < swags; i++) {
			const xa = cx - W / 2 + (W * i) / swags,
				xb = cx - W / 2 + (W * (i + 1)) / swags;
			for (const [dy, r] of [
				[0, 0.17],
				[-0.18, 0.12],
			] as [number, number][]) {
				const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(xa, py + dy, pz), new THREE.Vector3((xa + xb) / 2, py - 0.75 + dy, pz + 0.22), new THREE.Vector3(xb, py + dy, pz));
				b.add(dy === 0 ? M.curtainDeep : M.curtain, new THREE.TubeGeometry(curve, 24, r, 10, false));
			}
			const fr: THREE.Vector3[] = [];
			for (let k = 0; k <= 16; k++) {
				const t = k / 16;
				const x = xa + (xb - xa) * t;
				fr.push(new THREE.Vector3(x, py - 0.18 - 4 * t * (1 - t) * 0.75 - 0.12, pz + 0.24 + 4 * t * (1 - t) * 0.1));
			}
			goldLine(fr, 0.022, M.line);
			// a gathered tail between swags
			const tail = fluted(0.11, 1.1, 5, 0.03, 20);
			b.at(M.curtainDeep, tail, xb, py - 0.45, pz + 0.05);
		}
		for (const s of [-1, 1]) {
			const drape = fluted(0.5, 6.6, 8, 0.12, 64);
			drape.scale(1, 1, 0.6);
			b.at(M.curtainDeep, drape, cx + s * (W / 2 - 0.3), 3.3 + STAGE.top, STAGE.z0 + 1.2);
		}
	}

	// proscenium: three stepped arched frames, the fan crest above
	const arch = (w: number, h: number, r: number, outerW: number, outerH: number, depth: number, z: number, mat: THREE.Material) => {
		const s = new THREE.Shape();
		s.moveTo(-outerW / 2, 0);
		s.lineTo(outerW / 2, 0);
		s.lineTo(outerW / 2, outerH);
		s.lineTo(-outerW / 2, outerH);
		s.closePath();
		const hole = new THREE.Path();
		hole.moveTo(-w / 2, 0);
		hole.lineTo(-w / 2, h - r);
		hole.absellipse(0, h - r, w / 2, r, Math.PI, 0, true, 0);
		hole.lineTo(w / 2, 0);
		hole.closePath();
		s.holes.push(hole);
		const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1, curveSegments: 48 });
		g.translate(cx, 0, z);
		b.add(mat, g);
		return z + depth + 0.03;
	};
	/** gold line following an arch opening, inset metres outside its edge, on the frame's front face */
	const archLine = (w: number, h: number, r: number, inset: number, zf: number, mat: THREE.Material = M.line, rad = 0.02) => {
		const pts: THREE.Vector3[] = [];
		const W = w / 2 + inset,
			R = r + inset;
		pts.push(new THREE.Vector3(cx - W, 0.02, zf), new THREE.Vector3(cx - W, h - r, zf));
		for (let i = 1; i < 40; i++) {
			const a = Math.PI - (i / 40) * Math.PI;
			pts.push(new THREE.Vector3(cx + Math.cos(a) * W, h - r + Math.sin(a) * R, zf));
		}
		pts.push(new THREE.Vector3(cx + W, h - r, zf), new THREE.Vector3(cx + W, 0.02, zf));
		goldLine(pts, rad, mat);
	};
	const fz = STAGE.z1 - 0.6;
	const f1 = arch(9.6, 6.9, 1.7, 10.7, HALL.h - 0.06, 0.55, fz, M.trim);
	const f2 = arch(9.2, 6.7, 1.6, 10.3, HALL.h - 0.1, 0.4, fz - 0.42, M.goldMatte);
	const f3 = arch(8.8, 6.5, 1.5, 10.0, HALL.h - 0.15, 0.4, fz - 0.84, M.wallDark);
	archLine(9.6, 6.9, 1.7, 0.06, f1);
	archLine(9.6, 6.9, 1.7, 0.3, f1, M.lineDim, 0.014);
	archLine(9.2, 6.7, 1.6, 0.05, f2, M.lineDim, 0.016);
	archLine(8.8, 6.5, 1.5, 0.05, f3, M.line, 0.016);
	for (const sx of [-1, 1]) for (const off of [0.55, 0.62]) goldLine([new THREE.Vector3(cx + sx * (4.8 + off), 0.02, f1), new THREE.Vector3(cx + sx * (4.8 + off), HALL.h - 0.4, f1)], 0.012, M.lineDim);
	b.collideBox(cx - 5.1, 4.2, fz + 0.27, 0.6, 8.4, 0.6);
	b.collideBox(cx + 5.1, 4.2, fz + 0.27, 0.6, 8.4, 0.6);
	{
		const y0 = 7.0,
			zf = fz + 0.62;
		const fins = 7;
		for (let i = 0; i < fins; i++) {
			const k = i - (fins - 1) / 2;
			const len = 1.55 - Math.abs(k) * 0.24;
			const a = k * 0.09;
			const g = new THREE.BoxGeometry(0.17, len, 0.1);
			g.translate(0, len / 2, 0);
			g.rotateZ(-a);
			b.at(M.line, g, cx + k * 0.24, y0 + 0.12, zf + 0.02);
			// a dark groove down each fin
			const gr = new THREE.BoxGeometry(0.03, len * 0.86, 0.02);
			gr.translate(0, len / 2, 0);
			gr.rotateZ(-a);
			b.at(M.goldMatte, gr, cx + k * 0.24, y0 + 0.14, zf + 0.075);
		}
		b.box(M.gold, cx, y0 + 0.04, zf + 0.02, 1.9, 0.16, 0.14);
		b.box(M.line, cx, y0 - 0.1, zf + 0.03, 2.4, 0.08, 0.16);
		b.box(M.gold, cx, y0 - 0.2, zf + 0.04, 2.9, 0.06, 0.18);
	}

	// a Deco smoking stand beside the saxophonist: a slim gold column and a dish, a cigarette left burning
	{
		const sx = -2.3 + 0.75,
			sz = -6.75 + 0.25;
		b.cyl(M.lacquer, sx, STAGE.top + 0.02, sz, 0.12, 0.14, 0.04, 24);
		b.cyl(M.gold, sx, STAGE.top + 0.46, sz, 0.015, 0.015, 0.86, 8);
		b.cyl(M.ash, sx, STAGE.top + 0.92, sz, 0.11, 0.07, 0.05, 24);
		const rim = new THREE.TorusGeometry(0.11, 0.008, 4, 24);
		rim.rotateX(Math.PI / 2);
		b.at(M.line, rim, sx, STAGE.top + 0.945, sz);
	}

	// ---------- north-east: ribbed columns, the stained glass, the bar ----------
	const col = (x: number, z: number, r = 0.4, h = HALL.h) => {
		// stepped square plinth and capital
		for (let i = 0; i < 3; i++) {
			const ww = (r + 0.22 - i * 0.07) * 2;
			b.box(M.woodDark, x, 0.04 + i * 0.08, z, ww, 0.08, ww);
			b.box(M.woodDark, x, h - 0.04 - i * 0.08, z, ww, 0.08, ww);
		}
		b.box(M.line, x, 0.245, z, (r + 0.08) * 2 + 0.01, 0.012, (r + 0.08) * 2 + 0.01);
		b.box(M.line, x, h - 0.245, z, (r + 0.08) * 2 + 0.01, 0.012, (r + 0.08) * 2 + 0.01);
		// a slim glowing glass tube on the room side of the column, gold caps and a pointed finial
		const sz = z + r + 0.07;
		b.at(M.lantern, new THREE.CylinderGeometry(0.045, 0.045, 0.62, 8), x, 3.1, sz, Math.PI / 8);
		for (let k = 0; k < 8; k++) {
			const a = (k / 8) * Math.PI * 2;
			b.box(M.lanternBand, x + Math.cos(a) * 0.043, 3.1, sz + Math.sin(a) * 0.043, 0.007, 0.6, 0.007, { rotY: -a });
		}
		for (const dy of [-0.32, 0.32]) b.at(M.gold, new THREE.CylinderGeometry(0.06, 0.06, 0.03, 8), x, 3.1 + dy, sz, Math.PI / 8);
		b.at(M.gold, new THREE.ConeGeometry(0.035, 0.14, 8), x, 3.5, sz, Math.PI / 8);
		b.box(M.gold, x, 2.75, sz - 0.04, 0.03, 0.03, 0.1);
		const SL = new THREE.PointLight(C('#ffa050'), 2.5, 3.0, 2);
		SL.position.set(x, 3.1, sz + 0.5);
		lights.push(SL);
		b.at(M.wood, fluted(r, h - 1.1, 16, 0.05), x, (h - 1.1) / 2 + 0.55, z);
		b.cyl(M.gold, x, 0.28, z, r + 0.08, r + 0.12, 0.56, 32);
		b.cyl(M.gold, x, h - 0.28, z, r + 0.14, r + 0.06, 0.56, 32);
		for (const y of [0.58, h - 0.58]) {
			const t = new THREE.TorusGeometry(r + 0.012, 0.014, 4, 32);
			t.rotateX(Math.PI / 2);
			b.at(M.line, t, x, y, z);
		}
		for (let i = 0; i < 16; i += 2) {
			const a = (i / 16) * Math.PI * 2;
			goldLine([new THREE.Vector3(x + Math.cos(a) * (r + 0.004), 0.6, z + Math.sin(a) * (r + 0.004)), new THREE.Vector3(x + Math.cos(a) * (r + 0.004), h - 0.6, z + Math.sin(a) * (r + 0.004))], 0.008, M.lineDim);
		}
		b.colliders.push({ kind: 'cyl', c: new THREE.Vector3(x, h / 2, z), r: r + 0.1, hh: h / 2 });
	};
	col(1.75, -9.7);
	col(5.0, -9.7);
	{
		const tex = stainedGlass();
		const m = new THREE.MeshLambertNodeMaterial({ color: 0x000000 });
		m.name = 'stainedGlass';
		m.emissiveMap = tex;
		m.emissive = C('#ffe2b4');
		m.emissiveIntensity = 1.05;
		const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 6.4), m);
		mesh.position.set(3.38, 4.3, HALL.z0 + 0.02);
		b.root.add(mesh);
		const gx0 = 2.28,
			gx1 = 4.48;
		b.aabb(M.line, gx0 - 0.06, 1.0, HALL.z0, gx0 + 0.04, 7.6, HALL.z0 + 0.12);
		b.aabb(M.line, gx1 - 0.04, 1.0, HALL.z0, gx1 + 0.06, 7.6, HALL.z0 + 0.12);
		b.aabb(M.line, gx0 - 0.08, 0.94, HALL.z0, gx1 + 0.08, 1.06, HALL.z0 + 0.14);
		b.aabb(M.line, gx0 - 0.08, 7.54, HALL.z0, gx1 + 0.08, 7.66, HALL.z0 + 0.14);
	}
	{
		// back bar on the north wall: base cabinet, backlit shelves of bottles, crown
		const bz = BAR.back + 0.45;
		b.aabb(M.woodDark, BAR.x0, 0, BAR.back + 0.01, BAR.x1 - 0.01, 1.0, bz + 0.4, true);
		b.aabb(M.lacquer, BAR.x0 - 0.02, 1.0, BAR.back + 0.01, BAR.x1 - 0.01, 1.04, bz + 0.42);
		{
			const bays = Math.ceil((BAR.x1 - BAR.x0) / 1.4);
			const cv = document.createElement('canvas');
			cv.width = 128 * bays;
			cv.height = 512;
			const g = cv.getContext('2d') as CanvasRenderingContext2D;
			g.fillStyle = '#b86a1c';
			g.fillRect(0, 0, cv.width, cv.height);
			for (let i = 0; i < bays; i++) {
				const gx = i * 128 + 64;
				const rg = g.createRadialGradient(gx, 300, 10, gx, 300, 300);
				rg.addColorStop(0, '#ffc45a');
				rg.addColorStop(0.55, '#f6a238');
				rg.addColorStop(1, '#c87420');
				g.fillStyle = rg;
				g.fillRect(i * 128 + 4, 0, 120, 512);
				// mirror streaks
				for (let sI = 0; sI < 6; sI++) {
					g.fillStyle = `rgba(255,236,200,${0.03 + (sI % 3) * 0.02})`;
					g.fillRect(i * 128 + 12 + sI * 19, 0, 3 + (sI % 2) * 3, 512);
				}
			}
			const tex = new THREE.CanvasTexture(cv);
			tex.colorSpace = THREE.SRGBColorSpace;
			const mm = new THREE.MeshLambertNodeMaterial({ color: 0x000000 });
			mm.name = 'barMirror';
			mm.emissiveMap = tex;
			mm.emissive = C('#ffffff');
			mm.emissiveIntensity = 1.0;
			const mesh = new THREE.Mesh(new THREE.PlaneGeometry(BAR.x1 - BAR.x0, 4.4), mm);
			mesh.position.set((BAR.x0 + BAR.x1) / 2, 1.04 + 2.2, BAR.back + 0.02);
			b.root.add(mesh);
		}
		const shelfYs = [1.72, 2.4, 3.08, 3.76, 4.44];
		for (const y of shelfYs) {
			b.aabb(M.goldMatte, BAR.x0, y - 0.03, BAR.back + 0.03, BAR.x1 - 0.02, y, bz + 0.26);
			b.aabb(M.line, BAR.x0, y - 0.03, bz + 0.26, BAR.x1 - 0.02, y + 0.004, bz + 0.29);
		}
		for (let x = BAR.x0 + 0.02; x <= BAR.x1; x += 1.4) b.aabb(M.woodDark, x - 0.05, 1.04, BAR.back + 0.03, x + 0.05, 5.3, bz + 0.3);
		b.aabb(M.woodDark, BAR.x0 - 0.1, 5.25, BAR.back + 0.02, BAR.x1 - 0.01, 5.55, bz + 0.42);
		b.aabb(M.line, BAR.x0 - 0.1, 5.2, bz + 0.42, BAR.x1 - 0.01, 5.26, bz + 0.45);
		const niche = glow('barNiche', '#ffb858', 1.15);
		b.aabb(niche, BAR.x0 + 0.07, 5.08, BAR.back + 0.03, BAR.x1 - 0.03, 5.24, bz + 0.34);
		b.aabb(niche, BAR.x0 - 0.06, 1.04, BAR.back + 0.03, BAR.x0 - 0.03, 5.24, bz + 0.34);
		for (let x = BAR.x0 + 0.02; x <= BAR.x1; x += 1.4) b.aabb(M.lineDim, x - 0.012, 1.04, bz + 0.3, x + 0.012, 5.2, bz + 0.32);
		// six bottle shapes: wine, square whisky, decanter with a stopper, slim liqueur, round gin, champagne
		const shapes: { prof: [number, number][]; seg: number; rot: number }[] = [
			{ prof: [[0, 0], [0.038, 0], [0.04, 0.02], [0.04, 0.22], [0.03, 0.26], [0.014, 0.29], [0.013, 0.36], [0.016, 0.37], [0, 0.37]], seg: 12, rot: 0 },
			{ prof: [[0, 0], [0.05, 0], [0.052, 0.015], [0.052, 0.16], [0.04, 0.19], [0.016, 0.21], [0.016, 0.25], [0, 0.25]], seg: 4, rot: Math.PI / 4 },
			{ prof: [[0, 0], [0.045, 0], [0.062, 0.05], [0.062, 0.12], [0.04, 0.17], [0.018, 0.2], [0.018, 0.23], [0.034, 0.25], [0.034, 0.28], [0.02, 0.31], [0, 0.31]], seg: 8, rot: Math.PI / 8 },
			{ prof: [[0, 0], [0.028, 0], [0.03, 0.3], [0.02, 0.34], [0.01, 0.41], [0, 0.41]], seg: 10, rot: 0 },
			{ prof: [[0, 0], [0.045, 0], [0.056, 0.06], [0.05, 0.17], [0.03, 0.2], [0.014, 0.24], [0.014, 0.28], [0, 0.28]], seg: 12, rot: 0 },
			{ prof: [[0, 0], [0.04, 0], [0.042, 0.2], [0.025, 0.27], [0.016, 0.33], [0.018, 0.36], [0, 0.36]], seg: 12, rot: 0 },
		];
		const glassTints = ['#ffb050', '#c86a20', '#7aa048', '#ffe8c0', '#c03a28', '#8a4a1c', '#ffd080', '#5a8a3a'];
		const geos: THREE.BufferGeometry[] = [];
		const colGeo = (g: THREE.BufferGeometry, fn: (y: number, nx: number, nz: number) => THREE.Color) => {
			const pos = g.attributes.position,
				nor = g.attributes.normal;
			const cols = new Float32Array(pos.count * 3);
			for (let i = 0; i < pos.count; i++) {
				const c = fn(pos.getY(i), nor.getX(i), nor.getZ(i));
				cols[i * 3] = c.r;
				cols[i * 3 + 1] = c.g;
				cols[i * 3 + 2] = c.b;
			}
			g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
			if (g.attributes.uv) g.deleteAttribute('uv');
			return g;
		};
		// a calm, luminous wall: uniform rows, one bottle shape per shelf, evenly spaced,
		// mostly amber with a few greens and a deep red, each glowing from its liquid with a glint up one side
		let k = 0;
		const shelves = [1.04, ...shelfYs.slice(0, -1)];
		const rowShape = [0, 5, 3, 0, 4];
		for (let si = 0; si < shelves.length; si++) {
			const y = shelves[si];
			for (let x = BAR.x0 + 0.16; x < BAR.x1 - 0.1; x += 0.172) {
				k++;
				const sh = shapes[(rowShape[si % rowShape.length] + ((k * 7) % 5 === 0 ? 1 : 0)) % shapes.length];
				const s = 1.3 + ((k * 13) % 5) * 0.04;
				// (about one bottle in three is amber glass: the wall's light comes through it)
				const through = (k * 11) % 3 === 0 ? 8 : (k * 11) % 3 === 1 ? 4.5 : 2;
				const lat = new THREE.LatheGeometry(bottomless(sh.prof).map(([r, yy]) => new THREE.Vector2(r, yy)), sh.seg, sh.rot).toNonIndexed();
				lat.scale(s, s, s);
				lat.computeVertexNormals();
				const top = sh.prof[sh.prof.length - 1][1] * s;
				const level = top * 0.62;
				const hue = (k * 37) % 11;
				const tint = new THREE.Color(hue < 6 ? '#ff9a28' : hue < 9 ? '#e07818' : hue < 10 ? '#78a030' : '#c83a18');
				colGeo(lat, (yy, nx, nz) => {
					const c = tint.clone().multiplyScalar((yy < level ? 1.05 : 0.42) * through);
					if (Math.max(0, -nx * 0.6 + nz * 0.8) > 0.9) c.lerp(new THREE.Color('#fff6e4'), 0.8);
					return c;
				});
				lat.translate(x, y + 0.006, bz + 0.07);
				geos.push(lat);
				{
					const r0 = sh.prof[2][0] * 1.04 * s;
					const lh = top * 0.22;
					const lb = new THREE.CylinderGeometry(r0, r0, lh, 8, 1, true, -Math.PI * 0.4, Math.PI * 0.8).toNonIndexed();
					lb.computeVertexNormals();
					colGeo(lb, () => new THREE.Color(hue % 3 === 0 ? '#c8a060' : '#9a6a30'));
					lb.translate(x, y + 0.006 + top * 0.32, bz + 0.07);
					geos.push(lb);
				}
			}
		}
		// glasses on the shelves: rows of coupes on the top shelf, stacked tumblers on the counter back
		const coupe = [[0, 0], [0.035, 0], [0.035, 0.004], [0.004, 0.01], [0.004, 0.08], [0.05, 0.11], [0.052, 0.112], [0, 0.09]] as [number, number][];
		const tumbler = [[0, 0], [0.032, 0], [0.036, 0.09], [0.034, 0.092], [0, 0.012]] as [number, number][];
		for (let x = BAR.x0 + 0.2; x < BAR.x1 - 0.2; x += 0.13) {
			const g = new THREE.LatheGeometry(bottomless(coupe).map(([r, yy]) => new THREE.Vector2(r, yy)), 12).toNonIndexed();
			g.computeVertexNormals();
			colGeo(g, (_yy, nx, nz) => new THREE.Color(Math.max(0, -nx * 0.6 + nz * 0.8) > 0.85 ? '#fff0d0' : '#5a4a3a'));
			g.translate(x, shelfYs[3] + 0.004, bz + 0.12);
			geos.push(g);
		}
		for (let x = BAR.x0 + 0.25; x < BAR.x1 - 0.2; x += 0.09) {
			const g = new THREE.LatheGeometry(bottomless(tumbler).map(([r, yy]) => new THREE.Vector2(r, yy)), 10).toNonIndexed();
			g.computeVertexNormals();
			colGeo(g, (_yy, nx, nz) => new THREE.Color(Math.max(0, -nx * 0.6 + nz * 0.8) > 0.85 ? '#ffe8c0' : '#4a3a2c'));
			g.translate(x, 1.046, bz + 0.3);
			geos.push(g);
		}
		{
			const cz = BAR.z - 0.05,
				cy = BAR.top;
			const coupeG = bottomless(coupe).map(([r, yy]) => new THREE.Vector2(r, yy));
			for (const [cx, col] of [
				[BAR.x0 + 1.4, '#ff5030'],
				[BAR.x0 + 1.58, '#ffb040'],
				[BAR.x0 + 2.9, '#ff9030'],
			] as [number, string][]) {
				const g = new THREE.LatheGeometry(coupeG, 14).toNonIndexed();
				g.computeVertexNormals();
				colGeo(g, (_yy, nx, nz) => new THREE.Color(Math.max(0, -nx * 0.6 + nz * 0.8) > 0.85 ? '#fff0d0' : '#4a3a2c'));
				g.translate(cx, cy + 0.002, cz);
				geos.push(g);
				const liq = new THREE.LatheGeometry([new THREE.Vector2(0, 0.083), new THREE.Vector2(0.044, 0.104), new THREE.Vector2(0, 0.104)], 14).toNonIndexed();
				liq.computeVertexNormals();
				colGeo(liq, () => new THREE.Color(col));
				liq.translate(cx, cy + 0.002, cz);
				geos.push(liq);
			}
		}
		// a cocktail shaker and a jigger on the counter
		b.at(M.chrome ?? M.gold, lathe([[0, 0], [0.045, 0], [0.048, 0.14], [0.04, 0.17], [0.03, 0.2], [0.032, 0.23], [0.02, 0.25], [0, 0.25]], 20), BAR.x0 + 2.2, BAR.top + 0.001, BAR.z - 0.08);
		b.at(M.gold, lathe([[0, 0], [0.02, 0], [0.008, 0.03], [0.022, 0.06], [0, 0.06]], 12), BAR.x0 + 2.32, BAR.top + 0.001, BAR.z - 0.02);
		const bm = new THREE.MeshLambertNodeMaterial({ color: 0x050302 });
		bm.name = 'bottles';
		{
			const facing = abs(normalView.dot(positionViewDirection));
			(bm as unknown as { emissiveNode: unknown }).emissiveNode = vertexColor().mul(pow(facing.clamp(0, 1), float(1.4)).mul(0.1).add(0.035));
		}
		b.root.add(new THREE.Mesh(mergeAll(geos), bm));
		// Deco brackets under every shelf at every divider: a small stepped gold block
		for (let x = BAR.x0 + 0.02; x <= BAR.x1; x += 1.4)
			for (const y of shelfYs) {
				b.aabb(M.gold, x - 0.07, y - 0.075, bz + 0.2, x + 0.07, y - 0.035, bz + 0.265);
				b.aabb(M.gold, x - 0.045, y - 0.11, bz + 0.21, x + 0.045, y - 0.075, bz + 0.255);
			}


		// the counter, running east-west in front of the back bar, open at its west end
		const z = BAR.z;
		b.aabb(M.woodDark, BAR.x0 + 0.6, 0, z - 0.35, BAR.x1 - 0.01, BAR.top - 0.06, z + 0.35, true);
		for (let x = BAR.x0 + 0.72; x < BAR.x1 - 0.06; x += 0.16) {
			const g = new THREE.CylinderGeometry(0.06, 0.06, BAR.top - 0.32, 10, 1, false, -Math.PI / 2, Math.PI);
			b.at(M.leatherDark, g, x, 0.2 + (BAR.top - 0.32) / 2, z + 0.36);
		}
		b.aabb(M.lacquer, BAR.x0 + 0.5, BAR.top - 0.06, z - 0.42, BAR.x1 - 0.01, BAR.top, z + 0.48);
		b.aabb(M.line, BAR.x0 + 0.48, BAR.top - 0.09, z + 0.47, BAR.x1 - 0.02, BAR.top + 0.005, z + 0.5);
		b.aabb(M.lineDim, BAR.x0 + 0.62, 0.62, z + 0.42, BAR.x1 - 0.02, 0.645, z + 0.44);
		b.aabb(glow('barUnder', '#ff8a2a', 0.9), BAR.x0 + 0.62, BAR.top - 0.13, z + 0.355, BAR.x1 - 0.02, BAR.top - 0.065, z + 0.46);
		const rail = new THREE.CylinderGeometry(0.025, 0.025, BAR.x1 - BAR.x0 - 0.65, 12);
		rail.rotateZ(Math.PI / 2);
		b.at(M.gold, rail, (BAR.x0 + 0.6 + BAR.x1) / 2, 0.22, z + 0.6);
		b.aabb(M.lineDim, BAR.x0 + 0.62, 0, z + 0.36, BAR.x1 - 0.02, 0.2, z + 0.42);
	}
	const stools: THREE.Vector3[] = [];
	for (let x = BAR.x0 + 1.0; x < BAR.x1 - 0.3; x += 0.95) stools.push(new THREE.Vector3(x, 0, BAR.z + 0.95));

	// ---------- pendant lanterns (tiered) ----------
	const lantern = (x: number, y: number, z: number, s = 1, light = true) => {
		// a Deco pendant of flat panes of glass: a tall square body with a lower wing on each side, tiers stepping
		// in below it and a small cap above; every pane framed in thin dark leading; a pointed finial, hung on a rod
		/** One glowing box in its leading: uprights at the corners, a band at head and foot, mullions down each face. */
		const pane = (cx: number, top: number, cz: number, w: number, h: number, d: number, bars: number) => {
			b.box(M.lantern, cx, top - h / 2, cz, w, h, d);
			const t = 0.011 * s;
			for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(M.lanternBand, cx + (sx * w) / 2, top - h / 2, cz + (sz * d) / 2, t, h, t);
			for (const yb of [top, top - h]) b.box(M.lanternBand, cx, yb, cz, w + t, t, d + t);
			for (let i = 1; i <= bars; i++) {
				const u = -0.5 + i / (bars + 1);
				for (const sz of [-1, 1]) b.box(M.lanternBand, cx + u * w, top - h / 2, cz + (sz * d) / 2, t * 0.8, h, t * 0.8);
				for (const sx of [-1, 1]) b.box(M.lanternBand, cx + (sx * w) / 2, top - h / 2, cz + u * d, t * 0.8, h, t * 0.8);
			}
		};
		let yy = y;
		b.box(M.gold, x, yy + 0.03 * s, z, 0.13 * s, 0.06 * s, 0.13 * s);
		pane(x, yy, z, 0.16 * s, 0.09 * s, 0.16 * s, 0);
		yy -= 0.09 * s;
		const bw = 0.25 * s,
			bh = 0.58 * s;
		pane(x, yy, z, bw, bh, bw, 2);
		for (const [dx, dz] of [
			[1, 0],
			[-1, 0],
			[0, 1],
			[0, -1],
		])
			pane(x + dx * (bw / 2 + 0.045 * s), yy - 0.1 * s, z + dz * (bw / 2 + 0.045 * s), dx ? 0.09 * s : bw * 0.6, 0.38 * s, dz ? 0.09 * s : bw * 0.6, 0);
		yy -= bh;
		for (const [w, h] of [
			[0.19, 0.15],
			[0.14, 0.12],
			[0.09, 0.1],
		]) {
			pane(x, yy, z, w * s, h * s, w * s, w > 0.15 ? 1 : 0);
			yy -= h * s;
		}
		b.at(M.line, new THREE.CylinderGeometry(0.04 * s, 0.04 * s, 0.02 * s, 8), x, yy, z, Math.PI / 8);
		b.at(M.lanternBand, new THREE.ConeGeometry(0.035 * s, 0.32 * s, 8), x, yy - 0.16 * s, z, Math.PI / 8);
		b.add(M.lanternBand, new THREE.CylinderGeometry(0.01, 0.01, HALL.h - y, 6), new THREE.Matrix4().makeTranslation(x, (HALL.h + y) / 2, z));
		b.cyl(M.gold, x, HALL.h - 0.03, z, 0.14 * s, 0.18 * s, 0.06, 16);
		b.cyl(M.line, x, HALL.h - 0.09, z, 0.07 * s, 0.1 * s, 0.06, 16);
		if (light) cones.push(new THREE.Vector3(x, yy - 0.3 * s, z));
		if (light) {
			const L = new THREE.PointLight(C('#ffa050'), 11, 5.5, 2);
			L.position.set(x, y - 1.0 * s, z);
			lights.push(L);
		}
	};
	lantern(6.2, 5.5, -6.4, 1.75);
	lantern(7.9, 5.0, -6.0, 1.55);
	lantern(4.55, 6.5, -7.8, 1.45);
	lantern(7.2, 6.3, -8.6, 1.2, false);

	// ---------- tables, booths, lamps, glasses ----------
	const table = (x: number, z: number, booth: number | null, chairs: number[]) => {
		const top = 0.74;
		pedestal(b, x, z, top - 0.03, M.gold, M.lacquer);
		const topRec = { x, y: top - 0.02, z, r: 0.52, lamp: new THREE.Vector3(), lampR: 0.13, hex: '#ffa050' };
		tops.push(topRec);
		const rim = new THREE.TorusGeometry(0.52, 0.012, 6, 64);
		rim.rotateX(Math.PI / 2);
		b.at(M.line, rim, x, top - 0.02, z);
		b.colliders.push({ kind: 'cyl', c: new THREE.Vector3(x, top / 2, z), r: 0.55, hh: top / 2 });
		const kinds: LampKind[] = ['red', 'red', 'amber', 'red', 'dome'];
		const kind = kinds[Math.abs(Math.round(x * 7 + z * 3)) % kinds.length];
		const ga = (x * 13 + z * 7) % 6.28;
		const lx = x + Math.cos(ga + 1.2) * 0.12,
			lz = z + Math.sin(ga + 1.2) * 0.12;
		const bulb = tableLamp(b, lx, top + 0.001, lz, kind, M.line, M.goldMatte);
		pools.push({ p: new THREE.Vector3(lx, top + 0.004, lz), hex: LAMP_COLOURS[kind] });
		topRec.lamp.set(lx, top + (kind === 'dome' ? 0.24 : 0.31), lz);
		topRec.lampR = kind === 'dome' ? 0 : 1;
		topRec.hex = LAMP_COLOURS[kind];
		const L = new THREE.PointLight(C(LAMP_COLOURS[kind]), 3.6, 2.8, 2);
		L.position.copy(bulb);
		lights.push(L);
		lamps.push(new THREE.Vector3(lx, top + 0.3, lz));
		martini(b, x + Math.cos(ga) * 0.3, top + 0.001, z + Math.sin(ga) * 0.3, M.liquid, M.olive);
		tumbler(b, x + Math.cos(ga + 2.4) * 0.28, top + 0.001, z + Math.sin(ga + 2.4) * 0.28, ga);
		const tip = ashtray(b, x + Math.cos(ga + 4.2) * 0.26, top + 0.001, z + Math.sin(ga + 4.2) * 0.26, ga + 1.0, M.gold);
		ashtrays.push(tip);
		if (booth !== null) {
			const a0 = booth + Math.PI * 0.5 + 0.55,
				a1 = booth + Math.PI * 1.5 - 0.55;
			b.at(M.leather, ringSector(0.95, 1.55, a0, a1, 0.44, 0.03), x, 0, z);
			b.at(M.leather, ringSector(1.5, 1.72, a0 - 0.05, a1 + 0.05, 0.9, 0.06), x, 0, z);
			// channel tufting: rounded vertical rolls on the inside of the back, a deep seam between each
			for (let a = a0 + 0.02; a < a1 - 0.02; a += 0.13) {
				b.at(M.leather, ringSector(1.455, 1.5, a + 0.012, a + 0.118, 0.4, 0.018), x, 0.47, z);
				b.at(M.leatherDark, ringSector(1.49, 1.5, a, a + 0.012, 0.4, 0), x, 0.47, z);
			}
			// a pair of cushions leaning on the back
			for (const ca of [a0 + 0.5, a1 - 0.7]) {
				const g = new THREE.BoxGeometry(0.42, 0.34, 0.12, 4, 4, 2);
				const pp = g.attributes.position;
				for (let i = 0; i < pp.count; i++) {
					const u = pp.getX(i) / 0.21,
						v = pp.getY(i) / 0.17;
					pp.setZ(i, pp.getZ(i) * (1 - 0.6 * (u * u * 0.5 + v * v * 0.5)));
				}
				g.computeVertexNormals();
				g.rotateX(-0.25);
				g.rotateY(-ca + Math.PI / 2 + Math.PI);
				b.at(M.leatherDark, g, x + Math.cos(ca) * 1.36, 0.63, z - Math.sin(ca) * 1.36);
			}
			b.at(M.line, ringSector(1.69, 1.73, a0 - 0.06, a1 + 0.06, 0.03, 0), x, 0.9, z);
			for (let i = 0; i <= 6; i++) {
				const a = a0 + ((a1 - a0) * i) / 6;
				b.collideBox(x + Math.cos(a) * 1.3, 0.55, z - Math.sin(a) * 1.3, 0.75, 1.1, 0.75, -a);
			}
			for (let i = 0; i < 3; i++) {
				const a = a0 + 0.35 + ((a1 - a0 - 0.7) * i) / 2;
				const sx = x + Math.cos(a) * 1.22,
					sz = z - Math.sin(a) * 1.22;
				seats.push({ pos: new THREE.Vector3(sx, 0, sz), yaw: Math.atan2(x - sx, z - sz), seatY: 0.44, zone: 'hall', table: new THREE.Vector3(x, top, z) });
			}
		}
		for (const a of chairs) {
			const sx = x + Math.cos(a) * 0.95,
				sz = z + Math.sin(a) * 0.95;
			seats.push({ pos: new THREE.Vector3(sx, 0, sz), yaw: Math.atan2(x - sx, z - sz), seatY: 0.42, zone: 'hall', table: new THREE.Vector3(x, top, z), chair: true });
		}
	};
	// booth openings face the stage; a shape angle a maps to world direction (cos a, 0, -sin a)
	const towardStage = (x: number, z: number) => Math.atan2(-(-8 - z), -3.6 - x);
	const T: [number, number, boolean][] = [
		[-7.0, -2.9, true],
		[-3.4, -2.6, true],
		[0.2, -3.0, true],
		[3.4, -3.4, false],
		[-5.4, 1.4, true],
		[-1.6, 1.2, true],
		[2.3, -0.5, false],
		[6.4, -2.2, true],
		[-7.2, 5.6, true],
		[-3.4, 5.4, true],
		[0.6, 5.2, true],
		[6.6, 3.6, true],
		[4.4, 7.0, false],
	];
	for (const [x, z, booth] of T) {
		const ang = Math.atan2(-8 - z, -3.6 - x);
		table(x, z, booth ? towardStage(x, z) : null, booth ? [] : [ang + Math.PI * 0.72, ang - Math.PI * 0.72]);
	}

	// ---------- wall sconces ----------
	const sconce = (x: number, y: number, z: number, rotY: number, nx: number, nz: number) => {
		// a slim tall lantern sconce in an arched niche: a dark recessed arch, a gold bracket, an octagonal glowing
		// glass tube with dark mullions and gold caps, pointed finials above and below
		void rotY;
		const ry = Math.atan2(nx, nz);
		const ox = x + nx * 0.02,
			oz = z + nz * 0.02;
		const niche = new THREE.Shape();
		niche.moveTo(-0.32, -0.75);
		niche.lineTo(0.32, -0.75);
		niche.lineTo(0.32, 0.55);
		niche.absarc(0, 0.55, 0.32, 0, Math.PI, false);
		niche.lineTo(-0.32, -0.75);
		const ng = new THREE.ShapeGeometry(niche, 24);
		ng.rotateY(ry);
		b.at(M.ceiling, ng, ox, y, oz);
		const arch: THREE.Vector3[] = [];
		const P = (u: number, v: number, d: number) => new THREE.Vector3(ox + Math.cos(ry) * u + nx * d, y + v, oz - Math.sin(ry) * u + nz * d);
		arch.push(P(-0.33, -0.75, 0.01), P(-0.33, 0.55, 0.01));
		for (let i = 1; i < 16; i++) {
			const a = Math.PI - (i / 16) * Math.PI;
			arch.push(P(Math.cos(a) * 0.33, 0.55 + Math.sin(a) * 0.33, 0.01));
		}
		arch.push(P(0.33, 0.55, 0.01), P(0.33, -0.75, 0.01));
		goldLine(arch, 0.01, M.line);
		const c = P(0, 0.05, 0.13);
		b.box(M.gold, c.x - nx * 0.07, y - 0.32, c.z - nz * 0.07, 0.04, 0.04, 0.14, { rotY: ry });
		b.at(M.lantern, new THREE.CylinderGeometry(0.055, 0.055, 0.5, 8), c.x, c.y, c.z, Math.PI / 8);
		for (let k = 0; k < 8; k++) {
			const a = (k / 8) * Math.PI * 2;
			b.box(M.lanternBand, c.x + Math.cos(a) * 0.052, c.y, c.z + Math.sin(a) * 0.052, 0.008, 0.48, 0.008, { rotY: -a });
		}
		for (const dy of [-0.26, 0.26]) b.at(M.gold, new THREE.CylinderGeometry(0.07, 0.07, 0.03, 8), c.x, c.y + dy, c.z, Math.PI / 8);
		b.at(M.gold, new THREE.ConeGeometry(0.04, 0.16, 8), c.x, c.y + 0.35, c.z, Math.PI / 8);
		const bot = new THREE.ConeGeometry(0.035, 0.14, 8);
		bot.rotateX(Math.PI);
		b.at(M.gold, bot, c.x, c.y - 0.34, c.z, Math.PI / 8);
		const L = new THREE.PointLight(C('#ffa050'), 3, 3.6, 2);
		L.position.set(c.x + nx * 0.4, c.y, c.z + nz * 0.4);
		lights.push(L);
	};
	sconce(HALL.x0 + 0.06, 3.0, 4.6, Math.PI / 2, 1, 0);
	sconce(-5.9, 3.0, HALL.z1 - 0.06, Math.PI, 0, -1);
	sconce(5.9, 3.0, HALL.z1 - 0.06, Math.PI, 0, -1);
	sconce(HALL.x1 - 0.06, 3.0, 1.0, -Math.PI / 2, -1, 0);

	// ---------- stage light: a wide warm spot from high front-right, laying a diagonal pool on the curtain ----------
	const spot = new THREE.SpotLight(C('#ffc474'), 420, 24, 0.36, 0.25, 2);
	spot.position.set(-0.6, 6.2, -7.5);
	spot.target.position.set(-4.4, 1.1, -8.7);
	spot.castShadow = true;
	spot.shadow.mapSize.set(2048, 2048);
	spot.shadow.bias = -0.0004;
	spot.shadow.normalBias = 0.02;
	spot.shadow.camera.near = 2;
	spot.shadow.camera.far = 25;
	lights.push(spot);
	scene.add(spot.target);
	// stage wash: amber up the curtain from the footlights, red in the wings, light on the proscenium
	for (const [x, y, z, c, i, d] of [
		[cx - 2.8, STAGE.top + 0.3, STAGE.z1 - 0.5, '#ff7a30', 22, 8],
		[cx + 2.8, STAGE.top + 0.3, STAGE.z1 - 0.5, '#ff7a30', 22, 8],
		[STAGE.x0 + 2.2, 3.5, STAGE.z0 + 2.0, '#ff5a20', 10, 7],
		[cx - 3.0, 7.6, fz + 6.5, '#ff8a40', 5, 16],
		[cx + 3.5, 7.6, fz + 6.5, '#ff9a48', 5, 16],
	] as [number, number, number, string, number, number][]) {
		const L = new THREE.PointLight(C(c), i, d, d > 10 ? 1.0 : 1.6);
		L.position.set(x, y, z);
		lights.push(L);
	}
	{
		const L = new THREE.PointLight(C('#ff9440'), 22, 7, 1.8);
		L.position.set((BAR.x0 + BAR.x1) / 2, 2.4, BAR.back + 2.0);
		lights.push(L);
	}
	// the hall's fill: a low warm red from everywhere, so walls, arches and ceiling read as oxblood, not as black
	// (the card room and the balcony keep the dim fill they had)
	lights.push(new THREE.HemisphereLight(C('#b0401e'), C('#7a2412'), 2.0));
	const hemi = new THREE.HemisphereLight(C('#4a2410'), C('#160804'), 0.2);

	// ---------- card room (west): purple felt under a hanging lamp, blue and violet spots ----------
	const R = CARDS;
	const tx = (R.x0 + R.x1) / 2 - 0.1,
		tz = 0;
	{
		bc.aabb(M.carpetCards, R.x0, -0.02, R.z0, R.x1 - 0.4, 0.005, R.z1);
		bc.aabb(M.ceiling, R.x0, R.h, R.z0, R.x1 - 0.4, R.h + 0.3, R.z1); // stops inside the wall, never flush with the hall face
		bc.aabb(M.wallCards, R.x0 - 0.4, 0, R.z0, R.x0, R.h, R.z1, true);
		bc.aabb(M.wallCards, R.x0 - 0.4, 0, R.z0 - 0.4, R.x1 - 0.4, R.h, R.z0, true);
		bc.aabb(M.wallCards, R.x0 - 0.4, 0, R.z1, R.x1 - 0.4, R.h, R.z1 + 0.4, true);
		bc.aabb(M.woodDark, R.x1 - 0.45, 0, -1.7, R.x1 + 0.05, 3.35, -1.58);
		bc.aabb(M.woodDark, R.x1 - 0.45, 0, 1.58, R.x1 + 0.05, 3.35, 1.7);
		bc.aabb(M.woodDark, R.x1 - 0.47, 3.28, -1.72, R.x1 + 0.07, 3.4, 1.72);
		for (const fx of [R.x1 - 0.482, R.x1 + 0.07]) {
			for (const sz of [-1.72, 1.695]) bc.aabb(M.lineDim, fx, 0, sz, fx + 0.012, 3.4, sz + 0.025);
			bc.aabb(M.lineDim, fx, 3.38, -1.72, fx + 0.012, 3.405, 1.72);
		}
		for (let z = R.z0 + 0.6; z < R.z1; z += 0.9) bc.aabb(M.woodDark, R.x0, 0, z - 0.04, R.x0 + 0.05, R.h - 0.02, z + 0.04);
		bc.cyl(M.woodDark, tx, 0.35, tz, 0.12, 0.2, 0.7, 16);
		bc.cyl(M.felt, tx, 0.745, tz, 0.95, 0.95, 0.03, 64);
		const rim = new THREE.TorusGeometry(0.96, 0.035, 8, 64);
		rim.rotateX(Math.PI / 2);
		bc.at(M.line, rim, tx, 0.75, tz);
		bc.cyl(M.woodDark, tx, 0.7, tz, 0.98, 0.9, 0.06, 64);
		bc.colliders.push({ kind: 'cyl', c: new THREE.Vector3(tx, 0.4, tz), r: 1.0, hh: 0.4 });
		const chip = lambert('chipRed', '#8a1a14');
		const chipW = lambert('chipCream', '#d8c8a8');
		for (let i = 0; i < 9; i++) {
			const a = i * 0.7,
				r = 0.25 + (i % 3) * 0.12;
			const h = 0.01 * (2 + (i % 4));
			bc.cyl(i % 2 ? chip : chipW, tx + Math.cos(a) * r, 0.76 + h / 2, tz + Math.sin(a) * r, 0.02, 0.02, h, 12);
		}
		const card = lambert('card', '#e8dcc0');
		for (let i = 0; i < 5; i++) bc.box(card, tx - 0.1 + i * 0.07, 0.762, tz + 0.05 + (i % 2) * 0.01, 0.06, 0.003, 0.09, { rotY: i * 0.2 });
		bc.at(lambert('lampTin', '#3a2a1a', { side: THREE.DoubleSide }), new THREE.CylinderGeometry(0.12, 0.55, 0.32, 32, 1, true), tx, 2.05, tz);
		bc.cyl(M.bulb, tx, 1.95, tz, 0.07, 0.07, 0.08, 12);
		bc.add(M.lanternBand, new THREE.CylinderGeometry(0.01, 0.01, R.h - 2.2, 6), new THREE.Matrix4().makeTranslation(tx, (R.h + 2.2) / 2, tz));
		const ringGlow = new THREE.RingGeometry(0.4, 0.545, 48);
		ringGlow.rotateX(Math.PI / 2);
		bc.at(M.shadeIn, ringGlow, tx, 1.895, tz);
		const lamp = new THREE.SpotLight(C('#ffc070'), 70, 6, 0.72, 0.35, 2);
		lamp.position.set(tx, 1.9, tz);
		lamp.target.position.set(tx, 0, tz);
		lamp.castShadow = true;
		lamp.shadow.mapSize.set(1024, 1024);
		lamp.shadow.bias = -0.0005;
		scene.add(lamp.target);
		cardLights.push(lamp);
		const blue = new THREE.SpotLight(C('#2a4cff'), 130, 12, 0.38, 0.3, 2);
		blue.position.set(R.x0 + 0.5, R.h - 0.1, R.z1 - 0.6);
		blue.target.position.set(tx, 0.9, tz);
		scene.add(blue.target);
		cardLights.push(blue);
		const violet = new THREE.SpotLight(C('#b030ff'), 120, 12, 0.38, 0.3, 2);
		violet.position.set(R.x0 + 0.5, R.h - 0.1, R.z0 + 0.6);
		violet.target.position.set(tx, 0.9, tz);
		scene.add(violet.target);
		cardLights.push(violet);
		bc.root.add(beam(blue, '#4a6aff', 0.34), beam(violet, '#c050ff', 0.32), beam(lamp, '#ffc080', 0.08));
		for (let i = 0; i < 4; i++) {
			const a = Math.PI * 0.25 + i * (Math.PI / 2);
			const sx = tx + Math.cos(a) * 1.25,
				sz = tz + Math.sin(a) * 1.25;
			seats.push({ pos: new THREE.Vector3(sx, 0, sz), yaw: Math.atan2(tx - sx, tz - sz), seatY: 0.46, zone: 'cards', table: new THREE.Vector3(tx, 0.76, tz) });
		}
		const cardFill = new THREE.PointLight(C('#5a3aff'), 4, 6, 2);
		cardFill.position.set(tx + 1.5, 2.6, R.z1 - 0.8);
		cardLights.push(cardFill);
	}

	// ---------- balcony (south) ----------
	{
		const Q = BALC;
		bb.aabb(M.stone, Q.x0, -0.4, HALL.z1 + 0.4, Q.x1, 0, Q.z1, true);
		bb.aabb(M.woodDark, -2.25, 0, HALL.z1 - 0.02, -2.1, 3.6, HALL.z1 + 0.42);
		bb.aabb(M.woodDark, 2.1, 0, HALL.z1 - 0.02, 2.25, 3.6, HALL.z1 + 0.42);
		bb.aabb(M.woodDark, -2.27, 3.5, HALL.z1 - 0.04, 2.27, 3.62, HALL.z1 + 0.44);
		// (a thin gold line round the opening, on the hall's face and on the balcony's)
		for (const fz of [HALL.z1 - 0.05, HALL.z1 + 0.44]) {
			for (const sx of [-2.27, 2.245]) bb.aabb(M.lineDim, sx, 0, fz, sx + 0.025, 3.62, fz + 0.012);
			bb.aabb(M.lineDim, -2.27, 3.6, fz, 2.27, 3.625, fz + 0.012);
		}
		const post = lathe([[0, 0], [0.05, 0], [0.05, 0.08], [0.028, 0.16], [0.05, 0.4], [0.03, 0.66], [0.05, 0.7], [0, 0.7]], 12);
		for (let x = Q.x0 + 0.8; x <= Q.x1 - 0.7; x += 0.62) bb.at(M.stoneDark, post, x, 0.1, Q.z1 - 0.25);
		bb.aabb(M.stoneDark, Q.x0, 0, Q.z1 - 0.4, Q.x1, 0.1, Q.z1 - 0.1, true);
		bb.aabb(M.stone, Q.x0, 0.8, Q.z1 - 0.36, Q.x1, 0.88, Q.z1 - 0.14, true);
		bb.collideBox(0, 0.6, Q.z1 - 0.25, Q.x1 - Q.x0, 1.2, 0.3); // the collider stays tall: you can't step over
		for (const sx of [Q.x0, Q.x1]) {
			bb.aabb(M.stoneDark, sx - 0.5, 0, HALL.z1 + 0.4, sx + 0.5, 4.2, Q.z1, true);
			bb.aabb(M.stone, sx - 0.42, 4.2, HALL.z1 + 0.5, sx + 0.42, 4.7, Q.z1 - 0.1);
			bb.aabb(M.stoneDark, sx - 0.3, 4.7, HALL.z1 + 0.6, sx + 0.3, 5.3, Q.z1 - 0.2);
		}
		bb.aabb(M.stoneDark, Q.x0 - 0.5, 3.6, HALL.z1 + 0.4, Q.x1 + 0.5, HALL.h, HALL.z1 + 0.8);
		// tall lit windows of the tower beside the doors (warm amber slots in the navy stone)
		for (const sx of [-4.4, 4.4]) bb.box(M.lantern, sx, 2.4, HALL.z1 + 0.81, 1.0, 3.2, 0.02);
		// a Deco lamp standard on the balustrade: a fluted post, a tiered glowing lantern, a gold pool of light
		const balLamp = glow('balLamp', '#ffc070', 2.6);
		for (const lx of [-4.6, 4.6]) {
			const lz = Q.z1 - 0.25;
			bb.cyl(M.stoneDark, lx, 0.94, lz, 0.14, 0.16, 0.12, 16);
			bb.at(M.lanternBand, fluted(0.045, 1.1, 8, 0.01, 24), lx, 1.0 + 0.55, lz);
			let yy = 2.1;
			for (const [r, h] of [[0.09, 0.14], [0.078, 0.13], [0.066, 0.12], [0.05, 0.09]] as [number, number][]) {
				bb.at(balLamp, new THREE.CylinderGeometry(r * 0.92, r, h, 8), lx, yy + h / 2, lz, Math.PI / 8);
				bb.at(M.line, new THREE.CylinderGeometry(r * 1.07, r * 1.07, 0.025, 8), lx, yy, lz, Math.PI / 8);
				yy += h;
			}
			bb.at(M.lanternBand, new THREE.ConeGeometry(0.035, 0.12, 8), lx, yy + 0.06, lz);
			const L = new THREE.PointLight(C('#ffb060'), 42, 8, 1.4);
			L.position.set(lx, 2.3, lz - 0.3);
			balcLights.push(L);
		}
		const moon = new THREE.SpotLight(C('#5a74ff'), 320, 40, 0.5, 0.6, 2);
		moon.position.set(-8, 16, 30);
		moon.target.position.set(0, 0, 12);
		scene.add(moon.target);
		balcLights.push(moon);
		const spill = new THREE.PointLight(C('#ff9a50'), 14, 6, 2);
		spill.position.set(0, 2.2, HALL.z1 + 1.0);
		balcLights.push(spill);
		for (const sx of [-4.4, 4.4]) {
			const w = new THREE.PointLight(C('#ff9040'), 4, 3.5, 2);
			w.position.set(sx, 2.4, HALL.z1 + 1.4);
			balcLights.push(w);
		}
	}

	const palms = [
		{ pos: new THREE.Vector3(8.6, 0, 8.4), yaw: 0.3, s: 1.25 },
		{ pos: new THREE.Vector3(-8.6, 0, 8.6), yaw: 2.0, s: 1.3 },
		{ pos: new THREE.Vector3(1.2, STAGE.top, -7.0), yaw: 0.6, s: 0.95 },
		{ pos: new THREE.Vector3(0.95, 0, 1.0), yaw: 2.6, s: 1.3 },
		{ pos: new THREE.Vector3(-6.2, 0, BALC.z0 + 1.4), yaw: 0.1, s: 1.2 },
		{ pos: new THREE.Vector3(R.x0 + 0.9, 0, 2.8), yaw: 0.5, s: 0.9 },
	];

	const barSpots = [
		{ pos: new THREE.Vector3(BAR.x0 + 1.6, 0, BAR.z + 0.9), yaw: Math.PI + 0.2 },
		{ pos: new THREE.Vector3(BAR.x0 + 2.4, 0, BAR.z + 1.0), yaw: Math.PI - 0.3 },
		{ pos: new THREE.Vector3(BAR.x1 - 0.9, 0, BAR.z + 0.95), yaw: Math.PI + 0.4 },
	];

	for (const { p, hex } of pools) {
		const g = new THREE.CircleGeometry(0.4, 48);
		g.rotateX(-Math.PI / 2);
		const m = new THREE.Mesh(g, tablePool(hex));
		m.position.copy(p);
		m.renderOrder = 9;
		b.root.add(m);
	}
	for (const p of cones) {
		const len = 2.6;
		const g = new THREE.CylinderGeometry(0.18, 1.05, len, 32, 8, true);
		g.translate(0, -len / 2, 0);
		const v = g.attributes.position;
		const along = new Float32Array(v.count);
		for (let i = 0; i < v.count; i++) along[i] = -v.getY(i) / len;
		g.setAttribute('along', new THREE.BufferAttribute(along, 1));
		const a = attribute('along', 'float');
		const facing = normalView.dot(positionViewDirection).abs();
		const m = new THREE.Mesh(g, additive('lanternCone', '#ffa050', 1, { opacityNode: smoothstep(0, 0.1, a).mul(float(1).sub(smoothstep(0.4, 1, a))).mul(facing.mul(facing)).mul(0.04) }));
		m.position.copy(p);
		m.renderOrder = 10;
		b.root.add(m);
	}
	b.root.add(marbleTops(tops));
	for (const L of [...lights, ...cardLights, ...balcLights]) scene.add(L);
	cardLights.push(hemi);
	balcLights.push(hemi);
	withLights(floorMat, lights);
	if (curtainMat) withLights(curtainMat, lights);
	const root = b.finish(lights);
	root.add(bc.finish(cardLights), bb.finish(balcLights));
	root.traverse((o) => {
		const m = (o as THREE.Mesh).material as THREE.Material | undefined;
		if (m && (m.name === 'stainedGlass' || m.name === 'bottles' || m.name === 'barMirror')) withLights(m, null);
		if (m && m.name === 'marble') withLights(m, lights);
	});
	scene.add(root);

	const zoneAt = (p: THREE.Vector3): Zone => (p.x < HALL.x0 - 0.2 ? 'cards' : p.z > HALL.z1 + 0.2 ? 'balcony' : 'hall');
	const pianoX = -6.0,
		pianoZ = -7.5;
	return {
		root,
		colliders: [...b.colliders, ...bc.colliders, ...bb.colliders],
		zoneLights: { hall: lights, cards: cardLights, balcony: balcLights },
		seats,
		barSpots,
		stage: {
			piano: new THREE.Vector3(pianoX, STAGE.top, pianoZ),
			pianoYaw: Math.PI / 2,
			bench: new THREE.Vector3(pianoX - 1.9, STAGE.top, pianoZ),
			sax: new THREE.Vector3(-2.3, STAGE.top, -6.75),
			saxYaw: -0.25,
			barman: new THREE.Vector3(BAR.x0 + 2.6, 0, BAR.back + 1.45),
		},
		spawn: { pos: new THREE.Vector3(2.9, 0, 2.3), yaw: 0.27, pitch: 0.02 },
		lights,
		spot,
		lamps,
		ashtrays,
		palms,
		stools,
		cardTable: new THREE.Vector3(tx, 0.76, tz),
		zoneAt,
		update(t: number) {
			void t;
		},
		floorReflect: { strength: reflStrength },
		ceiling: HALL.h,
	};
}

function mergeAll(list: THREE.BufferGeometry[]) {
	let count = 0;
	for (const g of list) count += g.attributes.position.count;
	const pos = new Float32Array(count * 3),
		nor = new Float32Array(count * 3),
		col = new Float32Array(count * 3);
	let o = 0;
	for (const g of list) {
		pos.set(g.attributes.position.array as Float32Array, o * 3);
		nor.set(g.attributes.normal.array as Float32Array, o * 3);
		col.set(g.attributes.color.array as Float32Array, o * 3);
		o += g.attributes.position.count;
	}
	const out = new THREE.BufferGeometry();
	out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
	out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
	out.setAttribute('color', new THREE.BufferAttribute(col, 3));
	out.computeBoundingSphere();
	return out;
}

function martini(b: Builder, x: number, y: number, z: number, liquid: THREE.Material, olive: THREE.Material) {
	const glass = glassMat();
	b.at(glass, lathe([[0, 0], [0.04, 0], [0.04, 0.004], [0.004, 0.01], [0.004, 0.1], [0.055, 0.17], [0.057, 0.172], [0, 0.11]], 20), x, y, z);
	b.at(liquid, lathe([[0, 0.105], [0.045, 0.16], [0, 0.16]], 20), x, y, z);
	b.at(olive, new THREE.SphereGeometry(0.009, 8, 6), x + 0.01, y + 0.135, z);
	b.noShadow.add(glass);
}

let _glass: THREE.Material | null = null;
function glassMat() {
	if (_glass) return _glass;
	_glass = additive('glass', '#ffcf98', 1, {opacityNode: smoothstep(0.52, 0.6, float(1).sub(abs(normalView.dot(positionViewDirection)))).mul(0.6).add(0.03) });
	return _glass;
}

/** A spot's beam in the haze: an open cone, brightest along the axis, fading toward its far end and its edges. */
function beam(L: THREE.SpotLight, hex: string, strength: number) {
	const len = L.position.distanceTo(L.target.position) * 1.02;
	const r = Math.tan(L.angle) * len;
	const g = new THREE.CylinderGeometry(0.1, r * 0.95, len, 48, 24, true);
	g.translate(0, -len / 2, 0);
	const v = g.attributes.position;
	const along = new Float32Array(v.count);
	for (let i = 0; i < v.count; i++) along[i] = -v.getY(i) / len;
	g.setAttribute('along', new THREE.BufferAttribute(along, 1));
	const a = attribute('along', 'float');
	const facing = normalView.dot(positionViewDirection).abs();
	const fade = smoothstep(0.0, 0.08, a).mul(float(1).sub(smoothstep(0.6, 1.0, a))).mul(facing.mul(facing));
	const m = additive(`beam-${hex}`, hex, 1, { opacityNode: fade.mul(strength).mul(mix(float(1.4), float(0.6), a)) });
	const mesh = new THREE.Mesh(g, m);
	mesh.position.copy(L.position);
	mesh.lookAt(L.target.position);
	mesh.rotateX(-Math.PI / 2);
	mesh.renderOrder = 10;
	return mesh;
}

/** A pleated (fluted) lamp shade: an open cone whose radius ripples around it. */
function pleated(rTop: number, rBot: number, h: number, n: number) {
	const g = new THREE.CylinderGeometry(rTop, rBot, h, n * 4, 1, true);
	const p = g.attributes.position;
	for (let i = 0; i < p.count; i++) {
		const x = p.getX(i),
			z = p.getZ(i);
		const r = Math.hypot(x, z);
		if (r < 1e-4) continue;
		const a = Math.atan2(z, x);
		const k = 1 + 0.06 * Math.abs(Math.cos((a * n) / 2));
		p.setX(i, x * k);
		p.setZ(i, z * k);
	}
	g.computeVertexNormals();
	return g;
}

let _pool: THREE.Material | null = null;
/** A crisp pool of lamplight on a tabletop: bright inside, a hard edge, unbanded light. */
function poolMat() {
	if (_pool) return _pool;
	const r = positionLocal.xz.length();
	const inside = float(1).sub(smoothstep(0.4, 0.43, r));
	_pool = additive('lampPool', '#ffb060', 1, { opacityNode: inside.mul(float(0.3).add(float(1).sub(r.div(0.43)).mul(0.25))) });
	return _pool;
}
