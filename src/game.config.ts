// The one file a forked game edits first: identity, default render path and feel tuning.
// Everything here can be overridden from the URL (see src/config.ts).

export const GAME = {
	title: 'The Blue Hour',
	slug: 'deco',
	/**
	 * Default render path:
	 *  - 'webgpu' : WebGPURenderer + TSL post (falls back to its WebGL2 backend when there is no WebGPU adapter)
	 *  - 'webgl2' : WebGPURenderer forced onto its WebGL2 backend (same TSL post; use to test the fallback)
	 *  - 'webgl'  : classic WebGLRenderer + pmndrs postprocessing
	 */
	renderer: 'webgpu' as 'webgpu' | 'webgl2' | 'webgl',
	/** Field of view, degrees (vertical). */
	fov: 62,
	/** Mouse sensitivity, radians per pixel (players can change it with [ and ]; saved in localStorage). */
	mouseSensitivity: 0.0022,
	/** Right-stick speed, radians per second at full tilt. */
	padSensitivity: 3.4,
};

/** First-person controller tuning (metres, seconds). */
export const MOVE = {
	radius: 0.35,
	height: 1.78,
	crouchHeight: 1.1,
	eyeFromTop: 0.13,
	walkSpeed: 2.9,
	sprintSpeed: 4.6,
	crouchSpeed: 2.6,
	adsSpeedScale: 0.6,
	groundAccel: 14,
	airAccel: 3.5,
	gravity: 24,
	fallGravityScale: 1.45,
	jumpHeight: 0.45,
	/** Releasing jump while rising cuts upward speed by this factor (variable jump height). */
	jumpCut: 0.5,
	coyoteTime: 0.12,
	jumpBuffer: 0.14,
	stepHeight: 0.35,
	maxSlopeDeg: 50,
	crouchLerp: 14,
};

