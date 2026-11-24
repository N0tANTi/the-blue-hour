// Smoke drawn as clean ribbon curls (additive, unbanded) rising from ashtrays and cigarettes.
import * as THREE from 'three/webgpu';
import { abs, max, attribute, cos, float, positionLocal, sin, smoothstep, uniform, uv, vec3 } from 'three/tsl';
import { additive } from './mats';
import type { Club } from './club';

export class FX {
	private ribbons: THREE.Mesh[] = [];
	private uTime = uniform(0);

	constructor(scene: THREE.Scene, club: Club) {
		const sources: THREE.Vector3[] = [];
		for (const p of club.ashtrays) sources.push(p.clone());
		const st = club.stage;
		sources.push(new THREE.Vector3(st.sax.x + 0.75, st.sax.y + 0.98, st.sax.z + 0.25));
		sources.push(new THREE.Vector3(club.cardTable.x + 0.55, 0.85, 0.45), new THREE.Vector3(club.cardTable.x - 0.7, 1.25, -0.6), new THREE.Vector3(-3.35, 1.42, 14.45));
		const H = 1.6;
		const g = new THREE.PlaneGeometry(0.016, H, 1, 64);
		g.translate(0, H / 2, 0);
		const pos = g.attributes.position;
		const v = new Float32Array(pos.count);
		for (let i = 0; i < pos.count; i++) v[i] = pos.getY(i) / H;
		g.setAttribute('h', new THREE.BufferAttribute(v, 1));
		sources.forEach((p, i) => {
			const seed = i * 1.7;
			const h = attribute('h', 'float');
			const t = this.uTime.add(seed);
			// the curl: a lazy S that sways and twists more as it rises
			const amp = h.mul(0.08).add(h.mul(h).mul(0.2));
			const x = sin(h.mul(6.0).sub(t.mul(0.7))).mul(amp).add(sin(h.mul(13).add(t.mul(1.3))).mul(h).mul(0.02));
			const z = cos(h.mul(4.5).sub(t.mul(0.5))).mul(amp.mul(0.7));
			const width = float(1).add(h.mul(h).mul(7));
			const soft = max(float(0), float(1).sub(abs(uv().x.sub(0.5)).mul(2))).pow(1.5);
			const opacity = smoothstep(0.0, 0.05, h).mul(float(1).sub(smoothstep(0.4, 1.0, h))).mul(soft).mul(0.85);
			const m = additive(`smoke${i}`, '#efe0d0', 0.7, { opacityNode: opacity });
			m.positionNode = vec3(positionLocal.x.mul(width).add(x), positionLocal.y, positionLocal.z.add(z));
			const mesh = new THREE.Mesh(g, m);
			mesh.position.copy(p);
			mesh.frustumCulled = false;
			mesh.renderOrder = 11;
			scene.add(mesh);
			this.ribbons.push(mesh);
		});
	}

	update(t: number, dt: number) {
		void dt;
		this.uTime.value = t;
	}

	/** Ribbons turn to face the camera around their vertical axis. */
	face(camera: THREE.Camera) {
		for (const r of this.ribbons) r.rotation.y = Math.atan2(camera.position.x - r.position.x, camera.position.z - r.position.z);
	}
}
