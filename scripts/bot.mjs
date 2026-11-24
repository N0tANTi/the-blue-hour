// Playwright bot playtest: plays the build for 60 s with real keyboard and mouse input under the game host's
// headers, asserts the game reacted, counts console errors and off-host requests, measures fps / load /
// longest main-thread task, saves 3 screenshots and a 15 s clip.
//   node scripts/bot.mjs [--renderer webgpu|webgl2|webgl] [--seconds 60] [--headed] [--out shots] [--dist dist]
// Output: <out>/<renderer>/{title,play-1,play-2,play-3}.png, clip.mp4, clip.webm, results.json (+ run.mp4 with --keep-run)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { arg, launch, PROBE_INIT, startPreview, startRecorder, watch } from './lib.mjs';

const kind = String(arg('renderer', 'webgpu'));
const seconds = Number(arg('seconds', 60));
const headed = !!arg('headed', false);
const out = resolve(String(arg('out', 'shots')), kind);
const W = 1280,
	H = 720;
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const server = await startPreview(String(arg('dist', 'dist')));
const browser = await launch({ headed });
const context = await browser.newContext({ viewport: { width: W, height: H } });
const page = await context.newPage();
await page.addInitScript(PROBE_INIT);
const w = watch(page, server.url);
const recorder = await startRecorder(page, join(out, 'run.mp4'), { width: W, height: H });
const log = [];
const t0 = Date.now();
const T = () => (Date.now() - t0) / 1000;
const say = (s) => {
	const l = `${T().toFixed(1)}s ${s}`;
	log.push(l);
	console.log(l);
};

const url = `${server.url}?renderer=${kind}&seed=7`;
const navStart = Date.now();
await page.goto(url);
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 30000, polling: 50 });
const loadMs = Date.now() - navStart;
const S = () => page.evaluate(() => window.__game.state());
let st = await S();
say(`ready in ${loadMs} ms on ${st.renderer}`);
const veilFlat = await page.evaluate(() => window.__game.isFlat());
await page.waitForTimeout(800);
await page.screenshot({ path: join(out, 'title.png') });

// ---- start: click the veil (the gesture that unlocks audio and requests pointer lock) ----
await page.mouse.click(W / 2, H / 2);
await page.waitForTimeout(400);
st = await S();
say(`phase ${st.phase}, pointer lock ${st.locked}, audio ${st.audio.state}`);
const start = st.player;

// ---- input helpers (real events only; state is read to steer, like a player watching the screen) ----
let mx = W / 2,
	my = H / 2;
const sens = await page.evaluate(() => window.__game.game.input.sensitivity);
async function mouseLook(dxRad, dyRad, ms = 250) {
	// movementX is what the game reads; Playwright's mouse.move produces it from the position delta
	const steps = Math.max(2, Math.round(ms / 16));
	const px = -dxRad / sens,
		py = -dyRad / sens;
	for (let i = 0; i < steps; i++) {
		// wrap the virtual cursor so it never sticks to the window edge when unlocked
		if (mx < 100 || mx > W - 100 || my < 100 || my > H - 100) {
			mx = W / 2;
			my = H / 2;
			await page.mouse.move(mx, my, { steps: 1 });
			await page.evaluate(() => window.__game.game.input.flushLook());
		}
		mx += px / steps;
		my += py / steps;
		await page.mouse.move(mx, my);
		await page.waitForTimeout(16);
	}
}
async function aimAt(target, tolerance = 0.02, tries = 6) {
	for (let k = 0; k < tries; k++) {
		const s = await S();
		const p = s.player;
		const eyeY = p.y + (p.crouched ? 0.97 : 1.62);
		const dx = target.x - p.x,
			dy = target.y - eyeY,
			dz = target.z - p.z;
		const yaw = Math.atan2(-dx, -dz);
		const pitch = Math.atan2(dy, Math.hypot(dx, dz));
		let dyaw = yaw - p.yaw;
		dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
		const dp = pitch - p.pitch;
		if (Math.abs(dyaw) < tolerance && Math.abs(dp) < tolerance) return true;
		await mouseLook(dyaw, dp, 120);
		await page.waitForTimeout(40);
	}
	return false;
}
const key = async (code, ms) => {
	await page.keyboard.down(code);
	await page.waitForTimeout(ms);
	await page.keyboard.up(code);
};
async function fireBurst(ms, aim = false) {
	if (aim) await page.mouse.down({ button: 'right' });
	await page.mouse.down({ button: 'left' });
	await page.waitForTimeout(ms);
	await page.mouse.up({ button: 'left' });
	if (aim) await page.mouse.up({ button: 'right' });
}
const dummy = () => S().then((s) => s.level.dummy);

// ---- the 60 s script ----
const shots = [];
const samples = [];
const sampler = setInterval(async () => {
	try {
		const s = await S();
		samples.push({ t: +T().toFixed(1), x: s.player.x, z: s.player.z, fps: +s.perf.fps.toFixed(1), shots: s.weapon.shots, hits: s.level.dummy.hits });
	} catch {}
}, 2000);
const playStart = Date.now();
const elapsed = () => (Date.now() - playStart) / 1000;
const shotAt = new Set([12, 28, 46]);
const maybeShot = async () => {
	for (const s of shotAt)
		if (elapsed() >= s) {
			shotAt.delete(s);
			const n = shots.length + 1;
			await page.screenshot({ path: join(out, `play-${n}.png`) });
			shots.push(`play-${n}.png`);
			say(`screenshot play-${n}`);
		}
};

let round = 0;
while (elapsed() < seconds) {
	round++;
	// 1. walk a loop with strafes and look-arounds
	await page.keyboard.down('KeyW');
	await mouseLook(0.6, 0.05, 350);
	await page.keyboard.down('KeyA');
	await page.waitForTimeout(500);
	await page.keyboard.up('KeyA');
	await mouseLook(-1.2, -0.05, 450);
	await page.keyboard.up('KeyW');
	await maybeShot();
	// 2. sprint and jump
	await page.keyboard.down('KeyW');
	await page.keyboard.down('ShiftLeft');
	await page.waitForTimeout(600);
	await key('Space', 120);
	await page.waitForTimeout(500);
	await page.keyboard.up('ShiftLeft');
	await page.keyboard.up('KeyW');
	// 3. crouch-walk a bit
	await page.keyboard.down('KeyC');
	await key('KeyS', 500);
	await page.keyboard.up('KeyC');
	await maybeShot();
	// 4. find the dummy and shoot: hip bursts, then aimed bursts, reload
	const d = await dummy();
	if (await aimAt({ x: d.x, y: d.y + 1.15, z: d.z })) {
		await fireBurst(450);
		await aimAt({ x: d.x, y: d.y + 1.15, z: d.z });
		await fireBurst(700, true);
		await aimAt({ x: d.x, y: d.y + 1.85, z: d.z }); // head
		await fireBurst(350, true);
	}
	await key('KeyR', 80);
	await page.waitForTimeout(400);
	await maybeShot();
	// 5. shoot the crate stack every other round
	if (round % 2 === 0) {
		await aimAt({ x: 4.85, y: 0.6, z: -7 });
		await fireBurst(600);
	}
	// 6. strafe-shoot the dummy
	await page.keyboard.down(round % 2 ? 'KeyD' : 'KeyA');
	const d2 = await dummy();
	await aimAt({ x: d2.x, y: d2.y + 1.15, z: d2.z }, 0.03, 3);
	await fireBurst(500);
	await page.keyboard.up(round % 2 ? 'KeyD' : 'KeyA');
	// walk back toward the middle if we drifted far
	const s = await S();
	if (Math.hypot(s.player.x, s.player.z - 4) > 9) {
		await aimAt({ x: 0, y: 1.6, z: 4 }, 0.1, 3);
		await key('KeyW', 900);
	}
	await maybeShot();
}
clearInterval(sampler);
await maybeShot();

// ---- results ----
const end = await page.evaluate(() => ({ state: window.__game.state(), probe: window.__probe, events: window.__game.events(400) }));
const endStats = await page.evaluate(() => window.__game.game.path.stats());
const es = end.state;
const moved = Math.hypot(es.player.x - start.x, es.player.z - start.z);
const types = new Set(end.events.map((e) => e.type));
const longestTask = Math.max(0, ...end.probe.longtasks.map((t) => t.ms));
const longestBlock = Math.max(0, ...end.probe.blocks.map((t) => t.ms));
const playLongTasks = end.probe.longtasks.filter((t) => t.at > es.marks.play);
const assertions = {
	'started (phase playing)': es.phase === 'playing',
	'player moved > 3 m from spawn at some point': samples.some((s) => Math.hypot(s.x - start.x, s.z - start.z) > 3) || moved > 3,
	'jumped': es.player.jumps > 0,
	'crouched': end.events.some((e) => e.type === 'crouch' && e.down),
	'fired > 20 shots': es.weapon.shots > 20,
	'hit the dummy > 5 times': es.level.dummy.hits > 5,
	'reloaded': es.weapon.reloads > 0,
	'particles spawned > 100': es.vfx.spawned > 100,
	'crates moved': es.level.crates.moved > 0.2,
	'audio unlocked and played': es.audio.state === 'running' && es.audio.played > 20,
	'frames advanced': es.frame > seconds * 20,
	'first frame not flat': !veilFlat.flat,
	'zero console errors': w.errors.length === 0 && es.errors === 0,
	'zero off-host requests': w.offHost.length === 0,
	'no main-thread stall over 1 s': longestTask < 1000 && longestBlock < 1000,
};
await recorder.stop();
const recordedFrames = recorder.frames();
await page.close();
await context.close();
await browser.close();
server.stop();

// ---- clip: 15 s from the run (starts a third in, after the warm-up), h264 mp4 + vp9 webm ----
let clip = null;
try {
	const raw = join(out, 'run.mp4');
	const ss = String(Math.max(0, Math.min(20, seconds / 3)));
	execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', ss, '-t', '15', '-i', raw, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'medium', '-an', '-movflags', '+faststart', join(out, 'clip.mp4')]);
	execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', ss, '-t', '15', '-i', raw, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '34', '-row-mt', '1', '-an', join(out, 'clip.webm')]);
	clip = { mp4: 'clip.mp4', webm: 'clip.webm', from: `${ss}s`, seconds: 15, screencastFrames: recordedFrames };
	if (!arg('keep-run', false)) rmSync(raw, { force: true }); // the full 60 s recording is ~35 MB
} catch (e) {
	clip = { error: String(e.message).slice(0, 200) };
}

const results = {
	renderer: kind,
	backend: es.renderer,
	quality: es.quality,
	headed,
	seconds,
	loadMs,
	marks: es.marks,
	fps: +es.perf.fps.toFixed(1),
	frameMs: { p50: +es.perf.p50.toFixed(2), p95: +es.perf.p95.toFixed(2), max: +es.perf.max.toFixed(1) },
	cpuFrameMs: { p50: es.perf.cpuP50, p95: es.perf.cpuP95 },
	drawCalls: await Promise.resolve(endStats.calls),
	triangles: endStats.triangles,
	longestTaskMs: longestTask,
	longestTaskDuringPlayMs: Math.max(0, ...playLongTasks.map((t) => t.ms)),
	longestBlockMs: longestBlock,
	longTasks: end.probe.longtasks.map((t) => ({ atMs: t.at, ms: t.ms, phase: t.at > es.marks.play ? 'play' : 'boot' })),
	firstFrameSpread: veilFlat.spread,
	counts: { shots: es.weapon.shots, hits: es.level.dummy.hits, kills: es.level.dummy.kills, reloads: es.weapon.reloads, jumps: es.player.jumps, particles: es.vfx.spawned, cratesMoved: es.level.crates.moved, sounds: es.audio.played, frames: es.frame },
	pointerLock: types.has('lock-refused') ? 'refused (free-mouse fallback)' : 'ok',
	eventTypes: [...types],
	errors: w.errors,
	warnings: [...new Set(w.warnings)].slice(0, 10),
	offHost: w.offHost,
	assertions,
	screenshots: ['title.png', ...shots],
	clip,
	samples,
};
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2));
const failed = Object.entries(assertions).filter(([, ok]) => !ok);
console.log(`\n${kind} (${es.renderer}): load ${loadMs} ms, ${results.fps} fps (p95 ${results.frameMs.p95} ms), longest task ${longestTask} ms (${results.longestTaskDuringPlayMs} ms during play)`);
console.log(`shots ${es.weapon.shots}, hits ${es.level.dummy.hits}, kills ${es.level.dummy.kills}, particles ${es.vfx.spawned}, sounds ${es.audio.played}, lock ${results.pointerLock}`);
for (const [name, ok] of Object.entries(assertions)) console.log(`${ok ? 'pass' : 'FAIL'} ${name}`);
if (w.errors.length) console.log(`errors: ${w.errors.slice(0, 5).join(' | ')}`);
console.log(`results: ${join(out, 'results.json')}`);
if (!existsSync(join(out, 'clip.mp4'))) console.log('no clip produced');
process.exit(failed.length ? 1 : 0);
