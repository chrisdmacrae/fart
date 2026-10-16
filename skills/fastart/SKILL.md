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

## Workflow

Cheapest first; most work needs only the first three steps.

1. **Read the outline before the file.** `npx fart outline <file>` (or
   the Uranus tool `get_document` with `detail: "outline"`) is every
   name and count in a few hundred tokens; read the whole file only to
   change geometry by hand. `fart tokens` says what a file costs.
2. **Edit by patch or verb, never by rewriting.** In Uranus,
   `apply_patch` takes RFC 6902 operations addressed by **name**
   (`/parts/hull/pivot`, `/states/open/parts/lid/rotate`,
   `/clips/walk/keys/2/t`, shapes by index under their part), and the
   verbs `pose`, `morph`, `clip` and `make` do the common jobs in one
   call. On disk, change the JSON in place with a small script against
   `@fastart/core` (`applyPatch`, `pose`, `morph`, `setClip`,
   `makeShape`) and write it with `stringifyDoc`. Bakes (`tris`,
   `bake`) are a reader's business: never write them by hand; `fart
   bake` and the studio do.
3. **Anything with symmetry, a set, or a number you may change is a
   generator.** A `.mjs` in the project's `assets/gen/` that builds
   documents with `@fastart/make` (`doc`, `part`, `mirrorOf`,
   `ellipse`, `roundedRect`, `state`, `clip`, `morph`, `write`) and the
   solid helpers, validates, and writes. Changing the fleet is then one
   line and a rerun; Uranus shows "from gen/…" on such an asset and
   offers Regenerate. `{{FASTART}}/examples/space/generate.mjs` and
   `{{FASTART}}/examples/curves/generate.mjs` are the models to copy.
4. **Read the project's direction first** when one exists: a `.gas`
   file at the project root (`get_direction` in Uranus, or read it)
   says the palette, roles, scale, line, light, motion, names, the
   assets to copy from, and the rules; `fart lint` checks them. New
   assets take its defaults.
5. Validate, always: `cd {{FASTART}} && make validate DIR=/path/to/art`
   (every file below, refs resolved). Fix every error; warnings about
   unknown fields are yours to judge.
6. Look at it: `render` in Uranus (a state, a clip at a time, or
   `sheet: "states"` / `sheet: "clip"` for one image of everything), or
   `make serve DIR=/path/to/art` and `http://localhost:4747`.
7. Use it in the game (references/loaders.md). Ignore `*.fart~` files:
   they are the studio's checkpoints (gitignore them).

## References

Longer sections, read when the task needs them:

- `references/curves-and-3d.md`: paths and the pen, `space: "3d"`
  (mesh, ball, rod, sweeps, smooth surfaces, creases), projection,
  glTF, 3D collision, 3D chains.
- `references/textures.md`: textures as drawings (1.5), mapping.
- `references/scenes.md`: `.shart` scenes.
- `references/loaders.md`: loading in Odin and TypeScript, blending,
  layering, collision worlds, the raylib paths.
- `{{FASTART}}/spec/FORMAT.md` is the whole contract; `spec/TOOLING.md`
  and `spec/DIRECTION.md` say why the tools and the direction file are
  shaped as they are.

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
