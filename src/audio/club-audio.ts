// The club's sound. Real recordings only (see CREDITS.md / ASSETS.md):
//  - the band: four 1923-24 public-domain 78s, streamed through <audio> elements, panned to the stage
//    (HRTF), with a room reverb send; muffled and lowered through the doors
//  - walla and room tone loops, applause between tunes
//  - glasses clinking at random tables (positional), the bar's ice and pours
//  - footsteps per surface: parquet, carpet (card room), stone (balcony, parquet takes pitched down)
// Bus: music / amb / sfx / steps -> compressor -> limiter-ish compressor -> out.
import * as THREE from 'three/webgpu';
import { Rng } from '../core/rng';
import type { Zone } from '../world/club';

const rng = new Rng(0x7a22);
const A = (id: string, ext: string) => new URL(`../assets/audio/${id}.${ext}`, import.meta.url).href;

export const SET = ['wild-cat-blues', 'bleeding-hearted-blues', 'spain', 'in-the-evening'] as const;
const SFX = [
	'ambience-walla',
	'ambience-roomtone',
	'applause-1',
	'applause-2',
	'glass-clink-1',
	'glass-clink-2',
	'glass-clink-3',
	'glass-clink-4',
	'ice-1',
	'ice-2',
	'pour-1',
	'glass-set-down-1',
	'glass-set-down-2',
	'glass-set-down-3',
	'lighter-1',
	'floor-creak-1',
	'floor-creak-2',
	...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => `step-wood-${i}`),
	...[1, 2, 3, 4, 5, 6].map((i) => `step-carpet-${i}`),
];

const STAGE = new THREE.Vector3(-4.2, 2.2, -8.4);
const BAR = new THREE.Vector3(7.4, 1.2, -9.4);

export class ClubAudio {
	ctx: AudioContext | null = null;
	private ext = 'ogg';
	private raw = new Map<string, ArrayBuffer>();
	private buf = new Map<string, AudioBuffer>();
	private out!: GainNode;
	private music!: GainNode;
	private musicFilter!: BiquadFilterNode;
	private amb!: GainNode;
	private ambFilter!: BiquadFilterNode;
	private sfx!: GainNode;
	private steps!: GainNode;
	private reverb!: ConvolverNode;
	private panner!: PannerNode;
	private analyser!: AnalyserNode;
	private tracks: HTMLAudioElement[] = [];
	track = -1;
	private trackNode: MediaElementAudioSourceNode[] = [];
	private nextClink = 3;
	private nextBar = 6;
	private stepIdx = 0;
	private level = new Float32Array(512);
	/** smoothed music loudness 0..1 (drives the band's swing) */
	energy = 0.5;
	steps_played = 0;
	sfx_played = 0;
	tables: THREE.Vector3[] = [];
	private unlocked = false;
	private walla: AudioBufferSourceNode | null = null;

	async load() {
		const probe = document.createElement('audio');
		this.ext = probe.canPlayType('audio/ogg; codecs=opus') ? 'ogg' : 'm4a';
		await Promise.all(
			SFX.map(async (id) => {
				const r = await fetch(A(id, this.ext));
				this.raw.set(id, await r.arrayBuffer());
			}),
		);
		for (const id of SET) {
			const el = new Audio();
			el.preload = id === SET[0] ? 'auto' : 'metadata';
			el.src = A(id, this.ext);
			el.crossOrigin = 'anonymous';
			this.tracks.push(el);
		}
	}

	unlock() {
		if (this.unlocked) return;
		this.unlocked = true;
		const ctx = new AudioContext({ latencyHint: 'interactive' });
		this.ctx = ctx;
		ctx.resume().catch(() => {});
		const comp = ctx.createDynamicsCompressor();
		comp.threshold.value = -18;
		comp.ratio.value = 3;
		comp.attack.value = 0.01;
		comp.release.value = 0.25;
		const lim = ctx.createDynamicsCompressor();
		lim.threshold.value = -2;
		lim.ratio.value = 20;
		lim.attack.value = 0.002;
		lim.release.value = 0.1;
		this.out = ctx.createGain();
		this.out.gain.value = 0.9;
		this.out.connect(comp).connect(lim).connect(ctx.destination);
		this.music = ctx.createGain();
		this.musicFilter = ctx.createBiquadFilter();
		this.musicFilter.type = 'lowpass';
		this.musicFilter.frequency.value = 18000;
		this.music.connect(this.musicFilter).connect(this.out);
		this.amb = ctx.createGain();
		this.ambFilter = ctx.createBiquadFilter();
		this.ambFilter.type = 'lowpass';
		this.ambFilter.frequency.value = 18000;
		this.amb.connect(this.ambFilter).connect(this.out);
		this.sfx = ctx.createGain();
		this.sfx.connect(this.out);
		this.steps = ctx.createGain();
		this.steps.gain.value = 0.5;
		this.steps.connect(this.out);
		this.reverb = ctx.createConvolver();
		this.reverb.buffer = this.impulse(2.3);
		const wet = ctx.createGain();
		wet.gain.value = 0.32;
		this.reverb.connect(wet).connect(this.out);
		this.panner = new PannerNode(ctx, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 7, rolloffFactor: 0.7, positionX: STAGE.x, positionY: STAGE.y, positionZ: STAGE.z });
		this.analyser = ctx.createAnalyser();
		this.analyser.fftSize = 512;
		const musicIn = ctx.createGain();
		musicIn.gain.value = 0.85;
		musicIn.connect(this.panner).connect(this.music);
		musicIn.connect(this.reverb);
		musicIn.connect(this.analyser);
		for (const el of this.tracks) {
			const n = ctx.createMediaElementSource(el);
			n.connect(musicIn);
			this.trackNode.push(n);
			el.addEventListener('ended', () => this.between());
		}
		for (const [id, raw] of this.raw) {
			ctx.decodeAudioData(raw.slice(0)).then(
				(b) => {
					this.buf.set(id, b);
					if (id === 'ambience-walla') this.startLoops();
				},
				() => {},
			);
		}
	}

	/** A warm room: decaying noise, darker as it decays. */
	private impulse(seconds: number) {
		const ctx = this.ctx as AudioContext;
		const n = Math.floor(ctx.sampleRate * seconds);
		const b = ctx.createBuffer(2, n, ctx.sampleRate);
		for (let ch = 0; ch < 2; ch++) {
			const d = b.getChannelData(ch);
			let lp = 0;
			for (let i = 0; i < n; i++) {
				const t = i / n;
				const k = 0.25 + 0.7 * t;
				lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
				d[i] = lp * (1 - t) ** 2.2 * (i < ctx.sampleRate * 0.012 ? i / (ctx.sampleRate * 0.012) : 1);
			}
		}
		return b;
	}

	private loopSrc(id: string, gain: number) {
		const ctx = this.ctx as AudioContext;
		const b = this.buf.get(id);
		if (!b) return null;
		const s = ctx.createBufferSource();
		s.buffer = b;
		s.loop = true;
		const g = ctx.createGain();
		g.gain.value = gain;
		s.connect(g).connect(this.amb);
		s.start(0, rng.next() * b.duration);
		return s;
	}

	private startLoops() {
		if (this.walla) return;
		this.walla = this.loopSrc('ambience-walla', 1.0);
		setTimeout(() => this.loopSrc('ambience-roomtone', 1.0), 300);
	}

	/** Sound the browser held back for want of a gesture (a start from a pad): resume it now. */
	wake() {
		this.ctx?.resume().catch(() => {});
		const el = this.tracks[this.track];
		if (el?.paused && !el.ended) el.play().catch(() => {});
	}

	startSet() {
		if (!this.ctx) return;
		this.play(0);
	}

	private play(i: number) {
		this.track = i % this.tracks.length;
		const el = this.tracks[this.track];
		el.currentTime = 0;
		el.play().catch(() => {});
		const nx = this.tracks[(this.track + 1) % this.tracks.length];
		nx.preload = 'auto';
	}

	/** Between tunes: applause, then the next number. */
	private between() {
		this.oneShot(rng.chance(0.5) ? 'applause-1' : 'applause-2', null, 0.8, 0.03);
		setTimeout(() => this.play(this.track + 1), 4200);
	}

	/** Seconds into the set (for the clock, later) */
	setTime() {
		if (this.track < 0) return 0;
		let t = 0;
		for (let i = 0; i < this.track; i++) t += this.tracks[i].duration || 0;
		return t + (this.tracks[this.track]?.currentTime ?? 0);
	}

	oneShot(id: string, at: THREE.Vector3 | null, volume = 1, pitchVar = 0.07, bus: 'sfx' | 'steps' = 'sfx') {
		const ctx = this.ctx;
		const b = this.buf.get(id);
		if (!ctx || !b) return;
		const s = ctx.createBufferSource();
		s.buffer = b;
		s.playbackRate.value = 1 + rng.spread(pitchVar);
		const g = ctx.createGain();
		g.gain.value = volume;
		let node: AudioNode = s.connect(g);
		if (at) {
			const p = new PannerNode(ctx, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1.5, rolloffFactor: 1.2, positionX: at.x, positionY: at.y, positionZ: at.z });
			node = node.connect(p);
			// distant events: darker
			const lp = ctx.createBiquadFilter();
			lp.type = 'lowpass';
			lp.frequency.value = 14000;
			node = node.connect(lp);
		}
		node.connect(bus === 'steps' ? this.steps : this.sfx);
		s.start();
		if (bus === 'sfx') this.sfx_played++;
	}

	step(surface: 'wood' | 'carpet' | 'stone', at: THREE.Vector3, speed: number) {
		if (!this.ctx) return;
		this.stepIdx = (this.stepIdx + 1 + rng.int(0, 2)) % 8;
		const v = 0.55 + Math.min(1, speed) * 0.45;
		if (surface === 'carpet') this.oneShot(`step-carpet-${(this.stepIdx % 6) + 1}`, null, v * 0.9, 0.07, 'steps');
		else if (surface === 'stone') {
			const id = `step-wood-${this.stepIdx + 1}`;
			const ctx = this.ctx;
			const b = this.buf.get(id);
			if (!b) return;
			const s = ctx.createBufferSource();
			s.buffer = b;
			s.playbackRate.value = 0.82 + rng.spread(0.05);
			const g = ctx.createGain();
			g.gain.value = v * 0.8;
			const hp = ctx.createBiquadFilter();
			hp.type = 'highshelf';
			hp.frequency.value = 3000;
			hp.gain.value = 3;
			s.connect(hp).connect(g).connect(this.steps);
			s.start();
		} else this.oneShot(`step-wood-${this.stepIdx + 1}`, null, v, 0.07, 'steps');
		this.steps_played++;
		void at;
	}

	update(camera: THREE.Camera, zone: Zone, dt: number) {
		const ctx = this.ctx;
		if (!ctx) return;
		const L = ctx.listener;
		const p = camera.position;
		const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
		const u = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
		const t = ctx.currentTime;
		if (L.positionX) {
			L.positionX.setTargetAtTime(p.x, t, 0.02);
			L.positionY.setTargetAtTime(p.y, t, 0.02);
			L.positionZ.setTargetAtTime(p.z, t, 0.02);
			L.forwardX.setTargetAtTime(f.x, t, 0.02);
			L.forwardY.setTargetAtTime(f.y, t, 0.02);
			L.forwardZ.setTargetAtTime(f.z, t, 0.02);
			L.upX.setTargetAtTime(u.x, t, 0.02);
			L.upY.setTargetAtTime(u.y, t, 0.02);
			L.upZ.setTargetAtTime(u.z, t, 0.02);
		}
		// zones: through a door the band and the room are muffled
		const inside = zone === 'hall';
		this.musicFilter.frequency.setTargetAtTime(inside ? 18000 : zone === 'cards' ? 1400 : 900, t, 0.3);
		this.music.gain.setTargetAtTime(inside ? 1 : zone === 'cards' ? 0.6 : 0.45, t, 0.3);
		this.ambFilter.frequency.setTargetAtTime(inside ? 18000 : 1100, t, 0.3);
		this.amb.gain.setTargetAtTime(inside ? 1 : 0.4, t, 0.3);
		// band energy
		this.analyser.getFloatTimeDomainData(this.level);
		let s = 0;
		for (let i = 0; i < this.level.length; i++) s += this.level[i] * this.level[i];
		const rms = Math.sqrt(s / this.level.length);
		this.energy += (Math.min(1, rms * 5) - this.energy) * Math.min(1, dt * 2);
		// room life: clinks at random tables, the bar's ice and pours
		this.nextClink -= dt;
		if (this.nextClink <= 0 && this.tables.length) {
			const at = rng.pick(this.tables);
			const id = rng.chance(0.7) ? `glass-clink-${rng.int(1, 4)}` : `glass-set-down-${rng.int(1, 3)}`;
			this.oneShot(id, at, 0.55);
			this.nextClink = 1.6 + rng.next() * 4.5;
		}
		this.nextBar -= dt;
		if (this.nextBar <= 0) {
			const id = rng.pick(['ice-1', 'ice-2', 'pour-1', 'glass-set-down-2']);
			this.oneShot(id, BAR, 0.6);
			this.nextBar = 7 + rng.next() * 9;
		}
	}

	status() {
		return {
			state: this.ctx?.state ?? 'locked',
			decoded: this.buf.size,
			expected: SFX.length,
			track: this.track,
			title: this.track >= 0 ? SET[this.track] : null,
			time: this.track >= 0 ? (this.tracks[this.track]?.currentTime ?? 0) : 0,
			steps: this.steps_played,
			sfx: this.sfx_played,
			energy: this.energy,
		};
	}
}
