// Keyboard, mouse (pointer lock), and gamepad (standard mapping) mapped to actions.
// Also accepts virtual input from the harness/bot (press/release/look) so tests use the same path.
import { GAME } from '../game.config';

export type Action = 'forward' | 'back' | 'left' | 'right' | 'jump' | 'crouch' | 'sprint' | 'fire' | 'aim' | 'reload' | 'interact' | 'pause';

const KEYS: Record<Action, string[]> = {
	forward: ['KeyW', 'ArrowUp'],
	back: ['KeyS', 'ArrowDown'],
	left: ['KeyA', 'ArrowLeft'],
	right: ['KeyD', 'ArrowRight'],
	jump: ['Space'],
	crouch: ['KeyC', 'KeyX'],
	sprint: ['ShiftLeft', 'ShiftRight'],
	fire: [],
	aim: [],
	reload: ['KeyR'],
	interact: ['KeyE', 'KeyF'],
	pause: ['Escape', 'KeyP'],
};
const MOUSE: Partial<Record<Action, number>> = { fire: 0, aim: 2 };
// Standard gamepad mapping: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 Back, 9 Start, 10 L3, 11 R3
const PAD: Partial<Record<Action, number[]>> = {
	jump: [0],
	crouch: [1, 11],
	reload: [2],
	interact: [3],
	aim: [6],
	fire: [7, 5],
	sprint: [10],
	pause: [9],
};
const ACTIONS = Object.keys(KEYS) as Action[];
/** Keys whose browser default (scrolling, find, ...) we suppress while playing. */
const SWALLOW = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Slash', 'Quote']);

/** Whose face-button names a pad wears, from its id (vendor 045e is Microsoft, 054c Sony). */
export type PadKind = 'xbox' | 'ps' | 'generic';
function padKindOf(id: string): PadKind {
	const s = id.toLowerCase();
	if (/045e|xbox|xinput/.test(s)) return 'xbox';
	if (/054c|playstation|dualshock|dualsense/.test(s)) return 'ps';
	return 'generic';
}
/** Standard-layout buttons by index, as hints name them: {A}, {Start}, {LT}... */
const BUTTONS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'LS', 'RS'] as const;
export type PadButton = (typeof BUTTONS)[number];
const LABELS: Record<PadKind, string[]> = {
	xbox: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS'],
	ps: ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Share', 'Options', 'L3', 'R3'],
	generic: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'LS', 'RS'],
};

function deadzone(x: number, y: number, dz = 0.15, curve = 1.6): [number, number] {
	const m = Math.hypot(x, y);
	if (m < dz) return [0, 0];
	const s = Math.min(1, (m - dz) / (1 - dz)) ** curve / m;
	return [x * s, y * s];
}

const loadNum = (k: string, d: number) => {
	try {
		const v = Number(localStorage.getItem(k));
		return Number.isFinite(v) && v > 0 ? v : d;
	} catch {
		return d;
	}
};

export class Input {
	readonly keys = new Set<string>();
	private mouseButtons = new Set<number>();
	private padButtons = new Set<number>();
	/** pad buttons held last frame, for padPressed() */
	private padPrev = new Set<number>();
	/** pad buttons held while input was off (title, pause): they count once let go, so the A that starts doesn't also jump */
	private padStale = new Set<number>();
	private virtual = new Set<Action>();
	private prev = new Set<Action>();
	private now = new Set<Action>();
	private mdx = 0;
	private mdy = 0;
	private vdx = 0;
	private vdy = 0;
	padMove: [number, number] = [0, 0];
	padLook: [number, number] = [0, 0];
	padConnected = false;
	locked = false;
	/** When false, game keys are ignored (title screen, menus). */
	enabled = false;
	sensitivity = loadNum('sens', GAME.mouseSensitivity);
	padSensitivity = GAME.padSensitivity;
	invertY = false;
	/** Last device used, for prompts: 'kbm' | 'pad' */
	device: 'kbm' | 'pad' = 'kbm';
	/** The pad in use: whose button names it wears, and whether it reports the standard layout. */
	padKind: PadKind = 'generic';
	padStandard = true;
	private padId = '';
	onLockChange: ((locked: boolean) => void) | null = null;
	onLockError: (() => void) | null = null;

	constructor(private target: HTMLElement) {
		addEventListener('keydown', (e) => {
			if (!this.enabled) return;
			if (SWALLOW.has(e.code)) e.preventDefault();
			if (e.repeat) return;
			this.keys.add(e.code);
			this.device = 'kbm';
			if (e.code === 'BracketLeft') this.setSensitivity(this.sensitivity / 1.15);
			if (e.code === 'BracketRight') this.setSensitivity(this.sensitivity * 1.15);
		});
		addEventListener('keyup', (e) => this.keys.delete(e.code));
		addEventListener('blur', () => {
			this.keys.clear();
			this.mouseButtons.clear();
		});
		target.addEventListener('mousedown', (e) => {
			if (!this.enabled) return;
			this.mouseButtons.add(e.button);
			this.device = 'kbm';
		});
		addEventListener('mouseup', (e) => this.mouseButtons.delete(e.button));
		target.addEventListener('contextmenu', (e) => e.preventDefault());
		addEventListener('mousemove', (e) => {
			if (!this.enabled) return;
			// Locked: raw deltas. Unlocked (lock refused, e.g. a headless bot or a denied sandbox): use deltas
			// anyway so the game stays playable. Clamp absurd spikes (Chrome sometimes reports one on lock).
			const dx = Math.max(-300, Math.min(300, e.movementX || 0));
			const dy = Math.max(-300, Math.min(300, e.movementY || 0));
			this.mdx += dx;
			this.mdy += dy;
		});
		document.addEventListener('pointerlockchange', () => {
			this.locked = document.pointerLockElement === this.target;
			this.onLockChange?.(this.locked);
		});
		document.addEventListener('pointerlockerror', () => this.onLockError?.());
		addEventListener('gamepadconnected', () => (this.padConnected = true));
		addEventListener('gamepaddisconnected', () => (this.padConnected = navigator.getGamepads().some((p) => !!p)));
		// a key or a click while input is off (title, pause) still says the keyboard is in use, for hints
		addEventListener('keydown', () => (this.device = 'kbm'));
		addEventListener('mousedown', () => (this.device = 'kbm'));
		active = this;
	}

	setSensitivity(v: number) {
		this.sensitivity = Math.min(0.02, Math.max(0.0002, v));
		try {
			localStorage.setItem('sens', String(this.sensitivity));
		} catch {}
	}

	/** Must run inside a user gesture. Rejections are always caught (a console error fails Patch's test). */
	requestLock(): void {
		const el = this.target as HTMLElement & { requestPointerLock: (o?: unknown) => Promise<void> | void };
		if (!el.requestPointerLock || document.pointerLockElement === el) return;
		const fallback = () => {
			try {
				const p2 = el.requestPointerLock();
				if (p2 && typeof (p2 as Promise<void>).catch === 'function') (p2 as Promise<void>).catch(() => this.onLockError?.());
			} catch {
				this.onLockError?.();
			}
		};
		try {
			const p = el.requestPointerLock({ unadjustedMovement: true });
			if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(fallback);
		} catch {
			fallback();
		}
	}

	exitLock(): void {
		try {
			if (document.pointerLockElement) document.exitPointerLock();
		} catch {}
	}

	/** Poll once per rendered frame, before game logic. */
	update(): void {
		this.padPrev = this.padButtons;
		this.padButtons = new Set();
		this.padMove = [0, 0];
		this.padLook = [0, 0];
		const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
		// one pad: the first with the standard layout, which the button numbers assume, else the first connected
		let p: Gamepad | null = null;
		for (const q of pads) {
			if (!q || !q.connected) continue;
			if (q.mapping === 'standard') {
				p = q;
				break;
			}
			p ??= q;
		}
		if (p) {
			if (p.id !== this.padId) {
				this.padId = p.id;
				this.padKind = padKindOf(p.id);
			}
			this.padStandard = p.mapping === 'standard';
			p.buttons.forEach((b, i) => {
				if (b.pressed || b.value > 0.5) this.padButtons.add(i);
			});
			this.padMove = deadzone(p.axes[0] ?? 0, p.axes[1] ?? 0, 0.18, 1.2);
			this.padLook = deadzone(p.axes[2] ?? 0, p.axes[3] ?? 0, 0.12, 1.7);
			// a resting stick that drifts a little shouldn't take the hints from the keyboard
			const pushed = Math.max(Math.hypot(p.axes[0] ?? 0, p.axes[1] ?? 0), Math.hypot(p.axes[2] ?? 0, p.axes[3] ?? 0));
			if (this.padButtons.size || pushed > 0.5) this.device = 'pad';
		}
		this.prev = this.now;
		this.now = new Set();
		if (!this.enabled) {
			this.padStale = new Set(this.padButtons);
			return;
		}
		for (const b of this.padStale) if (!this.padButtons.has(b)) this.padStale.delete(b);
		for (const a of ACTIONS) {
			if (
				this.virtual.has(a) ||
				KEYS[a].some((k) => this.keys.has(k)) ||
				(MOUSE[a] !== undefined && this.mouseButtons.has(MOUSE[a]!)) ||
				(PAD[a]?.some((b) => this.padButtons.has(b) && !this.padStale.has(b)) ?? false)
			)
				this.now.add(a);
		}
	}

	down(a: Action): boolean {
		return this.now.has(a);
	}
	pressed(a: Action): boolean {
		return this.now.has(a) && !this.prev.has(a);
	}
	released(a: Action): boolean {
		return !this.now.has(a) && this.prev.has(a);
	}

	/** Move intent: x = strafe right, y = forward. Length <= 1. */
	move(): [number, number] {
		let x = (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0) + this.padMove[0];
		let y = (this.down('forward') ? 1 : 0) - (this.down('back') ? 1 : 0) - this.padMove[1];
		const m = Math.hypot(x, y);
		if (m > 1) {
			x /= m;
			y /= m;
		}
		return [x, y];
	}

	/** Look delta in radians for this frame: [yaw, pitch] (positive = right / up). Consumes mouse deltas. */
	look(realDt: number, scale = 1): [number, number] {
		const yaw = -(this.mdx * this.sensitivity + this.padLook[0] * this.padSensitivity * realDt + this.vdx) * scale;
		const pitch = -(this.mdy * this.sensitivity + this.padLook[1] * this.padSensitivity * 0.8 * realDt + this.vdy) * scale * (this.invertY ? -1 : 1);
		this.mdx = this.mdy = this.vdx = this.vdy = 0;
		return [yaw, pitch];
	}

	/** Drop any accumulated mouse motion (after lock changes). */
	flushLook(): void {
		this.mdx = this.mdy = this.vdx = this.vdy = 0;
	}

	/** True on the frame one of these pad buttons goes down. Works while input is off, for the title and pause screens. */
	padPressed(...buttons: number[]): boolean {
		return buttons.some((b) => this.padButtons.has(b) && !this.padPrev.has(b));
	}
	/** True while a pad button is held, whether input is on or off. */
	padDown(b: number): boolean {
		return this.padButtons.has(b);
	}
	/** A button's name on the pad in use: ✕ on a PlayStation pad where an Xbox pad says A. */
	padLabel(b: PadButton): string {
		const i = BUTTONS.indexOf(b);
		if (this.padKind === 'ps' && b === 'Back' && /0ce6|0df2/.test(this.padId)) return 'Create';
		return LABELS[this.padKind][i];
	}
	/** Fills {A}, {Start}, {LT}... in a hint with the pad's own button names. */
	padText(s: string): string {
		return s.replace(/\{(\w+)\}/g, (m, b: string) => ((BUTTONS as readonly string[]).includes(b) ? this.padLabel(b as PadButton) : m));
	}

	// ---- virtual input (harness / bots) ----
	press(a: Action) {
		this.virtual.add(a);
	}
	release(a: Action) {
		this.virtual.delete(a);
	}
	releaseAll() {
		this.virtual.clear();
	}
	/** Radians: positive dx turns right, positive dy looks down (same as mouse). */
	virtualLook(dx: number, dy: number) {
		this.vdx += dx;
		this.vdy += dy;
	}
	/** Pad rumble, if the browser exposes it. */
	rumble(strong: number, weak: number, ms: number) {
		const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
		for (const p of pads) {
			const act = (p as Gamepad & { vibrationActuator?: { playEffect?: (t: string, o: object) => Promise<unknown> } })?.vibrationActuator;
			act?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak })?.catch?.(() => {});
		}
	}
}

let active: Input | null = null;
/** Hint text for the device in use: `pad` may name buttons as {A}, {Start}, {LT}... */
export function hint(kbm: string, pad: string): string {
	return active?.device === 'pad' ? active.padText(pad) : kbm;
}
/** A button's name on the pad in use (see Input.padLabel). */
export function padLabel(b: PadButton): string {
	return active?.padLabel(b) ?? b;
}
