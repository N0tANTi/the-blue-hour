// HUD and overlays: plain DOM (index.html holds the markup and CSS). Menus bounce too (CSS springs).
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class Hud {
	readonly veil = $('veil');
	readonly veilStatus = $('veil-status');
	readonly veilBar = $('veil-bar');
	readonly veilPlay = $('veil-play');
	readonly pause = $('pause');
	readonly hint = $('hint');
	readonly debug = $('debug');
	private hintLeft = 12;

	progress(text: string, p: number) {
		this.veilStatus.textContent = text;
		this.veilBar.style.transform = `scaleX(${Math.max(0, Math.min(1, p))})`;
	}

	ready(label = 'Click to play') {
		this.veil.classList.add('ready');
		this.veilPlay.textContent = label;
		this.veilStatus.textContent = '';
	}

	hideVeil() {
		this.veil.classList.add('gone');
		document.body.classList.add('playing');
	}

	showPause(show: boolean) {
		this.pause.classList.toggle('on', show);
	}

	update(realDt: number) {
		if (this.hintLeft > 0) {
			this.hintLeft -= realDt;
			if (this.hintLeft <= 0) this.hint.classList.add('gone');
		}
	}
}
