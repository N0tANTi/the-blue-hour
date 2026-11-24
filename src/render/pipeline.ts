// @ts-nocheck: three r186 TSL typings reject valid node graphs (Fn params, emissiveNode); runtime-checked by smoke/shots
// The look. WebGPURenderer (falls back to its WebGL2 backend by itself) + one TSL post chain:
//
//   scene pass (MSAA) with MRT: lit colour, albedo, emissive, depth
//   -> light = (lit - emissive) / albedo, quantised into 3-4 hard bands (cel shading done once, for
//      every light, shadow and falloff in the frame), recombined with the flat albedo
//   -> near-camera darkening (foreground goes to silhouette)
//   -> screen-space rim: an edge in front of something farther and brighter takes a thin rim of that light
//   -> + emissive (lamps, bottles, glass, beams, reflections, skyline; never banded)
//   -> ink: a thin dark line wherever the depth breaks, so every glass, lamp, bottle and figure has a drawn
//      outline (indoors only: it fades out with distance)
//   -> glow (thresholded bloom) and haze (wide low-threshold blur mixed in by distance)
//   -> palette grade toward the colour key of the place each pixel is in (so a warm room and the blue night
//      outside its doors hold their own colours in one frame), tone map, vignette, grain
import * as THREE from 'three/webgpu';
import {
	abs,
	clamp,
	convertToTexture,
	diffuseColor,
	dot,
	emissive,
	exp,
	float,
	Fn,
	fract,
	length,
	max,
	min,
	mix,
	mrt,
	neutralToneMapping,
	output,
	pass,
	pow,
	screenSize,
	screenUV,
	sin,
	smoothstep,
	uniform,
	vec2,
	vec3,
	vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

/** Live look values; the game writes these (zones blend them), the pipeline copies them to uniforms. */
export interface LookParams {
	exposure: number;
	/** band thresholds on the tone-mapped light value, and the light value each band takes */
	t1: number;
	t2: number;
	t3: number;
	v0: number;
	v1: number;
	v2: number;
	v3: number;
	/** half-width of each band edge (0 = razor, 0.08 = soft painted edge) */
	edge: number;
	/** 0 hard toon bands .. 1 smooth painterly ramp */
	soft: number;
	warmTint: [number, number, number];
	coolTint: [number, number, number];
	tempShift: number;
	dither: number;
	/** how much of the continuous light survives inside a band (0 = perfectly flat) */
	keep: number;
	/** shadow colour floor added to unlit albedo (deep umber, never pure grey) */
	shadowTint: [number, number, number];
	rim: number;
	rimPx: number;
	nearDark: number;
	nearA: number;
	nearB: number;
	glow: number;
	glowThreshold: number;
	glowRadius: number;
	haze: number;
	/** far-layer softening: mix toward the wide blur by distance (0 off) */
	diffuse: number;
	hazeDensity: number;
	hazeTint: [number, number, number];
	/** palette grade: dark, mid, light colours of the zone's ramp and how hard to pull toward it */
	rampDark: [number, number, number];
	rampMid: [number, number, number];
	rampLight: [number, number, number];
	grade: number;
	saturation: number;
	/** how much a bright light keeps its own colour instead of washing toward white (0 = the plain tone curve) */
	hueKeep: number;
	vignette: number;
	grain: number;
	/** display-space levels: black point, gamma (>1 darkens mids), gain, and a hue rotation in degrees (+ = red toward orange) */
	blackPoint: number;
	gamma: number;
	gain: number;
	hueRot: number;
	fade: number;
	/** ink outlines: how dark the line drawn at every break in depth is (0 none .. 1 black), and its width in pixels at 1080p */
	ink: number;
	inkPx: number;
}

export function defaultLook(): LookParams {
	return {
		exposure: 0.92,
		t1: 0.16,
		t2: 0.42,
		t3: 0.8,
		v0: 0.035,
		v1: 0.32,
		v2: 0.8,
		v3: 1.6,
		edge: 0.025,
		soft: 0.8,
		warmTint: [1.1, 0.98, 0.85],
		coolTint: [0.78, 0.82, 1.15],
		tempShift: 0.7,
		dither: 1.0,
		keep: 0.12,
		shadowTint: [0.012, 0.004, 0.002],
		rim: 0.9,
		rimPx: 2.2,
		nearDark: 0.55,
		nearA: 0.6,
		nearB: 3.2,
		glow: 0.55,
		glowThreshold: 0.62,
		glowRadius: 0.55,
		haze: 0.16,
		diffuse: 0,
		hazeDensity: 0.03,
		hazeTint: [1.0, 0.62, 0.32],
		rampDark: [0.012, 0.004, 0.002],
		rampMid: [0.56, 0.24, 0.05],
		rampLight: [1.0, 0.8, 0.5],
		grade: 0.45,
		saturation: 0.74,
		hueKeep: 0,
		vignette: 0.42,
		grain: 0.035,
		blackPoint: 0.035,
		gamma: 1.42,
		gain: 1.12,
		hueRot: 12,
		fade: 0,
		ink: 0,
		inkPx: 1,
	};
}

/** The settings the last stage reads per place (glow and haze strength, tone, palette grade, levels); the rest of a look follows the camera. */
const PLACE_NUMBERS = ['exposure', 'glow', 'haze', 'diffuse', 'hazeDensity', 'grade', 'saturation', 'hueKeep', 'blackPoint', 'gamma', 'gain'] as const;
const PLACE_COLOURS = ['hazeTint', 'rampDark', 'rampMid', 'rampLight'] as const;
export type Box = { min: [number, number, number]; max: [number, number, number] };

export interface Pipeline {
	renderer: THREE.WebGPURenderer;
	backend: string;
	look: LookParams;
	/**
	 * Looks by place: [inside room A, inside room B, everywhere else, the far view]. Each pixel is graded by the
	 * place it is in, whichever one the camera is in. The far view is whatever lies outside both rooms and more
	 * than about a hundred metres away (a skyline, the sky); without a fourth look it takes the third.
	 * Null (the default) grades the whole picture with `look`.
	 */
	placeLooks: LookParams[] | null;
	/** The two rooms, in world metres; give boxes that end inside the walls' thickness. Where they overlap, it is room B. */
	setRooms(a: Box, b: Box): void;
	setSize(w: number, h: number, pr: number): void;
	render(): void;
	compile(scene: THREE.Scene, camera: THREE.Camera): Promise<void>;
	isFlat(): Promise<{ flat: boolean; spread: number }>;
	stats(): { calls: number; triangles: number };
	/** debug views: 0 final, 1 light, 2 albedo, 3 emissive, 4 depth, 5 places (red room A, green room B, blue outside, white the far view) */
	debugView: { value: number };
}

export async function createPipeline(canvas: HTMLCanvasElement, scene: THREE.Scene, camera: THREE.PerspectiveCamera, forceWebGL: boolean): Promise<Pipeline> {
	const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, forceWebGL });
	await renderer.init();
	const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.toneMapping = THREE.NoToneMapping;
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFShadowMap;
	renderer.info.autoReset = false;

	const look = defaultLook();
	const U = {
		t1: uniform(0),
		t2: uniform(0),
		t3: uniform(0),
		v0: uniform(0),
		v1: uniform(0),
		v2: uniform(0),
		v3: uniform(0),
		edge: uniform(0),
		soft: uniform(0),
		warmTint: uniform(new THREE.Vector3(1, 1, 1)),
		coolTint: uniform(new THREE.Vector3(1, 1, 1)),
		tempShift: uniform(0),
		dither: uniform(0),
		keep: uniform(0),
		shadowTint: uniform(new THREE.Vector3()),
		rim: uniform(0),
		rimPx: uniform(0),
		nearDark: uniform(0),
		nearA: uniform(0),
		nearB: uniform(0),
		vignette: uniform(0),
		grain: uniform(0),
		fade: uniform(0),
		ink: uniform(0),
		inkPx: uniform(1),
		seed: uniform(0),
		view: uniform(0),
		// the camera, for finding where in the world a pixel is
		camPos: uniform(new THREE.Vector3()),
		camRight: uniform(new THREE.Vector3(1, 0, 0)),
		camUp: uniform(new THREE.Vector3(0, 1, 0)),
		camFwd: uniform(new THREE.Vector3(0, 0, -1)),
		tanHalf: uniform(new THREE.Vector2(1, 1)),
		// the two rooms; until setRooms, room A is everywhere
		roomAMin: uniform(new THREE.Vector3(-1e6, -1e6, -1e6)),
		roomAMax: uniform(new THREE.Vector3(1e6, 1e6, 1e6)),
		roomBMin: uniform(new THREE.Vector3(2e6, 2e6, 2e6)),
		roomBMax: uniform(new THREE.Vector3(3e6, 3e6, 3e6)),
	};
	// one set of last-stage settings per place: room A, room B, everywhere else, the far view
	const placeU = [0, 1, 2, 3].map(() => ({
		exposure: uniform(1),
		glow: uniform(0),
		haze: uniform(0),
		diffuse: uniform(0),
		hazeDensity: uniform(0),
		grade: uniform(0),
		saturation: uniform(1),
		hueKeep: uniform(0),
		blackPoint: uniform(0),
		gamma: uniform(1),
		gain: uniform(1),
		hazeTint: uniform(new THREE.Vector3()),
		rampDark: uniform(new THREE.Vector3()),
		rampMid: uniform(new THREE.Vector3()),
		rampLight: uniform(new THREE.Vector3()),
		hueM0: uniform(new THREE.Vector3(1, 0, 0)),
		hueM1: uniform(new THREE.Vector3(0, 1, 0)),
		hueM2: uniform(new THREE.Vector3(0, 0, 1)),
	}));

	const scenePass = pass(scene, camera, { samples: 4 });
	const sceneMRT = mrt({ output, albedo: diffuseColor, emissive: vec4(emissive, diffuseColor.a) });
	// additive beams, glass and smoke must blend into every target, not overwrite them
	sceneMRT.setBlendMode('albedo', new THREE.BlendMode(THREE.MaterialBlending));
	sceneMRT.setBlendMode('emissive', new THREE.BlendMode(THREE.MaterialBlending));
	scenePass.setMRT(sceneMRT);
	const colTex = scenePass.getTextureNode('output');
	const albTex = scenePass.getTextureNode('albedo');
	const emiTex = scenePass.getTextureNode('emissive');
	const lum = (c: ReturnType<typeof vec3>) => dot(c, vec3(0.2126, 0.7152, 0.0722));

	const band = Fn(([l]: [ReturnType<typeof float>]) => {
		const lp = float(1).sub(exp(l.negate().mul(1.6))); // tone-map the light so thresholds are perceptual
		const e = U.edge;
		const s1 = smoothstep(U.t1.sub(e), U.t1.add(e), lp);
		const s2 = smoothstep(U.t2.sub(e), U.t2.add(e), lp);
		const s3 = smoothstep(U.t3.sub(e), U.t3.add(e), lp);
		const b = U.v0.add(U.v1.sub(U.v0).mul(s1)).add(U.v2.sub(U.v1).mul(s2)).add(U.v3.sub(U.v2).mul(s3));
		// the painterly ramp: a smooth curve through the same values (deep toe, soft shoulder)
		const sm = lp.mul(lp).mul(float(3).sub(lp.mul(2)));
		const soft = U.v0.add(U.v3.sub(U.v0).mul(pow(sm, float(1.25))));
		return mix(mix(b, soft, U.soft), l, U.keep);
	});

	/** Cel-banded scene colour (no emissive), at a uv. */
	const celAt = Fn(([uv]: [ReturnType<typeof vec2>]) => {
		const c = colTex.sample(uv).rgb;
		const a = albTex.sample(uv).rgb;
		const em = emiTex.sample(uv).rgb;
		const lit = max(c.sub(em), vec3(0));
		const L = lit.div(max(a, vec3(0.02)));
		const l = lum(L);
		const b = band(l);
		const Lb = L.mul(b.div(max(l, 0.0001)));
		// warm toward the light, cool navy/umber in the shadows
		const lightK = smoothstep(0.05, 0.9, b);
		const temp = mix(U.coolTint, U.warmTint, lightK);
		return a.mul(Lb).mul(mix(vec3(1), temp, U.tempShift)).add(U.shadowTint.mul(a.mul(4).add(0.02)));
	});


	// Depth sampling at offsets needs the raw depth texture; build the rim from it.
	const depthTex = scenePass.getTextureNode('depth');
	const near = float(camera.near);
	const far = float(camera.far);
	const linZ = (d: ReturnType<typeof float>) => near.mul(far).div(far.sub(d.mul(far.sub(near)))); // perspective depth -> view distance

	const composed = Fn(() => {
		const uv = screenUV;
		const d0 = linZ(depthTex.sample(uv).r);
		const cel = celAt(uv).toVar();
		const nearK = float(1).sub(U.nearDark.mul(float(1).sub(smoothstep(U.nearA, U.nearB, d0))));
		cel.mulAssign(nearK);
		const px = vec2(U.rimPx).div(screenSize);
		const rim = vec3(0).toVar();
		const dirs: [number, number][] = [
			[1, 0],
			[-1, 0],
			[0, 1],
			[0, -1],
			[0.7, 0.7],
			[-0.7, 0.7],
			[0.7, -0.7],
			[-0.7, -0.7],
		];
		for (const [dx, dy] of dirs) {
			const q = uv.add(px.mul(vec2(dx, dy)));
			const dq = linZ(depthTex.sample(q).r);
			const behind = smoothstep(d0.mul(0.08).add(0.12), d0.mul(0.2).add(0.4), dq.sub(d0));
			const bg = colTex.sample(q).rgb;
			rim.addAssign(bg.mul(behind));
		}
		// (no rim on the far view: a skyline's edges stay clean against the sky)
		const rimC = rim.div(8).mul(U.rim).mul(smoothstep(0.4, 1.2, d0)).mul(float(1).sub(smoothstep(70, 130, d0)));
		const em = emiTex.sample(uv).rgb;
		// bounded before the glow and haze blur it: one pixel that is not a number would otherwise black out the
		// whole block of screen its blur reaches
		// ink: the raw depth runs straight across any flat surface on screen, so where it bends sharply (its second
		// difference, left to right and top to bottom) one thing ends and another begins. Scaled by the distance it
		// reads as the size of the jump relative to how far away it is; a jump of a few percent is a silhouette
		// (one reading per pixel: four readings averaged made the line no steadier and the shader slower to build)
		const ip = vec2(U.inkPx).div(screenSize);
		const dc = depthTex.sample(uv).r;
		const bend = abs(depthTex.sample(uv.add(vec2(ip.x, 0))).r.add(depthTex.sample(uv.sub(vec2(ip.x, 0))).r).sub(dc.mul(2))).add(
			abs(depthTex.sample(uv.add(vec2(0, ip.y))).r.add(depthTex.sample(uv.sub(vec2(0, ip.y))).r).sub(dc.mul(2))),
		);
		const ink = smoothstep(0.008, 0.03, bend.mul(d0).div(near)).mul(U.ink).mul(float(1).sub(smoothstep(35, 80, d0)));
		return vec4(cel.add(rimC).add(em).mul(float(1).sub(ink)).clamp(0, 1000), 1);
	})();

	const composedTex = convertToTexture(composed);
	const glowNode = bloom(composedTex, 1, look.glowRadius, look.glowThreshold);
	const hazeNode = bloom(composedTex, 1, 1.0, 0.0);

	const finalNode = Fn(() => {
		const uv = screenUV;
		const d0 = linZ(depthTex.sample(uv).r);
		// which place this pixel is in: its spot in the world from its depth, then how far inside each room that is
		// (the edge is a soft 25 cm, meant to fall inside a wall's thickness)
		const ndc = vec2(uv.x.mul(2).sub(1), float(1).sub(uv.y.mul(2))).mul(U.tanHalf).mul(d0);
		const world = U.camPos.add(U.camRight.mul(ndc.x)).add(U.camUp.mul(ndc.y)).add(U.camFwd.mul(d0));
		const insideOf = (lo: typeof U.roomAMin, hi: typeof U.roomAMax) => {
			const k = smoothstep(lo.sub(0.125), lo.add(0.125), world).mul(float(1).sub(smoothstep(hi.sub(0.125), hi.add(0.125), world)));
			return k.x.mul(k.y).mul(k.z);
		};
		const wB = insideOf(U.roomBMin, U.roomBMax).toVar();
		const wA = insideOf(U.roomAMin, U.roomAMax).mul(float(1).sub(wB)).toVar();
		const wF = float(1).sub(wA).sub(wB).mul(smoothstep(70, 130, d0)).toVar();
		const wO = float(1).sub(wA).sub(wB).sub(wF).toVar();
		const P = {} as (typeof placeU)[0];
		for (const key of Object.keys(placeU[0]) as (keyof (typeof placeU)[0])[])
			P[key] = placeU[0][key].mul(wA).add(placeU[1][key].mul(wB)).add(placeU[2][key].mul(wO)).add(placeU[3][key].mul(wF)).toVar();

		const c = composedTex.sample(uv).rgb.toVar();
		c.addAssign(glowNode.rgb.mul(P.glow));
		const fog = float(1).sub(exp(d0.mul(P.hazeDensity).negate()));
		c.assign(mix(c, max(c.mul(0.3), hazeNode.rgb.mul(P.hazeTint.mul(0.45).add(0.55)).mul(0.95)), fog.mul(fog).mul(P.diffuse)));
		c.assign(mix(c, c.add(hazeNode.rgb.mul(P.hazeTint).mul(2.5)), fog.mul(P.haze)));
		c.mulAssign(P.exposure);
		// the tone curve, two ways: the plain one washes a bright colour toward white; the kept one runs the curve on
		// the brightest channel alone and scales the colour by it, so an orange lamp stays orange at full strength
		const peak = max(max(c.r, c.g), c.b);
		const kept = c.mul(neutralToneMapping(vec3(peak), float(1)).r.div(max(peak, 0.0001)));
		c.assign(mix(neutralToneMapping(c, float(1)), kept, P.hueKeep));
		// palette grade: luminance through the place's ramp, pulled toward by `grade`
		const l = clamp(lum(c), 0, 1);
		const ramp = mix(mix(P.rampDark, P.rampMid, smoothstep(0.0, 0.45, l)), P.rampLight, smoothstep(0.35, 1.0, l));
		const chroma = c.div(max(l, 0.0001));
		const graded = mix(c, ramp.mul(mix(vec3(1), chroma, 0.5)), P.grade);
		const g = mix(vec3(lum(graded)), graded, P.saturation).toVar();
		// vignette
		const d = uv.sub(0.5).mul(vec2(1.0, 1.15));
		g.mulAssign(float(1).sub(U.vignette.mul(smoothstep(0.2, 0.85, length(d)))));
		// film grain in display space
		const n = fract(sin(dot(uv.mul(screenSize).add(U.seed), vec2(12.9898, 78.233))).mul(43758.5453));
		const disp0 = pow(max(g, vec3(0)), vec3(1 / 2.2));
		// hue rotation (CSS hue-rotate matrix rows), then levels: black point, gamma, gain
		const hr = vec3(dot(P.hueM0, disp0), dot(P.hueM1, disp0), dot(P.hueM2, disp0));
		const lv = clamp(hr.sub(P.blackPoint).div(float(1).sub(P.blackPoint)), 0, 1);
		const disp = pow(lv, vec3(P.gamma)).mul(P.gain);
		const grained = disp.add(n.sub(0.5).mul(U.grain).mul(smoothstep(0.0, 0.08, lum(disp)).mul(0.7).add(0.3)));
		const n2 = fract(sin(dot(uv.mul(screenSize).add(U.seed.mul(1.7)), vec2(39.346, 11.135))).mul(24634.6345));
		const dith = vec3(n.add(n2).sub(1)).mul(U.dither.div(255));
		const out = pow(max(grained.add(dith), vec3(0)), vec3(2.2)).mul(float(1).sub(U.fade));
		// debug views
		const a = albTex.sample(uv).rgb;
		const em = emiTex.sample(uv).rgb;
		const lit = max(colTex.sample(uv).rgb.sub(em), vec3(0));
		const Lv = lit.div(max(a, vec3(0.02)));
		const v = U.view;
		const dbg = mix(
			mix(mix(out, neutralToneMapping(Lv, float(1)), min(v, 1)), a, clamp(v.sub(1), 0, 1)),
			mix(em, vec3(d0.div(30)), clamp(v.sub(3), 0, 1)),
			clamp(v.sub(2), 0, 1),
		);
		return vec4(mix(dbg, vec3(wA, wB, wO).add(wF), clamp(v.sub(4), 0, 1)), 1);
	})();

	const pipeline = new THREE.RenderPipeline(renderer);
	pipeline.outputNode = finalNode;

	let flatWaiters: Array<(r: { flat: boolean; spread: number }) => void> = [];
	const sample = () => {
		const c = document.createElement('canvas');
		c.width = 32;
		c.height = 18;
		const g = c.getContext('2d', { willReadFrequently: true });
		if (!g) return { flat: true, spread: 0 };
		g.drawImage(canvas, 0, 0, 32, 18);
		const px = g.getImageData(0, 0, 32, 18).data;
		let lo = 255,
			hi = 0;
		for (let i = 0; i < px.length; i += 4) {
			const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
			lo = Math.min(lo, l);
			hi = Math.max(hi, l);
		}
		return { flat: hi - lo < 6, spread: Math.round(hi - lo) };
	};

	const V = (u: { value: THREE.Vector3 }, a: [number, number, number]) => u.value.set(a[0], a[1], a[2]);
	const p: Pipeline = {
		renderer,
		backend: isWebGPU ? 'WebGPU' : 'WebGL2 (WebGPURenderer fallback)',
		look,
		placeLooks: null,
		setRooms(a, b) {
			V(U.roomAMin, a.min);
			V(U.roomAMax, a.max);
			V(U.roomBMin, b.min);
			V(U.roomBMax, b.max);
		},
		debugView: U.view,
		setSize(w, h, pr) {
			renderer.setPixelRatio(pr);
			renderer.setSize(w, h, false);
		},
		render() {
			renderer.info.reset();
			const L = look;
			U.t1.value = L.t1;
			U.t2.value = L.t2;
			U.t3.value = L.t3;
			U.v0.value = L.v0;
			U.v1.value = L.v1;
			U.v2.value = L.v2;
			U.v3.value = L.v3;
			U.edge.value = L.edge;
			U.soft.value = L.soft;
			V(U.warmTint, L.warmTint);
			V(U.coolTint, L.coolTint);
			U.tempShift.value = L.tempShift;
			U.dither.value = L.dither;
			U.keep.value = L.keep;
			V(U.shadowTint, L.shadowTint);
			U.rim.value = L.rim;
			U.rimPx.value = L.rimPx * Math.max(1, renderer.getPixelRatio() * (canvas.height / renderer.getPixelRatio() / 1080));
			U.nearDark.value = L.nearDark;
			U.nearA.value = L.nearA;
			U.nearB.value = L.nearB;
			U.vignette.value = L.vignette;
			U.grain.value = L.grain;
			for (let i = 0; i < 4; i++) {
				const PL = p.placeLooks ? (p.placeLooks[i] ?? p.placeLooks[2]) : L,
					u = placeU[i];
				for (const key of PLACE_NUMBERS) u[key].value = PL[key];
				for (const key of PLACE_COLOURS) V(u[key], PL[key]);
				const a = (PL.hueRot * Math.PI) / 180,
					c = Math.cos(a),
					sn = Math.sin(a);
				u.hueM0.value.set(0.213 + c * 0.787 - sn * 0.213, 0.715 - c * 0.715 - sn * 0.715, 0.072 - c * 0.072 + sn * 0.928);
				u.hueM1.value.set(0.213 - c * 0.213 + sn * 0.143, 0.715 + c * 0.285 + sn * 0.14, 0.072 - c * 0.072 - sn * 0.283);
				u.hueM2.value.set(0.213 - c * 0.213 - sn * 0.787, 0.715 - c * 0.715 + sn * 0.715, 0.072 + c * 0.928 + sn * 0.072);
			}
			{
				const e = camera.matrixWorld.elements,
					th = Math.tan((camera.fov * Math.PI) / 360) / camera.zoom;
				U.camRight.value.set(e[0], e[1], e[2]);
				U.camUp.value.set(e[4], e[5], e[6]);
				U.camFwd.value.set(-e[8], -e[9], -e[10]);
				U.camPos.value.set(e[12], e[13], e[14]);
				U.tanHalf.value.set(th * camera.aspect, th);
			}
			U.fade.value = L.fade;
			U.ink.value = L.ink;
			U.inkPx.value = L.inkPx * Math.max(1, renderer.getPixelRatio() * (canvas.height / renderer.getPixelRatio() / 1080));
			U.seed.value = (U.seed.value + 17.13) % 1000;
			glowNode.threshold.value = L.glowThreshold;
			glowNode.radius.value = L.glowRadius;
			pipeline.render();
			if (flatWaiters.length) {
				const r = sample();
				for (const w of flatWaiters) w(r);
				flatWaiters = [];
			}
		},
		async compile(sc, cam) {
			await renderer.compileAsync(sc, cam);
			pipeline.render();
		},
		isFlat() {
			return new Promise((r) => flatWaiters.push(r));
		},
		stats() {
			const r = renderer.info.render as { drawCalls?: number; calls: number; triangles: number };
			return { calls: r.drawCalls ?? r.calls, triangles: r.triangles };
		},
	};
	return p;
}
