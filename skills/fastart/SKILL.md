---
name: fastart
description: Write, edit, validate and load .fart files (the Fast Art Format, JSON vector art for games, 2D and low-poly 3D, with parts, states, clips, IK chains, swappable palettes, collision, and textures that are themselves drawings) and .shart scenes (the Scene Hierarchy of Art, which places .fart files). Use when a game needs sprites, props, models, animations, palettes, textures or scenes made by hand or by script, when such files need checking or projecting from 3D to 2D, or when loading them in Odin or TypeScript.
---

# fastart: the Fast Art Format

A `.fart` file is JSON: shapes grouped into **parts**, arranged by
**states**, animated by **clips** (states in time), reached by IK
**chains**, coloured by named **slots** a palette fills in, surfaced by
**textures** that are themselves drawings, and, since 1.3, either flat
or a low-poly **3D** model (`"space": "3d"`) that projects to 2D views.
A `.shart` file is a **scene**: `.fart` files placed, posed and
recoloured in a tree. The format is the contract; the checkout at
`{{FASTART}}` holds the spec (`spec/FORMAT.md`, `spec/PROJECT.md`,
`spec/SHART.md`), the validator, the loaders, the studio and sample sets
(`examples/space`, `examples/pistol`, `examples/lantern`,
`examples/cabin`, with scenes in `examples/space/scenes` and
`examples/cabin/camp.shart`).

- The truth: `{{FASTART}}/spec/FORMAT.md` (read it when in doubt) and
  `{{FASTART}}/spec/fart.schema.json`.
- A complete sample project: `{{FASTART}}/examples/space` (ships, a
  station, rocks, projectiles, an explosion, palettes to swap) with the
  script that wrote it, `generate.mjs`. Copy its shape for new sets.

## Coordinates and conventions

- x right, y **down** (screen-like). Units are the file's own; the
  studio shows one unit as 10 px at its default zoom. A small ship is
  ~24 units long, a capital ship ~64, a pickup ~6.
- Top-down things point up: the nose is at negative y. A game adds its
  own heading when it draws.
- Names are lowercase snake_case. Mirrored parts end `_l` / `_r`.
- Anchors are where a game hooks in: `nose`, `gun_l`, `muzzle`, `tip`,
  `exhaust`, `hand`, `foot`, `dock_n`. Name them for the game, not the art.
- Colours are never literal. A shape names a **slot** (`hull`, `skin`,
  `trim`); the palette says what it means today.

## The file, annotated

```json
{
  "version": 1,
  "name": "fighter",
  "palette_refs": ["../palettes/hull.fart"],
  "palette": [ {"name": "clasp", "rgb": [220, 190, 90, 255]} ],
  "parts": [
    {"name": "hull", "pivot": [0, 0],
     "shapes": [
       {"kind": "poly",   "color": "hull",  "points": [[0,-12],[3,-4],[3,6],[0,8],[-3,6],[-3,-4]]},
       {"kind": "line",   "color": "trim",  "a": [0,-6], "b": [0,4], "w": 0.8},
       {"kind": "circle", "color": "glass", "at": [0,-4], "r": 1.5}
     ],
     "anchors": [ {"name": "nose", "at": [0, -12]} ]},
    {"name": "wing_l", "parent": "hull", "pivot": [-3, 1], "shapes": [ ... ]}
  ],
  "states": [
    {"name": "idle",   "parts": [ {"part": "hull"}, {"part": "wing_l"} ]},
    {"name": "bank_l", "parts": [ {"part": "hull", "rotate": -0.1}, {"part": "wing_l", "scale": 0.75} ]}
  ],
  "clips": [
    {"name": "bank_left", "loop": false, "keys": [
      {"t": 0,    "state": "idle"},
      {"t": 0.25, "state": "bank_l", "ease": "out"}
    ]}
  ],
  "constraints": [ {"name": "arm", "chain": ["upper", "fore"], "end": "fore/hand", "bend": 1} ],
  "collision": [ {"kind": "poly", "points": [[0,-12],[10,7],[-10,7]]} ]
}
```

- **Shapes**: `circle` (`at`, `r`), `line` (`a`, `b`, `w`, round caps),
  `poly` (`points`, three or more, concave is fine). Order within a part
  is paint order. `tris` (index triples into `points`) is optional in a
  hand-written file: `fart bake` or the studio writes it; loaders fan
  without it.
- **Parts**: `pivot` is the point the part turns about and is placed by,
  in document space. A `parent` makes the part ride another (an arm on a
  torso, a turret on a hull): it is posed in the parent's frame, and
  paint order stays the state's list. Parents must exist and not loop.
- **States**: a named list of `{part, offset?, rotate?, scale?}`. The
  list is membership and paint order. `offset` is **where the pivot
  lands** (a position, not a delta; absent means the pivot itself, i.e.
  drawn as authored). `rotate` is radians; `scale` multiplies about the
  pivot. A file's first state is the one editors show. A file with no
  states draws all parts in file order.
- **Clips**: keys at `t` seconds, each naming a `state` (or carrying an
  inline `parts` list). Between keys, `offset` and `scale` tween
  linearly, `rotate` the short way round, bent by the *incoming* key's
  `ease`: `linear` (default), `in`, `out`, `in-out`, `step`. Which parts
  draw switches at keys, it never tweens. `loop` wraps at the last key's
  `t`; a loop that should ease back ends with a key equal to its first.
  A full turn needs three or more keys (thirds), since rotation tweens
  the short way.
- **Constraints**: `chain` lists parts root-first, each after the first
  parented to the previous; `end` is `part/anchor` on the last part;
  `bend` is `1` or `-1`. Games may solve live (`solveChain` /
  a CCD solver); the studio uses chains to pose, and saves ordinary states.
- **Collision**: shapes in document space, never drawn, `color`
  optional. Since 1.4 a collision shape may name a `part`: it is then in
  that part's rest space and rides the part's pose (a door flap's solid
  moves with the flap); `layer` (default `solid`) is an engine's tag
  (`surface`, `player`, `trigger`, whatever the game says). Loaders give
  the whole list in document space for a pose: `collisionWorld(doc,
  poses)` / `collision_world(&doc, poses, &out)`.
- **1.2 additions** (all optional; older readers ignore them):
  - `"like": "claw_r"` on a part: it draws that part's shapes and
    anchors and has none of its own (keep its own `pivot`, `parent`).
  - `"mirror": true` on a state entry: flipped about the pivot before
    the turn. A child rides its parent's mirror; do not mirror twice.
    The left claw is `{"name":"claw_l","like":"claw_r","pivot":[5,0]}`
    posed `{"part":"claw_l","mirror":true,"offset":[-5,0]}`.
  - `"angle"` on an anchor (radians): the direction an attached thing
    points. A game attaches by aligning anchors: `attach_xf(host_xf,
    &hand, &grip)`. Files never name what they hold.
  - `"targets": [{"chain":"arm","at":[x,y]}]` on a state or key: the
    chain reaches that document-space point. Bake the solved rotations
    into the pose too (the studio does), so non-solving readers draw it.
  - `"events": ["footstep"]` on a key: names a game hears crossing it.
  - `"curve": [x1,y1,x2,y2]` on a key: a cubic bezier, wins over
    `ease`; set `ease` to the nearest name as well.
  - `"emissive": 1.5` on a palette token: light the slot gives off.
- **1.3 additions**:
  - `"shade": 0.7` on a shape: multiplies the slot's r, g, b (alpha
    kept); lighting that survives a palette swap. Absent = 1.
  - `"space": "3d"` at the top: a 3D model. See **3D** below.
- **Palettes**: `palette` is the file's slots with default colours.
  `palette_refs` are paths relative to *this file* to palette files
  (colours and no parts). Lookup is the file's own palette first, then
  refs last to first. An unresolved slot paints loud magenta. Keep art
  files free of colours of their own when a project shares a palette;
  override a slot locally only when one file must differ.
- Unknown fields are kept by every tool, so `meta` and your own keys are safe.

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
  [--no-shades]`, or `importGltf(bytes, options)` from `@fastart/core`
  (`gltfBufferUris` lists the `.bin` files a `.gltf` wants in
  `options.buffers`). A part per mesh node (snake_case names, the
  node's origin as `pivot`, the nearest mesh node above as `parent`),
  points in document space at rest, a token per material, one shape per
  mesh with `colors` + `paint` (1.8) unless `--split-materials`,
  triangles paired into quads, split vertices welded, `normals:
  "smooth"` where the source shades smooth, vertex colours as `shades`,
  animations as clips, morph targets as states. It prints what it left
  out (textures, cameras, lights; a skin becomes rigid parts) and
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
  puts them in the material.
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
way the example does. `blend_poses_3d`, `layer_poses_3d`,
`clip_events_3d`, `attach_xf_3d` (dir-aligned sockets) and
`apply_palette_3d` are the 2D calls with a third axis.

**TypeScript**: `as3d`, `worldTransforms3`, `sampleClip3`, `sampleTargets3`,
`solveTargets3`, `flattenPart`/`triMesh`, `Y_UP`, `projectDoc`, `toGlb`.

A frame's entries may morph (1.6): `morphs_3d(&doc, &sp)` says so, and
`flatten_part_posed(&doc, part, &sp, &tms)` flattens the part with the
frame's points; re-upload those meshes (raylib: `UpdateMeshBuffer` for
vertices and normals) and draw as before. Sample frames with the temp
allocator as `context.allocator`, since mixed morphs allocate their
points there, and `free_all` it each frame.

## Textures

No bitmaps: a texture is a set of **maps** and every map is a 2D `.fart`
tiled over a `cell`, in 2D and 3D alike.

```json
"textures": [{"name": "planks", "cell": [8, 8], "maps": {
  "color":  {"ref": "textures/planks.fart"},
  "height": {"ref": "textures/planks.fart", "palette": "palettes/height.fart", "mode": "mask"},
  "glow":   {"ref": "textures/planks.fart", "state": "knots"}}}]
```

- `color` is what readers paint: `paint` (default) lays its colours over
  the shape's slot where it paints, the slot shows through elsewhere;
  `mask` multiplies the slot by the map's luminance. Every other map is
  a scalar the engine reads (luminance × alpha × shade), named whatever
  the game says (`height`, `glow`, `rough`). The same drawing under
  another `palette` or `state` is another map, so maps line up for free.
- A shape takes `"texture": "planks"` and a `mapping`: in 2D
  `{"at": [x, y], "angle": a, "scale": s}` placing pattern space in the
  shape's space (or `xf`, six numbers, as a projection writes); in 3D
  `{"scale": s}` for **box mapping** (each face reads the two world axes
  across its normal, so planks line up across a wall with nothing
  authored) or `{"uvs": [[[u, v], ...] per face]}` per corner. Balls and
  rods box-map as the meshes they flatten to. A palette swap still
  recolours the slot underneath.
- Draw the map in the 2D editor (its cell is `[0, 0]` to `[w, h]` of the
  drawing's space; shapes crossing the edge wrap). `npx fart bake
  --textures out/ --px 64 model.fart` writes each map as a PNG for a
  build; `fart gltf` embeds the colour map; the projector carries a
  face's mapping into the 2D file as an `xf`. Loaders give pattern
  coordinates per vertex (`triMesh(...).uvs`, `Tri_Mesh.uvs`; divide by
  the cell for 0..1) and `resolve_textures_3d` reads the maps' drawings;
  the raylib example rasterises one with `draw_2d`. Sample textures:
  `examples/cabin/textures`, `examples/space/textures`.

## Scenes: .shart

A `.shart` (Scene Hierarchy of Art, dot-s-h-art) composes farts into a
scene and draws nothing of its own. `spec/SHART.md` is the contract.

```json
{"version": 1, "space": "3d", "name": "camp", "palette_refs": ["palettes/night.fart"],
 "nodes": [
   {"name": "hut", "ref": "cabin.fart", "at": [0, 0, 0], "state": "closed",
    "children": [{"name": "lamp", "ref": "lantern.fart", "attach": {"to": "hook", "by": "grip"}}]},
   {"name": "guard", "ref": "hero.fart", "at": [14, 0, 6], "rotate": [0, 1.2, 0], "clip": "idle", "t": 0.4, "palette": "palettes/red.fart"},
   {"name": "rocks", "at": [-20, 0, 0], "children": [{"name": "a", "ref": "rock.fart"}, {"name": "b", "ref": "rock.fart", "at": [4, 0, 2], "scale": 0.6, "mirror": true}]},
   {"name": "annex", "ref": "yard.shart", "at": [30, 0, 0]}]}
```

- A node is an instance (`ref` a `.fart`), a placed scene (`ref` a
  `.shart`), or a group (no `ref`). `at`, `rotate` (a number in 2D,
  `[x, y, z]` in 3D), `scale`, `mirror` pose it in its parent's frame.
  `state` or `clip` + `t` picks what it shows; `palette` recolours it;
  the scene's `palette_refs` recolour everything. `attach` hangs a child
  from a socket of its parent's art, positions and directions matched
  (`to` on the parent, `by` on the child; `by` absent = the child's
  origin). Names are unique among siblings; refs are relative; every
  ref is of the scene's space.
- Paint order in 2D: list order, children after their parent. 3D is by
  depth.
- Check: `npx fart validate camp.shart` (reads the files it names:
  `ref.state`, `ref.clip`, `ref.anchor`, `space`, `cycle`). See it:
  `npx fart flatten camp.shart` lists every instance placed; Uranus
  opens a scene on its shelf.
- Load: TypeScript `parseScene` → `loadScene(scene, read)` →
  `flattenScene(loaded, {time})` → for each `Placed`: draw its `doc`
  with its `poses` and `tokens`, the instance `xf` in front of the
  part's world map; `sceneCollision(placed)` for the solids. Odin:
  `load_scene` → `flatten_scene(&scene, resolver, user, &cache, &placed,
  time)` → each `Placed` has `doc`/`doc3`, `poses`/`poses3`, `tokens`
  (use `token_color`), `xf`/`xf3`. Keep the `Scene_Cache` for the
  scene's life; `destroy_placed` each frame if you re-flatten.

## Workflow

1. Write the JSON (by hand for one file; by a small script for a set,
   starting from `{{FASTART}}/examples/space/generate.mjs`, which has the
   helpers: mirrored parts, baked tris, validation, writing). For 3D,
   start from `{{FASTART}}/examples/lantern/generate.mjs` and core's
   `box`, `extrude`, `lathe`.
2. Validate, always:
   `cd {{FASTART}} && make validate DIR=/path/to/art` (every `.fart`
   below, refs resolved). Fix every error; warnings about unknown fields
   are yours to judge.
3. Look at it: `cd {{FASTART}} && make serve DIR=/path/to/art` and open
   `http://localhost:4747` (headless Playwright works against it too), or
   open the folder in Uranus (the fastart studio app). Pick a clip and scrub. A tour
   script can read `globalThis.fastart` (the store, `frameW()` world
   transforms) to assert poses.
4. Use it in the game (below). Ignore `*.fart~` files: they are the
   studio's checkpoints (gitignore them). For 3D art, make the compiled
   sidecars in the game's build, never by hand, and gitignore them too
   (`*.fart.glb`). A Makefile line: `art: ; npx fart build art/`.

## Loading in a game

**Odin** (the reference loader, `{{FASTART}}/loaders/odin`, copied into a
game as package `fastart`):

```odin
doc, ok := fastart.load_bytes(data)            // or load_file(path)
fastart.resolve_palettes(&doc, resolver, nil)   // resolver: proc(path: string, user: rawptr) -> ([]byte, bool), path is the ref as written
rgb := fastart.color_of(&doc, "hull")           // [4]u8
st  := fastart.state_of(&doc, "idle")           // ^State, its .parts is the pose list
for sp in st.parts {                            // paint order
    part := fastart.part_of(&doc, sp.part)
    W := fastart.world_xf(&doc, st.parts[:], part.name)   // parents applied
    // draw part.shapes through W (poly: tris are index triples into points), then the entity's own placement
}
frame := make([dynamic]fastart.State_Part, context.temp_allocator)
fastart.sample_clip(&doc, fastart.clip_of(&doc, "thrust"), t, &frame)   // a pose list at time t
d := fastart.clip_duration(c)
red, _ := fastart.load_bytes(red_palette_bytes)
fastart.apply_palette(&doc, red.palette[:])     // a swap: same slot names, new colours
```

Anchors: `xf_apply(world_xf(...), anchor.at)` gives the point in the
posed drawing; use `anchors_of` / `anchor_of` so `like` parts resolve.
`destroy(&doc)` frees the containers; games that load into an arena
drop the lot.

Runtime operations (1.2), no file changes needed:

```odin
fastart.blend_poses(&doc, a[:], b[:], w, &out)   // two clips at once: crossfades
fastart.layer_poses(&doc, gait[:], head[:], w, &out)  // a layer over a base: head turn over a walk
fastart.clip_events(c, t_prev, t_now, &names)     // what fired since last frame (loop-aware)
fastart.sample_targets(&doc, c, t, &targets); fastart.solve_targets(&doc, &poses, targets[:])  // live IK
fastart.solve_chain(&doc, &poses, constraint, point)  // reach a point now (feet on a slope)
```
Draw with `shapes_of(&doc, part)`, never `part.shapes`, so parts drawn
like another show up.

**TypeScript** (`@fastart/core`, zero deps; not on npm yet, import from
`{{FASTART}}/packages/core/dist/index.js`): `parseDoc`, `validate`,
`resolvePalettes`, `colorOf`, `applyPalette`, `worldTransforms`,
`drawList`, `sampleClip`, `sampleTargets`, `solveTargets`, `clipEvents`,
`blendPoses`, `layerPoses`, `attachXf`, `shapesOf`, `anchorsOf`,
`clipDuration`, `solveChain`, `bakeTris`, `stringifyDoc`.

## Inside Uranus

When the `uranus` tools are present (mcp__uranus__*), you are in the
studio's Ask panel and the user is looking at the canvas. Work through
the editor, not the file system:

1. `get_document`: the open file, what is selected, which state or clip
   is on the canvas, the shared slot names, the project's files.
2. Change the document in memory, then `apply_document` with the whole
   document and a one-line `note`; it is validated and applied as one
   undo step. A refusal returns the errors: fix and apply again.
3. `render` a state or a clip frame to see what you did; `validate` a
   document you are unsure of before applying.
4. `open_file` to move to another file of the project.

Reply in a sentence or two: what changed. The user sees each tool use
and the note.

## Mistakes that bite

- `offset` is where the pivot *lands*, not a nudge. To draw as authored,
  leave it out (or set it to the pivot).
- A child's pivot should sit at the joint, on the parent, so turning it
  reads as articulation.
- A state that leaves a part out hides it; a clip key with `parts`
  must list every part that should show at that moment.
- `palette_refs` paths are relative to the file that names them
  (`../palettes/hull.fart` from `ships/`).
- A dark shape on a dark panel disappears: check the thumbnail.
- The version is the major: `"version": 1` (a number). Minor features
  (`parent`, `clips`, `constraints`, the 1.2 fields) need no version bump.
- A part with `like` must not carry `shapes` or `anchors`; the validator
  refuses it (`like`). A target must name a real chain (`ref.chain`).
- Blending and layering are runtime calls on sampled poses, not fields;
  a "flinch on top of a walk" is `layer_poses` with a weight that rises
  and falls.
- A 3D file is refused by 2D loaders (`load_bytes` says no;
  `load_bytes_3d` reads it). Inside Uranus with a model open,
  `get_document` says so and `render` takes a `view` (front, left, top,
  … or [x, y, z] radians).
- Mesh faces wind outward. Use the helpers, or `windOutward`; a face
  wound the wrong way vanishes in every view and every projection.
- `extrude`'s profile is in the plane's other two axes in a fixed order
  (`[z, y]` for x); a profile typed as `[y, z]` comes out mirrored.
- A sampled target only exists once the playhead reaches the key that
  names it; give the outgoing key a target too if the hand must track
  from the start.
- A morph replaces a shape's points whole: write every corner, in the
  base's order, and never add or drop one (the validator refuses the
  count, `morph`). To stretch a mesh in a state, morph it; to move the
  part, pose it; the two compose (morph first, then the pose).
- A path's `in`/`out` are **relative to their vertex** and there is one
  per point (error `curve`); an open path needs `w`. A crease of 0.5 is
  sharpness 5: fully sharp for five levels, which at `smooth: 2` means
  sharp. Use 0.1–0.3 for a fillet you can see at two levels.
- A `mirror` mod welds only points within `merge` of the plane: put the
  seam's points at exactly 0 on the axis, and never model the far half
  (it would be doubled). `paint` counts the cage's faces, before any
  mod; the mods carry it over.
- `solidify` moves along point normals, so the cage must be wound
  outward first: a cage wound inward grows its wall outward and shows
  its lining on the outside.
