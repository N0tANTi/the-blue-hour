"""(The Blue Hour's copy of our general retarget script. Adds, per clip in clips.json:
  "yaw": degrees   turn the source motion about the vertical before transfer (Sitting Drinking sits facing away)
  "narrow": 0..1        bring the knees and ankles towards the centre line (gowns: less spread, less skirt stretch)
  "foot_lift": metres   raise both ankle IK targets (soles that dip under the floor in a seated pose)
  "align_hips_to": "<earlier clip name>"   shift this clip so its mean hips position equals that clip's mean
                   (every sitting clip then uses the same chair), and re-solve both legs with a two-bone IK so the
                   ankles stay where the source put them relative to the floor (horizontal offset follows the hips).
 and writes per-clip hips means and IK shifts to the meta.)

World-space, rest-corrected retarget of Mixamo FBX clips onto a Mixamo-rigged character.

blender -b --factory-startup --python retarget_ws.py -- <character.gltf> <out.glb> <clips.json>

clips.json: [{"name": "idle", "file": "mixamo/standing idle.fbx", "inplace": false, "start": 0, "end": null,
              "strip_travel": true}]

Why not copy local rotations: a character's Mixamo-named rig is usually rigged on a different body than the clips' source
(X Bot), so rest orientations differ by a few degrees per bone, which shows up as splayed arms and knees that don't
line up with the feet. Here each target bone's world rotation is Q_src(t) * Q_src_rest^-1 * Q_tgt_rest, and the hips
translation is the source's offset from rest scaled by the hip-height ratio, so feet land where the source's feet land.

Characters: works for any Mixamo-named rig (any `prefix:`). Fixes for another game's character (drop a sword and
sheath, cut helmet horns) run only when those meshes exist, so this game's characters pass through untouched. Writes
<out>.meta.json (tux.glb -> tux.meta.json).

Rest alignment (A-pose targets): the clips' source (X Bot) rests in a T-pose. A target rigged in an A-pose would keep its
arms ~45 degrees lower in every clip, because only the delta from rest is transferred. With alignment on, the target's
rest is first swung, in world space, so each arm and leg segment points along the source's segment (the swing carries
down the chain to hands and fingers; feet and toes keep their own rest so soles stay flat), and the delta is applied to
that virtual rest. `auto` (the default) turns it on when an upper arm is more than 20 degrees off the source's, so the
T-pose rig bakes exactly as before.
  extra flags after clips.json: --align-rest on|off|auto
"""
import json
import math
import re
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector

argv = sys.argv[sys.argv.index('--') + 1:]
CHAR, OUT, CLIPS = argv[0], argv[1], argv[2]
OPTS = {'align-rest': 'auto'}
for i in range(3, len(argv) - 1, 2):
	OPTS[argv[i].lstrip('-')] = argv[i + 1]
clips = json.load(open(CLIPS))


def norm(name):
	n = name.split(':')[-1]
	n = re.sub(r'_\d+$', '', n)
	n = re.sub(r'^mixamorig\d*', '', n, flags=re.I)
	return n


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30

# ---- target ----
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=CHAR)
tobjs = [o for o in bpy.data.objects if o not in before]
tarm = max((o for o in tobjs if o.type == 'ARMATURE'), key=lambda o: len(o.data.bones))
for a in list(bpy.data.actions):
	bpy.data.actions.remove(a)
if tarm.animation_data:
	tarm.animation_data.action = None
	for tr in list(tarm.animation_data.nla_tracks):
		tarm.animation_data.nla_tracks.remove(tr)
else:
	tarm.animation_data_create()

# rename bones to clean Mixamo names (Hips, Spine, LeftArm...)
for b in tarm.data.bones:
	b.name = norm(b.name)

# drop the sword and sheath meshes (we attach our own tools to RightHand)
def chain(o):
	names = []
	while o is not None:
		names.append(o.name)
		o = o.parent
	return ' '.join(names)

viking_parts = 0
for o in list(tobjs):
	if o.type == 'MESH' and (re.search(r'Sword1|Sheath', chain(o)) or o.name.startswith('Icosphere')):
		print('drop', o.name, chain(o))
		bpy.data.objects.remove(o, do_unlink=True)
		viking_parts += 1

# cut the horns off the helmet (a horned helmet is a cliche): drop vertices
# beyond the dome's half-width. Only a character with a 'Helmet' node gets this; this game's skip it.
import bmesh
for o in list(bpy.data.objects):
	if o.type == 'MESH' and 'Helmet' in chain(o):
		viking_parts += 1
		me = o.data
		xs = [v.co.x for v in me.vertices]
		cx, w = (min(xs) + max(xs)) / 2, (max(xs) - min(xs)) / 2
		bm = bmesh.new()
		bm.from_mesh(me)
		kill = [v for v in bm.verts if abs(v.co.x - cx) > w * 0.52]
		bmesh.ops.delete(bm, geom=kill, context='VERTS')
		bm.to_mesh(me)
		bm.free()
		print('helmet: horns removed', len(kill))
print('viking-specific parts handled:', viking_parts)

# bones in hierarchy order
def order(arm):
	out = []
	def walk(b):
		out.append(b)
		for c in b.children:
			walk(c)
	for b in arm.data.bones:
		if b.parent is None:
			walk(b)
	return out

tbones = order(tarm)
TW = tarm.matrix_world.copy()
t_rest_w = {b.name: TW @ b.matrix_local for b in tbones}


def hip_height(rest_w):
	h = rest_w['Hips'].translation
	f = rest_w.get('LeftToeBase') or rest_w.get('LeftFoot')
	return h.z - f.translation.z


t_hip_h = hip_height(t_rest_w)
print('target hip height', t_hip_h)
t_head_w = {b.name: TW @ b.head_local for b in tbones}

# segments whose direction is aligned to the source's (bone -> child joint), and bones whose own rest is kept
ALIGN = {}
for s_ in ('Left', 'Right'):
	ALIGN.update({f'{s_}Shoulder': f'{s_}Arm', f'{s_}Arm': f'{s_}ForeArm', f'{s_}ForeArm': f'{s_}Hand',
				  f'{s_}UpLeg': f'{s_}Leg', f'{s_}Leg': f'{s_}Foot'})
KEEP_OWN = {'LeftFoot', 'RightFoot'}


def rest_alignment(s_head_w):
	"""World-space correction per target bone that swings arm/leg segments onto the source's directions."""
	C = {}
	for b in tbones:
		cp = C[b.parent.name] if b.parent is not None else Quaternion()
		if b.name in KEEP_OWN:
			cp = Quaternion()
		ch = ALIGN.get(b.name)
		if ch and ch in t_head_w and b.name in s_head_w and ch in s_head_w:
			dt = cp @ (t_head_w[ch] - t_head_w[b.name])
			ds = s_head_w[ch] - s_head_w[b.name]
			cp = dt.normalized().rotation_difference(ds.normalized()) @ cp
		C[b.name] = cp
	return C


def arm_offset_deg(s_head_w):
	worst = 0.0
	for s_ in ('Left', 'Right'):
		a, ch = f'{s_}Arm', f'{s_}ForeArm'
		if all(k in t_head_w and k in s_head_w for k in (a, ch)):
			worst = max(worst, (t_head_w[ch] - t_head_w[a]).angle(s_head_w[ch] - s_head_w[a]) * 57.29578)
	return worst

# rotation channels: quaternions everywhere
for pb in tarm.pose.bones:
	pb.rotation_mode = 'QUATERNION'

start_frame = 1
META = {}
HIPS_MEAN = {}
for ci, c in enumerate(clips):
	before = set(bpy.data.objects)
	before_act = set(bpy.data.actions)
	bpy.ops.import_scene.fbx(filepath=c['file'], use_anim=True, ignore_leaf_bones=False, automatic_bone_orientation=False)
	sobjs = [o for o in bpy.data.objects if o not in before]
	sarm = max((o for o in sobjs if o.type == 'ARMATURE'), key=lambda o: len(o.data.bones))
	sact = [a for a in bpy.data.actions if a not in before_act][0]
	SW = sarm.matrix_world.copy()
	smap = {norm(b.name): b.name for b in sarm.data.bones}
	s_rest_w = {norm(b.name): SW @ b.matrix_local for b in sarm.data.bones}
	ratio = t_hip_h / hip_height(s_rest_w)
	s_head_w = {norm(b.name): SW @ b.head_local for b in sarm.data.bones}
	mode = OPTS['align-rest']
	off = arm_offset_deg(s_head_w)
	align = mode == 'on' or (mode == 'auto' and off > 20)
	CORR = rest_alignment(s_head_w) if align else {}
	print(f"rest alignment: {'on' if align else 'off'} (mode {mode}, upper-arm offset {off:.1f} deg)")
	f0, f1 = int(sact.frame_range[0]), int(sact.frame_range[1])
	if c.get('start') is not None:
		f0 = max(f0, int(c['start']))
	if c.get('end') is not None:
		f1 = min(f1, int(c['end']))
	sarm.animation_data.action = sact
	YAW = Matrix.Rotation(math.radians(c.get('yaw', 0)), 4, 'Z')
	SWY = YAW @ SW

	act = bpy.data.actions.new(c['name'])
	act.use_fake_user = True
	tarm.animation_data.action = act

	# first pass: source hips world positions, to strip net travel for in-place
	scene.frame_set(f0)
	hips_first = (SWY @ sarm.pose.bones[smap['Hips']].matrix).translation.copy()
	scene.frame_set(f1)
	hips_last = (SWY @ sarm.pose.bones[smap['Hips']].matrix).translation.copy()
	n = max(1, f1 - f0)
	travel = hips_last - hips_first
	travel.z = 0
	strip = c.get('strip_travel', True)
	extract = c.get('root') == 'extract'
	root_curve = []

	s_hip_rest = s_rest_w['Hips'].translation
	t_hip_rest = t_rest_w['Hips'].translation
	TWI = TW.inverted()
	TWq = TW.to_quaternion().inverted()

	def solve(f, shift=None, over=None):
		"""armature-space matrices for frame f; shift: armature-space hips offset; over: bone -> extra rotation"""
		scene.frame_set(f)
		A = {}
		for b in tbones:
			sn = smap.get(b.name)
			if b.parent is not None:
				base = A[b.parent.name] @ (b.parent.matrix_local.inverted() @ b.matrix_local)
			else:
				base = b.matrix_local.copy()
			if sn is None:
				desired = base
			else:
				Ws = SWY @ sarm.pose.bones[sn].matrix
				qs = Ws.to_quaternion()
				qs_rest = s_rest_w[b.name].to_quaternion() if b.name in s_rest_w else qs
				qt_rest = t_rest_w[b.name].to_quaternion()
				if b.name in CORR:
					qt_rest = CORR[b.name] @ qt_rest
				qw = qs @ qs_rest.inverted() @ qt_rest
				q_arm = TWq @ qw
				if over and b.name in over:
					q_arm = over[b.name] @ q_arm
				pos = base.translation
				if b.name == 'Hips':
					ph = Ws.translation - s_hip_rest
					if strip:
						ph = ph - travel * ((f - f0) / n)
					pw = t_hip_rest + ph * ratio
					pos = (TWI @ pw)
					if shift is not None:
						pos = pos + shift
				desired = Matrix.Translation(pos) @ q_arm.to_matrix().to_4x4()
			A[b.name] = desired
		return A

	def leg_ik(A0, A1, shift):
		over = {}
		cx = (A1['LeftUpLeg'].translation.x + A1['RightUpLeg'].translation.x) / 2
		for s_ in ('Left', 'Right'):
			u, l, ft = f'{s_}UpLeg', f'{s_}Leg', f'{s_}Foot'
			h0, k0, a0 = A0[u].translation, A0[l].translation, A0[ft].translation
			h = A1[u].translation
			t = a0 + Vector((shift.x, shift.y, lift))
			if narrow:
				t.x = cx + (t.x - cx) * (1 - 0.5 * narrow)
			l1, l2 = (k0 - h0).length, (a0 - k0).length
			dv = t - h
			d = max(abs(l1 - l2) + 1e-3, min(dv.length, (l1 + l2) * 0.999))
			uu = dv.normalized()
			pole = (k0 - h0) - (a0 - h0).normalized() * (k0 - h0).dot((a0 - h0).normalized())
			if narrow:
				pole = Vector((pole.x * (1 - narrow), pole.y, pole.z))
			v = pole - uu * pole.dot(uu)
			v = v.normalized() if v.length > 1e-6 else Vector((0, -1, 0))
			x = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
			y = math.sqrt(max(0.0, l1 * l1 - x * x))
			k = h + uu * x + v * y
			r_up = (k0 - h0).normalized().rotation_difference((k - h).normalized())
			r_lo = (r_up @ (a0 - k0)).normalized().rotation_difference((t - k).normalized()) @ r_up
			over[u], over[l] = r_up, r_lo
		return over

	shift = None
	lift = float(c.get('foot_lift', 0))
	narrow = float(c.get('narrow', 0))
	if lift or narrow:
		shift = Vector()
	if c.get('align_hips_to'):
		acc = Vector()
		for f in range(f0, f1 + 1):
			acc += solve(f)['Hips'].translation
		mean = acc / (f1 - f0 + 1)
		shift = HIPS_MEAN[c['align_hips_to']] - mean
		print(f"align {c['name']} -> {c['align_hips_to']}: shift {tuple(round(x, 3) for x in shift)}")
	acc = Vector()
	for f in range(f0, f1 + 1):
		if shift is not None:
			A0 = solve(f)
			A1 = solve(f, shift)
			A = solve(f, shift, leg_ik(A0, A1, shift))
		else:
			A = solve(f)
		acc += A['Hips'].translation
		fr = f - f0 + start_frame
		for b in tbones:
			pb = tarm.pose.bones[b.name]
			if b.parent is not None:
				base = A[b.parent.name] @ (b.parent.matrix_local.inverted() @ b.matrix_local)
			else:
				base = b.matrix_local.copy()
			pb.matrix_basis = base.inverted() @ A[b.name]
			pb.keyframe_insert('rotation_quaternion', frame=fr)
			if b.name == 'Hips' or b.parent is None:
				pb.keyframe_insert('location', frame=fr)
	HIPS_MEAN[c['name']] = acc / (f1 - f0 + 1)
	extract = False
	root_curve = []
	META[c['name']] = {'frames': f1 - f0 + 1, 'fps': 30, 'hipsMean': [round(x, 4) for x in HIPS_MEAN[c['name']]], 'shift': [round(x, 4) for x in shift] if shift is not None else None}
	tr = tarm.animation_data.nla_tracks.new()
	tr.name = c['name']
	st = tr.strips.new(c['name'], start_frame, act)
	tarm.animation_data.action = None
	print(f"CLIP {c['name']}: {f1 - f0 + 1} frames, hip ratio {ratio:.3f}, net travel {travel.length:.3f} (stripped={strip})")
	for o in sobjs:
		bpy.data.objects.remove(o, do_unlink=True)
	for a in list(bpy.data.actions):
		if a is not act and a.name not in [x['name'] for x in clips]:
			if not a.use_fake_user:
				bpy.data.actions.remove(a)

# reset pose
for pb in tarm.pose.bones:
	pb.matrix_basis = Matrix.Identity(4)

bpy.ops.export_scene.gltf(
	filepath=OUT,
	export_format='GLB',
	export_animations=True,
	export_animation_mode='NLA_TRACKS',
	export_force_sampling=True,
	export_frame_step=1,
	export_optimize_animation_size=False,
	export_anim_single_armature=True,
	export_reset_pose_bones=True,
	export_def_bones=False,
	export_yup=True,
)
json.dump({'hipHeight': t_hip_h, 'clips': META}, open(OUT.replace('.glb', '.meta.json'), 'w'))
print('WROTE', OUT)
