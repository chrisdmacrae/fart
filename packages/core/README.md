# @fastart/core

The Fast Art Format (`.fart`) as a library. Types, parsing and validation,
palette resolution, posing, extents, triangulation. Zero runtime
dependencies, so it is also the loader for a browser game.

    import { loadDoc, resolvePalettes, colorOf, drawList, posePoint } from "@fastart/core";

    const doc = loadDoc(text);                       // throws a FartError with the report
    const { tokens } = await resolvePalettes(doc, readRelative);
    for (const { part, sp } of drawList(doc, "open")) {
      for (const sh of part.shapes ?? []) {
        const rgba = colorOf(tokens, sh.color!);     // magenta if nobody supplies it
        // posePoint(p, part, sp) takes every point from rest space to the pose
      }
    }

`parseDoc(text)` is the non-throwing form; its report carries the same
error codes `spec/examples/manifest.json` names, so a "why won't this
load" reads the same everywhere.

The command line:

    fart validate spec/examples      # every .fart below, refs resolved, exit 1 on any failure
    fart bake enemies/bat.fart       # write tris into each poly (or mesh), in place
    fart project pistol.fart --view left --view top -o out/pistol.fart   # 1.3: 2D views of a 3D file
    fart gltf pistol.fart            # the model as a .glb: animations, skins, textures
    fart hull hut.fart --part table  # 1.4: a convex hull into collision
    fart bake --smooth helm.fart     # 1.7/1.8: the finished surface into `bake`, for readers that do not generate
    fart bake --textures out/ crate.fart   # every map as a PNG, plus .normal.png and .orm.png (1.10)
    fart build art/                  # 1.8: the compiled sidecar name.fart.glb beside every 3D file
    fart unwrap bag.fart             # 1.10: uvs packed into the texture's cell
    fart import stick.glb --map color=albedo.png --map normal=normal.png   # a glTF as a .fart, textures as image maps (1.12)

`fart` with no arguments lists every command and its flags.

3D (1.3): `as3d(doc)` types a parsed 3D document; `worldTransforms3`,
`sampleClip3`, `sampleTargets3`, `solveChain3`, `blendPoses3`,
`layerPoses3`, `attachXf3`, `bakeTris3` are the 2D calls with a third
coordinate; `projectDoc(doc3, { view, light, ambient, fps, outline })` is
`fart project` as a function and `toGlb(doc3)` is `fart gltf`. Solids:
`box`, `extrude`, `lathe`, `windOutward`, `ballMesh`, `rodMesh`;
`flattenPart` / `triMesh` give a renderer its triangles and normals;
`Y_UP` / `yUp` turn the frame for y-up engines. `shadeColor` lays a
shape's `shade` on a resolved colour. Collision (1.4): `collisionWorld`
/ `collisionWorld3` give every solid in document space under a pose,
boxes expanded, layers set; `hullPart` / `setHull` / `convexHull` derive
hulls (`fart hull`). Textures (1.5): `resolveTextures`, `rasterizeMap`,
`rasterValues`, `textureColor`, `mappingXf`, `boxUV`, `meshUVs`,
`affineFrom`, `toPng` (`fart bake --textures`); flattened triangles
carry `uvs` and a `texture` name. Morphs (1.6): `shapesOfPosed` /
`shapesOf3Posed` give a part's shapes as a pose reshapes them,
`lerpMorphs` between keys. Paths and surfaces (1.7): `pathPoints`,
`bakePath`/`bakePaths`, `subdivide`, `smoothNormals`, `sweepMesh`;
`asMesh` is the surface a renderer draws, `cageOf` the file's cage,
`bakeSurfaces` is `fart bake --smooth`. 1.8: `applyMods` / `builtOf`
(a cage with its mods), `pipe`, `buildSidecar` / `sidecarFresh` /
`sidecarPath` (`fart build`), `importGltf` (`fart import`). Skins
(1.9): `shapesOf3Skinned`, `shapesOf3Worn` (a host's skin). Relief
(1.10): `mapValues`, `normalRaster`, `ormRaster`, `bakeTexture`,
`unwrapDoc`. Rails (1.11): `rail`. Images (1.12): `fromPng` (any PNG to
RGBA, its own inflate), `pngSize`, `imagePx`; `resolveTextures` takes a
bytes reader for image maps; `importGltf`'s `textures` option and
`gltfImages` (`fart import --map name=file.png`).
