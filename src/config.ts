// Runtime flags, read once from the URL.
//   ?renderer=webgpu|webgl2|webgl   render path (default GAME.renderer)
//   ?quality=low|medium|high|auto   quality tier (default auto)
//   ?seed=123                       seeded RNG; also replaces Math.random with a seeded stream
//   ?clock=fixed                    every frame advances exactly 1/60 s (deterministic captures)
//   ?patch-test=1                   run self-checks and print `pass <name>` / `fail <name>: why`
//   ?vfx=quarks                     also load the three.quarks probe (WebGL path only, see audit)
//   ?debug=1                        perf overlay
//   ?autostart=1                    skip the title veil (bots)
//   ?reduce-motion=1                scale down shake, bob and FOV kicks
import { GAME } from './game.config';

export type RendererKind = 'webgpu' | 'webgl2' | 'webgl';
export type QualityName = 'low' | 'medium' | 'high';

const q = new URLSearchParams(location.search);
const pick = <T extends string>(v: string | null, allowed: readonly T[], fallback: T): T =>
	v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

export const config = {
	renderer: pick(q.get('renderer'), ['webgpu', 'webgl2', 'webgl'] as const, GAME.renderer),
	quality: pick(q.get('quality'), ['low', 'medium', 'high', 'auto'] as const, 'auto'),
	seed: Number.parseInt(q.get('seed') ?? '1', 10) || 1,
	seeded: q.has('seed'),
	fixedClock: q.get('clock') === 'fixed',
	patchTest: q.get('patch-test') === '1',
	vfx: q.get('vfx') ?? 'instanced',
	debug: q.has('debug'),
	autostart: q.has('autostart'),
	reduceMotion:
		q.has('reduce-motion') || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches),
};
