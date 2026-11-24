// Flat-colour materials. No textures on the set: every surface is one albedo, the post chain bands the light.
// Emissive surfaces put their colour in the emissive MRT target so they are never banded.
import * as THREE from 'three/webgpu';
import { abs, attribute, color, float, lights, normalView, positionViewDirection, positionWorld, pow, uniform, vec3, vertexColor } from 'three/tsl';

export type Mat = THREE.Material;

const cache = new Map<string, Mat>();

/** sRGB hex -> linear Color */
export const C = (hex: string) => new THREE.Color(hex);

export function lambert(key: string, hex: string, opts: { side?: THREE.Side; emissive?: string; emissiveIntensity?: number } = {}): Mat {
	const k = `l:${key}`;
	const hit = cache.get(k);
	if (hit) return hit;
	const m = new THREE.MeshLambertNodeMaterial({ color: C(hex), side: opts.side ?? THREE.FrontSide });
	if (opts.emissive) {
		m.emissive = C(opts.emissive);
		m.emissiveIntensity = opts.emissiveIntensity ?? 1;
	}
	m.name = key;
	m.userData.vc = opts.side === THREE.DoubleSide ? 'lambert2' : 'lambert';
	m.userData.rgb = C(hex);
	cache.set(k, m);
	return m;
}

/** Glossy (lacquer, brass, chrome): Standard with low roughness, its highlight becomes a crisp top band. */
export function gloss(key: string, hex: string, roughness: number, metalness = 0): Mat {
	const k = `g:${key}`;
	const hit = cache.get(k);
	if (hit) return hit;
	const m = new THREE.MeshStandardNodeMaterial({ color: C(hex), roughness, metalness });
	m.name = key;
	m.userData.vc = 'gloss';
	m.userData.rgb = C(hex);
	m.userData.rough = roughness;
	m.userData.metal = metalness;
	cache.set(k, m);
	return m;
}

/** Self-lit glass that glows brightest where it faces you and darkens to its edges (lanterns, sconces). */
export function glowSoft(key: string, hex: string, intensity = 1): Mat {
	const k = `s:${key}`;
	const hit = cache.get(k);
	if (hit) return hit;
	const m = new THREE.MeshLambertNodeMaterial({ color: 0x000000 });
	m.emissive = C(hex);
	m.emissiveIntensity = intensity;
	m.name = key;
	m.userData.vc = 'glowSoft';
	m.userData.rgb = C(hex).multiplyScalar(intensity);
	cache.set(k, m);
	return m;
}

/** Self-lit: black albedo + emissive, so it only lands in the emissive target. */
export function glow(key: string, hex: string, intensity = 1, side: THREE.Side = THREE.FrontSide): Mat {
	const k = `e:${key}`;
	const hit = cache.get(k);
	if (hit) return hit;
	const m = new THREE.MeshLambertNodeMaterial({ color: 0x000000, side });
	m.emissive = C(hex);
	m.emissiveIntensity = intensity;
	m.name = key;
	m.userData.vc = side === THREE.DoubleSide ? 'glow2' : 'glow';
	m.userData.rgb = C(hex).multiplyScalar(intensity);
	cache.set(k, m);
	return m;
}

/**
 * Additive light (beams, glass glints, smoke): writes the same amount into output and emissive and
 * nothing into albedo, so the cel pass treats it as unbanded light.
 */
export function additive(key: string, hex: string, intensity: number, opts: { opacityNode?: THREE.Node; side?: THREE.Side; depthTest?: boolean } = {}): THREE.MeshLambertNodeMaterial {
	// black albedo + emissive, blended additively: lands in output and emissive equally, adds nothing to albedo
	const m = new THREE.MeshLambertNodeMaterial({
		transparent: true,
		depthWrite: false,
		depthTest: opts.depthTest ?? true,
		blending: THREE.AdditiveBlending,
		side: opts.side ?? THREE.DoubleSide,
	});
	m.colorNode = vec3(0);
	(m as unknown as { emissiveNode: unknown }).emissiveNode = color(C(hex)).mul(intensity);
	m.opacityNode = (opts.opacityNode as ReturnType<typeof float>) ?? float(1);
	m.lightsNode = lights([]);
	m.name = key;
	return m;
}

export const nodeUtil = { positionWorld, uniform };

export const PAL = {
	ink: '#070403',
	umber: '#2a120a',
	umberLight: '#4a2414',
	wood: '#3a1a0c',
	woodDark: '#1e0c06',
	floor: '#26110a',
	curtain: '#ae4812',
	curtainDeep: '#5a1c0a',
	leather: '#9a2a18',
	leatherDark: '#5a160c',
	gold: '#c38a3e',
	goldDark: '#7a4a1c',
	brass: '#d09a48',
	plaster: '#3e1a0c',
	plasterLight: '#7a3c1e',
	lacquer: '#0a0605',
	shade: '#e88a3c',
	bulb: '#ffd59a',
	felt: '#4a1a5a',
	feltRim: '#1a0a12',
	stone: '#2c3048',
	stoneDark: '#161a2c',
	navy: '#0a1030',
};

/** Velvet: flat colour whose grazing edges glow with a soft sheen of their own hue. */
export function velvet(key: string, hex: string): Mat {
	const k = `v:${key}`;
	const hit = cache.get(k);
	if (hit) return hit;
	const m = new THREE.MeshLambertNodeMaterial({ color: C(hex) });
	m.name = key;
	m.userData.vc = 'velvet';
	m.userData.rgb = C(hex);
	cache.set(k, m);
	return m;
}
// biome-ignore lint: TSL node types
// (the facing term is clamped everywhere it is raised to a power: interpolated normals can push it a hair
// past 1, a negative base is not a number, and one such pixel is spread into a black block by the glow)
const sheen = (c: any) => c.mul(pow(float(1).sub(abs(normalView.dot(positionViewDirection))).clamp(0, 1), float(2.2))).mul(0.55);
export function velvetStandalone(hex: string): THREE.Material {
	const m = new THREE.MeshLambertNodeMaterial({ color: C(hex) });
	(m as unknown as { emissiveNode: unknown }).emissiveNode = sheen(color(C(hex)));
	m.name = `velvet-${hex}`;
	return m;
}

/** The shared vertex-colour materials a Builder bakes palette materials into (one set per zone). */
export function vcMaterial(kind: string, zoneLights: THREE.Light[]): THREE.Material {
	const L = lights(zoneLights);
	if (kind === 'gloss') {
		const m = new THREE.MeshStandardNodeMaterial();
		m.colorNode = vertexColor();
		m.roughnessNode = attribute('rough', 'float');
		m.metalnessNode = attribute('metal', 'float');
		m.lightsNode = L;
		m.name = 'set-gloss';
		return m;
	}
	if (kind === 'glowSoft') {
		const m = new THREE.MeshLambertNodeMaterial();
		m.colorNode = vec3(0);
		const facing = abs(normalView.dot(positionViewDirection));
		(m as unknown as { emissiveNode: unknown }).emissiveNode = vertexColor().mul(pow(facing.clamp(0, 1), float(1.6)).mul(0.45).add(0.9));
		m.lightsNode = lights([]);
		m.name = 'set-glowSoft';
		return m;
	}
	if (kind === 'glow' || kind === 'glow2') {
		const m = new THREE.MeshLambertNodeMaterial({ side: kind === 'glow2' ? THREE.DoubleSide : THREE.FrontSide });
		m.colorNode = vec3(0);
		(m as unknown as { emissiveNode: unknown }).emissiveNode = vertexColor();
		m.lightsNode = lights([]);
		m.name = `set-${kind}`;
		return m;
	}
	const m = new THREE.MeshLambertNodeMaterial({ side: kind === 'lambert2' ? THREE.DoubleSide : THREE.FrontSide });
	m.colorNode = vertexColor();
	if (kind === 'velvet') (m as unknown as { emissiveNode: unknown }).emissiveNode = sheen(vertexColor());
	m.lightsNode = L;
	m.name = `set-${kind}`;
	return m;
}

/** Give a material (or a clone of it) a zone's light list. */
export function withLights<T extends THREE.Material>(m: T, zoneLights: THREE.Light[] | null): T {
	(m as unknown as { lightsNode: unknown }).lightsNode = zoneLights ? lights(zoneLights) : lights([]);
	m.needsUpdate = true;
	return m;
}

const zoned = new Map<string, THREE.Material>();
/** Per-zone copy of a material carrying that zone's lights (props and people). */
export function zoneMat(m: THREE.Material, zone: string, zoneLights: THREE.Light[]): THREE.Material {
	const k = `${m.uuid}:${zone}`;
	let z = zoned.get(k);
	if (!z) {
		z = withLights(m.clone(), zoneLights);
		z.name = `${m.name}@${zone}`;
		zoned.set(k, z);
	}
	return z;
}

export function applyZone(root: THREE.Object3D, zone: string, zoneLights: THREE.Light[]) {
	root.traverse((o) => {
		const mesh = o as THREE.Mesh;
		if (!mesh.isMesh) return;
		mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => zoneMat(m, zone, zoneLights)) : zoneMat(mesh.material, zone, zoneLights);
	});
}
