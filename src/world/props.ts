// Hero props from Sketchfab (CC BY, see CREDITS.md): piano, sax, palms, chairs, stools, fedora.
// Their materials are replaced by our flat palette by part name.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { color, texture } from 'three/tsl';
import type { Physics } from '../physics/physics';
import { RAPIER } from '../physics/physics';
import type { Club } from './club';
import { applyZone, gloss, lambert, PAL, velvetStandalone } from './mats';

const url = (f: string) => new URL(`../assets/models/props/${f}`, import.meta.url).href;

export interface Props {
	piano: THREE.Object3D;
	sax: THREE.Object3D;
	palm: THREE.Object3D;
	chair: THREE.Object3D;
	stool: THREE.Object3D;
	place(scene: THREE.Scene, club: Club, physics: Physics): void;
}

const PART: Record<string, () => THREE.Material> = {
	lacquer: () => gloss('pianoLacquer', '#080505', 0.18),
	keys_white: () => lambert('keysWhite', '#d8c8a8'),
	keys_black: () => lambert('keysBlack', '#060404'),
	brass: () => gloss('brass', PAL.brass, 0.28, 0.85),
	felt: () => lambert('pianoFelt', '#5a1410'),
	strings: () => gloss('pianoStrings', '#a88050', 0.4, 0.7),
	plate: () => gloss('pianoPlate', '#8a6030', 0.4, 0.7),
	wood: () => lambert('pianoWood', '#2a1208'),
	keys: () => gloss('saxKeys', '#e0b060', 0.25, 0.9),
	pearls: () => lambert('saxPearls', '#e8dcc8'),
	mouthpiece: () => gloss('saxMouth', '#0a0806', 0.3),
	pot: () => lambert('urn', '#2a1a10'),
	soil: () => lambert('soil', '#0a0604'),
	upholstery: () => velvetStandalone(PAL.leather),
	cushion: () => lambert('stoolCushion', PAL.leather),
	chrome: () => gloss('chrome', '#c0b0a0', 0.25, 0.9),
	rubber: () => lambert('rubber', '#080606'),
	band: () => lambert('hatBand', '#1a0a06'),
};

function restyle(root: THREE.Object3D, overrides: Record<string, () => THREE.Material> = {}) {
	root.traverse((o) => {
		const m = o as THREE.Mesh;
		if (!m.isMesh) return;
		m.castShadow = true;
		m.receiveShadow = true;
		const mats = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[];
		const next = mats.map((mat) => {
			const key = mat.name;
			if (key === 'leaves') {
				// keep the leaf alpha, flatten its colour: a palm reads as a dark silhouette with a little green-umber
				const lm = new THREE.MeshLambertNodeMaterial({ side: THREE.DoubleSide, alphaTest: 0.5 });
				lm.name = 'palmLeaves';
				lm.colorNode = color('#2a2210');
				if (mat.map) lm.opacityNode = texture(mat.map).a;
				return lm;
			}
			const f = overrides[key] ?? PART[key];
			if (f) return f();
			if (key === 'wood') return lambert('propWood', PAL.woodDark);
			return lambert(`prop-${key}`, '#2a1810');
		});
		m.material = Array.isArray(m.material) ? next : next[0];
	});
	return root;
}

export async function loadProps(renderer: THREE.WebGPURenderer): Promise<Props> {
	void renderer;
	const loader = new GLTFLoader();
	loader.setMeshoptDecoder(MeshoptDecoder);
	const get = async (f: string) => (await loader.loadAsync(url(f))).scene;
	const [piano, sax, palm, chair, stool] = await Promise.all(['grand-piano.glb', 'alto-sax.glb', 'potted-palm.glb', 'club-chair.glb', 'bar-stool.glb'].map(get));
	restyle(piano);
	// the keys' end faces sit flush on the cheek blocks: pull them in 0.3% along the keyboard
	piano.traverse((o) => {
		const m = o as THREE.Mesh;
		if (!m.isMesh || !/keys/.test((m.material as THREE.Material).name)) return;
		m.geometry = m.geometry.clone();
		m.geometry.computeBoundingBox();
		const c = m.geometry.boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();
		m.geometry.translate(-c.x, 0, 0);
		m.geometry.scale(0.997, 1, 1);
		m.geometry.translate(c.x, 0, 0.003); // and 3 mm back behind the front rail
	});
	restyle(sax);
	restyle(palm);
	restyle(chair);
	restyle(stool);

	return {
		piano,
		sax,
		palm,
		chair,
		stool,
		place(scene, club, physics) {
			const add = (o: THREE.Object3D, p: THREE.Vector3, yaw: number, s = 1) => {
				const c = o.clone();
				c.position.copy(p);
				c.rotation.y = yaw;
				c.scale.setScalar(s);
				const z = club.zoneAt(p);
				applyZone(c, z, club.zoneLights[z]);
				scene.add(c);
				return c;
			};
			// grand piano
			add(piano, club.stage.piano, club.stage.pianoYaw);
			physics.world.createCollider(RAPIER.ColliderDesc.cuboid(1.45, 0.6, 0.85).setTranslation(club.stage.piano.x, club.stage.piano.y + 0.6, club.stage.piano.z));
			// piano bench (simple)
			const bench = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.9), gloss('pianoLacquer', '#080505', 0.18));
			bench.position.set(club.stage.bench.x, club.stage.bench.y + 0.49, club.stage.bench.z);
			bench.castShadow = true;
			applyZone(bench, 'hall', club.zoneLights.hall);
			scene.add(bench);
			for (const [dx, dz] of [
				[-0.16, -0.38],
				[0.16, -0.38],
				[-0.16, 0.38],
				[0.16, 0.38],
			]) {
				const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.46, 0.04), gloss('pianoLacquer', '#080505', 0.18));
				leg.position.set(club.stage.bench.x + dx, club.stage.bench.y + 0.23, club.stage.bench.z + dz);
				applyZone(leg, 'hall', club.zoneLights.hall);
				scene.add(leg);
			}
			for (const p of club.palms) {
				add(palm, p.pos, p.yaw, p.s);
				physics.world.createCollider(RAPIER.ColliderDesc.cylinder(0.6, 0.35 * p.s).setTranslation(p.pos.x, p.pos.y + 0.6, p.pos.z));
			}
			// chairs for the seats that aren't on a booth
			for (const s of club.seats) {
				if (!(s as { chair?: boolean }).chair) continue;
				add(chair, s.pos.clone().setY(0), s.yaw + Math.PI, 1.0);
				physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.33, 0.4, 0.33).setTranslation(s.pos.x, 0.4, s.pos.z));
			}
			// bar stools along the counter
			for (const p of club.stools) {
				add(stool, p, 0);
				physics.world.createCollider(RAPIER.ColliderDesc.cylinder(0.38, 0.2).setTranslation(p.x, 0.38, p.z));
			}
		},
	};
}
