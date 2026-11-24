// Rapier (rapier3d-compat 0.21: WASM embedded, no extra fetch) with a fixed 60 Hz step and
// interpolated render transforms.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export { RAPIER };

export async function initPhysics(): Promise<void> {
	await RAPIER.init();
}

interface Synced {
	body: RAPIER.RigidBody;
	obj: THREE.Object3D;
	p0: THREE.Vector3;
	p1: THREE.Vector3;
	q0: THREE.Quaternion;
	q1: THREE.Quaternion;
}

export interface RayHit {
	point: THREE.Vector3;
	normal: THREE.Vector3;
	distance: number;
	collider: RAPIER.Collider;
	body: RAPIER.RigidBody | null;
	/** Whatever was registered with `tag(collider, value)`. */
	tag: unknown;
}

export class Physics {
	readonly world: RAPIER.World;
	readonly step = 1 / 60;
	maxSubsteps = 5;
	/** 0..1 between the last two fixed steps; use it to interpolate anything you simulate yourself. */
	alpha = 0;
	steps = 0;
	private acc = 0;
	private synced: Synced[] = [];
	private tags = new Map<number, unknown>();
	readonly events = new RAPIER.EventQueue(true);

	constructor(gravity = -9.81) {
		this.world = new RAPIER.World({ x: 0, y: gravity, z: 0 });
		this.world.timestep = this.step;
	}

	/** Advance by a (scaled) frame dt. `fixed` runs before each world step (controllers, forces). */
	update(dt: number, fixed: (h: number) => void) {
		this.acc += dt;
		let n = 0;
		while (this.acc >= this.step && n < this.maxSubsteps) {
			for (const s of this.synced) {
				s.p0.copy(s.p1);
				s.q0.copy(s.q1);
			}
			fixed(this.step);
			this.world.step(this.events);
			this.steps++;
			for (const s of this.synced) {
				const t = s.body.translation(),
					r = s.body.rotation();
				s.p1.set(t.x, t.y, t.z);
				s.q1.set(r.x, r.y, r.z, r.w);
			}
			this.acc -= this.step;
			n++;
		}
		if (n === this.maxSubsteps) this.acc = 0; // drop time rather than spiral
		this.alpha = this.acc / this.step;
		for (const s of this.synced) {
			if (s.body.isSleeping()) {
				s.obj.position.copy(s.p1);
				s.obj.quaternion.copy(s.q1);
			} else {
				s.obj.position.lerpVectors(s.p0, s.p1, this.alpha);
				s.obj.quaternion.slerpQuaternions(s.q0, s.q1, this.alpha);
			}
		}
	}

	tag(collider: RAPIER.Collider, value: unknown) {
		this.tags.set(collider.handle, value);
	}
	tagOf(collider: RAPIER.Collider): unknown {
		return this.tags.get(collider.handle);
	}

	/** Keep `obj` following `body` (interpolated). */
	sync(body: RAPIER.RigidBody, obj: THREE.Object3D) {
		const t = body.translation(),
			r = body.rotation();
		const p = new THREE.Vector3(t.x, t.y, t.z),
			q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
		this.synced.push({ body, obj, p0: p.clone(), p1: p.clone(), q0: q.clone(), q1: q.clone() });
	}

	unsync(body: RAPIER.RigidBody) {
		this.synced = this.synced.filter((s) => s.body !== body);
	}

	/** Teleport a synced body (no interpolation smear). */
	teleport(body: RAPIER.RigidBody, p: THREE.Vector3, q?: THREE.Quaternion) {
		body.setTranslation(p, true);
		if (q) body.setRotation(q, true);
		body.setLinvel({ x: 0, y: 0, z: 0 }, true);
		body.setAngvel({ x: 0, y: 0, z: 0 }, true);
		for (const s of this.synced)
			if (s.body === body) {
				s.p0.copy(p);
				s.p1.copy(p);
				if (q) {
					s.q0.copy(q);
					s.q1.copy(q);
				}
			}
	}

	/** A fixed box collider. `rot` is Euler radians. */
	addStaticBox(center: THREE.Vector3, half: THREE.Vector3, rot?: THREE.Euler, friction = 0.8): RAPIER.Collider {
		const desc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setTranslation(center.x, center.y, center.z).setFriction(friction);
		if (rot) {
			const q = new THREE.Quaternion().setFromEuler(rot);
			desc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
		}
		return this.world.createCollider(desc);
	}

	/** A fixed collider for a box-shaped mesh (uses its geometry bounds, world transform and scale). */
	addStaticMeshBox(mesh: THREE.Mesh, friction = 0.8): RAPIER.Collider {
		mesh.updateWorldMatrix(true, false);
		mesh.geometry.computeBoundingBox();
		const bb = mesh.geometry.boundingBox!;
		const p = new THREE.Vector3(),
			q = new THREE.Quaternion(),
			s = new THREE.Vector3();
		mesh.matrixWorld.decompose(p, q, s);
		const half = bb.getSize(new THREE.Vector3()).multiply(s).multiplyScalar(0.5);
		const off = bb.getCenter(new THREE.Vector3()).multiply(s).applyQuaternion(q);
		const desc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
			.setTranslation(p.x + off.x, p.y + off.y, p.z + off.z)
			.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
			.setFriction(friction);
		return this.world.createCollider(desc);
	}

	/** A fixed triangle-mesh collider from any mesh (world transform baked in). */
	addStaticTrimesh(mesh: THREE.Mesh): RAPIER.Collider {
		mesh.updateWorldMatrix(true, false);
		const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
		const pos = g.attributes.position;
		const verts = new Float32Array(pos.count * 3);
		const v = new THREE.Vector3();
		for (let i = 0; i < pos.count; i++) {
			v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
			verts.set([v.x, v.y, v.z], i * 3);
		}
		const idx = new Uint32Array(pos.count);
		for (let i = 0; i < idx.length; i++) idx[i] = i;
		return this.world.createCollider(RAPIER.ColliderDesc.trimesh(verts, idx));
	}

	/** A dynamic box body that drives `mesh`. */
	addDynamicBox(mesh: THREE.Mesh, density = 1, friction = 0.7, restitution = 0.05): RAPIER.RigidBody {
		mesh.geometry.computeBoundingBox();
		const half = mesh.geometry.boundingBox!.getSize(new THREE.Vector3()).multiply(mesh.scale).multiplyScalar(0.5);
		const q = mesh.quaternion;
		const body = this.world.createRigidBody(
			RAPIER.RigidBodyDesc.dynamic()
				.setTranslation(mesh.position.x, mesh.position.y, mesh.position.z)
				.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
				.setCcdEnabled(true),
		);
		this.world.createCollider(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setDensity(density).setFriction(friction).setRestitution(restitution), body);
		this.sync(body, mesh);
		return body;
	}

	addDynamicBall(mesh: THREE.Object3D, radius: number, density = 1): RAPIER.RigidBody {
		const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(mesh.position.x, mesh.position.y, mesh.position.z).setCcdEnabled(true));
		this.world.createCollider(RAPIER.ColliderDesc.ball(radius).setDensity(density).setRestitution(0.3), body);
		this.sync(body, mesh);
		return body;
	}

	remove(body: RAPIER.RigidBody) {
		this.unsync(body);
		for (let i = 0; i < body.numColliders(); i++) this.tags.delete(body.collider(i).handle);
		this.world.removeRigidBody(body);
	}

	private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
	raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, exclude?: RAPIER.Collider, excludeBody?: RAPIER.RigidBody): RayHit | null {
		this.ray.origin = { x: origin.x, y: origin.y, z: origin.z };
		this.ray.dir = { x: dir.x, y: dir.y, z: dir.z };
		const hit = this.world.castRayAndGetNormal(this.ray, maxDist, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, exclude, excludeBody);
		if (!hit) return null;
		const d = hit.timeOfImpact;
		return {
			point: origin.clone().addScaledVector(dir, d),
			normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
			distance: d,
			collider: hit.collider,
			body: hit.collider.parent(),
			tag: this.tagOf(hit.collider),
		};
	}
}
