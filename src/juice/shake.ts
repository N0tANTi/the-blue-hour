// Trauma camera shake (Eiserloh): trauma 0..1, shake = trauma^2, smooth noise, ~1.5/s decay.

/** Smooth 1D value noise in -1..1, one independent channel per `seed`. */
export function noise1(seed: number, x: number): number {
	const i = Math.floor(x);
	const f = x - i;
	const h = (n: number) => {
		let t = (n * 374761393 + seed * 668265263) | 0;
		t = Math.imul(t ^ (t >>> 13), 1274126177);
		return (((t ^ (t >>> 16)) >>> 0) / 4294967296) * 2 - 1;
	};
	const u = f * f * (3 - 2 * f);
	return h(i) * (1 - u) + h(i + 1) * u;
}

export class TraumaShake {
	trauma = 0;
	decay = 1.5;
	frequency = 18;
	/** Radians at full trauma. Roll kept at ~0.5 deg per the juice checklist. */
	maxYaw = 0.035;
	maxPitch = 0.03;
	maxRoll = 0.009;
	/** Metres at full trauma. */
	maxOffset = 0.06;
	/** Accessibility: 0..1 */
	scale = 1;
	yaw = 0;
	pitch = 0;
	roll = 0;
	x = 0;
	y = 0;
	private t = 0;

	add(amount: number) {
		this.trauma = Math.min(1, this.trauma + amount);
	}
	update(realDt: number) {
		this.t += realDt;
		this.trauma = Math.max(0, this.trauma - this.decay * realDt);
		const s = this.trauma * this.trauma * this.scale;
		const ft = this.t * this.frequency;
		this.yaw = this.maxYaw * s * noise1(1, ft);
		this.pitch = this.maxPitch * s * noise1(2, ft);
		this.roll = this.maxRoll * s * noise1(3, ft);
		this.x = this.maxOffset * s * noise1(4, ft);
		this.y = this.maxOffset * s * noise1(5, ft);
	}
}
