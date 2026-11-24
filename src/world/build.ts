// Geometry builder: collects pieces per material, merges each material into one mesh, and records
// colliders for Rapier. Every piece is non-indexed position+normal(+uv dropped) so merges always line up.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { type Mat, vcMaterial } from './mats';

export type Collider =
	| { kind: 'box'; c: THREE.Vector3; h: THREE.Vector3; rotY: number }
	| { kind: 'cyl'; c: THREE.Vector3; r: number; hh: number };

const clean = (g: THREE.BufferGeometry) => {
	let n = g.index ? g.toNonIndexed() : g;
	if (n === g) n = g.clone();
	for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
	if (!n.attributes.normal) n.computeVertexNormals();
	return n;
};

export class Builder {
	readonly groups = new Map<Mat, THREE.BufferGeometry[]>();
	readonly colliders: Collider[] = [];
	readonly root = new THREE.Group();
	/** materials whose merged mesh should not cast shadows */
	readonly noShadow = new Set<Mat>();

	private vc = new Map<string, THREE.BufferGeometry[]>();

	add(mat: Mat, geo: THREE.BufferGeometry, m?: THREE.Matrix4) {
		const g = clean(geo);
		if (m) g.applyMatrix4(m);
		const kind = mat.userData.vc as string | undefined;
		if (kind) {
			// bake the palette colour (and gloss params) into vertex attributes; one material per kind per zone
			const n = g.attributes.position.count;
			const c = mat.userData.rgb as THREE.Color;
			const col = new Float32Array(n * 3);
			for (let i = 0; i < n; i++) {
				col[i * 3] = c.r;
				col[i * 3 + 1] = c.g;
				col[i * 3 + 2] = c.b;
			}
			g.setAttribute('color', new THREE.BufferAttribute(col, 3));
			if (kind === 'gloss') {
				g.setAttribute('rough', new THREE.BufferAttribute(new Float32Array(n).fill(mat.userData.rough), 1));
				g.setAttribute('metal', new THREE.BufferAttribute(new Float32Array(n).fill(mat.userData.metal), 1));
			}
			let arr = this.vc.get(kind);
			if (!arr) this.vc.set(kind, (arr = []));
			arr.push(g);
			if (this.noShadow.has(mat)) this.vcNoShadow.add(kind);
			return g;
		}
		let arr = this.groups.get(mat);
		if (!arr) this.groups.set(mat, (arr = []));
		arr.push(g);
		return g;
	}
	private vcNoShadow = new Set<string>();

	/** Axis-aligned (optionally Y-rotated) box from its centre and full size. */
	box(mat: Mat, x: number, y: number, z: number, sx: number, sy: number, sz: number, opts: { rotY?: number; collide?: boolean; rotX?: number; rotZ?: number } = {}) {
		const m = new THREE.Matrix4().compose(
			new THREE.Vector3(x, y, z),
			new THREE.Quaternion().setFromEuler(new THREE.Euler(opts.rotX ?? 0, opts.rotY ?? 0, opts.rotZ ?? 0, 'YXZ')),
			new THREE.Vector3(1, 1, 1),
		);
		this.add(mat, new THREE.BoxGeometry(sx, sy, sz), m);
		if (opts.collide) this.colliders.push({ kind: 'box', c: new THREE.Vector3(x, y, z), h: new THREE.Vector3(sx / 2, sy / 2, sz / 2), rotY: opts.rotY ?? 0 });
	}

	/** Box from min/max corners (axis aligned). */
	aabb(mat: Mat, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, collide = false) {
		this.box(mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), { collide });
	}

	cyl(mat: Mat, x: number, y: number, z: number, rTop: number, rBot: number, h: number, seg = 32, opts: { collide?: boolean; open?: boolean; rotY?: number } = {}) {
		const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, opts.open ?? false);
		const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), opts.rotY ?? 0), new THREE.Vector3(1, 1, 1));
		this.add(mat, g, m);
		if (opts.collide) this.colliders.push({ kind: 'cyl', c: new THREE.Vector3(x, y, z), r: Math.max(rTop, rBot), hh: h / 2 });
	}

	at(mat: Mat, geo: THREE.BufferGeometry, x: number, y: number, z: number, rotY = 0, s = 1) {
		const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), new THREE.Vector3(s, s, s));
		return this.add(mat, geo, m);
	}

	collideBox(x: number, y: number, z: number, sx: number, sy: number, sz: number, rotY = 0) {
		this.colliders.push({ kind: 'box', c: new THREE.Vector3(x, y, z), h: new THREE.Vector3(sx / 2, sy / 2, sz / 2), rotY });
	}

	finish(zoneLights: THREE.Light[]): THREE.Group {
		for (const [kind, list] of this.vc) {
			const g = mergeGeometries(list, false);
			if (!g) continue;
			g.computeBoundingSphere();
			const mesh = new THREE.Mesh(g, vcMaterial(kind, zoneLights));
			mesh.name = `set-${kind}`;
			mesh.castShadow = !kind.startsWith('glow');
			if (kind === 'velvet') mesh.name = 'set-velvet';
			mesh.receiveShadow = true;
			mesh.matrixAutoUpdate = false;
			mesh.updateMatrix();
			this.root.add(mesh);
		}
		this.vc.clear();
		for (const [mat, list] of this.groups) {
			const g = mergeGeometries(list, false);
			if (!g) continue;
			g.computeBoundingSphere();
			const mesh = new THREE.Mesh(g, mat);
			mesh.name = mat.name;
			mesh.castShadow = !this.noShadow.has(mat);
			mesh.receiveShadow = true;
			mesh.matrixAutoUpdate = false;
			mesh.updateMatrix();
			this.root.add(mesh);
		}
		this.groups.clear();
		return this.root;
	}
}

/** A vertical ribbed/fluted column: radius r, n flutes of depth d. */
export function fluted(r: number, h: number, n: number, d: number, seg = 96) {
	const g = new THREE.CylinderGeometry(r, r, h, seg, 1, false);
	const p = g.attributes.position;
	for (let i = 0; i < p.count; i++) {
		const x = p.getX(i),
			z = p.getZ(i);
		const rr = Math.hypot(x, z);
		if (rr < 1e-4) continue;
		const a = Math.atan2(z, x);
		const k = r - d * (1 - Math.abs(Math.cos((a * n) / 2)));
		p.setX(i, (x / rr) * k);
		p.setZ(i, (z / rr) * k);
	}
	g.computeVertexNormals();
	return g;
}

/** Annulus sector extruded upward: inner/outer radius, start/end angle (radians, around +Y, 0 = +X), height. */
export function ringSector(r0: number, r1: number, a0: number, a1: number, h: number, bevel = 0.02, seg = 40) {
	const s = new THREE.Shape();
	s.absarc(0, 0, r1, a0, a1, false);
	s.absarc(0, 0, r0, a1, a0, true);
	s.closePath();
	const g = new THREE.ExtrudeGeometry(s, { depth: h - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: seg });
	// shape is in XY, extruded along +Z: rotate so Z becomes Y (up) and the shape's Y becomes -Z
	g.rotateX(-Math.PI / 2);
	g.translate(0, bevel, 0);
	return g;
}

/** A vertical lathe from a profile of [radius, y] points. */
export function lathe(profile: [number, number][], seg = 32) {
	return new THREE.LatheGeometry(
		bottomless(profile).map(([r, y]) => new THREE.Vector2(r, y)),
		seg,
	);
}

/**
 * Drop a lathe profile's flat bottom cap (a first point on the axis at the same height as the next point).
 * Lathe props rest on tables, shelves and floors; that hidden disc would sit coplanar with the surface under
 * it and z-fight.
 */
export function bottomless(profile: [number, number][]): [number, number][] {
	if (profile.length > 2 && profile[0][0] === 0 && profile[1][1] === profile[0][1] && profile[1][0] > 0) return profile.slice(1);
	return profile;
}
