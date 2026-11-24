# Missing assets

The released game ships 6 characters with 10 animation clips each, and 32 sounds. This repo has the characters without those clips, and 10 of the sounds. The rest isn't here, because it comes from two libraries whose licences let anyone use it in a game but not pass it on as files: **Mixamo** (the clips) and the **Sonniss GDC Game Audio Bundles** (22 sounds). This file lists each one so you can get it and put it back.

## What happens without them

The game builds and runs.

- **People:** each character file here is the released character with the Mixamo clips taken out and ten still poses of ours under the same clip names: guests in chairs and booths sit with their hands in their laps, everyone else stands with their arms down, and the man who walks the floor glides in a standing pose. Nobody talks, drinks or looks around. The band's arms are posed in code, so they still play.
- **Sound:** the 22 sounds below are silent, including the crowd's murmur and the room tone, so the club is quieter than it should be. The band, the wood footsteps and the lighter play. The game still asks for each missing sound as it loads, at `assets/undefined` (the build has no file to point it at), so the browser logs a failed request there and `pch check` reports it.

## Animation clips (Mixamo)

- **Files:** `src/assets/models/chars/tux.glb`, `fedora.glb`, `trench.glb`, `barman.glb`, `gown_gloves.glb`, `gown_bob.glb` are in the repo as stand-ins. The released versions also hold these ten clips each.
- **Source:** https://www.mixamo.com (free with an Adobe account). Download each animation below as FBX (Mixamo's packs come as a zip of these files) and keep the folder and file names shown, under a folder named `mixamo/` at the top of the repo:

| Clip in the game | Mixamo animation | Who |
| --- | --- | --- |
| `sit_idle` | `mixamo/Survival/Sitting Idle.fbx` | all |
| `sit_talk` | `mixamo/Survival/Sitting Talking.fbx` | all |
| `sit_drink` | `mixamo/Survival/Sitting Drinking.fbx` (frames 157 to 355 are used, turned 180°) | all |
| `sit_rub` | `mixamo/Survival/Sitting Rubbing Arm.fbx` | all |
| `sit_laugh` | `mixamo/Survival/Sitting Victory.fbx` | all |
| `drink` | `mixamo/Survival/Drinking.fbx` | all |
| `look_around` | `mixamo/Survival/Nervously Look Around.fbx` | all |
| `look_away` | `mixamo/Gestures Pack Basic/look away gesture.fbx` | all |
| `idle` | `mixamo/Male Locomotion Pack/idle.fbx`, or `mixamo/Female Locomotion Pack/idle.fbx` for `gown_gloves` and `gown_bob` | per character |
| `walk` | `mixamo/Male Locomotion Pack/walking (in place).fbx`, or the Female Locomotion Pack's for the two gowns | per character |

The names are from Mixamo's packs (Survival, Gestures Pack Basic, Male and Female Locomotion). Each character's exact list, with its trims and fixes, is `assets-src/chars/<id>/clips.json`.

- **Licence:** Adobe's Mixamo terms: free, royalty-free use of the characters and animations in your own projects, games included, commercial or not. You may not pass on the animation files on their own. So keep `mixamo/` and the rebuilt character files out of git, and a released game that ships them keeps a proprietary art licence.
- **How to put them back:** for each character, with [Blender](https://www.blender.org) and from the top of the repo:
  1. `blender -b --factory-startup --python assets-src/chars/tools/retarget_deco.py -- assets-src/chars/<id>/<id>-rig.glb assets-src/chars/<id>/<id>-anim.glb assets-src/chars/<id>/clips.json --align-rest on` retargets the clips onto our rig, keeps sitting clips on one chair and feet on the floor.
  2. `npx @gltf-transform/cli optimize assets-src/chars/<id>/<id>-anim.glb assets-src/chars/<id>/<id>-opt.glb --compress false --texture-compress webp --texture-size 512 --no-join --no-flatten --no-simplify --no-palette`, then `npx @gltf-transform/cli webp assets-src/chars/<id>/<id>-opt.glb assets-src/chars/<id>/<id>-opt.glb --lossless true`.
  3. `node assets-src/chars/tools/sampler.mjs assets-src/chars/<id>/<id>-opt.glb src/assets/models/chars/<id>.glb` (it needs `npm i --no-save @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer`).
  4. So git doesn't pick up the six rebuilt files: `git update-index --skip-worktree src/assets/models/chars/*.glb`.

  The `.meta.json` beside each character (its seat height and clip lengths) is already the released one. The rebuilt files won't be byte-identical to the released game's, but they're the same clips on the same rigs.

## Sounds (Sonniss)

- **Source:** the Sonniss GDC Game Audio Bundles, free from Sonniss, one bundle per year: https://sonniss.com/gameaudiogdc/ (this game uses the 2016, 2018, 2019 and 2020 bundles). The links below go to each file on a public mirror of the bundles; the bundle names the library folder.
- **Licence:** https://sonniss.com/gdc-bundle-license/. Royalty-free, for commercial and non-commercial projects, no credit required (the game credits them in `public/CREDITS.md` anyway). You may use the sounds inside your game; you may not share, sell or give away the sound files themselves. So keep them out of git, out of Patch's asset library and away from AI services, and a released game that ships them keeps a proprietary art licence.
- **How to put them back:**
  1. Download the bundles and unzip them into one folder, laid out `<year>/<library folder>/<file>`, for example `sonniss/2018/West Wolf - Restaurant Ambiences/RA_40_Restaurant_Bar_Night_Fridges_Empty_Room Tone_Neumann KM184 ORTF.wav`. The exact names are in `tools/audio/build.py`.
  2. Install Python 3 with numpy, and [ffmpeg](https://ffmpeg.org) with libopus and AAC.
  3. `SONNISS_DIR=<that folder> python -I tools/audio/build.py --skip-music --only <ids>`, with the ids below separated by commas. It cuts, cleans, loops and levels each one exactly as the ledger says, and writes `src/assets/audio/<id>.ogg` and `.m4a`. `.gitignore` keeps them out of git.
  4. `npm run build`.

  `assets-src/audio/LEDGER.md` has every cut, filter and loudness target. The rebuilt files won't be byte-identical to the released game's, as encoders differ.

| Files | What it is | Recording |
| --- | --- | --- |
| `src/assets/audio/ambience-walla.ogg`, `.m4a` | Seated-crowd murmur | [Sonniss GDC layers: 2018 West Wolf - Restaurant Ambiences / RA_06_Restaurant_Dinner_Int_Walla_Crowd_50-75 People_Germany_Zoom H4.wav; 2020 Sonik Sound Library - Spatial Crowds / Ambience, Wedding Crowd, Crowd in a Open Bar Wedding Banquet-Surround.wav; 2016 Chupapsound - CROWD AMBIANCE / hall ambiance people far st.wav; laughs from 2018 Soundrangers - Audience Reactions (sitcom_studio_crowd_laughter_10.wav, theater_audience_laughter_applause_01.wav)](https://ftpmirror.your.org/pub/misc/sonniss2018/individual/West%20Wolf%20-%20Restaurant%20Ambiences/RA_06_Restaurant_Dinner_Int_Walla_Crowd_50-75%20People_Germany_Zoom%20H4.wav) |
| `src/assets/audio/ambience-roomtone.ogg`, `.m4a` | Empty bar at night with fridges | [Sonniss GDC 2018 bundle / West Wolf - Restaurant Ambiences / RA_40_Restaurant_Bar_Night_Fridges_Empty_Room Tone_Neumann KM184 ORTF.wav](https://ftpmirror.your.org/pub/misc/sonniss2018/individual/West%20Wolf%20-%20Restaurant%20Ambiences/RA_40_Restaurant_Bar_Night_Fridges_Empty_Room%20Tone_Neumann%20KM184%20ORTF.wav) |
| `src/assets/audio/glass-clink-1.ogg`, `.m4a` | Two drinking glasses touching (single) | [Sonniss GDC 2019 bundle / 3maze - Kitchenware / drinks_glasses_touching_003.wav](https://ftpmirror.your.org/pub/misc/sonniss2019/individual/3maze%20-%20Kitchenware/drinks_glasses_touching_003.wav) |
| `src/assets/audio/glass-clink-2.ogg`, `.m4a` | Wine-glass hit #1 (0.21 s in the source) | [Sonniss GDC 2016 bundle / George Karagioules - The Source Collection SFX Pack / Wine Glass Hit Higher Pitch.wav](https://ftpmirror.your.org/pub/misc/sonniss2016/individual/George%20Karagioules%20-%20The%20Source%20Collection%20SFX%20Pack/Wine%20Glass%20Hit%20Higher%20Pitch.wav) |
| `src/assets/audio/glass-clink-3.ogg`, `.m4a` | Wine-glass hit #2 (1.08 s in the source) | [Sonniss GDC 2016 bundle / George Karagioules - The Source Collection SFX Pack / Wine Glass Hit Higher Pitch.wav](https://ftpmirror.your.org/pub/misc/sonniss2016/individual/George%20Karagioules%20-%20The%20Source%20Collection%20SFX%20Pack/Wine%20Glass%20Hit%20Higher%20Pitch.wav) |
| `src/assets/audio/glass-clink-4.ogg`, `.m4a` | Wine-glass hit #4 (4.81 s in the source) | [Sonniss GDC 2016 bundle / George Karagioules - The Source Collection SFX Pack / Wine Glass Hit Higher Pitch.wav](https://ftpmirror.your.org/pub/misc/sonniss2016/individual/George%20Karagioules%20-%20The%20Source%20Collection%20SFX%20Pack/Wine%20Glass%20Hit%20Higher%20Pitch.wav) |
| `src/assets/audio/ice-1.ogg`, `.m4a` | Ice cubes dropped into a glass (first drop, 0.16-1.66 s) | [Sonniss GDC 2016 bundle / Qbsound Studio - Bar Effects / Ice filling glass 01 NT1-A.wav](https://ftpmirror.your.org/pub/misc/sonniss2016/individual/Qbsound%20Studio%20-%20Bar%20Effects/Ice%20filling%20glass%2001%20NT1-A.wav) |
| `src/assets/audio/ice-2.ogg`, `.m4a` | Ice swirled in a tumbler (0.09-2.09 s) | [Sonniss GDC 2018 bundle / Airborne Sound - Kitchen / Ice Cubes,Glass,Tumbler,Water,Swirl,Rattle.wav](https://ftpmirror.your.org/pub/misc/sonniss2018/individual/Airborne%20Sound%20-%20Kitchen/Ice%20Cubes%2CGlass%2CTumbler%2CWater%2CSwirl%2CRattle.wav) |
| `src/assets/audio/pour-1.ogg`, `.m4a` | Short drink pour (0.25-1.9 s) | [Sonniss GDC 2020 bundle / SpillAudio - Bar and Coffee Shop / pouring_007.wav](https://ftpmirror.your.org/pub/misc/sonniss2020/individual/SpillAudio%20-%20Bar%20and%20Coffee%20Shop/pouring_007.wav) |
| `src/assets/audio/glass-set-down-1.ogg`, `.m4a` | Heavy glass base knocked down on wood (4.37 s in the source, before it slides) | [Sonniss GDC 2020 bundle / Wav Junction Sound Effects - Glassware / 0081_Glass_large_slide_on_wood_surface_2.wav](https://ftpmirror.your.org/pub/misc/sonniss2020/individual/Wav%20Junction%20Sound%20Effects%20-%20Glassware/0081_Glass_large_slide_on_wood_surface_2.wav) |
| `src/assets/audio/glass-set-down-2.ogg`, `.m4a` | Glass set down (2.67 s in the source) | [Sonniss GDC 2016 bundle / Qbsound Studio - Bar Effects / Glasses handle 03 NTG-2.wav](https://ftpmirror.your.org/pub/misc/sonniss2016/individual/Qbsound%20Studio%20-%20Bar%20Effects/Glasses%20handle%2003%20NTG-2.wav) |
| `src/assets/audio/glass-set-down-3.ogg`, `.m4a` | Glass set down, sharper (0.35 s in the source) | [Sonniss GDC 2016 bundle / Qbsound Studio - Bar Effects / Glasses handle 03 NTG-2.wav](https://ftpmirror.your.org/pub/misc/sonniss2016/individual/Qbsound%20Studio%20-%20Bar%20Effects/Glasses%20handle%2003%20NTG-2.wav) |
| `src/assets/audio/floor-creak-1.ogg`, `.m4a` | Old wood floor creak (0.38-1.58 s) | [Sonniss GDC 2019 bundle / Matt Script - Squeaks & Creaks / Old wood floor_creak_creaking_slow_back and forth_04.wav](https://ftpmirror.your.org/pub/misc/sonniss2019/individual/Matt%20Script%20-%20Squeaks%20%26%20Creaks/Old%20wood%20floor_creak_creaking_slow_back%20and%20forth_04.wav) |
| `src/assets/audio/floor-creak-2.ogg`, `.m4a` | Longer floor creak (2.82-4.57 s) | [Sonniss GDC 2019 bundle / Matt Script - Squeaks & Creaks / Old wood floor_creak_creaking_slow_back and forth_04.wav](https://ftpmirror.your.org/pub/misc/sonniss2019/individual/Matt%20Script%20-%20Squeaks%20%26%20Creaks/Old%20wood%20floor_creak_creaking_slow_back%20and%20forth_04.wav) |
| `src/assets/audio/applause-1.ogg`, `.m4a` | Small-group applause, first burst (0-9.6 s) with its natural decay; tail faded from 6.8 s | [Sonniss GDC 2019 bundle / 2496SoundEffects - Bits, Scraps and Pieces Super Pack / Cheer Clapping Small Group In Theater Applause sound effect.wav](https://ftpmirror.your.org/pub/misc/sonniss2019/individual/2496SoundEffects%20-%20Bits%2C%20Scraps%20and%20Pieces%20Super%20Pack/Cheer%20Clapping%20Small%20Group%20In%20Theater%20Applause%20sound%20effect.wav) |
| `src/assets/audio/applause-2.ogg`, `.m4a` | Small-group applause, third burst (23.95-32.05 s), 150 ms fade-in, tail faded from 5.6 s | [Sonniss GDC 2019 bundle / 2496SoundEffects - Bits, Scraps and Pieces Super Pack / Cheer Clapping Small Group In Theater Applause sound effect.wav](https://ftpmirror.your.org/pub/misc/sonniss2019/individual/2496SoundEffects%20-%20Bits%2C%20Scraps%20and%20Pieces%20Super%20Pack/Cheer%20Clapping%20Small%20Group%20In%20Theater%20Applause%20sound%20effect.wav) |
| `src/assets/audio/step-carpet-1.ogg`, `.m4a` | Single soft step on carpet (sneakers) sliced from the 90 fpm loop at 2.829 s | [Sonniss GDC 2018 bundle / The Sound Pack Tree - Footstep Loops / 1806 - Footsteps - Sneakers on Carpet - 90 fpm - Loop.wav](https://ftpmirror.your.org/pub/misc/sonniss2018/individual/The%20Sound%20Pack%20Tree%20-%20Footstep%20Loops/1806%20-%20Footsteps%20-%20Sneakers%20on%20Carpet%20-%2090%20fpm%20-%20Loop.wav) |
| `src/assets/audio/step-carpet-2.ogg`, `.m4a` | Single soft step on carpet (sneakers) sliced from the 90 fpm loop at 6.826 s | [Sonniss GDC 2018 bundle / The Sound Pack Tree - Footstep Loops / 1806 - Footsteps - Sneakers on Carpet - 90 fpm - Loop.wav](https://ftpmirror.your.org/pub/misc/sonniss2018/individual/The%20Sound%20Pack%20Tree%20-%20Footstep%20Loops/1806%20-%20Footsteps%20-%20Sneakers%20on%20Carpet%20-%2090%20fpm%20-%20Loop.wav) |
| `src/assets/audio/step-carpet-3.ogg`, `.m4a` | Single soft step on carpet (sneakers) sliced from the 90 fpm loop at 12.160 s | [Sonniss GDC 2018 bundle / The Sound Pack Tree - Footstep Loops / 1806 - Footsteps - Sneakers on Carpet - 90 fpm - Loop.wav](https://ftpmirror.your.org/pub/misc/sonniss2018/individual/The%20Sound%20Pack%20Tree%20-%20Footstep%20Loops/1806%20-%20Footsteps%20-%20Sneakers%20on%20Carpet%20-%2090%20fpm%20-%20Loop.wav) |
| `src/assets/audio/step-carpet-4.ogg`, `.m4a` | Single soft step on carpet (sneakers) sliced from the 90 fpm loop at 13.494 s | [Sonniss GDC 2018 bundle / The Sound Pack Tree - Footstep Loops / 1806 - Footsteps - Sneakers on Carpet - 90 fpm - Loop.wav](https://ftpmirror.your.org/pub/misc/sonniss2018/individual/The%20Sound%20Pack%20Tree%20-%20Footstep%20Loops/1806%20-%20Footsteps%20-%20Sneakers%20on%20Carpet%20-%2090%20fpm%20-%20Loop.wav) |
| `src/assets/audio/step-carpet-5.ogg`, `.m4a` | Single soft step on carpet (sneakers) sliced from the 90 fpm loop at 16.829 s | [Sonniss GDC 2018 bundle / The Sound Pack Tree - Footstep Loops / 1806 - Footsteps - Sneakers on Carpet - 90 fpm - Loop.wav](https://ftpmirror.your.org/pub/misc/sonniss2018/individual/The%20Sound%20Pack%20Tree%20-%20Footstep%20Loops/1806%20-%20Footsteps%20-%20Sneakers%20on%20Carpet%20-%2090%20fpm%20-%20Loop.wav) |
| `src/assets/audio/step-carpet-6.ogg`, `.m4a` | Single soft step on carpet (sneakers) sliced from the 90 fpm loop at 20.162 s | [Sonniss GDC 2018 bundle / The Sound Pack Tree - Footstep Loops / 1806 - Footsteps - Sneakers on Carpet - 90 fpm - Loop.wav](https://ftpmirror.your.org/pub/misc/sonniss2018/individual/The%20Sound%20Pack%20Tree%20-%20Footstep%20Loops/1806%20-%20Footsteps%20-%20Sneakers%20on%20Carpet%20-%2090%20fpm%20-%20Loop.wav) |

The ids for step 3: `ambience-walla,ambience-roomtone,glass-clink-1,glass-clink-2,glass-clink-3,glass-clink-4,ice-1,ice-2,pour-1,glass-set-down-1,glass-set-down-2,glass-set-down-3,floor-creak-1,floor-creak-2,applause-1,applause-2,step-carpet-1,step-carpet-2,step-carpet-3,step-carpet-4,step-carpet-5,step-carpet-6`.

## Already here

- The six characters' meshes, textures and rigs (generated for this game, ours), and the rigs before any clip, in `assets-src/chars/<id>/<id>-rig.glb`.
- The five props (CC BY 4.0), the four band recordings (public domain), the eight wood footsteps and the lighter (Freesound, CC0). [ASSETS.md](ASSETS.md) has their sources.
