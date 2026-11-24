// node sampler.mjs in.glb out.glb : set every base-colour sampler to LINEAR min/mag (no mipmaps), then meshopt-compress
// (the same step as `optimize --compress meshopt`, done last so the sampler edit and lossless WebP are kept).
// The atlas has many small UV islands of different flat colours; mipmaps blend neighbouring islands into light seams
// on the black cloth at a distance. Without mipmaps the flat palette stays clean.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { NodeIO, TextureInfo } = require("@gltf-transform/core");
const { ALL_EXTENSIONS } = require("@gltf-transform/extensions");
const { meshopt } = require("@gltf-transform/functions");
const { MeshoptDecoder, MeshoptEncoder } = require("meshoptimizer");
await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
const f = process.argv[2];
const doc = await io.read(f);
let n = 0;
for (const m of doc.getRoot().listMaterials()) {
  const ti = m.getBaseColorTextureInfo();
  if (ti) { ti.setMinFilter(TextureInfo.MinFilter.LINEAR); ti.setMagFilter(TextureInfo.MagFilter.LINEAR); n++; }
}
await doc.transform(meshopt({ encoder: MeshoptEncoder, level: "high" }));
await io.write(process.argv[3] || f, doc);
console.log("samplers set", n, f);
