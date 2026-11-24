// Controller words in place of keyboard ones while a pad is in use. The keyboard text is read from the page as it
// was, and put back the moment a key or the mouse is used again.
import type { Input } from './input';

export class PadHints {
	private items: { el: HTMLElement; kbm: string; pad: string }[] = [];
	private shown = 'kbm';
	constructor(private input: Input) {}

	/** `pad` is HTML that may name buttons as {A}, {B}, {X}, {Y}, {LB}, {RB}, {LT}, {RT}, {Back}, {Start}, {LS}, {RS}. */
	add(el: Element | null, pad: string): this {
		if (el instanceof HTMLElement) this.items.push({ el, kbm: el.innerHTML, pad });
		this.shown = '';
		return this;
	}

	/** Once a frame: swaps the words when the device, or the kind of pad, changes. */
	update(): void {
		const mode = this.input.device === 'pad' ? `pad:${this.input.padKind}` : 'kbm';
		if (mode === this.shown) return;
		this.shown = mode;
		for (const it of this.items) it.el.innerHTML = mode === 'kbm' ? it.kbm : this.input.padText(it.pad);
	}
}
