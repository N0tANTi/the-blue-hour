// The game object: scene, look pipeline, club, people, sound, player, and one frame.
import * as THREE from 'three/webgpu';
import { ClubAudio } from './audio/club-audio';
import { config } from './config';
import { Input } from './core/input';
import { PadHints } from './core/padhints';
import { time } from './core/time';
import { GAME } from './game.config';
import { damp } from './juice/spring';
import { initPhysics, Physics, RAPIER } from './physics/physics';
import { FPSController } from './player/controller';
import { createPipeline, type LookParams, type Pipeline } from './render/pipeline';
import { Hud } from './ui/hud';
import { buildClub, CARDS, type Club, HALL, type Zone } from './world/club';
import { People } from './world/people';
import { loadProps } from './world/props';
import { FX } from './world/fx';
import { City } from './world/city';
import { CITY_LOOK, ZONE_LOOKS } from './world/looks';

export type Phase = 'loading' | 'title' | 'playing' | 'paused';

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export interface GameEvent {
	t: number;
	type: string;
	[k: string]: unknown;
}

export class Game {
	phase: Phase = 'loading';
	readonly scene = new THREE.Scene();
	readonly camera = new THREE.PerspectiveCamera(GAME.fov, innerWidth / innerHeight, 0.1, 1700);
	readonly input: Input;
	readonly hud = new Hud();
	readonly audio = new ClubAudio();
	readonly events: GameEvent[] = [];
	path!: Pipeline;
	physics!: Physics;
	club!: Club;
	people!: People;
	fx!: FX;
	city!: City;
	player!: FPSController;
	readonly marks: Record<string, number> = {};
	frameTimes = new Float32Array(600);
	cpuTimes = new Float32Array(600);
	frameCursor = 0;
	frames = 0;
	errors: string[] = [];
	zone: Zone = 'hall';
	/** zone blend weights for the look */
	private zoneW: Record<Zone, number> = { hall: 1, cards: 0, balcony: 0 };
	private titleT = 0;
	private wasLocked = false;
	private padHints: PadHints | null = null;
	private tmp = new THREE.Vector3();
	/** Optional fixed camera (screenshots); when set the player camera is not applied. */
	shotCam: { pos: THREE.Vector3; target: THREE.Vector3; fov: number } | null = null;

	constructor(readonly canvas: HTMLCanvasElement) {
		this.input = new Input(canvas);
		this.camera.rotation.order = 'YXZ';
		this.scene.add(this.camera);
		this.scene.background = new THREE.Color(0x000000);
	}

	mark(name: string) {
		this.marks[name] = Math.round(performance.now());
	}

	async boot() {
		this.mark('boot');
		this.hud.progress('Lighting the room', 0.1);
		this.path = await createPipeline(this.canvas, this.scene, this.camera, config.renderer === 'webgl2' || config.renderer === 'webgl');
		// each pixel takes the look of the place it is in, whichever room the camera is in: the hall and the card room
		// by their walls (the edges fall inside the walls' 40 cm), the night outside for everything else
		this.path.placeLooks = [ZONE_LOOKS.hall, ZONE_LOOKS.cards, ZONE_LOOKS.balcony, CITY_LOOK];
		this.path.setRooms(
			// the hall's box reaches west past the stage's wing; the card room's box wins where they overlap
			{ min: [HALL.x0 - 1.5, -1, HALL.z0 - 0.6], max: [HALL.x1 + 0.6, HALL.h + 0.6, HALL.z1 + 0.2] },
			{ min: [CARDS.x0 - 0.6, -1, CARDS.z0 - 0.6], max: [CARDS.x1 - 0.2, CARDS.h + 0.6, CARDS.z1 + 0.6] },
		);
		this.mark('renderer');
		this.resize();
		new ResizeObserver(() => this.resize()).observe(this.canvas);

		this.hud.progress('Setting the tables', 0.25);
		await initPhysics();
		this.physics = new Physics(-9.81);
		this.club = buildClub(this.scene);
		this.city = new City(this.scene);
		this.fx = new FX(this.scene, this.club);
		this.audio.tables = this.club.lamps;
		for (const c of this.club.colliders) {
			if (c.kind === 'box') {
				const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.rotY);
				this.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(c.h.x, c.h.y, c.h.z).setTranslation(c.c.x, c.c.y, c.c.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
			} else {
				this.physics.world.createCollider(RAPIER.ColliderDesc.cylinder(c.hh, c.r).setTranslation(c.c.x, c.c.y, c.c.z));
			}
		}
		this.player = new FPSController(this.physics, this.club.spawn.pos);
		this.player.yaw = this.club.spawn.yaw;
		this.player.pitch = this.club.spawn.pitch;
		this.mark('club');

		this.hud.progress('Seating the guests', 0.4);
		const [props] = await Promise.all([loadProps(this.path.renderer), this.audio.load()]);
		this.people = new People(this.scene, this.club, props);
		await this.people.load(this.path.renderer, (p) => this.hud.progress('Seating the guests', 0.4 + p * 0.3));
		props.place(this.scene, this.club, this.physics);
		this.mark('people');
		this.wireEvents();

		this.hud.progress('Warming the band up', 0.75);
		this.placeTitleCamera(0);
		// compile in small batches with a frame between them, so no single main-thread block runs long
		const meshes: THREE.Object3D[] = [];
		this.scene.traverse((o) => {
			if ((o as THREE.Mesh).isMesh) meshes.push(o);
		});
		let last = performance.now();
		for (let i = 0; i < meshes.length; i += 24) {
			await Promise.all(meshes.slice(i, i + 24).map((m) => this.path.renderer.compileAsync(m, this.camera, this.scene)));
			if (performance.now() - last > 30) {
				await nextFrame();
				last = performance.now();
				this.hud.progress('Warming the band up', 0.75 + (0.2 * i) / meshes.length);
			}
		}
		this.mark('compiledMeshes');
		await nextFrame();
		this.path.render();
		this.mark('post');
		await nextFrame();
		await this.warmup();
		this.mark('compiled');

		this.phase = 'title';
		this.hud.ready(config.patchTest ? 'Self-test running' : 'Click to enter');
		this.padHints = new PadHints(this.input)
			.add(config.patchTest ? null : this.hud.veilPlay, 'Press {A} to enter')
			.add(document.querySelector('#veil .howto'), '<b>Left stick</b> walk &nbsp; <b>Right stick</b> look &nbsp; <b>{LS}</b> walk faster &nbsp; <b>{Start}</b> pause')
			.add(document.getElementById('hint'), 'Left stick walk &nbsp;·&nbsp; Right stick look &nbsp;·&nbsp; {LS} walk faster &nbsp;·&nbsp; {Start} pause')
			.add(this.hud.pause, 'Paused &nbsp;·&nbsp; {Start} to return');
		this.input.onLockChange = (locked) => this.onLock(locked);
		this.input.onLockError = () => this.events.push({ t: time.elapsed, type: 'lock-refused' });
		this.hud.veil.addEventListener('click', () => this.start());
		this.hud.pause.addEventListener('click', () => this.resume());
		this.canvas.addEventListener('click', () => {
			if (this.phase === 'playing' && !this.input.locked) this.input.requestLock();
		});
		addEventListener('keydown', (e) => {
			if (this.phase === 'title' && (e.code === 'Enter' || e.code === 'Space')) this.start();
			if (config.debug && e.code === 'F4') this.path.debugView.value = (this.path.debugView.value + 1) % 5;
		});
		if (config.debug) document.body.classList.add('debug');
	}

	/** Render the three zones once each with culling off so every pipeline compiles behind the veil. */
	private async warmup() {
		// shaders are compiled already; these renders only build the shadow/reflection passes per zone, so they
		// run at a small size with culling left on
		const saved: THREE.Object3D[] = [];

		const views: [number, number, number, number, number, number][] = [
			[-9.8, 1.62, 0.2, -13.2, 1.1, 0],
			[-1.2, 1.65, 10.8, -6, 4.5, 60],
		];
		for (const v of views) {
			this.camera.position.set(v[0], v[1], v[2]);
			this.camera.lookAt(v[3], v[4], v[5]);
			this.camera.updateMatrixWorld();
			this.people.update(0.016, this.camera);
			// no frame wait: the GPU process finishes compiling behind the title screen instead of blocking load
			this.path.render();
		}
		for (const o of saved) o.frustumCulled = true;
	}

	resize() {
		if (!this.path) return;
		const w = this.canvas.clientWidth || innerWidth,
			h = this.canvas.clientHeight || innerHeight;
		const pr = Math.min(devicePixelRatio || 1, config.quality === 'low' ? 0.75 : config.quality === 'medium' ? 1 : 1.25);
		this.path.setSize(w, h, pr);
		this.camera.aspect = w / h;
		this.camera.updateProjectionMatrix();
	}

	start() {
		if (this.phase !== 'title') return;
		this.audio.unlock();
		this.audio.startSet();
		this.input.requestLock();
		this.canvas.focus();
		this.phase = 'playing';
		this.input.enabled = true;
		this.input.flushLook();
		this.hud.hideVeil();
		time.resync();
		this.mark('play');
		this.events.push({ t: time.elapsed, type: 'start' });
	}

	private onLock(locked: boolean) {
		if (locked) {
			this.wasLocked = true;
			this.input.flushLook();
			if (this.phase === 'paused') this.resume();
		} else if (this.wasLocked && this.phase === 'playing') this.pause();
	}

	/** Pausing is the game's, not only the pointer lock's: a pad has no lock to lose. */
	pause() {
		if (this.phase !== 'playing') return;
		this.phase = 'paused';
		this.input.enabled = false;
		this.input.releaseAll();
		this.hud.showPause(true);
		this.input.exitLock();
	}

	/** A pad alone can start, pause and resume: A or Start on the title and the pause card, Start while playing. */
	private padMenu() {
		this.padHints?.update();
		const i = this.input;
		if (this.phase === 'title' && i.padPressed(0, 9)) {
			this.start();
			// a pad press may not count as a gesture, so the band could be held back: the first click or key lets it play
			for (const ev of ['pointerdown', 'keydown'] as const) addEventListener(ev, () => this.audio.wake(), { once: true, capture: true });
		} else if (this.phase === 'paused' && i.padPressed(0, 9)) this.resume();
		else if (this.phase === 'playing' && i.padPressed(9)) this.pause();
	}

	resume() {
		if (this.phase !== 'paused') return;
		this.phase = 'playing';
		this.input.enabled = true;
		this.hud.showPause(false);
		this.input.requestLock();
		time.resync();
	}

	reset() {
		this.player.teleport(this.club.spawn.pos, this.club.spawn.yaw, this.club.spawn.pitch);
	}

	private wireEvents() {
		this.player.on((e) => {
			if (e.type === 'step') {
				const f = this.player.feet(1);
				this.audio.step(this.surfaceAt(f), f, this.player.speed() / this.player.cfg.walkSpeed);
				this.events.push({ t: time.elapsed, type: 'step' });
			} else if (e.type === 'land') {
				if (e.speed > 2) this.audio.step(this.surfaceAt(this.player.feet(1)), this.player.feet(1), 1.4);
			}
		});
	}

	surfaceAt(p: THREE.Vector3): 'wood' | 'carpet' | 'stone' {
		const z = this.club.zoneAt(p);
		return z === 'cards' ? 'carpet' : z === 'balcony' ? 'stone' : 'wood';
	}

	frame() {
		const t0 = performance.now();
		time.tick();
		const realDt = time.realDt;
		const dt = time.dt;
		this.input.update();
		this.padMenu();

		if (this.phase === 'playing') {
			const look = this.input.look(realDt);
			this.player.frame(this.input, look);
			this.physics.update(dt, (h) => this.player.fixed(h, this.input));
			this.placePlayerCamera(realDt);
		} else {
			this.input.look(realDt);
			if (this.phase === 'title') {
				this.titleT += realDt;
				this.placeTitleCamera(this.titleT);
			}
		}
		if (this.shotCam) {
			this.camera.position.copy(this.shotCam.pos);
			this.camera.lookAt(this.shotCam.target);
			this.camera.fov = this.shotCam.fov;
			this.camera.updateProjectionMatrix();
		}
		this.camera.updateMatrixWorld();
		this.zone = this.club.zoneAt(this.camera.position);
		this.blendLook(realDt);
		this.people.update(dt, this.camera);
		this.fx.update(time.elapsed, dt);
		this.fx.face(this.camera);
		this.people.energy = 0.35 + this.audio.energy * 0.9;
		this.city.update(time.elapsed);
		this.club.update(time.elapsed);
		this.audio.update(this.camera, this.zone, dt);
		this.hud.update(realDt);
		this.path.render();
		this.frames++;
		const ms = performance.now() - t0;
		this.cpuTimes[this.frameCursor % this.cpuTimes.length] = ms;
		this.frameTimes[this.frameCursor++ % this.frameTimes.length] = realDt * 1000;
		if (config.debug && this.frames % 15 === 0) this.debugText(ms);
	}

	/**
	 * The part of the look that is one setting for the whole picture (the banding, the dark foreground, the glow's
	 * reach) follows the zone the camera is in; the colour key is per pixel, by place (see `placeLooks`).
	 */
	private blendLook(realDt: number) {
		for (const z of ['hall', 'cards', 'balcony'] as Zone[]) this.zoneW[z] = damp(this.zoneW[z], z === this.zone ? 1 : 0, 3, this.frames < 3 ? 1000 : realDt);
		const L = this.path.look as unknown as Record<string, number | number[]>;
		const sum = this.zoneW.hall + this.zoneW.cards + this.zoneW.balcony;
		for (const key of Object.keys(ZONE_LOOKS.hall) as (keyof LookParams)[]) {
			const a = ZONE_LOOKS.hall[key],
				b = ZONE_LOOKS.cards[key],
				c = ZONE_LOOKS.balcony[key];
			if (typeof a === 'number') L[key] = (a * this.zoneW.hall + (b as number) * this.zoneW.cards + (c as number) * this.zoneW.balcony) / sum;
			else if (Array.isArray(a)) L[key] = a.map((v, i) => (v * this.zoneW.hall + (b as number[])[i] * this.zoneW.cards + (c as number[])[i] * this.zoneW.balcony) / sum);
		}
	}

	private placePlayerCamera(realDt: number) {
		const p = this.player;
		const feet = p.feet(this.physics?.alpha ?? 1, this.tmp);
		const cam = this.camera;
		cam.position.set(feet.x, feet.y + p.eyeHeight(), feet.z);
		const bob = p.grounded ? Math.min(1, p.speed() / p.cfg.walkSpeed) * (config.reduceMotion ? 0.3 : 1) : 0;
		cam.position.y += Math.abs(Math.sin((p.stride * Math.PI) / 1.6)) * 0.018 * bob;
		cam.rotation.set(p.pitch, p.yaw, Math.sin((p.stride * Math.PI) / 1.6) * 0.002 * bob);
		cam.fov = damp(cam.fov, GAME.fov, 6, realDt);
		cam.updateProjectionMatrix();
	}

	private placeTitleCamera(t: number) {
		const s = this.club.spawn.pos;
		const a = Math.sin(t * 0.08) * 0.12;
		this.camera.position.set(s.x + 0.3 + Math.sin(t * 0.05) * 0.4, 1.75, s.z + 0.9);
		this.camera.rotation.set(0.03, this.club.spawn.yaw + a, 0);
		this.camera.fov = GAME.fov - 6;
		this.camera.updateProjectionMatrix();
	}

	private debugText(cpuMs: number) {
		const s = this.path.stats();
		const ft = this.perf();
		const p = this.camera.position;
		this.hud.debug.textContent = `${this.path.backend}\nfps ${ft.fps.toFixed(0)}  p95 ${ft.p95.toFixed(1)} ms\ncpu ${cpuMs.toFixed(2)} ms\ncalls ${s.calls}  tris ${s.triangles}\nzone ${this.zone}\npos ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}`;
	}

	perf() {
		const n = Math.min(this.frames, this.frameTimes.length);
		const arr = Array.from(this.frameTimes.subarray(0, n)).sort((a, b) => a - b);
		const avg = arr.reduce((a, b) => a + b, 0) / Math.max(1, n);
		const cpu = Array.from(this.cpuTimes.subarray(0, n)).sort((a, b) => a - b);
		return {
			fps: avg > 0 ? 1000 / avg : 0,
			p95: arr[Math.floor(n * 0.95)] ?? 0,
			cpuAvg: cpu.reduce((a, b) => a + b, 0) / Math.max(1, n),
			cpuP95: cpu[Math.floor(n * 0.95)] ?? 0,
		};
	}

	state() {
		const p = this.player;
		const f = p ? p.feet(1) : null;
		return {
			phase: this.phase,
			zone: this.zone,
			backend: this.path?.backend,
			frames: this.frames,
			player: f && { x: f.x, y: f.y, z: f.z, yaw: p.yaw, pitch: p.pitch, grounded: p.grounded, speed: p.speed() },
			people: this.people?.count() ?? 0,
			animating: this.people?.animating() ?? 0,
			audio: this.audio.status(),
			perf: this.perf(),
			marks: this.marks,
		};
	}
}
