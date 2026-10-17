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
carry `uvs` and a `texture` name. Images (1.12): `fromPng` (any PNG to
RGBA, its own inflate), `pngSize`, `imagePx`; `resolveTextures` takes a
bytes reader for image maps; `importGltf`'s `textures` option and
`gltfImages` (`fart import --map name=file.png`).
