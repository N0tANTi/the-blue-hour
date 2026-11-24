# Working on The Blue Hour

A first-person three.js browser game on [Patch](https://patch.gg), in TypeScript, bundled by Vite: one Art Deco jazz club in 1929. It's a look preview, with no game yet. Start with `npm ci`. What the person asks for comes first: nothing here says what to make.

## Missing files

The characters' animation clips and 22 club sounds aren't in the repo, because their licences don't allow passing them on as files. The game runs without them: the characters in `src/assets/models/chars/` are stand-ins with still poses of ours under the same clip names, and the missing sounds are silent (the game asks for them at `assets/undefined`, which fails). [MISSING_ASSETS.md](MISSING_ASSETS.md) says where to get each one and how to rebuild them. Never commit those files, never add them to Patch's asset library, and never send them to an AI service. New art you add should be CC0 or CC-BY (credited), so it can stay in the repo.

## Run

- `npm run dev`: Vite on port 5173.
- `npm run build`: makes `dist/`, which is the whole release. `npm run preview` serves it with the game host's headers on port 8080.
- URL flags (`src/config.ts`): `?renderer=webgpu|webgl2`, `?quality=low|medium|high|auto`, `?seed=`, `?clock=fixed`, `?debug=1` (F4 then cycles the debug buffers: light, albedo, emissive, depth), `?autostart=1`, `?reduce-motion=1`, `?patch-test=1` (the self-checks).

## Check

The browser scripts use `PATCH_CHROME` if it's set, otherwise Playwright's Chromium (`npx playwright install chromium`). They always run muted, and `scripts/no-pointer-lock.mjs` fakes the mouse lock, so a test never takes the real mouse. Keep both in any new script by importing `scripts/lib.mjs`.

| Command | What it checks |
| --- | --- |
| `pch check` (after a build) | Patch's own look at the game, as its host serves it |
| `pch validate` | `patch.json`, its recipe and its files |
| `npm run typecheck` | Types |
| `npm run check` | `dist/` against Patch's submit-time file checks |
| `npm run smoke` | The `?patch-test=1` self-checks |
| `npm run bot`, `npm run bot:webgl2` | A walk-through with real keyboard and mouse, on WebGPU and on WebGL2 |
| `node scripts/views.mjs [--only ref,bar,booth,cards,balcony] [--size 1920x1080] [--view 1..4]` | Fixed-camera look-dev captures; `--view` shows a debug buffer |
| `node scripts/perf.mjs` | Frames per second per zone at 1080p |
| `node scripts/walk.mjs` | A 15 s walk-through clip |
| `node tools/zcheck.mjs [--scan-only]` | Coplanar faces that would z-fight, plus a grazing flicker test. Run it after building anything new |
| `node tools/loadprobe.mjs` | Load marks and long tasks only |

Screenshots and clips go in `shots/`, which git ignores.

## Change

- `public/` ships as it is: `CREDITS.md`, `LICENSE` (a copy of the one at the top, so change both) and `patch-credits.js` (the "i" credits button). Assets in `src/assets/` are bundled by Vite.
- **One render path:** `WebGPURenderer`, which falls back to its own WebGL2 backend (`?renderer=webgl2` forces it).
- **The look** (`src/render/pipeline.ts`): the scene pass renders output, albedo and emissive (MRT, MSAA). Light is recovered as (lit - emissive) / albedo, quantised into hard bands and multiplied back onto the flat albedo, so every light, shadow and falloff gets the same cel treatment. Then near-camera darkening, a screen-space rim, glow bloom, a distance haze, the palette grade, tone mapping, vignette and grain.
- **Zone keys:** `src/world/looks.ts` holds the hall (amber), the card room (blue and violet) and the balcony (navy); the game blends them by the camera's zone.
- **Materials:** `lambert`, `gloss` and `glow` are baked by `Builder` into vertex colours, so each zone renders with a few materials (`src/world/mats.ts`, `build.ts`). Self-lit things (lamps, bottles, city, glass, beams, smoke) go to the emissive target and are never banded.
- **Light lists:** each zone's materials see only that zone's lights (`lightsNode = lights([...])`), and so do props and people (`applyZone`). Otherwise every shader loops over all ~30 lights, and compiles and frames slow down.
- **No z-fighting:** trims stand proud and stop short of shared planes. Keep it that way.
- **People** (`src/world/people.ts`): six characters on a Mixamo-named skeleton (`src/assets/models/chars/*.glb` and `.meta.json`). Seat one at `seatY - meta.seat.seatSurfaceY`. Each person plays clips from a pool by name (`sit_idle`, `sit_talk`, `sit_drink`, `sit_rub`, `sit_laugh`, `drink`, `look_around`, `look_away`, `idle`, `walk`), so a character file needs every clip its pool names. The band's arms are two-bone IK (`solveArm`); a character's right-hand side is `(-fwd.z, 0, fwd.x)`.
- **Sound** (`src/audio/club-audio.ts`): the four band recordings play in turn as a set; effects and beds are decoded Web Audio buffers.
- To publish: put the next version in `patch.json`, commit, then `pch publish`, which says what comes next. A fork's `patch.json` has to name the fork, and a fork that ships the missing files must keep a proprietary art licence, as this game's release does.

## Where things live

| Path | What |
| --- | --- |
| `src/world/` | The club: `club.ts` and `build.ts` the room and its ornament, `tableware.ts` the tables, `props.ts` the five props, `people.ts` the guests and band, `looks.ts` the zone keys, `mats.ts` the materials, `city.ts` the city, `art.ts` the stained glass and canvas art, `fx.ts` smoke and beams |
| `src/render/pipeline.ts` | The cel-shaded post chain |
| `src/audio/club-audio.ts` | The band, the room and the effects |
| `src/player/`, `src/physics/` | The first-person walker on Rapier |
| `src/harness/` | The `?patch-test=1` self-checks |
| `src/game.ts`, `src/config.ts`, `src/game.config.ts` | The game loop and flags |
| `assets-src/chars/` | The characters' rigs before clips, and the tools that bake the clips in |
| `assets-src/audio/LEDGER.md`, `tools/audio/build.py` | Every sound's source, licence and processing, and the script that builds them |
| `scripts/`, `tools/` | Test, look-dev and probe scripts |
