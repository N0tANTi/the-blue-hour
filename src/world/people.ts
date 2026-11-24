// Everyone in the club: patrons in the booths, the card players, drinkers at the bar, the barman, a couple
// on the balcony, and the band. Six generated characters on one Mixamo skeleton, Mixamo clips (in-game use only).
// The band has no instrument clips, so the pianist's and saxophonist's arms are solved with two-bone IK
// onto the keys and the horn, over a sitting / standing idle, with a little swing in the spine.
import * as THREE from 'three/webgpu';
import { color, float, lights, mix, normalView, normalWorld, positionViewDirection, smoothstep, texture, vec3 } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { Rng } from '../core/rng';
import type { Club, Seat } from './club';
import type { Props } from './props';


type CharId = 'tux' | 'fedora' | 'trench' | 'gown_gloves' | 'gown_bob' | 'barman';
const IDS: CharId[] = ['tux', 'fedora', 'trench', 'gown_gloves', 'gown_bob', 'barman'];

interface Meta {
	id: string;
	heightM: number;
	seat: { seatSurfaceY: number; hipsY: number };
}

interface Template {
	scene: THREE.Object3D;
	clips: Map<string, THREE.AnimationClip>;
	meta: Meta;
}

interface Person {
	id: CharId;
	root: THREE.Object3D;
	mixer: THREE.AnimationMixer;
	actions: Map<string, THREE.AnimationAction>;
	current: string;
	pool: string[];
	next: number;
	role: 'patron' | 'pianist' | 'sax' | 'barman' | 'stand' | 'walker';
	head?: THREE.Bone;
	/** finger bones in the rig's rest pose (straight), for the band's clean hands */
	fingerRest?: Map<THREE.Bone, THREE.Quaternion>;
	bones: Map<string, THREE.Bone>;
	path?: THREE.CatmullRomCurve3;
	pathT?: number;
	pathLen?: number;
}

const _a = new THREE.Vector3(),
	_b = new THREE.Vector3(),
	_c = new THREE.Vector3(),
	_d = new THREE.Vector3(),
	_e = new THREE.Vector3(),
	_q = new THREE.Quaternion(),
	_q2 = new THREE.Quaternion(),
	_m = new THREE.Matrix4();

/** Rotate a bone in world space so its child direction `from` points along `to`. */
function aimBone(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3) {
	_q.setFromUnitVectors(from.clone().normalize(), to.clone().normalize());
	bone.getWorldQuaternion(_q2);
	_q2.premultiply(_q);
	const parent = bone.parent as THREE.Object3D;
	parent.getWorldQuaternion(_q);
	bone.quaternion.copy(_q.invert().multiply(_q2));
	bone.updateMatrixWorld(true);
}

/** Two-bone IK: upper/lower/end bones, a world target and a pole (where the elbow should point). */
function solveArm(upper: THREE.Bone, lower: THREE.Bone, end: THREE.Bone, target: THREE.Vector3, pole: THREE.Vector3) {
	upper.getWorldPosition(_a);
	lower.getWorldPosition(_b);
	end.getWorldPosition(_c);
	const l1 = _a.distanceTo(_b),
		l2 = _b.distanceTo(_c);
	const toT = _d.copy(target).sub(_a);
	const dist = THREE.MathUtils.clamp(toT.length(), 0.05, (l1 + l2) * 0.999);
	const dir = toT.normalize();
	const cosA = THREE.MathUtils.clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
	const sinA = Math.sqrt(1 - cosA * cosA);
	const pv = _e.copy(pole).sub(_a);
	pv.addScaledVector(dir, -pv.dot(dir)).normalize();
	const elbow = new THREE.Vector3().copy(_a).addScaledVector(dir, cosA * l1).addScaledVector(pv, sinA * l1);
	aimBone(upper, _b.clone().sub(_a), elbow.clone().sub(_a));
	lower.getWorldPosition(_b);
	end.getWorldPosition(_c);
	const tgt = _a.clone().addScaledVector(dir, dist);
	aimBone(lower, _c.clone().sub(_b), tgt.sub(_b));
}

export class People {
	readonly root = new THREE.Group();
	private templates = new Map<CharId, Template>();
	readonly people: Person[] = [];
	private rng = new Rng(1926);
	private t = 0;
	private sax: THREE.Object3D | null = null;
	private saxPlayer: Person | null = null;
	private pianist: Person | null = null;
	/** 0..1 how hard the band is swinging (the audio writes it from the music's loudness) */
	energy = 0.6;

	constructor(
		scene: THREE.Scene,
		private club: Club,
		private props: Props,
	) {
		scene.add(this.root);
	}

	async load(renderer: THREE.WebGPURenderer, progress: (p: number) => void) {
		void renderer;
		const loader = new GLTFLoader();
		loader.setMeshoptDecoder(MeshoptDecoder);
		let done = 0;
		await Promise.all(
			IDS.map(async (id) => {
				const base = new URL(`../assets/models/chars/${id}.glb`, import.meta.url).href;
				const metaUrl = new URL(`../assets/models/chars/${id}.meta.json`, import.meta.url).href;
				const [g, meta] = await Promise.all([loader.loadAsync(base), fetch(metaUrl).then((r) => r.json() as Promise<Meta>)]);
				const clips = new Map(g.animations.map((c) => [c.name, c] as const));
				this.toon(g.scene);
				this.templates.set(id, { scene: g.scene, clips, meta });
				progress(++done / IDS.length);
			}),
		);
		this.populate();
	}

	private toon(root: THREE.Object3D) {
		root.traverse((o) => {
			const m = o as THREE.SkinnedMesh;
			if (!m.isMesh) return;
			const old = m.material as THREE.MeshStandardMaterial;
			const map = old.map;
			if (map) {
				map.colorSpace = THREE.SRGBColorSpace;
				map.generateMipmaps = false;
				map.minFilter = THREE.LinearFilter;
				map.magFilter = THREE.LinearFilter;
			}

			m.castShadow = true;
			m.receiveShadow = true;
			m.frustumCulled = false;
		});
	}

	private spawn(id: CharId, role: Person['role'], pos: THREE.Vector3, yaw: number, pool: string[]): Person {
		const t = this.templates.get(id) as Template;
		const root = SkeletonUtils.clone(t.scene);
		root.position.copy(pos);
		root.rotation.y = yaw;
		const zone = this.club.zoneAt(pos);
		root.traverse((o) => {
			const m = o as THREE.SkinnedMesh;
			if (m.isMesh) m.material = this.charMat(id, (m.material as THREE.MeshStandardMaterial).map ?? null, zone);
		});
		// graphic proportions: a touch longer and slimmer, a smaller head
		root.scale.set(0.95, 1.04, 0.95);
		this.root.add(root);
		const mixer = new THREE.AnimationMixer(root);
		const actions = new Map<string, THREE.AnimationAction>();
		for (const name of new Set(pool)) {
			const clip = t.clips.get(name);
			if (!clip) continue;
			const a = mixer.clipAction(clip);
			actions.set(name, a);
		}
		const bones = new Map<string, THREE.Bone>();
		root.traverse((o) => {
			if ((o as THREE.Bone).isBone) bones.set(o.name.replace(/^mixamorig:?/, ''), o as THREE.Bone);
		});
		const first = pool[this.rng.int(0, pool.length - 1)];
		const a = actions.get(first) ?? [...actions.values()][0];
		a.play();
		a.time = this.rng.next() * a.getClip().duration;
		mixer.timeScale = 0.92 + this.rng.next() * 0.16;
		const fingerRest = new Map<THREE.Bone, THREE.Quaternion>();
		if (role === 'pianist' || role === 'sax') for (const [n, b] of bones) if (/Hand(Thumb|Index|Middle|Ring|Pinky)\d/.test(n)) fingerRest.set(b, b.quaternion.clone());
		const p: Person = { id, root, mixer, actions, current: first, pool, next: 6 + this.rng.next() * 14, role, bones, head: bones.get('Head'), fingerRest };
		this.people.push(p);
		return p;
	}

	private mats = new Map<string, THREE.Material>();
	/**
	 * The people's look: their flat texture with the darks pushed to ink (clothes, hair, hats go to one black),
	 * banded by the post like everything else, plus a crisp rim from the zone's key direction.
	 */
	private charMat(id: string, map: THREE.Texture | null, zone: 'hall' | 'cards' | 'balcony') {
		const k = `${id}:${zone}`;
		let m = this.mats.get(k);
		if (m) return m;
		const mat = new THREE.MeshLambertNodeMaterial();
		const KEY = {
			hall: { dir: new THREE.Vector3(-0.35, 0.35, -0.87).normalize(), col: '#ffb060', k: 1.3 },
			cards: { dir: new THREE.Vector3(0.0, 1.0, 0.0), col: '#b070ff', k: 1.5 },
			balcony: { dir: new THREE.Vector3(-0.3, 0.4, 0.87).normalize(), col: '#90a8ff', k: 1.2 },
		}[zone];
		if (map) {
			const c = texture(map).rgb;
			const l = c.dot(vec3(0.2126, 0.7152, 0.0722));
			const ink = color('#0b0807');
			// (in the hall the lit parts take a warm tan, so skin under a table lamp never goes pale)
						mat.colorNode = mix(ink, c.mul(zone === 'hall' ? vec3(0.74, 0.56, 0.44) : vec3(0.82)), smoothstep(0.12, 0.2, l));
		}
		const fres = float(1).sub(normalView.dot(positionViewDirection).abs());
		const side = smoothstep(-0.25, 0.35, normalWorld.dot(vec3(KEY.dir.x, KEY.dir.y, KEY.dir.z)));
		(mat as unknown as { emissiveNode: unknown }).emissiveNode = color(KEY.col).mul(smoothstep(0.62, 0.72, fres).mul(side).mul(KEY.k));
		mat.lightsNode = lights(this.club.zoneLights[zone]);
		mat.name = `char-${id}@${zone}`;
		this.mats.set(k, mat);
		return mat;
	}

	private seatAt(s: Seat, id: CharId, pool: string[]) {
		const t = this.templates.get(id) as Template;
		const pos = s.pos.clone();
		pos.y = s.seatY - t.meta.seat.seatSurfaceY * 1.04;
		return this.spawn(id, 'patron', pos, s.yaw, pool);
	}

	private populate() {
		const r = this.rng;
		const sitPool = ['sit_idle', 'sit_talk', 'sit_idle', 'sit_drink', 'sit_talk', 'sit_rub'];
		const patrons: CharId[] = ['tux', 'gown_bob', 'fedora', 'gown_gloves', 'tux', 'gown_bob', 'gown_gloves', 'fedora'];
		let k = 0;
		const hall = this.club.seats.filter((s) => s.zone === 'hall');
		// group the hall seats by table and fill each table with 1-3 people
		const byTable = new Map<string, Seat[]>();
		for (const s of hall) {
			const key = `${s.table.x.toFixed(1)},${s.table.z.toFixed(1)}`;
			(byTable.get(key) ?? byTable.set(key, []).get(key))?.push(s);
		}
		for (const seats of byTable.values()) {
			// the near table in the composed view: a woman in a strapless gown and a man in a tux, backs to us
			if (Math.hypot(seats[0].table.x - 2.3, seats[0].table.z + 0.5) < 0.1) {
				const sorted = [...seats].sort((a, b) => a.pos.x - b.pos.x);
				this.seatAt(sorted[0], 'tux', ['sit_idle', 'sit_drink', 'sit_idle']);
				this.seatAt(sorted[sorted.length - 1], 'gown_gloves', ['sit_idle', 'sit_talk', 'sit_idle']);
				continue;
			}
			const n = Math.min(seats.length, r.chance(0.15) ? 2 : 3);
			const start = r.int(0, seats.length - 1);
			for (let i = 0; i < n; i++) {
				const s = seats[(start + i) % seats.length];
				const id = patrons[k++ % patrons.length];
				const pool = [...sitPool];
				this.seatAt(s, id, pool);
			}
		}
		// card room: three players
		const cards = this.club.seats.filter((s) => s.zone === 'cards');
		const players: CharId[] = ['fedora', 'trench', 'tux'];
		for (let i = 0; i < 3; i++) this.seatAt(cards[i], players[i], ['sit_idle', 'sit_rub', 'sit_idle', 'sit_talk']);
		// standing at the bar
		const barPeople: [CharId, string[]][] = [
			['gown_gloves', ['drink', 'idle', 'look_away']],
			['fedora', ['idle', 'drink', 'look_around']],
			['gown_bob', ['look_away', 'idle', 'drink']],
		];
		this.club.barSpots.forEach((s, i) => this.spawn(barPeople[i][0], 'stand', s.pos, s.yaw, barPeople[i][1]));
		// barman
		this.spawn('barman', 'barman', this.club.stage.barman, -Math.PI / 2, ['idle', 'look_around', 'idle']);
		// balcony: a woman at the rail, a man in a trench coat by the pier
		this.spawn('gown_gloves', 'stand', new THREE.Vector3(0.5, 0, 14.25), 0.15, ['idle', 'look_away']); // at the rail, her back to us, the city ahead
		this.spawn('trench', 'stand', new THREE.Vector3(-3.6, 0, 14.2), -0.25, ['idle', 'look_around']);
		// a guest who walks the room
		const w = this.spawn('tux', 'walker', new THREE.Vector3(5, 0, 2), 0, ['walk']);
		w.path = new THREE.CatmullRomCurve3(
			[new THREE.Vector3(3.6, 0, -5.6), new THREE.Vector3(4.3, 0, -1.0), new THREE.Vector3(3.6, 0, 4.0), new THREE.Vector3(1.6, 0, 7.8), new THREE.Vector3(0.2, 0, 8.6), new THREE.Vector3(2.1, 0, 7.6), new THREE.Vector3(4.0, 0, 3.6), new THREE.Vector3(4.6, 0, -1.2), new THREE.Vector3(4.0, 0, -5.4)],
			true,
			'centripetal',
		);
		w.pathT = 0;
		w.pathLen = w.path.getLength();
		// the band
		const st = this.club.stage;
		const pt = this.templates.get('tux') as Template;
		const benchTop = st.bench.y + 0.52;
		this.pianist = this.spawn('tux', 'pianist', new THREE.Vector3(st.bench.x - 0.05, benchTop - pt.meta.seat.seatSurfaceY * 1.04, st.bench.z), Math.PI / 2, ['sit_idle']);
		this.saxPlayer = this.spawn('fedora', 'sax', st.sax, st.saxYaw, ['idle']);
		this.sax = this.props.sax.clone();
		this.root.add(this.sax);
	}

	count() {
		return this.people.length;
	}

	animating() {
		return this.people.filter((p) => p.mixer.time > 0).length;
	}

	update(dt: number, camera: THREE.Camera) {
		void camera;
		this.t += dt;
		for (const p of this.people) {
			p.next -= dt;
			if (p.next <= 0 && p.pool.length > 1) {
				const choices = p.pool.filter((n) => n !== p.current && p.actions.has(n));
				const n = choices[this.rng.int(0, choices.length - 1)];
				const from = p.actions.get(p.current) as THREE.AnimationAction;
				const to = p.actions.get(n) as THREE.AnimationAction;
				to.reset();
				to.time = this.rng.next() * to.getClip().duration * 0.5;
				to.play();
				from.crossFadeTo(to, 1.2, false);
				p.current = n;
				p.next = 8 + this.rng.next() * 16;
			}
			if (p.role === 'walker' && p.path && p.pathLen) {
				p.pathT = ((p.pathT as number) + (dt * 1.15) / p.pathLen) % 1;
				const at = p.path.getPointAt(p.pathT);
				const ahead = p.path.getPointAt((p.pathT + 0.01) % 1);
				p.root.position.copy(at);
				const yaw = Math.atan2(ahead.x - at.x, ahead.z - at.z);
				p.root.rotation.y = yaw;
			}
			p.mixer.update(dt);
			p.head?.scale.setScalar(0.9);
		}
		this.band();
	}

	/**
	 * The band, kept simple so nothing can flip. Arms are solved once onto the instrument (two-bone IK with a
	 * fixed pole), the hand is turned to a clean orientation, and the bone rotations are frozen. Each frame the
	 * clip pose is overwritten with the frozen arms; motion comes only from the spine and head, plus, for the
	 * pianist, a blend between a few pre-solved, nearby hand poses (a small dip and a slide). Fingers keep the
	 * clip's relaxed pose: no curl, no wrist offsets.
	 */
	private bandPoses: {
		pianist?: { rest: Map<THREE.Bone, THREE.Quaternion>; base: Map<THREE.Bone, THREE.Quaternion>; dip: Map<THREE.Bone, THREE.Quaternion>; left: Map<THREE.Bone, THREE.Quaternion>; right: Map<THREE.Bone, THREE.Quaternion> };
		sax?: { rest: Map<THREE.Bone, THREE.Quaternion>; hipsY: number; base: Map<THREE.Bone, THREE.Quaternion>; chest: THREE.Bone; offset: THREE.Matrix4 };
	} = {};

	private band() {
		const e = this.energy;
		const st = this.club.stage;
		const BPM = 104;
		const beat = (this.t * BPM) / 60;
		if (!this.bandPoses.pianist && this.pianist) this.freezePianist();
		if (!this.bandPoses.sax && this.saxPlayer && this.sax) this.freezeSax();
		const pn = this.pianist;
		const PP = this.bandPoses.pianist;
		if (pn && PP) {
			const B = pn.bones;
			for (const [bone, q] of PP.rest) bone.quaternion.copy(q);
			// hands: blend the frozen poses (slide drifts slowly along the keys, dip on each beat)
			const slide = Math.sin(this.t * 0.9) * 0.5 + Math.sin(this.t * 0.37) * 0.3; // -0.8..0.8
			const dip = Math.pow(Math.max(0, Math.sin((beat % 1) * Math.PI)), 3) * (0.6 + 0.4 * e); // a smooth press on each beat
			for (const [bone, q] of PP.base) {
				const side = slide >= 0 ? PP.right.get(bone) : PP.left.get(bone);
				bone.quaternion.copy(q);
				if (side) bone.quaternion.slerp(side, Math.abs(slide));
				const qd = PP.dip.get(bone);
				if (qd) bone.quaternion.slerp(qd, dip * 0.8);
			}
			// head and shoulders nod with the beat, the torso leans into the phrase
			const b8 = beat % 8;
			const lean = key(b8, [[0, 0.04], [2, 0.08], [4, 0.05], [6, 0.09], [8, 0.04]]);
			const sp = B.get('Spine2');
			if (sp) sp.rotation.x += lean * 0.5;
			const head = B.get('Head');
			if (head) head.rotation.x += 0.18 + bounce(beat) * 0.07 * e;
			const neck = B.get('Neck');
			if (neck) neck.rotation.y += Math.sin(this.t * 0.6) * 0.06;
		}
		const sx = this.saxPlayer;
		const SP = this.bandPoses.sax;
		if (sx && this.sax && SP) {
			const B = sx.bones;
			for (const [bone, q] of SP.rest) bone.quaternion.copy(q);
			for (const [bone, q] of SP.base) bone.quaternion.copy(q);
			const hp = B.get('Hips');
			if (hp) hp.position.y = SP.hipsY;
			// body only: sway on the beat, lean back on the long notes (the bell lifts with the chest)
			const b8 = beat % 8;
			const lean = key(b8, [[0, 0.0], [1.5, -0.04], [3, -0.13], [4.5, -0.1], [5.5, 0.03], [6.8, 0.09], [8, 0.0]]);
			const sway = Math.sin(beat * Math.PI) * 0.03;
			const sp = B.get('Spine');
			if (sp) {
				sp.rotation.x += lean * (0.5 + 0.6 * e);
				sp.rotation.z += sway * e;
			}
			const sp1 = B.get('Spine1');
			if (sp1) sp1.rotation.y += Math.sin(this.t * 0.45) * 0.05;
			const hips = B.get('Hips');
			if (hips) hips.position.y -= Math.abs(Math.sin(beat * Math.PI)) * 0.01 * e;
			sx.root.updateMatrixWorld(true);
			this.sax.matrixAutoUpdate = false;
			this.sax.matrix.multiplyMatrices(SP.chest.matrixWorld, SP.offset);
			this.sax.matrixWorld.copy(this.sax.matrix);
			this.sax.updateMatrixWorld(true);
		}
		void st;
	}

	/** Solve the arms of one person onto targets, turn the hands, and return the arm bones' local rotations. */
	private solveHold(p: Person, targets: { L: THREE.Vector3; R: THREE.Vector3; poleL: THREE.Vector3; poleR: THREE.Vector3; fingersL: THREE.Vector3; fingersR: THREE.Vector3; acrossL: THREE.Vector3; acrossR: THREE.Vector3; palmL: THREE.Vector3; palmR: THREE.Vector3; curl: number }) {
		const B = p.bones;
		const out = new Map<THREE.Bone, THREE.Quaternion>();
		for (const side of ['Left', 'Right'] as const) {
			const arm = B.get(`${side}Arm`),
				fore = B.get(`${side}ForeArm`),
				hand = B.get(`${side}Hand`);
			if (!arm || !fore || !hand) continue;
			const L = side === 'Left';
			solveArm(arm, fore, hand, L ? targets.L : targets.R, L ? targets.poleL : targets.poleR);
			orientHand(B, side, L ? targets.fingersL : targets.fingersR, L ? targets.acrossL : targets.acrossR);
			for (const b of [arm, fore, hand]) out.set(b, b.quaternion.clone());
			if (p.fingerRest) for (const [b, q] of p.fingerRest) if (b.name.includes(side)) b.quaternion.copy(q);
			curlFingers(B, side, L ? targets.palmL : targets.palmR, targets.curl);
			for (const [n, b] of B) if (n.startsWith(`${side}Hand`) && n !== `${side}Hand`) out.set(b, b.quaternion.clone());
		}
		return out;
	}

	private freezePianist() {
		const pn = this.pianist as Person;
		const st = this.club.stage;
		pn.root.updateMatrixWorld(true);
		// the pianist faces +x; keys run along z; the player's left is -z
		const kx = st.piano.x - 1.37 + 0.17,
			ky = st.piano.y + 0.745,
			kz = st.piano.z;
		const fwd = new THREE.Vector3(1, 0, 0);
		const right = new THREE.Vector3(0, 0, 1);
		const fingers = fwd.clone().add(new THREE.Vector3(0, -0.35, 0)).normalize();
		// every variant is solved from the same rest pose, so they differ only by the target
		const chain = ['LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand'].map((n) => pn.bones.get(n)).filter(Boolean) as THREE.Bone[];
		const rest = chain.map((b) => b.quaternion.clone());
		const make = (dz: number, dy: number) => {
			chain.forEach((b, i) => b.quaternion.copy(rest[i]));
			pn.root.updateMatrixWorld(true);
			return this.solveHold(pn, {
				L: new THREE.Vector3(kx, ky + dy, kz - 0.24 + dz),
				R: new THREE.Vector3(kx, ky + dy, kz + 0.2 + dz),
				poleL: new THREE.Vector3(kx - 0.6, ky - 0.5, kz - 0.75),
				poleR: new THREE.Vector3(kx - 0.6, ky - 0.5, kz + 0.75),
				fingersL: fingers,
				fingersR: fingers,
				acrossL: right.clone().negate(),
				acrossR: right,
				palmL: new THREE.Vector3(0, -1, 0),
				palmR: new THREE.Vector3(0, -1, 0),
				curl: 0.3,
			});
		};
		const base = make(0, 0);
		const pose = (m: Map<THREE.Bone, THREE.Quaternion>) => {
			// a variant is used only if it stays close to the base (a big jump would be a flip)
			for (const [b, q] of m) if (q.angleTo(base.get(b) as THREE.Quaternion) > 0.35) return base;
			return m;
		};
		const dip = pose(make(0, -0.008));
		const left = pose(make(-0.06, 0));
		const right2 = pose(make(0.06, 0));
		const restP = new Map<THREE.Bone, THREE.Quaternion>();
		for (const n of ['Spine2', 'Neck', 'Head']) {
			const bn = pn.bones.get(n);
			if (bn) restP.set(bn, bn.quaternion.clone());
		}
		this.bandPoses.pianist = { rest: restP, base, dip, left, right: right2 };
		// hold the clip on this frame: a looping clip would jump the shoulders at its wrap
		pn.mixer.timeScale = 0;
	}

	private freezeSax() {
		const sx = this.saxPlayer as Person;
		const sax = this.sax as THREE.Object3D;
		const B = sx.bones;
		const neck = B.get('Neck');
		if (neck) neck.rotation.x += 0.12;
		sx.root.updateMatrixWorld(true);
		const head = B.get('Head') as THREE.Bone;
		head.getWorldPosition(_a);
		const yaw = sx.root.rotation.y;
		const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
		const right = new THREE.Vector3(-fwd.z, 0, fwd.x); // the player's right hand side
		const mouth = _a.clone().addScaledVector(fwd, 0.13).add(new THREE.Vector3(0, 0.06, 0));
		const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.2, yaw + 0.3, 0.12, 'YXZ'));
		sax.quaternion.copy(q);
		const tip = new THREE.Vector3(0, 0.7, -0.129).applyQuaternion(q);
		sax.position.copy(mouth).sub(tip);
		sax.updateMatrixWorld(true);
		const upper = new THREE.Vector3(-0.035, 0.4, 0.02).applyMatrix4(sax.matrixWorld);
		const lower = new THREE.Vector3(-0.03, 0.2, 0.05).applyMatrix4(sax.matrixWorld);
		const down = new THREE.Vector3(0, -1, 0);
		const base = this.solveHold(sx, {
			L: upper.clone().addScaledVector(right, -0.085).addScaledVector(fwd, -0.03),
			R: lower.clone().addScaledVector(right, 0.085).addScaledVector(fwd, -0.03),
			poleL: upper.clone().addScaledVector(right, -0.5).add(new THREE.Vector3(0, -0.3, 0)).addScaledVector(fwd, 0.1),
			poleR: lower.clone().addScaledVector(right, 0.5).add(new THREE.Vector3(0, -0.2, 0)).addScaledVector(fwd, -0.15),
			// fingers wrap across the front of the horn, palms toward the body; index above pinky
			fingersL: fwd.clone().addScaledVector(right, 0.45).add(new THREE.Vector3(0, -0.35, 0)).normalize(),
			fingersR: fwd.clone().addScaledVector(right, -0.45).add(new THREE.Vector3(0, -0.35, 0)).normalize(),
			acrossL: down,
			acrossR: down,
			palmL: right.clone(),
			palmR: right.clone().negate(),
			curl: 0.75,
		});
		if (neck) base.set(neck, neck.quaternion.clone());
		base.set(head, head.quaternion.clone());
		const chest = (B.get('Spine2') ?? B.get('Spine1')) as THREE.Bone;
		chest.updateMatrixWorld(true);
		const offset = new THREE.Matrix4().copy(chest.matrixWorld).invert().multiply(sax.matrixWorld);
		const restS = new Map<THREE.Bone, THREE.Quaternion>();
		for (const n of ['Spine', 'Spine1']) {
			const bn = B.get(n);
			if (bn) restS.set(bn, bn.quaternion.clone());
		}
		this.bandPoses.sax = { rest: restS, hipsY: (B.get('Hips') as THREE.Bone).position.y, base, chest, offset };
		sx.mixer.timeScale = 0;
	}
}

/**
 * Curl each finger toward the palm by a fixed amount, joint by joint, in world space: each joint turns about
 * the axis perpendicular to its own bone and the palm direction, so the bend can never twist sideways.
 */
function curlFingers(B: Map<string, THREE.Bone>, side: 'Left' | 'Right', palm: THREE.Vector3, k: number) {
	const per = [0.55, 0.75, 0.55];
	for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) {
		for (let j = 1; j <= 3; j++) {
			const b = B.get(`${side}Hand${f}${j}`);
			const c = B.get(`${side}Hand${f}${j + 1}`) ?? b?.children[0];
			if (!b || !c) continue;
			b.updateMatrixWorld(true);
			const p0 = b.getWorldPosition(new THREE.Vector3());
			const dir = (c as THREE.Object3D).getWorldPosition(new THREE.Vector3()).sub(p0).normalize();
			const axis = new THREE.Vector3().crossVectors(dir, palm).normalize();
			if (axis.lengthSq() < 1e-6) continue;
			const ang = per[j - 1] * k * (f === 'Thumb' ? 0.4 : 1);
			const R = new THREE.Quaternion().setFromAxisAngle(axis, ang);
			const wq = b.getWorldQuaternion(new THREE.Quaternion()).premultiply(R);
			const pq = (b.parent as THREE.Object3D).getWorldQuaternion(new THREE.Quaternion());
			b.quaternion.copy(pq.invert().multiply(wq));
			b.updateMatrixWorld(true);
		}
	}
}

/**
 * Turn a hand (in world space) so its fingers point along `fingers` and its index-to-pinky line runs along
 * `across`, measured from the rig's own finger bones; then store it as a local rotation.
 */
function orientHand(B: Map<string, THREE.Bone>, side: 'Left' | 'Right', fingers: THREE.Vector3, across: THREE.Vector3) {
	const hand = B.get(`${side}Hand`);
	const mid = B.get(`${side}HandMiddle1`);
	const idx = B.get(`${side}HandIndex1`);
	const pky = B.get(`${side}HandPinky1`);
	if (!hand || !mid || !idx || !pky) return;
	hand.updateMatrixWorld(true);
	const h = hand.getWorldPosition(new THREE.Vector3());
	const f = mid.getWorldPosition(new THREE.Vector3()).sub(h).normalize();
	const a = pky.getWorldPosition(new THREE.Vector3()).sub(idx.getWorldPosition(new THREE.Vector3()));
	a.addScaledVector(f, -a.dot(f)).normalize();
	const basis = (x: THREE.Vector3, y: THREE.Vector3) => new THREE.Matrix4().makeBasis(x, y, new THREE.Vector3().crossVectors(x, y));
	const f2 = fingers.clone().normalize();
	const a2 = across.clone().addScaledVector(f2, -across.dot(f2)).normalize();
	const R = new THREE.Quaternion().setFromRotationMatrix(basis(f2, a2).multiply(basis(f, a).invert()));
	const wq = hand.getWorldQuaternion(new THREE.Quaternion()).premultiply(R);
	const pq = (hand.parent as THREE.Object3D).getWorldQuaternion(new THREE.Quaternion());
	hand.quaternion.copy(pq.invert().multiply(wq));
	hand.updateMatrixWorld(true);
}

/** Pose-to-pose: value at time t from [time, value] keys, eased (smootherstep) between neighbours. */
function key(t: number, keys: [number, number][]) {
	for (let i = 1; i < keys.length; i++) {
		if (t <= keys[i][0]) {
			const [t0, v0] = keys[i - 1];
			const [t1, v1] = keys[i];
			const u = Math.min(1, Math.max(0, (t - t0) / Math.max(1e-6, t1 - t0)));
			const s = u * u * u * (u * (u * 6 - 15) + 10);
			return v0 + (v1 - v0) * s;
		}
	}
	return keys[keys.length - 1][1];
}

/** 0..1 bounce peaking on each beat. */
function bounce(beat: number) {
	const f = beat % 1;
	return Math.exp(-f * 6);
}


void _m;
