# Paths and 3D

Read this for a `path`, a `"space": "3d"` model, sweeps, pipes, smooth surfaces, paint, shades, modifiers, skins, projection to 2D views, glTF export and import, the compiled sidecar, or 3D collision. The core skill (SKILL.md) covers the 2D file.

## Paths (1.7)

A `path` is a cubic polybézier: `points`, and per point `in` and `out`
tangent handles **relative to the point** (absent or `[0,0]`: a
corner). `closed: true` fills; open, it strokes with `w`. Editors (and
`fart bake`) write `bake: {points, tris}`, the polygon it flattens to
at 0.05 units, so a 1.6 reader draws it as a poly; a hand-written file
can skip the bake. A poly with no handles is still a `poly`. Morphs
replace `points` and the handles ride along (a morph may carry `in`/
`out` too). The circle constant: a quarter turn of radius r is one cubic
with handles of length 0.5523·r along the tangents.

```json
{"kind": "path", "color": "skin", "closed": true,
 "points": [[-6,-4],[6,-4],[8,0],[6,4],[-6,4],[-8,0]],
 "in":  [[-2,0],[-2,0],[0,-2],[2,0],[2,0],[0,2]],
 "out": [[2,0],[2,0],[0,2],[-2,0],[-2,0],[0,-2]]}
```

## 3D

A file with `"space": "3d"` is a low-poly model in the same words with a
third coordinate. Model props once, then project them to the 2D views a
2D game draws, or load them straight into a 3D game.

- **Frame**: x right, y **down**, z **away** (right-handed). The front
  of a thing faces -z (a muzzle points at the viewer in the front view);
  dropping z is the front view. Most engines are y-up: `Y_UP` / `to_y_up`
  in the loaders turn the frame (x, -y, -z) at draw time; never model
  y-up.
- **Shapes**: `mesh` (`points` `[x,y,z]`, `faces` as index loops wound
  so `(p1-p0)×(p2-p0)` points **out of the solid**, `tris` baked by
  `bakeTris3` or the studio), `ball` (`at`, `r`), `rod` (`a`, `b`, `w`).
  One token per shape, `shade` as in 2D. A face wound the wrong way
  vanishes in every view.
- **Parts and poses** as in 2D: `pivot` `[x,y,z]` at the joint, `parent`,
  `like`; a pose's `rotate` is `[x,y,z]` radians about x, then y, then
  z (a turn about z is the 2D rotate); `scale` uniform; `mirror` flips
  x. Between keys turns slerp. Anchors take `dir` (a direction) instead
  of `angle`. Chains work with a `pole` (a document-space point the
  elbow leans toward) instead of `bend`; targets are `[x,y,z]`.
- **Build by script, with the helpers**, never by typing coordinates:

  ```js
  import { box, extrude, lathe, bakeTris3, projectDoc, stringifyDoc, validate } from "@fastart/core";
  box("wood", [cx, cy, cz], [sx, sy, sz])                       // a box
  extrude("steel", [[z0, y0], [z1, y1], ...], "x", -1, 1)       // a side profile (any winding, concave is fine) as a prism
  lathe("brass", [[r0, t0], [r1, t1], ...], "y", 12)            // a profile of [radius, along] revolved: barrels, bottles, wheels
  { kind: "rod", color, a, b, w }  { kind: "ball", color, at, r }  // ribs, chains, eyes, knobs
  ```
  For `extrude` the profile is `[z, y]` on axis x, `[x, z]` on y, `[x, y]`
  on z. Every helper returns faces wound outward; `windOutward(mesh)`
  fixes a hand-made one. `examples/pistol/generate.mjs` (a flintlock from
  extruded profiles) and `examples/lantern/generate.mjs` (lathes, a box,
  rods) are the models to copy.
- **Conventions**: the same scale as the 2D art (a pistol ~24 units
  long); one part per thing that moves, its pivot at the hinge; parts
  that pass through each other project badly (the painter's order is
  per part), so split them; keep a ball's centre on or in front of the
  surface it sits on; tokens for colour, `shade` for baked light,
  `emissive` for glow.
- **Project** to 2D: `npx fart project model.fart --view left --view top
  [--outline ink:0.25]`. A turn about the view axis stays a real 2D pose
  (parents kept, clips tweened); anything else bakes into variant parts
  (`hammer@1`) and the clip subdivides at 12 fps. `left` is the
  side-scroller profile (muzzle right), `top` the top-down sprite (muzzle
  up). `spec/PROJECT.md` has the rules.
- **Export** for other engines: `npx fart gltf model.fart` writes a
  `.glb` (a node per part, vertex colours, an animation per clip, y-up).
- **Import** a model made elsewhere (Blender's own glTF export, no
  plugin): `npx fart import model.glb [-o model.fart] [--scale n]
  [--height n] [--merge] [--split-materials] [--no-quads]
  [--no-shades] [--map name=file.png]... [--textures dir]
  [--no-textures]`, or `importGltf(bytes, options)` from `@fastart/core`
  (`gltfBufferUris` lists the `.bin` files a `.gltf` wants in
  `options.buffers`). A part per mesh node (snake_case names, the
  node's origin as `pivot`, the nearest mesh node above as `parent`),
  points in document space at rest, a token per material, one shape per
  mesh with `colors` + `paint` (1.8) unless `--split-materials`,
  triangles paired into quads, split vertices welded, `normals:
  "smooth"` where the source shades smooth, vertex colours as `shades`,
  animations as clips, morph targets as states, and (1.12) the
  textures: the glTF's PNGs, or the ones `--map` names, as image maps
  with the uvs as `mapping.uvs` (see `textures.md`, Images). It prints
  what it left out (cameras, lights, JPEG pictures) and
  refuses compressed geometry. A Blender model is in metres: pass
  `--height` or `--scale` so three decimals keep its detail. In Uranus:
  File › Import glTF… (⌘I), or the `import_gltf` tool.
- **Collision in 3D (1.4)**: `collision` holds `ball`, `rod`, convex
  `mesh`, and `box` (`at` centre, `size` full extents, optional `rotate`;
  never in `shapes`). A collision `mesh` must be **convex** (error
  `convex`, naming the face): author concave solids as several pieces.
  `part` makes a solid ride a part; `layer` tags it. `npx fart hull
  model.fart [--part name]` writes a convex hull of each part's visible
  shapes into `collision` (`meta.hull` marks them, rerun replaces), so
  most props need no hand-written collision. The model screen's
  Collision button shows the solids posed, and a part's **hull** button
  does the same as the CLI.
- **Morphs (1.6)**: a state can reshape a mesh as well as place it. A
  state entry's `morph` lists `{"shape": i, "points": [...]}` per mesh
  of the part: the same number of points as the base, in the same
  order; faces and `tris` stay. Clips lerp the corners between keys
  (eased), so a breathing chest, a blinking eye or a bending tentacle
  segment is two states and a clip. A part drawn `like` another cannot
  morph (error `morph`), nor can balls, rods or collision. In 2D the
  same field reshapes a `poly`. Projection bakes a morphed entry into a
  variant part; glTF export writes morph targets with animated weights.
  Build one by script (`points` is `mesh.points.map(...)`), or in Uranus
  with the model screen's **Deform** toggle (D): corner drags then land
  in the current state's morph instead of the base mesh.
- **Smooth surfaces (1.7)**: a mesh stays its low-poly cage; `normals:
  "smooth"` lights it by averaged vertex normals (no new geometry;
  `angle` in degrees keeps edges sharper than that flat), and `smooth: n`
  draws it Catmull-Clark subdivided n times (1 or 2; the cage is the
  file, readers subdivide). `creases` is `[[a, b, c], ...]` for edges
  (c in 0–1, 1 sharp; a fraction is a fillet) and `[a, c]` for corners,
  OpenSubdiv's rules. Morphs move the cage and the surface follows;
  collision and `fart hull` use the cage. `fart bake --smooth` writes
  the subdivided surface into `bake` for a game that will not subdivide
  (the Odin loader subdivides itself). Keep `smooth` at 1–2.
- **Sweeps (1.7)**: `{"kind": "sweep", "op": "lathe"|"extrude", "axis",
  "profile": {points, in, out}, "segments" | "from"/"to"}` keeps the
  profile (a path body: `[radius, along]` pairs for a lathe, a closed
  outline for an extrude) and generates the mesh; `smooth`, `normals`,
  `texture` apply to it. Prefer a sweep to a baked lathe when the shape
  may change later. A sweep does not morph and never goes in collision.
- **1.8 additions** (all optional; `{{FASTART}}/examples/helm/generate.mjs`
  uses every one):
  - **Paint**: `"colors": ["brass", "lining"]` and `"paint": [1, 0, 2,
    ...]` on a mesh or a sweep, one whole number per face: 0 is `color`,
    n is `colors[n-1]`. Count and range are checked (error `paint`).
    One shape, several tokens; no more splitting a mesh to colour a band.
  - **Shades**: `"shades": [1, 0.8, ...]` on a mesh, one number per
    point, multiplying `shade` there and interpolated across faces: soft
    shadow in a fold (error `shades` on a wrong count).
  - **Mods**: `"mods": [...]` on a mesh or a sweep, applied in order to
    the cage after a morph and before `smooth`. `{"op": "mirror",
    "axis": "x", "merge": 0.001}` (model half, keep the seam's points
    on 0 so they weld); `{"op": "solidify", "thick": 0.3, "offset": -1,
    "inner": 2, "rim": 1}` (a wall inward from the cage, an open edge
    gets a rim; `inner`/`rim` are paint indices); `{"op": "crease",
    "angle": 40, "value": 0.2}` (every edge sharper than the angle
    creased: with `smooth` that is a bevel). Model the cage as the
    outside, wound outward, and let the mods do the rest; `creases`,
    `paint` and `shades` you write are over the cage. An unknown op is
    error `mod`. `builtOf(shape)` is the cage with its mods applied.
  - **Pipe**: `{"kind": "sweep", "op": "pipe", "path": {"points":
    [[x,y,z], ...], "in", "out"}, "radius": 0.2, "radii": [1, 0.9, 0],
    "segments": 8, "caps": true, "closed": false}`: a round section (or
    a closed 2D `profile`) carried along a 3D path without twisting,
    scaled per path point by `radii` (0 at an end is a point). Plumes,
    horns, straps, wires. In a script, `pipe(color, path, opts)` returns
    the mesh. Paint a pipe by face only when its path has no handles
    (the face count follows the flattening).
  - `fart bake --smooth` writes the finished mesh of every smooth,
    modified or swept shape into `bake` (with `paint` and `shades` for
    it) for a reader that will not generate.
  - **The sidecar**: `npx fart build art/` writes `name.fart.glb`
    beside every 3D `name.fart`: a binary glTF with everything
    generated, far quicker to load than the JSON. It is a build
    artifact, never edited and never the source; a loader uses it only
    while its hash matches the `.fart`. Gitignore `*.fart.glb`, run
    `fart build` as a build step (`fart build --check art/` in CI,
    `--clean` to remove them).
  - **Rail (1.11)**: `{"kind": "sweep", "op": "rail", "path": {"points":
    [[x,y,z], ...]}, "profile": {"points": [[out, down], ...]}, "round":
    1, "segments": 4, "closed": false}`: a profile carried *upright*
    along a path (a pipe's section turns with the path; a rail's stands
    along `axis`, y by default). Use it for anything that follows an
    outline: a cliff face with its brow, a kerb, a skirting board, a
    gutter. Draw the profile as the cross-section looks, out to the
    right; an open one is a sheet facing its own left (drawn going down
    it faces out), `"closed": true` on the profile makes a capped
    moulding. Corners are mitred; `round` fillets them (paths without
    handles only). Paint counts a face per profile edge per path
    segment.
- **Skins (1.9)**: a mesh that gives at its joints instead of turning
  whole with its part (a sleeve, a neck, a tail):

  ```json
  {"kind": "mesh", "color": "cloth", "points": [...], "faces": [...],
   "skin": {"joints": ["upper_arm", "torso"],
            "weights": [[0, 1], [0, 0.5, 1, 0.5], [1, 1], ...]}}
  ```

  `joints` names parts (any part, the shape's own or not); `weights` has
  one entry per point, in `points` order: one to four pairs `[joint
  index, weight]`, each weight above 0, no joint twice, adding to 1.
  A point is placed by the weighted sum of its joints' world maps
  (linear blend skinning); rest is every part at identity, so there is
  nothing to bind: model the mesh where it is at rest. A morph moves the
  points first. A `like` part's copy follows its own side's twins, and a
  mirrored part's points are reflected across x = 0 where the shape and
  a joint differ in side, so one sleeve serves both arms. `"host":
  true` makes `joints` name parts of **another** document the file is
  drawn on (clothes on a body); drawn alone, a host skin is rigid. A
  skin is on a drawn mesh with no `mods` and no `smooth` levels (error
  `skin` for every broken rule). Give a bend more points or spread it
  over more parts: a joint turned far thins. glTF export writes a skin;
  `fart import` keeps one (`--merge` drops it); projection places the
  points before it flattens.
- **Relief and sheets (1.10)**: for a surface that is not flat fills
  (paper, cloth, worn metal), put the form in the cage and the fine
  detail in maps. A map takes `soften` (a blur in the drawing's units:
  a hard line becomes a ridge with a slope); a texture with a `height`
  map takes `relief` (how far white stands proud of black, in the same
  units) and is lit by it. Draw the height map on mid grey (128) with
  lighter lines for ridges and darker for valleys, `soften` about half
  a line's width. `rough`, `metal` and `ao` are the other maps the
  tools read. For one sheet over a whole mesh, make the texture's
  `cell` the sheet and call `unwrapDoc(doc)` (or `fart unwrap file`):
  it writes the cage's `mapping.uvs`, each side an island, and they
  ride through mods and `smooth`; draw the maps in those coordinates.
  With `paint` or a `solidify` `inner` token, make the colour map
  `"mode": "mask"` (greys) so each token keeps its own colour under it.
  `fart bake --textures out/ --px 256` writes the maps plus
  `<texture>.normal.png` and `<texture>.orm.png`; `fart gltf --px 256`
  puts them in the material. A model painted elsewhere keeps its
  pictures instead (1.12, image maps: `references/textures.md`).
- **Look at it**: open the folder in Uranus; a 3D file opens the model
  screen (orbit, the four tools make box/ball/rod/prism, Deform, the
  inspector's normals/smooth/crease fields, Project…).

### Loading in a 3D game (Odin, raylib)

`loaders/odin/examples/raylib_spin/main.odin` is the whole loop; the
shape of it:

```odin
doc, ok := fastart.load_bytes_3d(data)              // load_bytes refuses 3D files; this reads them
fastart.resolve_palettes_3d(&doc, resolver, nil)
for &p in doc.parts {                                // once: flatten each part to triangles
    tms := make([dynamic]fastart.Tri_Mesh)
    fastart.flatten_part(&doc, &p, &tms)             // per shape: positions, normals (rest space), color token, shade
    // upload: fastart.to_y_up(pos), to_y_up(normal); colour = shade_color(color_of_3d(&doc, tm.color), tm.shade)
}
fastart.sample_clip_3d(&doc, clip, t, &frame)       // every frame: the pose
fastart.sample_targets_3d(&doc, clip, t, &targets); fastart.solve_targets_3d(&doc, &frame, targets[:])   // live IK, if any
fastart.collision_world_3d(&doc, frame[:], &colliders)   // the solids under this pose: ball / rod / mesh (boxes arrive as meshes), each with .layer and .part
for sp in frame {
    W := fastart.Y_UP * fastart.world_xf_3d(&doc, frame[:], sp.part)   // rest → engine space
    rl.DrawMesh(mesh, material, rl.Matrix(W))
}
```

Light in a shader from the normals, or bake it into vertex colours the
way the example does. Textures: `resolve_textures_3d(&doc, resolver,
user)` fills `doc.texture_docs[texture][map]`, a `Map_Doc` holding the
map's drawing (`doc`, `state`) or, for an image map (1.12), its pixels
(`pixels`, 8-bit RGBA, `width` × `height`; upload them as they are);
`Tri_Mesh.uvs` are pattern coordinates, divide by the texture's `cell`.
The compiled sidecar (1.8): `sc, fresh := load_sidecar(&doc, source,
glb)` then `flatten_part_sidecar(&sc, &doc, &part, &meshes)` in place of
`flatten_part`, falling back when it says no (`loaders/odin/sidecar.odin`
has the whole pattern). Skins (1.9): the Odin loader reads `skin` but
draws the mesh rigid with its part for now; in TypeScript
`shapesOf3Skinned(doc, part, entry, W)` (W from `worldTransforms3` of
the same pose) gives the part's shapes with skinned points placed, in
the part's rest space, and `shapesOf3Worn` places a host skin on its
host. `blend_poses_3d`, `layer_poses_3d`,
`clip_events_3d`, `attach_xf_3d` (dir-aligned sockets) and
`apply_palette_3d` are the 2D calls with a third axis.

**TypeScript**: `as3d`, `worldTransforms3`, `sampleClip3`, `sampleTargets3`,
`solveTargets3`, `flattenPart`/`triMesh`, `shapesOf3Skinned`, `Y_UP`,
`projectDoc`, `toGlb`, `importGltf`/`gltfImages`, `resolveTextures`
(pass a bytes reader for image maps), `bakeTexture`, `fromPng`/`toPng`.

A frame's entries may morph (1.6): `morphs_3d(&doc, &sp)` says so, and
`flatten_part_posed(&doc, part, &sp, &tms)` flattens the part with the
frame's points; re-upload those meshes (raylib: `UpdateMeshBuffer` for
vertices and normals) and draw as before. Sample frames with the temp
allocator as `context.allocator`, since mixed morphs allocate their
points there, and `free_all` it each frame.
