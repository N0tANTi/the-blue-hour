---
kind: game
engine: three.js
---

# The Blue Hour

A look preview: walk through an Art Deco jazz club in 1929 while the band plays its last set. The stage, the bar, a card room under blue lamps and a balcony over the night city. No game yet, just the place.

On Patch as `blendi/the-blue-hour`.

> **Some files aren't in this repo.** The six characters' animation clips and 22 club sounds come from libraries whose licences allow them inside a game but not as files anyone can download. In their place the characters here hold still poses we made, and those sounds are silent. [MISSING_ASSETS.md](MISSING_ASSETS.md) lists every one, where to get it and how to put it back.

## How it's built

A first-person browser game in TypeScript on [three.js](https://threejs.org) (`WebGPURenderer`, which falls back to its own WebGL2 backend), with [Rapier](https://rapier.rs) for walking, bundled by Vite into a folder of static files. The look is flat cel-shaded graphic noir: lighting is quantised into hard bands in a post pass (`src/render/pipeline.ts`), with one colour key per zone. The club, the stained glass, the bar and its 400-odd bottles, the tables and the city outside are all built in code. The models are five CC-BY props and six characters generated for this game. The band plays four public-domain recordings from 1923 and 1924.

## Run it

It takes Node 20 or newer.

```sh
npm ci
npm run dev        # http://localhost:5173
npm run build      # makes dist/, the game as Patch serves it
npm run preview    # serves dist/ with the game host's headers, at http://localhost:8080
```

Controls: WASD to walk, the mouse to look (click the view), Shift to walk faster, Esc to pause.

`AGENTS.md` says how to check and change it, and where things live.

## What's left out

- **The characters' animation clips.** Each of the six characters is our own generated mesh and rig, but its ten clips (sitting, talking, drinking, looking around, walking) come from Mixamo, which may not be passed on as files. The repo's `src/assets/models/chars/*.glb` are the same characters with those clips taken out and ten still poses of ours put in, so seated guests sit and the rest stand. The pianist's and saxophonist's arms are posed in code either way.
- **22 club sounds**, each as `.ogg` and `.m4a`: the crowd's murmur, the room tone, glasses, ice, a pour, floor creaks, applause and carpet steps. They come from the Sonniss GDC Game Audio Bundles. Without them those sounds are silent; the band, the wood footsteps and the lighter play.

[MISSING_ASSETS.md](MISSING_ASSETS.md) has each file, its source, its licence, and the scripts that rebuild them.

## Licence

The code is MIT ([LICENSE](LICENSE)). The art in this repo is open: our own work (everything built in code, the characters' meshes, rigs and still poses) is CC0 1.0, the five props are CC BY 4.0 (credit required), the music is public domain and the other sounds are CC0. [LICENSE-ART](LICENSE-ART) and [ASSETS.md](ASSETS.md) have the details. The released game's art licence is proprietary only because of the left-out files. The libraries it bundles keep their own licences, in [LICENSES/](LICENSES). Credits shown in the game: [public/CREDITS.md](public/CREDITS.md).
