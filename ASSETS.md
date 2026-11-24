# Assets

Every file in this repo that isn't code, where it came from and its licence. Credits shown to players are in `public/CREDITS.md` and the "i" button (`public/patch-credits.js`). What the released game has that this repo doesn't is in [MISSING_ASSETS.md](MISSING_ASSETS.md).

## Models: Sketchfab, CC BY 4.0

| File | Source | Author | Changes |
| --- | --- | --- | --- |
| `src/assets/models/props/grand-piano.glb` | https://sketchfab.com/3d-models/grand-piano-371090c279ff4e77a59acdebc25b5892 | farhad.Guli | Rescaled, legs lengthened, real keys modelled, textures removed, coplanar faces removed, recoloured in game |
| `src/assets/models/props/alto-sax.glb` | https://sketchfab.com/3d-models/sax-f137c64c274d46ba8a7157450541ed0b | shakiller | Rescaled, reoriented, decimated, textures removed, recoloured in game |
| `src/assets/models/props/potted-palm.glb` | https://sketchfab.com/3d-models/free-dyspis-lutescens-potted-palm-92f75abd656049608248cf76a8c88136 | AllQuad | A new stepped urn; the leaf texture kept for its alpha only, drawn as a flat silhouette |
| `src/assets/models/props/club-chair.glb` | https://sketchfab.com/3d-models/vintage-stylized-art-deco-low-poly-chair-f638ec2fd4104fd6bacac4c198f7a288 | eccwng | Split into upholstery and wood, textures removed |
| `src/assets/models/props/bar-stool.glb` | https://sketchfab.com/3d-models/bar-stool-aaf556f40f634719bc80a331d2799e4f | Saandy | Rescaled, hardware removed, textures removed |

## People: generated for this game

| File | Height |
| --- | --- |
| `src/assets/models/chars/tux.glb` | 1.88 m |
| `src/assets/models/chars/fedora.glb` | 1.88 m |
| `src/assets/models/chars/trench.glb` | 1.88 m |
| `src/assets/models/chars/barman.glb` | 1.86 m |
| `src/assets/models/chars/gown_gloves.glb` | 1.75 m |
| `src/assets/models/chars/gown_bob.glb` | 1.75 m |

- **Made:** each from our own text prompt, with an image model for the concept and an image-to-3D model for the mesh and a first rig; no reference image was used. Then our cleanup: the texture posterised to flat colours, the bones renamed to the Mixamo naming, fingers added, weights smoothed, feet at y = 0. The rig before any clip is `assets-src/chars/<id>/<id>-rig.glb`.
- **In this repo:** ten still poses of ours, one under each clip name the game uses. The released game's files carry Mixamo clips instead (MISSING_ASSETS.md).
- **Licence:** ours, CC0 1.0. Each `.meta.json` is our measurement of the character: height, clip lengths, and where it sits.

## Music: public-domain 78s (Internet Archive 78rpm collection)

| File | Recording | Recording published | Composition published |
| --- | --- | --- | --- |
| `src/assets/audio/wild-cat-blues.*` | Clarence Williams' Blue Five (Sidney Bechet) | OKeh 4925, 1923 | Waller and Williams, 1923 |
| `src/assets/audio/bleeding-hearted-blues.*` | James P. Johnson, solo piano | Victor 19123, 1923 | Lovie Austin, 1923 |
| `src/assets/audio/spain.*` | Isham Jones and His Orchestra | Brunswick 2600, 1924 | Jones and Kahn, 1924 |
| `src/assets/audio/in-the-evening.*` | Jean Goldkette and His Orchestra | Victor 19308, 1924 | Walter Donaldson, 1924 |

Public domain in the US: the recordings were published in 1925 or earlier and the compositions in 1930 or earlier. `assets-src/audio/LEDGER.md` has the sources, the evidence for each date and the processing.

## Sound

- `src/assets/audio/step-wood-1` to `-8`: Freesound #161756, "Footsteps Dress Shoes Wood Floor" by allrealsound, CC0, https://freesound.org/people/allrealsound/sounds/161756/
- `src/assets/audio/lighter-1`: Freesound #700894, "FIREIgn_Zippo Strike Close_MC.wav" by magnuscarlssen, CC0, https://freesound.org/people/magnuscarlssen/sounds/700894/
- `src/assets/audio/audio.json`: each sound's file names, loudness and credit, the left-out ones included. It ships with the game.

## Made in code

The club and all its ornament, the stained-glass panel (our own design, drawn on a canvas), the back bar and its bottles, the tables and tableware, the lamps and lanterns, the floor, the velvet, the city outside with its towers, river, bridges and clouds, smoke and light beams.

## Style

The look is inspired by Art Deco noir illustration, credited in `public/CREDITS.md`. No artwork was traced, used as an input to any model, or added to this repo or the game: the only images the game draws are made in code or come from the models above.
