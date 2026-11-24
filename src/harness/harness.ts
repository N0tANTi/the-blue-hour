// Deterministic playtest harness (catalog: deterministic-playtest-harness).
//   window.__game        state hook + control API for bots (see GameHook below)
//   ?seed=N              seeded RNG (and Math.random)       ?clock=fixed   fixed 1/60 s frames
//   ?patch-test=1        self-checks printed as `pass <name>` / `fail <name>: why` (Patch's test format)
import * as THREE from 'three/webgpu';
import type { Action } from '../core/input';
import { time } from '../core/time';
import type { Game } from '../game';

export const CHECKS = ['boot', 'render', 'move', 'people', 'band', 'audio', 'no-errors'] as const;

export interface GameHook {
	version: string;
	ready: boolean;
	/** True while a bot drives frames with step(); the live loop then idles. */
	manual: boolean;
	state(): ReturnType<Game['state']>;
	/** Advance n frames at exactly 1/60 s each (pauses the live loop until play()). */
	step(n?: number): ReturnType<Game['state']>;
	play(): void;
	start(): void;
	press(a: Action): void;
	release(a: Action): void;
	releaseAll(): void;
	/** Radians; positive dx turns right, positive dy looks down. */
	look(dx: number, dy: number): void;
	/** Point the view at a world position. */
	aimAt(x: number, y: number, z: number): void;
	isFlat(): Promise<{ flat: boolean; spread: number }>;
	events(n?: number): Game['events'];
	checks: Record<string, string>;
	errors: string[];
	game: Game;
}

/** Install first thing: counts every error the page would show Patch's test runner. */
export function installErrorCapture(): string[] {
	const errors: string[] = [];
	addEventListener('error', (e) => errors.push(`error: ${e.message}`));
	addEventListener('unhandledrejection', (e) => errors.push(`unhandledrejection: ${String((e as PromiseRejectionEvent).reason)}`));
	const orig = console.error.bind(console);
	console.error = (...args: unknown[]) => {
		errors.push(args.map(String).join(' ').slice(0, 300));
		orig(...args);
	};
	return errors;
}

export function installHarness(game: Game): GameHook {
	const hook: GameHook = {
		version: '1',
		ready: false,
		manual: false,
		state: () => game.state(),
		step(n = 1) {
			hook.manual = true;
			const wasFixed = time.fixed;
			time.fixed = true;
			for (let i = 0; i < n; i++) game.frame();
			time.fixed = wasFixed;
			return game.state();
		},
		play() {
			hook.manual = false;
			time.resync();
		},
		start: () => game.start(),
		press: (a) => game.input.press(a),
		release: (a) => game.input.release(a),
		releaseAll: () => game.input.releaseAll(),
		look: (dx, dy) => game.input.virtualLook(dx, dy),
		aimAt(x, y, z) {
			const p = game.player;
			const eye = p.feet(1).add(new THREE.Vector3(0, p.eyeHeight(), 0));
			const d = new THREE.Vector3(x, y, z).sub(eye);
			p.yaw = Math.atan2(-d.x, -d.z);
			p.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
		},
		isFlat: () => game.path.isFlat(),
		events: (n = 50) => game.events.slice(-n),
		checks: {},
		errors: game.errors,
		game,
	};
	(window as unknown as { __game: GameHook }).__game = hook;
	return hook;
}

/** Runs the self-checks through the same input path a player uses, then resets the game. */
export async function runSelfChecks(game: Game, hook: GameHook) {
	const report = (name: string, ok: boolean, why = '') => {
		hook.checks[name] = ok ? 'pass' : `fail: ${why}`;
		console.log(ok ? `pass ${name}` : `fail ${name}: ${why}`);
	};
	const s = () => game.state();
	const phase = game.phase;
	game.phase = 'playing';
	game.input.enabled = true;
	try {
		report('boot', hook.ready, 'not ready');

		const flatP = hook.isFlat();
		hook.step(1);
		const flat = await flatP;
		report('render', !flat.flat, `frame is one flat colour (spread ${flat.spread})`);

		{
			const a = s().player!;
			hook.press('forward');
			hook.step(50);
			hook.release('forward');
			hook.step(10);
			const b = s().player!;
			const d = Math.hypot(b.x - a.x, b.z - a.z);
			report('move', d > 1, `moved ${d.toFixed(2)} m`);
		}

		{
			const n = game.people.count();
			const p = game.people.people.find((q) => q.role === 'patron');
			const bone = p?.bones.get('RightForeArm');
			const q0 = bone?.quaternion.clone();
			hook.step(45);
			const moved = !!(bone && q0 && bone.quaternion.angleTo(q0) > 0.0005);
			report('people', n >= 20 && moved, `people ${n}, animating ${moved}`);
		}

		{
			const sax = game.people.people.find((q) => q.role === 'sax');
			const hand = sax?.bones.get('LeftHand');
			const head = sax?.bones.get('Head');
			let ok = false,
				why = 'no sax player';
			if (hand && head) {
				const h = hand.getWorldPosition(new THREE.Vector3());
				const e = head.getWorldPosition(new THREE.Vector3());
				const d = h.distanceTo(e);
				ok = d > 0.15 && d < 0.6;
				why = `left hand ${d.toFixed(2)} m from the head`;
			}
			report('band', ok, why);
		}

		{
			const a = game.audio.status();
			report('audio', a.expected > 30, `audio files ${a.expected}`);
		}

		report('no-errors', game.errors.length === 0, game.errors.slice(0, 3).join(' | '));
	} catch (e) {
		console.log(`fail selftest: ${(e as Error).message}`);
	} finally {
		game.input.releaseAll();
		game.reset();
		game.phase = phase === 'loading' ? 'title' : phase;
		game.input.enabled = game.phase === 'playing';
		hook.play();
	}
}
