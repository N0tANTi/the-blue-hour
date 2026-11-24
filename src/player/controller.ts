// First-person controller: Rapier KinematicCharacterController on a capsule.
// Coyote time, jump buffering, variable jump height, crouch (with head-clearance check), sprint,
// autostep and snap-to-ground. Look is applied per rendered frame (no input lag); movement per fixed step.
import * as THREE from 'three';
import type { Input } from '../core/input';
import { MOVE } from '../game.config';
import { type Physics, RAPIER } from '../physics/physics';

export type PlayerEvent =
	| { type: 'jump' }
	| { type: 'land'; speed: number }
	| { type: 'step'; sprint: boolean }
	| { type: 'crouch'; down: boolean };

export class FPSController {
	readonly body: RAPIER.RigidBody;
	readonly collider: RAPIER.Collider;
	readonly kcc: RAPIER.KinematicCharacterController;
	readonly cfg = { ...MOVE };

	yaw = 0;
	pitch = 0;
	/** Horizontal velocity (world) and vertical speed. */
	readonly vel = new THREE.Vector3();
	grounded = false;
	crouched = false;
	sprinting = false;
	aiming = false;
	/** 0 standing .. 1 crouched, smoothed (camera height). */
	crouchT = 0;
	/** Distance walked on the ground (drives head bob and footsteps). */
	stride = 0;
	airTime = 0;
	jumps = 0;
	listeners: Array<(e: PlayerEvent) => void> = [];

	private sinceGrounded = 999;
	private sinceJumpPressed = 999;
	private jumpHeld = false;
	private rising = false;
	private feet0 = new THREE.Vector3();
	private feet1 = new THREE.Vector3();
	private nextStep = 1.1;
	private wishCrouch = false;
	private desired = new THREE.Vector3();

	constructor(
		private physics: Physics,
		spawn: THREE.Vector3,
	) {
		const c = this.cfg;
		const half = this.halfHeight(false);
		this.body = physics.world.createRigidBody(
			RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y + c.radius + half, spawn.z),
		);
		this.collider = physics.world.createCollider(RAPIER.ColliderDesc.capsule(half, c.radius).setFriction(0), this.body);
		this.kcc = physics.world.createCharacterController(0.02);
		this.kcc.setUp({ x: 0, y: 1, z: 0 });
		this.kcc.enableAutostep(c.stepHeight, 0.15, true);
		this.kcc.enableSnapToGround(0.3);
		this.kcc.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(c.maxSlopeDeg));
		this.kcc.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(c.maxSlopeDeg + 5));
		this.kcc.setApplyImpulsesToDynamicBodies(true);
		this.kcc.setCharacterMass(80);
		this.feet0.copy(spawn);
		this.feet1.copy(spawn);
	}

	private halfHeight(crouched: boolean) {
		const h = crouched ? this.cfg.crouchHeight : this.cfg.height;
		return Math.max(0.05, h / 2 - this.cfg.radius);
	}

	on(fn: (e: PlayerEvent) => void) {
		this.listeners.push(fn);
	}
	private emit(e: PlayerEvent) {
		for (const l of this.listeners) l(e);
	}

	/** Per rendered frame: look and edge-triggered intents (so a tap is never lost between fixed steps). */
	frame(input: Input, look: [number, number]) {
		this.yaw += look[0];
		this.pitch = THREE.MathUtils.clamp(this.pitch + look[1], -1.52, 1.52);
		if (input.pressed('jump')) this.sinceJumpPressed = 0;
		this.jumpHeld = input.down('jump');
		this.wishCrouch = input.down('crouch');
		this.aiming = input.down('aim');
	}

	/** Fixed step. */
	fixed(h: number, input: Input) {
		const c = this.cfg;
		this.sinceJumpPressed += h;
		this.sinceGrounded = this.grounded ? 0 : this.sinceGrounded + h;

		// crouch / uncrouch (only if the standing capsule fits)
		if (this.wishCrouch !== this.crouched) {
			if (this.wishCrouch) this.setCrouch(true);
			else if (this.canStand()) this.setCrouch(false);
		}

		const [mx, my] = input.move();
		const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
		const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
		const wish = fwd.multiplyScalar(my).addScaledVector(right, mx);
		this.sprinting = input.down('sprint') && my > 0.3 && !this.crouched && !this.aiming;
		let speed = this.crouched ? c.crouchSpeed : this.sprinting ? c.sprintSpeed : c.walkSpeed;
		if (this.aiming) speed *= c.adsSpeedScale;
		const target = wish.multiplyScalar(speed);
		const accel = this.grounded ? c.groundAccel : c.airAccel;
		const k = 1 - Math.exp(-accel * h);
		this.vel.x += (target.x - this.vel.x) * k;
		this.vel.z += (target.z - this.vel.z) * k;

		// jump: buffered press + coyote window
		if (this.sinceJumpPressed <= c.jumpBuffer && this.sinceGrounded <= c.coyoteTime && !this.rising) {
			this.vel.y = Math.sqrt(2 * c.gravity * c.jumpHeight);
			this.sinceJumpPressed = 999;
			this.sinceGrounded = 999;
			this.grounded = false;
			this.rising = true;
			this.jumps++;
			if (this.crouched && this.canStand()) this.setCrouch(false);
			this.emit({ type: 'jump' });
		}
		if (this.rising && !this.jumpHeld && this.vel.y > 0) {
			this.vel.y *= c.jumpCut; // variable jump height
			this.rising = false;
		}
		if (this.vel.y <= 0) this.rising = false;

		if (this.grounded && this.vel.y <= 0) this.vel.y = -1.5; // stick to slopes
		else this.vel.y -= c.gravity * (this.vel.y < 0 ? c.fallGravityScale : 1) * h;
		this.vel.y = Math.max(this.vel.y, -40);

		this.desired.set(this.vel.x * h, this.vel.y * h, this.vel.z * h);
		this.kcc.computeColliderMovement(this.collider, this.desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
		let mv = this.kcc.computedMovement();
		const wasGrounded = this.grounded;
		const fallSpeed = -this.vel.y;
		this.grounded = this.kcc.computedGrounded();
		// Rapier's controller now and then answers a step on flat ground with no movement at all: the small downward
		// push that keeps the player on slopes meets the floor at zero distance, and the whole step is dropped, its
		// sideways part included. Walking, that felt like running into something every metre or two. When the step
		// was mostly lost and floor is all that was touched, ask again for the sideways part alone.
		const wantH = Math.hypot(this.desired.x, this.desired.z);
		if (wasGrounded && this.desired.y <= 0 && wantH > 1e-4 && Math.hypot(mv.x, mv.z) < wantH * 0.5 && this.onlyFloorTouched()) {
			this.desired.y = 0;
			this.kcc.computeColliderMovement(this.collider, this.desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
			const again = this.kcc.computedMovement();
			if (Math.hypot(again.x, again.z) > Math.hypot(mv.x, mv.z)) {
				mv = again;
				this.grounded = true;
			}
		}
		// bumped the ceiling
		if (this.vel.y > 0 && mv.y < this.desired.y * 0.5) {
			this.vel.y = 0;
			this.rising = false;
		}
		// slid along a wall: keep velocity consistent with actual motion
		if (h > 0) {
			this.vel.x = THREE.MathUtils.lerp(this.vel.x, mv.x / h, 0.5);
			this.vel.z = THREE.MathUtils.lerp(this.vel.z, mv.z / h, 0.5);
		}
		const t = this.body.translation();
		this.feet0.copy(this.feet1);
		this.body.setNextKinematicTranslation({ x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z });
		this.feet1.set(t.x + mv.x, t.y + mv.y - this.halfHeight(this.crouched) - c.radius, t.z + mv.z);

		if (!wasGrounded && this.grounded) {
			this.emit({ type: 'land', speed: fallSpeed });
			this.airTime = 0;
		}
		if (!this.grounded) this.airTime += h;

		const hs = Math.hypot(mv.x, mv.z);
		if (this.grounded) {
			this.stride += hs;
			if (this.stride >= this.nextStep) {
				this.nextStep = this.stride + (this.sprinting ? 2.4 : 2.0) * 0.5;
				this.emit({ type: 'step', sprint: this.sprinting });
			}
		}
		this.crouchT += ((this.crouched ? 1 : 0) - this.crouchT) * (1 - Math.exp(-c.crouchLerp * h));
	}

	/** True when the last move touched something and every touch was a surface facing up (floor, not a wall or a step's face). */
	private onlyFloorTouched(): boolean {
		const n = this.kcc.numComputedCollisions();
		for (let i = 0; i < n; i++) {
			const c = this.kcc.computedCollision(i);
			if (!c || c.normal1.y < 0.7) return false;
		}
		return n > 0;
	}

	private setCrouch(down: boolean) {
		const c = this.cfg;
		const hOld = this.halfHeight(this.crouched);
		const hNew = this.halfHeight(down);
		const t = this.body.translation();
		// keep the feet where they are
		const y = t.y - hOld + hNew;
		this.collider.setHalfHeight(hNew);
		this.body.setTranslation({ x: t.x, y, z: t.z }, true);
		this.crouched = down;
		this.emit({ type: 'crouch', down });
		void c;
	}

	private canStand(): boolean {
		const c = this.cfg;
		const t = this.body.translation();
		const hStand = this.halfHeight(false);
		const center = { x: t.x, y: t.y - this.halfHeight(this.crouched) + hStand + 0.02, z: t.z };
		const shape = new RAPIER.Capsule(hStand, c.radius * 0.95);
		let blocked = false;
		this.physics.world.intersectionsWithShape(
			center,
			{ x: 0, y: 0, z: 0, w: 1 },
			shape,
			() => {
				blocked = true;
				return false;
			},
			RAPIER.QueryFilterFlags.EXCLUDE_SENSORS | RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC,
			undefined,
			this.collider,
		);
		return !blocked;
	}

	/** Interpolated feet position for rendering. */
	feet(alpha: number, out = new THREE.Vector3()) {
		return out.lerpVectors(this.feet0, this.feet1, alpha);
	}

	eyeHeight() {
		const c = this.cfg;
		return THREE.MathUtils.lerp(c.height, c.crouchHeight, this.crouchT) - c.eyeFromTop;
	}

	/** Horizontal speed, m/s. */
	speed() {
		return Math.hypot(this.vel.x, this.vel.z);
	}

	teleport(p: THREE.Vector3, yaw = this.yaw, pitch = 0) {
		const half = this.halfHeight(this.crouched);
		this.body.setTranslation({ x: p.x, y: p.y + this.cfg.radius + half, z: p.z }, true);
		this.body.setNextKinematicTranslation({ x: p.x, y: p.y + this.cfg.radius + half, z: p.z });
		this.feet0.copy(p);
		this.feet1.copy(p);
		this.vel.set(0, 0, 0);
		this.yaw = yaw;
		this.pitch = pitch;
	}
}
