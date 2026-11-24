// Entry: error capture first, then seed + clock, boot behind the title veil, then the loop.
import { config } from './config';
import { seedAll } from './core/rng';
import { time } from './core/time';
import { Game } from './game';
import { GAME } from './game.config';
import { installErrorCapture, installHarness, runSelfChecks } from './harness/harness';

const errors = installErrorCapture();
seedAll(config.seed, config.seeded);
time.fixed = config.fixedClock;
document.title = GAME.title;
const title = document.getElementById('veil-title');
if (title) title.textContent = GAME.title;

const canvas = document.getElementById('view') as HTMLCanvasElement;
const game = new Game(canvas);
game.errors = errors;
const hook = installHarness(game);
hook.errors = errors;

game
	.boot()
	.then(() => {
		game.path.renderer.setAnimationLoop(() => {
			if (!hook.manual) game.frame();
		});
		hook.ready = true;
		game.mark('ready');
		if (config.autostart) game.start();
		if (config.patchTest) runSelfChecks(game, hook);
	})
	.catch((e: Error) => {
		game.hud.progress(`Could not start: ${e.message}`, 0);
		console.error('boot failed', e);
	});
