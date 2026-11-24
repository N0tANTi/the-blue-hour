// One colour key per zone; the game blends between them as you walk through a door.
import { defaultLook, type LookParams } from '../render/pipeline';

// the hall's lights stay saturated amber at full strength: they keep their own colour through the tone curve, the
// ramp's light end is amber rather than cream, and the grade takes less colour out
// (kept colour is dimmer than washed-out colour, so the exposure comes up and the black point down to hold the
// room's overall brightness where it was)
const hall: LookParams = { ...defaultLook(), hueKeep: 1, rampLight: [1.0, 0.5, 0.11], saturation: 0.9, blackPoint: 0.025, shadowTint: [0.02, 0.004, 0.003],
	// drawn, not misted: ink outlines, flatter bands of light with firmer edges, a tight small glow, almost no haze,
	// and little of the light that used to wrap round every edge
	ink: 0.92, inkPx: 1.1, soft: 0.55, edge: 0.03, keep: 0.06, rim: 0.25, glow: 0.2, glowRadius: 0.3, glowThreshold: 0.78, haze: 0.05, exposure: 1.1,
};

const cards: LookParams = {
	...defaultLook(),
	ink: 0.7,
	inkPx: 1.1,
	hazeTint: [0.5, 0.42, 1.0],
	hazeDensity: 0.05,
	haze: 0.3,
	rampDark: [0.004, 0.005, 0.03],
	rampMid: [0.1, 0.08, 0.42],
	rampLight: [0.95, 0.75, 0.6],
	grade: 0.25,
	hueRot: 0,
	saturation: 0.95,
	shadowTint: [0.004, 0.003, 0.012],
	nearDark: 0.4,
};

const balcony: LookParams = {
	...defaultLook(),
	hazeTint: [0.1, 0.3, 0.85],
	hazeDensity: 0.0032,
	haze: 0.62,
	diffuse: 0.8,
	rampDark: [0.004, 0.006, 0.022],
	rampMid: [0.04, 0.11, 0.27],
	rampLight: [1.0, 0.8, 0.52],
	grade: 0.35,
	hueRot: 0,
	saturation: 0.7,
	gamma: 1.3,
	blackPoint: 0.03,
	gain: 1.14,
	shadowTint: [0.003, 0.004, 0.014],
	nearDark: 0.35,
	glow: 1.15,
	glowThreshold: 0.5,
	glowRadius: 0.9,
};

/**
 * The far view from anywhere (the city across the river, the sky): deep, with no veil of haze over it; its lights
 * keep their amber, bloom softly, and lend a little warmth to the air around them. The balcony's own look still
 * colours the balcony itself.
 */
export const CITY_LOOK: LookParams = {
	...balcony,
	haze: 0.03,
	hazeTint: [0.45, 0.55, 0.9],
	diffuse: 0.1,
	glow: 0.45,
	grade: 0.1,
	saturation: 1.0,
	hueKeep: 1,
	exposure: 1.0,
	gamma: 1.12,
	blackPoint: 0.02,
	gain: 1.06,
};

export const ZONE_LOOKS: Record<'hall' | 'cards' | 'balcony', LookParams> = { hall, cards, balcony };
