# Fast Art Format (.fart) — v1.5

JSON-backed vector art for games. The format is the contract: any editor
that writes it and any engine that reads it agree through this document
alone. Scope: describing drawable, recolorable, re-posable art, flat or
(since 1.3) low-poly solid. Nothing else — no scenes, no logic, no engine
data (that's what `meta` is for).

The format is expressed in JSON. It is intended to be authored by hand
or by program, to be read and compared without tooling, and to be
interpreted by any runtime capable of parsing JSON. It is suitable for
prototyping and for shipped work alike; the specification draws no
distinction between the two.

The machine-readable half of this document is `fart.schema.json` beside
it, and the conformance corpus in `examples/` (see **Validation**).

## Conventions

- Coordinates: **y-down, x-right**. Units are the project's world units;
  the format doesn't interpret them.
- Art is authored **assembled, in document space**: the file at rest looks
  like the thing. Runtimes re-pose *parts* by rotating about their pivot
  and translating the pivot wherever they like. Animation is the runtime's
  job; the format supplies anatomy.
- All documents carry `"version": 1`. Readers must reject newer majors
  (and a document with no version, or a non-integer one).
- Unknown fields must be preserved by editors and ignored by loaders.
- Names (`name`, `part`, `color`) are non-empty strings, unique among
  their siblings: two parts, two states, or two local tokens may not share
  a name.

## Documents

Two kinds, distinguished by content, same extension:

- **Art file**: `parts` (+ optional `states`, `palette`, `palette_refs`).
- **Palette file**: `palette` only. Referenced by art files, shareable
  across a whole project (or several).

## Top-level

```json
{
  "version": 1,
  "name": "chest",
  "palette_refs": ["../palettes/base.fart"],
  "palette": [ {"name": "clasp", "rgb": [170,150,90,255]} ],
  "parts": [ ... ],
  "states": [ ... ],
  "meta": { }
}
```

- `palette_refs`: relative paths from this file, resolved in order.
- Token lookup order: this file's `palette` first, then `palette_refs`
  from last to first. Unresolvable tokens render loud magenta.
- Token entries are objects so later fields (e.g. `emissive`) are additive.
- `space` (1.3): `"2d"` (the default when absent) or `"3d"`. Everything
  in this document up to **Space: 3D** describes the 2D document; a 3D
  document is the same words with a third coordinate, and that section
  says exactly where they differ. A reader refuses a space it does not
  know (error `space`).

## Shapes

Order within a part = paint order.

```json
{"kind": "circle", "color": "wood",  "at": [0,0], "r": 3.2}
{"kind": "line",   "color": "steel", "a": [0,0], "b": [8,0], "w": 1.4}
{"kind": "poly",   "color": "wood",  "points": [[...]], "tris": [0,1,2, 0,2,3]}
```

- `circle` needs `at` and `r`; `line` needs `a`, `b` and `w`; `poly`
  needs at least three `points`. A drawn shape (one inside a part) always
  names a `color`; a collision shape may leave it out.
- `line` has round caps, width `w`.
- `poly` may be concave. **Editors bake `tris`** (index triples into
  `points`) on save so loaders can be dumb; loaders MAY fan untriangulated
  polys at their own risk. When present, `tris` is a multiple of three
  indices, each one a valid index into `points`.
- Reserved kinds for future versions: `ring`, `path`. A version-1 reader
  rejects them; they are not "unknown", they are spoken for.

### Shade (1.3)

```json
{"kind": "poly", "color": "steel", "shade": 0.72, "points": [[...]]}
```

A shape may carry `shade`, a number from 0 (absent = 1): the resolved
colour's red, green and blue are multiplied by it and clamped, alpha is
left alone. The token is still the recolor surface (a swap recolours a
shaded shape along with the rest), shade is the lighting painted on top:
the lit face and the shadowed face of one steel barrel name the same
token. Projections (below) write it; hands may too. A reader that
predates 1.3 draws flat.

## Parts

```json
{
  "name": "lid",
  "pivot": [0,-6],
  "shapes": [ ... ],
  "anchors": [ {"name": "hinge", "at": [0,-6]} ],
  "meta": { }
}
```

- Parts contain shapes only; a part never contains parts. Since 1.1 a
  part may name a `parent` instead (below), which is the articulation.
- `pivot` is in document space: the point the runtime rotates about and
  places.
- `anchors`: named document-space points runtimes may query (grips,
  muzzles, flames, hinges).

### Parents (1.1)

```json
{"name": "fore_l", "parent": "upper_l", "pivot": [6, 2], "shapes": [ ... ]}
```

A part with a `parent` is posed **in its parent's frame**: its own pose
(offset, rotate, scale) places it as if the parent were at rest, and the
parent's pose then carries it along. Writing a part's pose as the affine
map

    L(part) = translate(offset) · rotate(rotate) · scale(scale) · translate(-pivot)

the world transform is `W(part) = W(parent) · L(part)`, and `W = L` for a
part without a parent. Consequences:

- At rest (every pose identity) the file draws exactly as authored, parents
  or not. Parents only matter once something moves.
- A child's `offset` is where its pivot lands **in the parent's rest
  space**; absent, it is the pivot itself, as ever. Move the torso and the
  arm comes along without the arm's state entry changing at all.
- Paint order is untouched: a state's list (or file order) still decides
  who paints over whom. Parents are about motion, not layering.
- A parent that a state leaves out contributes identity: the child draws as
  if its parent were at rest.
- The parent must exist; chains of parents must not loop.

A reader that predates 1.1 ignores `parent` and poses every part on its
own, so a file that leans on parents looks right at rest and wrong in
motion there. That is the one place a minor version changes a picture,
and it is the point of the version.

## States

Named part-lists. **State order is paint order** (a lid may layer
differently open vs closed). Entries are objects; `offset`/`rotate`/
`scale` optionally re-pose the part relative to its rest placement, so one
drawing serves many poses:

```json
{
  "name": "open",
  "parts": [
    {"part": "box"},
    {"part": "lid", "rotate": 2.6, "offset": [0,-3]},
    {"part": "clasp"}
  ]
}
```

- `offset` is **where the part's pivot lands**, in document space -- a
  position, not a delta. Absent, it means the pivot itself: the rest
  placement. (`{"part": "box"}` draws the box exactly where it was
  authored; `{"part": "box", "offset": [0, 0]}` drags its pivot to the
  origin.) Editors write it explicitly; hand-written files may leave it
  out.
- `rotate` in radians about the pivot; absent = 0. `scale` multiplies
  about the pivot; 0 or absent = 1.
- A state's `parts` list may be empty (nothing drawn), and every entry
  must name a part the document has.
- A runtime asked for an unknown state should draw all parts in file order.

## Clips (1.1)

Animation is states in time. A clip is a named list of keys, each at a
time in seconds, each naming a state (or carrying an inline part list
shaped exactly like a state's `parts`):

```json
"clips": [
  {"name": "open", "loop": false, "keys": [
    {"t": 0.0, "state": "closed"},
    {"t": 0.4, "state": "open", "ease": "out"}
  ]}
]
```

- `keys` are in non-decreasing `t`, at least one of them. Each key has
  exactly one of `state` (a name the document has) or `parts`.
- Between two keys, a runtime interpolates each part's pose: `offset` and
  `scale` linearly, `rotate` the short way round. The fraction is eased by
  the **incoming** key's `ease`: `linear` (the default), `in`, `out`,
  `in-out`, or `step` (hold the outgoing key until the incoming one).
- Which parts are drawn, and in what order, comes from the outgoing key
  until time reaches the incoming key: membership and paint order switch
  at keys, they do not tween. A part in the outgoing key but not the
  incoming one holds its pose.
- Before the first key the first key holds; after the last, the last.
  With `loop`, time wraps at the last key's `t` (a loop that should ease
  back to its start ends with a key equal to its first).
- Sampling a clip at a time yields a part list shaped like a state's:
  draw it the way you draw a state. Nothing else in the format changes;
  a clip is a state factory.

## Constraints (1.1)

Inverse kinematics, declared so a runtime may solve it live (feet on a
slope, a hand on a ledge). An editor also uses chains as a posing tool,
and the result of that is ordinary states; games only need this section
when they solve at runtime.

```json
"constraints": [
  {"name": "arm_l", "chain": ["upper_l", "fore_l"], "end": "fore_l/hand", "bend": 1}
]
```

- `chain` lists parts root-first; each part after the first has the
  previous as its `parent`. The joints are the parts' pivots; the last
  bone runs from the last pivot to `end`.
- `end` is `part/anchor`: an anchor on the chain's last part.
- `bend` (optional, `1` or `-1`) is the preferred elbow direction where a
  solution is ambiguous.
- Solving means: given a target point in document space and a state,
  adjust the chain parts' `rotate` so the end anchor reaches the target,
  leaving everything else in the state alone. The reference solver is
  cyclic coordinate descent; any solver that reaches the same point is
  conforming.

## Mirror and reuse (1.2)

```json
{"name": "claw_r", "pivot": [5, 0], "shapes": [ ... ], "anchors": [ {"name": "tip", "at": [9, 0]} ]},
{"name": "claw_l", "like": "claw_r", "parent": "body", "pivot": [5, 0]}
```
```json
{"part": "claw_l", "mirror": true, "offset": [-5, 0]}
```

- A part with `like` draws another part's `shapes` and `anchors`, and
  has none of its own (a validator refuses a `like` part carrying
  either). It keeps its own `name`, `pivot`, `parent` and pose, so one
  claw's geometry serves both sides. `like` does not chain: the source
  draws its own geometry. A reader that predates 1.2 draws the part
  empty.
- `mirror` on a state entry flips the part left-to-right about its
  pivot, before the turn, so a mirrored part still turns the way its
  parent does:

      L(part) = translate(offset) · rotate(rotate) · scale(scale) · mirror · translate(-pivot)

  with `mirror` reflecting x across the pivot. It does not tween: between
  keys the outgoing key's flip holds. A solver adjusting rotations under
  a mirrored ancestor turns the other way (the parent's frame is
  reflected), which is the solver's business, not the author's.

## Sockets: anchors with a direction (1.2)

```json
"anchors": [ {"name": "hand", "at": [12, 1], "angle": -0.4} ]
```

An anchor may carry an `angle` (radians, in the part's rest space): the
direction an attached thing points. Attaching one document to another is
a runtime operation the format only makes exact: to put an item's anchor
(a sword's `grip`) onto a host's (a hand), align the positions and, where
both have an `angle`, the directions:

    attach = W(host part) · translate(host.at) · rotate(host.angle − item.angle) · translate(−item.at)

and draw the item's rest space through it. Which item sits in which hand
is game state, so files never name each other for this.

## IK targets (1.2)

```json
{"name": "reach", "parts": [ ... ], "targets": [ {"chain": "arm_l", "at": [14, -2]} ]}
```

A state, or a clip key, may carry `targets`: chains and the document-space
points they reach. The chain parts' rotations in the pose are the solved
result as of saving, so a reader that does not solve draws the right
thing; an editor re-solves whenever the pose changes (the hand stays on
the latch while the torso moves), and a runtime that solves live does so
after sampling. Between keys, a target both keys name tweens linearly and
the solve follows; a chain only the outgoing key targets holds its point.

## Events (1.2)

```json
{"t": 0.3, "state": "plant", "events": ["footstep"]}
```

A key may carry `events`, names a runtime hears when the playhead crosses
the key's time going forward: the footstep, the hit frame of a swing.
Reading events from t0 to t1 yields the events of keys with a time in
(t0, t1]; on a loop the interval wraps, and the wrap key itself (the last
one) never fires, since the first key at 0 stands for it.

## Curves (1.2)

```json
{"t": 0.4, "state": "open", "ease": "out", "curve": [0.34, 1.56, 0.64, 1]}
```

A key may carry a `curve`: a cubic bezier's two control points, [x1, y1,
x2, y2] with x within 0..1 (the CSS `cubic-bezier` form), bending the
fraction of time toward this key. Where present it wins over `ease`;
authors set `ease` to the nearest name anyway, so a reader that predates
1.2 stays close.

## Emissive tokens (1.2)

```json
{"name": "flame", "rgb": [255, 140, 50, 255], "emissive": 1.5}
```

A palette token may carry `emissive`, a number from 0: how much light the
slot gives off. The format says nothing about what light is; a game with
lighting reads it, one without ignores it.

## Blending and layering (1.2)

Clips sample to pose lists, and two pose lists combine. The format
defines the two operations so every runtime agrees, and neither needs
anything new in a file:

- `blend(a, b, w)`: every part in both lists tweens by `w` (`offset` and
  `scale` linearly, `rotate` the short way round); which parts draw, and
  in what order, comes from `a` while `w` is below 0.5 and from `b`
  after. A crossfade between two clips is a blend with a ramping `w`.
- `layer(base, over, w)`: parts `over` names tween from their base pose
  toward the layer's by `w`; every other part keeps the base pose; the
  base's order stands, and a part only the layer has joins the end once
  `w` reaches 0.5. A head turn over a gait is a layer; a flinch is a
  layer whose weight rises and falls.

`mirror` and targets come from the leading side of a blend and from the
base of a layer. Additive layers (a delta on top of any pose) are not
defined yet; a layer with a weight envelope covers the common cases.

## Space: 3D (1.3)

```json
{"version": 1, "space": "3d", "name": "pistol", "parts": [ ... ], "states": [ ... ]}
```

A document with `"space": "3d"` describes a low-poly solid the same way
a 2D document describes a drawing: parts with pivots and parents,
shapes that each paint one token, states and clips that pose them. It is
authoring-side first (model once, project to any 2D view; see
`PROJECT.md`), and a game with a 3D renderer may load it directly.

- Coordinates: **x-right, y-down, z-away** (into the picture), a
  right-handed frame. Dropping z from a 3D document at rest gives its
  front view: the file at rest still looks like the thing, from the front.
- Every point that was `[x, y]` is `[x, y, z]`: shape geometry, `pivot`,
  anchor `at`, pose `offset`. A 2D reader that predates 1.3 refuses a 3D
  document at the schema stage, which is the right outcome.
- Shapes are `mesh`, `ball` and `rod`; `circle`, `line` and `poly` do not
  occur in a 3D document (a mesh face is what a poly becomes):

```json
{"kind": "mesh", "color": "wood",  "points": [[0,0,0], ...], "faces": [[0,1,2,3], [4,5,6,7], ...], "tris": [0,1,2, 0,2,3, ...]}
{"kind": "ball", "color": "brass", "at": [0,0,0], "r": 1.2}
{"kind": "rod",  "color": "steel", "a": [0,0,0], "b": [8,0,0], "w": 0.6}
```

  - `mesh`: `points` (three or more) and `faces`, each face a list of
    three or more indices into `points`, planar, wound so that
    `(p1 − p0) × (p2 − p0)` points **outward**. A face may be concave.
    **Editors bake `tris`** (index triples into `points`, every face
    fanned or ear-clipped) on save so renderers can be dumb; `tris` is
    optional in a hand-written file. Error `face` covers a face with
    fewer than three indices or an index past the last point; `tris`
    covers the triples as in 2D.
  - `ball`: a sphere at `at` with radius `r`. `rod`: a round-capped
    cylinder from `a` to `b`, width `w`. Both project to exactly the
    circle and the line a 2D reader draws.
  - `shade` applies as in 2D.
- Anchors carry `at` and, for a socket, `dir`: a direction vector in the
  part's rest space (unit length is the convention; readers normalise).
  `angle` has no meaning in 3D.
- A pose's `rotate` is `[x, y, z]`: radians about the pivot, applied as
  a turn about x, then y, then z, in the parent's rest frame. Each turn
  is right-handed about its axis, so a turn about z is the 2D `rotate`
  exactly (`x' = x cos θ − y sin θ`, `y' = x sin θ + y cos θ`). Absent
  is `[0, 0, 0]`. `scale` stays one number; `mirror` reflects x across the
  pivot before the turn, as in 2D. The local map is

      L(part) = translate(offset) · Rz · Ry · Rx · scale · mirror · translate(−pivot)

  and `W(part) = W(parent) · L(part)` as ever.
- Tweening (clips, blending, layering): `offset` and `scale` linearly;
  `rotate` **as a rotation**, the short way round: both keys' turns
  become quaternions (`q = qz · qy · qx`), the pair is brought to a
  positive dot product, and the frame is their spherical interpolation.
  A reader that lerps Euler angles instead is wrong past small turns.
- Attaching: positions matched and, where both anchors have a `dir`,
  the item turned by the shortest rotation taking its `dir` onto the
  host's. Roll is left alone.
- A state's list is membership; in 3D, depth decides what paints over
  what, so the order carries no meaning (readers keep it anyway, and the
  projection sorts by depth). `like` keeps a part's geometry shared.
- Chains and targets work as in 2D with a third axis: a constraint's
  `chain`, `end` and errors are the same; `bend` has no meaning in 3D
  and an optional `pole` (`[x, y, z]`, document space) is a point the
  first elbow leans toward, since a bent chain in space may swivel
  freely about its root-to-end line. A target's `at` is `[x, y, z]`.
  The reference solver is cyclic coordinate descent: each joint, end
  first, turns about the axis `(joint → end) × (joint → target)` by the
  angle between them, in its parent's frame; then, with a pole, the root
  swings the chain about the root-to-end line until the elbow lies
  toward the pole. Any solver that reaches the same point conforms.
  Everything else (`like`, `mirror`, clips, `events`, `curve`,
  `emissive`, `collision` with the 3D kinds, `palette_refs`) means what
  it means in 2D.
- Nothing here changes a 2D document: a 2D file is a 1.2 file, byte for
  byte, unless it uses `shade`.

## Textures (1.5)

A texture is a set of **maps**, and every map is a drawing: a 2D Fast
Art file tiled over a cell (since 1.12 a map may instead be a PNG; see
**Images**). The
colour map is what a reader paints; every other map (`height`, `glow`,
`rough`, whatever a game invents) is a scalar field the format carries
and the engine reads, the way it carries `layer` on collision.

```json
"textures": [
  {"name": "planks", "cell": [8, 8], "maps": {
    "color":  {"ref": "textures/planks.fart"},
    "height": {"ref": "textures/planks.fart", "palette": "palettes/height.fart", "mode": "mask"},
    "glow":   {"ref": "textures/planks.fart", "state": "knots"}
  }}
]
```

- `cell` is `[w, h]` in the map drawings' own units: the tile is the
  rectangle from `[0, 0]` to `[w, h]` of each map's document space, and
  the drawing repeats with that period. **Pattern coordinates** are that
  document space.
- A map names a `ref`: a relative path (as `palette_refs` are) to a 2D
  art file. Its tokens resolve through that file's own palette and refs;
  a `palette` (a relative path to a palette file) is then laid over
  them, as a swap. A `state` picks which of the drawing's states to
  draw; absent, its first state, or every part in file order. Since
  one drawing under two palettes is two maps, maps of one texture line
  up for free.
- `mode` is `paint` (the default) or `mask`. Read as **colour**, a
  `paint` map's resolved colour lies over the shape's token where it
  paints, and the token shows where it does not; a `mask` map
  multiplies the token by its **value**. Read as a **scalar**, a map's
  value at a point is the painted colour's luminance
  (`0.2126 r + 0.7152 g + 0.0722 b`, over 255) times its alpha times the
  shape's `shade`, and 0 where nothing is painted. `shade` on the
  textured shape multiplies the colour last, as ever.
- A texture's `name` is unique among textures (`dup.texture`); a shape
  that names a texture the document lacks is `ref.texture`; a map's ref
  must be relative (`path`); a texture has at least one map (`schema`).
  A ref that cannot be read is the `unresolved` warning, like a palette.

A shape takes a texture by name, with a **mapping** from pattern
coordinates to its own space:

```json
{"kind": "poly", "color": "wood", "texture": "planks", "mapping": {"at": [4, 0], "angle": 0.2, "scale": 1.5}, "points": [...]}
{"kind": "mesh", "color": "wood", "texture": "planks", "mapping": {"scale": 2}, "points": [...], "faces": [...]}
```

- **2D**: `mapping` is `{at, angle, scale}` (pattern space placed with
  its origin at `at`, turned by `angle`, scaled by `scale`; all
  optional, identity by default) or `{xf}`, the affine map from pattern
  coordinates to document space as six numbers `[a, b, c, d, e, f]`
  (`x' = a x + c y + e`, `y' = b x + d y + f`), which is what a projector
  writes. A circle or a line is filled by the pattern over its area like
  a poly.
- **3D**: `mapping` is `{scale, uvs}`, both optional. Without `uvs` a
  mesh is **box mapped**: each face takes pattern coordinates from the
  two axes across its dominant normal, in world units over `scale`
  (default 1): a face facing ±x reads `(z, y)`, ±y reads `(x, z)`,
  ±z reads `(x, y)`. So planks line up across a wall with nothing
  authored. `uvs` are explicit pattern coordinates per face and corner,
  `uvs[face][corner]`, one pair per point of that face. A ball or a rod
  is box mapped as the mesh it flattens to. A face's mapping reaches
  its projection as a 2D `xf` (see `PROJECT.md`).
- A part drawn `like` another has its source's textures.
- Loaders hand a renderer the pattern coordinates per corner and the
  texture's name; rasterising a map is a drawing job (the reference
  loaders do it in fifty lines, and `fart bake --textures` writes the
  pixels for a build). Readers that predate 1.5 draw the shape's token
  flat and keep the fields.

## Morphs (1.6)

A state may change a part's shape as well as its place. A state entry's
`morph` lists, per shape of the part, the points that shape has in this
state:

```json
{"part": "chest", "offset": [0, 0, 0], "morph": [
  {"shape": 0, "points": [[-4, -3, 2], [4, -3, 2], [4, 3, 2], [-4, 3, 2], [-4, -3, -2], [4, -3, -2], [4, 3, -2], [-4, 3, -2]]}
]}
```

- `shape` is an index into the part's own `shapes`; `points` replaces
  that shape's `points` whole, so it has exactly as many entries as the
  base, in the same order. Only shapes that have points morph: `poly` in
  2D, `mesh` in 3D. Faces, `tris`, colour, `shade`, texture and mapping
  stay the base's: a morph moves corners, never a mesh's topology.
- A part drawn `like` another has no points of its own and may not
  morph. That, an index past the last shape, a shape of another kind, or
  a point count that differs from the base is error `morph`.
- The pose applies to the morphed points as it would to the base: morph
  first, then `mirror`, `scale`, the turn, `offset`.
- Between keys, a clip lerps the points: each corner moves straight
  toward its place in the incoming key, by the eased fraction. A shape
  only one key morphs lerps from or to the base. Blending and layering
  mix morphs the same way. A `step` ease holds the outgoing morph.
- Collision shapes never morph, and anchors do not move with a morph.
- Projection (`PROJECT.md`): a morphed entry bakes a variant part, the
  way a turn out of the view plane does.
- A 1.5 reader draws the base shape in every state and is otherwise
  right.

## Paths (1.7)

A `path` is a cubic polybézier, one token, the curve kind every vector
tool keeps (Lottie, Rive and Figma store exactly this):

```json
{"kind": "path", "color": "skin", "closed": true,
 "points": [[-6,-4], [6,-4], [8,0], [6,4], [-6,4], [-8,0]],
 "in":     [[-2,0],  [-2,0], [0,-2], [2,0],  [2,0],  [0,2]],
 "out":    [[2,0],   [2,0],  [0,2],  [-2,0], [-2,0], [0,-2]],
 "bake": {"points": [[-6,-4], [-5.1,-4.2], ...], "tris": [0,1,2, ...]}}
```

- `points` are the vertices. `in[i]` and `out[i]` are the tangent
  handles **relative to `points[i]`**; absent, or `[0, 0]`, the vertex
  is a corner. The segment from vertex i to i+1 is the cubic through
  `points[i] + out[i]` and `points[i+1] + in[i+1]`. A path with no
  handles is a polygon, which is what `poly` still is.
- `closed` adds the last-to-first segment and fills. An open path
  strokes with `w`, round joins and caps, like `line`.
- **Flattening.** A reader draws the path as a polyline whose every
  point lies within **0.05 document units** of the curve (half a pixel
  at ten pixels per unit). Any algorithm inside that bound conforms;
  recursive subdivision against the chord distance is the reference.
- **The bake.** Editors write `bake` on save: the flattened polygon,
  with `tris` when closed, so a reader that does not flatten draws
  `bake.points` as a `poly`. A hand-written file may leave it out. A
  reader that flattens for itself ignores it.
- **Morphs** (1.6) replace `points`; the handles ride along since they
  are relative. A morph may carry `in` and `out` too, one per point.
  The bake is the base's, so a reader drawing bakes draws the base
  shape in every state, the documented 1.6 fallback.
- Collision, `fart hull`, textures and `shade` treat a path as the
  polygon it flattens to.
- Error `curve`: `in` or `out` with a count that differs from `points`,
  an open path without `w`, a closed path with fewer than three points.

## Smooth surfaces (1.7)

A mesh stays the low-poly cage it was; three optional fields refine it.
A reader that knows none of them draws the cage, which is a correct
low-poly rendering of the same thing.

```json
{"kind": "mesh", "color": "clay", "points": [...], "faces": [...],
 "normals": "smooth", "smooth": 2,
 "creases": [[0, 1, 1], [1, 2, 0.6], [4, 1]]}
```

- `normals`: `"flat"` (the default) lights each face by its own
  normal; `"smooth"` lights each vertex by the average of its faces'
  normals, except across a sharp edge (a crease of 1, a boundary) or
  across edges whose faces meet at more than `angle` degrees (absent:
  no limit). Smooth normals cost no geometry and are what most rounded
  low-poly props want. Once `smooth` is above 0 the default is
  `"smooth"`.
- `smooth`: the number of Catmull-Clark subdivision levels, 0 by
  default. `creases` lists `[a, b, c]` for the edge from point a to
  point b with crease `c` in 0–1, and `[a, c]` for a corner. The rules
  are OpenSubdiv's, so any renderer with them conforms: `c` is
  sharpness `c × 10`, infinitely sharp at 1; a semi-sharp crease loses
  one unit of sharpness per level and then rounds off (a fillet); a
  boundary is sharp and its corners are pinned (`EDGE_AND_CORNER`).
  The limit surface is the target: a reader that subdivides `smooth`
  levels with these rules conforms, and so does one that evaluates it
  another way. Explicit `uvs` interpolate linearly within their face:
  each level, a face's child at one of its corners takes that corner's
  coordinates, the middles of the two edges there, and the mean of the
  face's corners, in the child's own corner order. Coordinates never
  cross an edge, so a seam in the pattern stays where the cage has it.
- **The cage is the file.** Morphs move cage points; the surface
  follows (subdivision is linear in the cage, so a lerp of cages is a
  lerp of surfaces). Collision and `fart hull` use the cage. Vertex
  handles in an editor are cage points.
- **The bake.** `bake` is the subdivided surface `{points, faces,
  tris, of}` with `of` a hash of the cage it came from (and, for a cage
  with explicit `uvs`, `uvs` for the bake's own faces with `uvOf` a hash
  of the cage's; a bake without them is not used for such a cage); a reader
  that does not subdivide draws it, and drops it when `of` no longer
  matches. Editors do **not** write it on save (two levels on a
  200-face cage is 3,200 faces of JSON); `fart bake --smooth` does,
  for a game that will not subdivide. A bake never morphs.
- Error `crease`: a value outside 0–1, a point the mesh lacks, or an
  edge pair that is not an edge of a face. `smooth` must be a whole
  number (`schema`).

## Sweeps (1.7)

A `sweep` is a solid generated from a 2D profile, kept as the profile
so an editor can change it after the fact:

```json
{"kind": "sweep", "color": "brass", "op": "lathe", "axis": "y", "segments": 12,
 "profile": {"points": [[0,-6], [3,-5], [3.4,0], [2,4], [0,4]], "out": [[0,0],[0.4,-0.6],[0,2],[0,0],[0,0]], "in": [[0,0],[-0.4,0.6],[0,-2],[0,0],[0,0]]}}
{"kind": "sweep", "color": "wood", "op": "extrude", "axis": "z", "from": -1, "to": 1,
 "profile": {"points": [[-4,-3], [4,-3], [4,3], [-4,3]]}}
```

- `profile` is a `path` body without a kind: `points`, optional `in`
  and `out`, flattened at the path tolerance. For `lathe` the points
  are `[radius, along]` revolved about `axis` in `segments` steps (3 or
  more, 12 by default), a zero radius an apex, an open end capped. For
  `extrude` the profile is closed and runs along `axis` from `from` to
  `to`, in the plane's other two axes in a fixed order (`[z, y]` for x,
  `[x, z]` for y, `[x, y]` for z).
- The sweep's mesh is wound outward and drawn as a `mesh`; `normals`,
  `angle`, `smooth`, `creases` (over the generated points), `texture`
  and `mapping` apply to it as to a mesh, and `bake` may hold the
  generated (and subdivided) mesh for readers that do not generate.
- A sweep has no `points` of its own, so it does not morph; it never
  occurs in `collision` (give the collision its mesh).

## Paint (1.8)

A shape names one token, and that was the whole of colour until a helm
wanted a brass band round its brow. A `mesh` or a `sweep` may carry
further tokens and say which face wears which:

```json
{"kind": "mesh", "color": "steel", "colors": ["brass", "lining"],
 "points": [...], "faces": [[0,1,2,3], [4,5,6,7], [0,4,7,3], ...],
 "paint": [1, 1, 0, ...]}
```

- `colors` is a list of palette tokens. `paint` has one whole number
  per face, in the order of `faces`: `0` is the shape's own `color`,
  `n` is `colors[n - 1]`. A shape without `paint` is all `color`, and
  so is one whose reader knows neither field: the file is still right,
  in one colour.
- Tokens in `colors` resolve as `color` does, and one that nothing
  supplies is the same `ref.token`.
- Through subdivision a face's children wear their face's paint. A
  morph changes no paint. `shade`, textures and normals are the
  shape's, whatever the paint.
- On a `sweep` the faces counted are those of the mesh it generates, in
  the order its op makes them: a lathe's sides ring by ring along the
  profile (each ring's faces in the order of the steps round the axis),
  then the cap at the profile's start and the cap at its end where
  there are any; an extrude's cap at `from`, its cap at `to`, then one
  side for each edge of the profile in order; a pipe's as **Pipes**
  says, a rail's as **Rails**. A profile or path with handles is flattened first, and the
  count then depends on the flattening: paint a sweep whose outline is
  corners, or paint its `bake`.
- Error `paint`: a `paint` whose count differs from the faces, an index
  past the last of `colors`, or `paint` on a shape with no `colors`. A
  loader inside a game that meets a `paint` it cannot use draws the
  shape in `color`.
- 2D shapes are one face each and take no paint.

## Shades (1.8)

`shade` darkens a whole shape. `shades` darkens it point by point, for
the soft shadow a modelling tool bakes into a fold:

```json
{"kind": "mesh", "color": "steel", "shade": 0.9, "points": [...8 points...],
 "faces": [...], "shades": [1, 1, 0.8, 0.8, 1, 1, 0.8, 0.8]}
```

- `shades` has one number per point, 0 or more, in the order of
  `points`. The colour at a point is the token's times `shade` times
  that point's number; across a face it is interpolated between the
  corners, as a renderer's vertex colour is.
- Through subdivision a shade is refined as a fourth coordinate: every
  rule that places a new point from old ones (a face point, an edge
  point, a moved vertex, creases included) gives it the same weighted
  sum of their shades. A result below 0 is 0.
- A morph moves points and leaves `shades` as they are.
- Only a `mesh` has points, so only a `mesh` has `shades`. A sweep's
  bake may carry them (below). Error `shades`: a count that differs
  from `points`, or `shades` on a sweep.
- Projection (`PROJECT.md`) gives a face one shade: the mean of its
  corners' shades times the shape's, under the light as ever.
- 2D shapes keep the one `shade`.

## Modifiers (1.8)

A `mesh` or a `sweep` may carry `mods`: an ordered list of operations a
reader applies to the cage before it draws. The cage stays the file,
half a helm with no thickness, and the mods make the rest every time:

```json
{"kind": "mesh", "color": "steel", "colors": ["lining", "brass"],
 "points": [...], "faces": [...], "smooth": 2,
 "mods": [
   {"op": "mirror", "axis": "x", "merge": 0.001},
   {"op": "solidify", "thick": 0.3, "offset": -1, "inner": 1, "rim": 2},
   {"op": "crease", "angle": 40, "value": 0.2}
 ]}
```

The order of work is fixed: the cage (a sweep's generated mesh), then a
morph's points, then the mods in list order, then `smooth`, then
triangles. Each mod takes the mesh the one before it left. `creases`,
`paint`, `shades` and explicit `uvs` in the file are over the cage and
ride through every mod as told below. A reader that knows no mods draws
the cage: half the helm, thin, and still the right shape as far as it
goes.

- **`mirror`**: `axis` is `x`, `y` or `z`; the plane is where that
  coordinate is 0 in the shape's own space. A point within `merge` of
  the plane (0.001 when absent) is **welded**: it stays one point and
  its coordinate on the axis becomes exactly 0. Every other point gets
  a copy with that coordinate negated; the copies follow the cage's
  points, in the cage's order. After the cage's faces come their
  copies in the same order, each with its points mapped to the copies
  and listed in reverse, so the copy faces out as its source does. A
  face whose every point is welded lies in the plane and is not
  copied. A copied face has its source's paint and its `uvs` in
  reverse; a copied point its source's shade; a crease is copied to
  the copied edge or corner (not when it lies wholly on the plane).
- **`solidify`**: gives a surface, open or closed, a wall `thick`
  deep. Each point has a normal: the unit normals of the faces that use
  it, summed and made unit. With `offset` o in −1…1 (−1 when absent)
  the outer shell is every point moved `thick × (1 + o) / 2` along its
  normal and the inner shell every point moved `thick × (1 − o) / 2`
  against it: at −1 the cage is the outside and the wall grows inward,
  at 1 the cage is the inside, at 0 it is the middle. The outer shell's
  points keep the mesh's indices; the inner shell's follow, point i at
  i + n for n points. The faces are the mesh's own, then the inner
  faces in the same order (each face's points plus n, reversed), then
  the **rim**: for every edge a → b that only one face uses, taken face
  by face and edge by edge, the quad `[b, a, a + n, b + n]`. A closed
  surface has no such edge and becomes a hollow shell. `inner` and
  `rim` are paint indices for those faces; absent, an inner face wears
  its source's paint and a rim quad the paint of the face its edge
  belongs to. Shades and creases are copied to the inner shell; an
  inner face has its source's `uvs` in reverse, and a rim quad its
  edge's two, repeated across it.
- **`crease`**: every edge with two faces whose normals stand more than
  `angle` degrees apart (30 when absent) gets the crease `value` (1
  when absent), unless it already has one: explicit `creases` win, and
  so does an earlier mod. With `smooth` above 0 this is a bevel, a
  fraction a fillet, as **Smooth surfaces** has it; with `smooth` at 0
  and `normals` smooth, a value of 1 is a hard edge.
- **Morphs.** What a mod decides, it decides on the rest cage: which
  points weld, which edges crease. A morph then moves positions only (a
  welded point stays on the plane, wherever the morph put it), so every
  pose has the same points and faces and a lerp of cages is still a
  lerp of surfaces. Solidify's normals are the posed cage's.
- **`fart hull`** reads the cage with its mods applied, before
  smoothing: both halves, with their thickness.
- **The bake.** A shape with `mods` may carry `bake` as a smooth one
  does: the final mesh, mods and subdivision done. A bake may hold
  `paint`, one index per face of the bake, and `shades`, one number per
  point of the bake; a reader drawing a bake uses those, never the
  cage's. `of` covers what the bake was made from: for a shape with
  any of `mods`, `paint` or `shades`, the cage's points, faces, creases
  and `smooth` as in 1.7, then its `mods`, `paint` and `shades`. A
  shape with none of the three hashes exactly as it did in 1.7, so its
  old bakes stand. A bake that lacks the `paint` or `shades` its shape
  would give it is not used. `fart bake --smooth` writes the bake of
  every generated shape: smooth meshes, shapes with mods, and sweeps.
- Errors. `mod`: an `op` that is not one of these three. `paint`: an
  `inner` or `rim` past the last of `colors`. `crease`: a `value`
  outside 0–1. A missing `axis` or `thick`, or an `offset` outside
  −1…1, is `schema`.
- 2D shapes take no mods: a mirrored part is `like` and `mirror`, and
  a path has its width.

## Pipes (1.8)

The third sweep carries a section along a path in space: a plume, a
horn, a strap, the wire of a lantern.

```json
{"kind": "sweep", "color": "plume", "op": "pipe", "segments": 6,
 "path": {"points": [[0,-9,0], [0,-12.5,1.5], [0,-12,5.5], [0,-8,8]],
          "out":    [[0,-1.5,0], [0,-0.8,1.6], [0,1.2,1.4], [0,0,0]],
          "in":     [[0,0,0], [0,1.2,-1], [0,-1,-1.6], [0,-1.6,-0.8]]},
 "radius": 0.8, "radii": [0.5, 1, 0.9, 0], "caps": true, "closed": false}
```

- `path` is a path body with three coordinates: `points`, and optional
  `in` and `out` handles relative to their points, one per point. It is
  flattened as a path is, within 0.05 units of the curve; a flattened
  point that sits on the one before it is dropped. `closed` (on the
  shape, false when absent) joins the last point to the first. A pipe
  has no `axis`.
- **The section** is a circle of radius 1 in `segments` sides (8 when
  absent, 3 or more), its corner k at angle 2πk / `segments`; or
  `profile`, a closed path body in two coordinates as an extrude has,
  flattened, taken in reverse when its signed area (Σ xₖ yₖ₊₁ − xₖ₊₁ yₖ)
  is negative. At each point of the flattened path the section is
  scaled by `radius` (1 when absent) times that place's entry of
  `radii`. `radii` has one number per point of `path.points`; between
  two path points the factor is linear in the cubic's own parameter;
  absent, it is 1 everywhere. So a round pipe's `radius` is its radius.
- **The frame.** Each point of the flattened path has a tangent T: at
  an open end the direction of its one segment, elsewhere the unit
  directions of the two segments that meet there, summed and made
  unit. The first normal N is the world axis T leans on least (the
  smallest component of T by size; x before y before z in a tie), made
  perpendicular to T. Each next N is the last one turned by the
  shortest rotation that takes the last T onto this one: parallel
  transport, so the section never rolls about the path. B is T × N,
  and a section point (x, y) stands at `P + s (x N + y B)`. On a closed
  path the frame returns to the start turned by some angle; that angle
  is undone evenly, ring i of m turned by i / m of it about its own T.
  No ring is stretched at a bend.
- **The mesh.** One ring of points per flattened path point, in path
  order, each in section order. Faces: for each ring and the next (and
  on a closed path the last and the first), for each section corner k,
  the quad `[aₖ, aₖ₊₁, bₖ₊₁, bₖ]`; then, on an open path with `caps`
  (true when absent), the first ring reversed and the last ring as it
  is. All of it faces out. A scale of 0 at an open end is an apex: one
  point, triangles to it, no cap.
- `normals`, `angle`, `smooth`, `creases` (over the generated points),
  `colors` and `paint` (over the generated faces, in the order above),
  `texture`, `mapping`, `mods` and `bake` apply as to the other sweeps.
  Like them a pipe has no `points`, does not morph, and never occurs in
  `collision`.
- Error `pipe`: `radii` with a count that differs from the path's
  points, or a closed pipe with fewer than three path points. Handles
  with the wrong count are `curve`, as on any path. A pipe without a
  `path` is `schema`.
- A 1.7 validator refuses `op: "pipe"` at the schema stage. A loader
  that does not know the op draws the shape's `bake` when it has one.

## The compiled sidecar (1.8)

A document full of cages, mods, sweeps and subdivision is small to
write and slow to turn into triangles. A build may do that once and
keep the result beside the file: for `helm.fart`, the **sidecar** is
`helm.fart.glb`, a binary glTF 2.0 holding every part's shapes as the
triangles a reader would have generated.

- The sidecar is **derived**. The `.fart` is the source of truth and
  the only thing an editor opens or writes; tools never edit a sidecar,
  only replace or remove it. It is a build artifact: keep `*.fart.glb`
  out of version control and make it in the build (`fart build art/`).
- A reader **may** use a sidecar in place of generating, and only when
  it is its source's: `asset.extras.fart.of` equals the hash of the
  `.fart` file's bytes. When it does not, or there is no sidecar, the
  reader generates from the `.fart` as if the sidecar were not there.
  The sidecar holds geometry, the rest pose and clips; palettes,
  states, targets, collision, textures and `meta` are still read from
  the `.fart`.
- **The hash** is FNV-1a, 64 bits, over the source file's bytes exactly
  as they are on disk (offset basis `cbf29ce484222325`, prime
  `100000001b3`), written as sixteen lowercase hex digits. The hash of
  no bytes is `cbf29ce484222325`; of the one byte `a`,
  `af63dc4c8601ec8c`. Any change to the file, a space included, makes
  another hash.
- Only a 3D document has a sidecar. A 2D document, a palette file and
  a scene have none.

The layout, which a reader may rely on:

- `asset.extras.fart` is `{"format": "1.8", "generator": "...", "of":
  "<hash>"}`: the format this sidecar was generated to, the tool that
  made it, the source's hash. `asset.generator` is `fastart`.
- **Nodes.** One node per part, in the document's order, so node i is
  part i; `name` is the part's name; a part with a `parent` is among
  its parent's `children`, and the scene's `nodes` are the parts with
  none. glTF is y-up: every position and direction in an accessor or a
  node's `translation` is the document's with y and z negated, `(x,
  −y, −z)`. A node's `translation` is its pivot less its parent's
  pivot, so a mesh's positions are **relative to its part's pivot**: a
  document-space rest point is `pivot + (x, −y, −z)`. A node's `extras`
  holds `pivot`, the part's pivot, and `anchors`, the part's anchors
  (through `like`) as `{name, at, dir?}`: these three in the
  document's own frame and the part's rest space, the file's numbers
  untouched.
- **Meshes.** One mesh per part that draws anything, named for the
  part; a part drawn `like` another has its source's mesh on its node.
  A mesh has one **primitive per shape and token**: for each shape in
  order, its triangles grouped by the token they paint, the groups in
  the order the shape's triangles first use them. A primitive's
  `extras` is `{"shape": i, "token": "name"}` and, on a textured
  shape, `"texture": "name"`: `shape` indexes the part's `shapes`,
  `token` is the palette token to resolve at run time, as it would be
  from `color`, `colors` and `paint`.
- **Accessors**, all 32-bit floats, unindexed, three vertices per
  triangle (`mode` 4), triangles in the order generation makes them:
  - `POSITION` (VEC3): pivot-relative, y-up, as above. Everything is
    done: a sweep generated, mods applied, `smooth` subdivided.
  - `NORMAL` (VEC3): unit, y-up. The face's normal for a flat shape;
    for one with smooth normals, the corner's, with `angle` and sharp
    creases already respected.
  - `_SHADE` (SCALAR): the shape's `shade` (1 when absent) times the
    point's entry of `shades` (1 when absent). The colour at a vertex
    is the resolved token's r, g, b times this.
  - `COLOR_0` (VEC4): that product for the palette the builder had, so
    the file shows in any glTF viewer. A reader that resolves tokens
    ignores it.
  - `TEXCOORD_0` (VEC2), on a textured shape only: pattern coordinates
    over the texture's `cell`, so 0…1 is one tile; multiply by the cell
    to have 1.5's pattern coordinates back. No image is embedded: a
    texture is a drawing, named in `extras.texture`.
- **Morphs.** A mesh whose part morphs has one morph target per pose
  that reshapes it; `mesh.extras.targetNames` names each by its source,
  a state's name or `clip#key` for an inline key, and every primitive's
  `targets` holds `POSITION` deltas in the primitive's own vertex
  order (zero for a shape the pose leaves alone). Since mods and
  subdivision keep their layout under a morph, a pose's surface is the
  base plus its target, and between two keys the weighted sum.
- **Animations.** One per clip, by name, sampled as `fart gltf` samples
  it (24 frames a second unless asked): `translation`, `rotation` and
  `scale` per node, targets reached by the solver, and `weights` for a
  part that morphs. A reader holding the `.fart` may play the clip
  from the document instead and take only the meshes from here.

`fart build <file or directory>…` writes the sidecar of every 3D
document it is given or finds, leaves one whose `of` already matches
(`--force` rebuilds; so does a sidecar some other generator made), and
with `--check` writes nothing and exits 1 when any is missing or stale;
`--clean` removes them. `fart gltf` is
unchanged: one primitive per shape with colours resolved, for engines
that want a model and not a cache.

## Skins (1.9)

A part is rigid: its shapes turn with it, whole. A `skin` lets a mesh
give at a joint instead. Each of its points follows several parts at
once, by weights, so a sleeve's top stays on the chest while its cuff
goes with the arm:

```json
{"kind": "mesh", "color": "cloth", "points": [...4 points...], "faces": [...],
 "skin": {"joints": ["upper_arm", "torso"],
          "weights": [[1, 1], [0, 0.5, 1, 0.5], [0, 1], [0, 1]]}}
```

- `joints` names parts of the document: the bones. Any part may be one,
  whatever its place in the tree, the shape's own part or not.
- `weights` has one entry per point, in the order of `points`. An entry
  is pairs, `[joint, weight, joint, weight, ...]`: an index into
  `joints` and how much of that part's motion the point takes. One to
  four pairs, each weight above 0, no joint twice. The weights of a
  point add up to 1; a reader divides by their sum, so rounding does no
  harm.
- A skinned point is placed by its joints, not by its own part:

      p' = Σ weight · W(joint) · p

  with `W` each joint's world map under the pose, exactly as a rigid
  shape of that part would use it. A document's rest is every part at
  identity, so there is nothing to bind: the points are where they are
  at rest, and a point wholly on one joint moves as a rigid shape of
  that part does. A normal takes the same sum of the maps' linear parts.
  This is linear blend skinning, and has its faults (a joint turned far
  thins): give the bend more points, or share it between more parts.
- A morph moves the points first, and the skin places what it leaves.
- A `like` part draws its source's skinned shapes through its own side
  of the body. For each joint: if the part is `like` that joint, the
  point follows the part itself; else if an ancestor of the part is
  `like` that joint, the nearest such (the twin: `upper_arm_l` for
  `upper_arm_r`, under `fore_arm_l`); else if a part below it is `like`
  that joint, that one (`fingers_l` for `fingers_r`, on `hand_l`).
  Otherwise the point follows the joint itself.
- **Sides.** A part drawn mirrored (a `mirror` on it or above it flips
  its world map) holds what is on the other side of x = 0. Wherever the
  shape's part and a joint differ in that (one's world map is flipped
  and the other's is not), the point is reflected across x = 0 before
  that joint's map is applied. So a mirrored sleeve holds to the
  unmirrored chest, and a point of the chest's left side may follow a
  mirrored `upper_arm_l` by naming it. So one sleeve serves both arms: each follows its own arm,
  and both hold to the one chest, either side of its middle.
- **A skin on a host.** Some documents are drawn on another: clothes
  on a body, in the body's own rest space. Their meshes should give
  where the body gives, and the bones are the body's, not theirs.
  `"host": true` on a skin says so: its `joints` name parts of the
  **host**, the document this one is drawn on, and are not looked for
  in this one.

  ```json
  "skin": {"host": true, "joints": ["upper_arm_r", "torso"], "weights": [...]}
  ```

  A runtime that draws such a document on a host places each point by
  the host's parts under the host's pose, and says which host part the
  shape is drawn on; that part stands where the shape's own part
  stands in the rule for `like` above, so one sleeve drawn on
  `upper_arm_l` follows the left arm. A joint the host lacks is at
  rest. Drawn with no host (in an editor, alone), a host skin is rigid:
  the shape is drawn with its own part.
- A skin is on a drawn `mesh` only, and for now on one with no `mods`
  and no `smooth` levels: a cage's weights are not yet carried through
  a modifier or subdivision. A collision shape has none.
- Error `skin`: a joint that names no part (unless the skin is on a
  host), an entry count that differs
  from `points`, an entry that is not one to four pairs, an index past
  the last joint, a joint twice in one entry, a weight that is not above
  0, weights that do not add up to 1 (within 0.01), or a skin beside
  `mods` or `smooth` levels.
- A reader that predates 1.9 ignores `skin` and draws the shape rigid,
  with its part.
- Projection (`PROJECT.md`) places a skinned mesh's points by the same
  sum before it flattens them.

## Relief (1.10)

A drawing is flat fills with hard edges, which is the wrong thing for a
fold, a dent or a worn corner. Two optional fields let a texture's maps
say those, still with no bitmap in the file:

```json
"textures": [
  {"name": "paper", "cell": [64, 64], "relief": 1.2, "maps": {
    "color":  {"ref": "textures/paper.fart", "mode": "mask", "soften": 0.9},
    "height": {"ref": "textures/folds.fart", "soften": 0.6},
    "rough":  {"ref": "textures/paper.fart", "palette": "palettes/rough.fart", "soften": 0.9}
  }}
]
```

- `soften` on a map is a blur: the map as drawn, convolved with a
  Gaussian whose standard deviation is `soften` **pattern units**,
  wrapping at the cell's edges so a tile stays a tile. Colour is blurred
  premultiplied by alpha. A hard-edged line in a height map becomes a
  ridge with a slope; a patch in a colour map becomes a stain. Absent or
  0, the map is as drawn. The reference is a separable kernel cut at
  three deviations; any filter that close conforms.
- `relief` on a texture gives its `height` map a size: the map's value 1
  stands `relief` pattern units proud of its value 0 (negative: sunk).
  A renderer that lights by it treats the surface, in each face's
  pattern frame (u right, v down, the face's normal out), as the height
  field `z = relief × height(u, v)` and lights with that field's normal,
  `(−relief ∂h/∂u, −relief ∂h/∂v, 1)` normalised, as if the pattern lay
  on the face at scale 1. It is light only: the silhouette, collision,
  `fart hull` and projection (`PROJECT.md`) see the face flat. Absent or
  0, or with no `height` map, there is no relief.
- Relief is the shape's, as its texture is: `paint` and `shades` (1.8)
  colour what it lights. Where a modifier turns a face's `uvs` round
  (a `mirror`'s copy, a `solidify`'s inner wall) the pattern frame turns
  with them, so a ridge stays a ridge seen from either side.
- **Maps the reference tools read**, all scalars as 1.5 defines them:
  `height` (above), `rough` (1 matte, 0 mirror), `metal` (1 metal),
  `ao` (1 open, 0 occluded). They stay the engine's to interpret; these
  are only the names `fart bake --textures` and `fart gltf` look for.
  The bake writes `<texture>.normal.png` when there is relief (tangent
  space, `n × 0.5 + 0.5`, red along +u, green **up the image**, the glTF
  convention) and `<texture>.orm.png` when any of the other three exist
  (occlusion in red, roughness in green, metallic in blue; an absent
  one is 1, 1 and 0). `fart gltf` puts both in the texture's material,
  with tangents on what wears it. The compiled sidecar (1.8) is as it
  was: it embeds no image, and a reader lighting by relief has the
  frame from a triangle's positions and `TEXCOORD_0`.
- **An atlas is a texture whose cell is the whole sheet**: explicit
  `uvs` that stay inside `[0, 0]`–`cell` never see it repeat. `fart
  unwrap` writes such uvs for the meshes that wear a texture: a cage's
  faces sorted by the axis their normal leans on (as box mapping sorts
  them), neighbours that agree laid flat as one island, seen from
  outside, and the islands packed into the cell. They are the cage's,
  and ride through mods and subdivision as any explicit uvs do.
- Errors: `soften` below 0 or not a number, `relief` not a number, are
  `schema`. A 1.9 reader draws a softened map hard and lights flat.

## Rails (1.11)

The fourth sweep carries a profile along a path as a pipe does, but
standing: a cliff's face with its brow, a kerb, a skirting board, a
gutter, the bank of a stream. Where a pipe's section turns with its
path, a rail's keeps one way up wherever the path goes.

```json
{"kind": "sweep", "color": "rock", "op": "rail", "axis": "y", "round": 1, "segments": 4,
 "path": {"points": [[-4,0,0], [0,0,0], [0,0,4]]},
 "profile": {"points": [[0,0], [0.3,0.2], [0.3,3]]}}
```

- `path` is a pipe's: a path body with three coordinates, flattened as
  a pipe's is, a point that sits on the one before it dropped. `closed`
  (on the shape) joins its last point to its first.
- `profile` is a path body in two coordinates, `[out, along]`: `along`
  runs along `axis` (`y` when absent: the format's down, so a profile
  is drawn as its cross-section looks), `out` to the path's side. It is
  open unless it says `"closed": true`.
- **Round.** When the path has no handles, each of its corners (every
  point of a closed path; every point but the ends of an open one) is
  rounded to the radius `round` (0 when absent: sharp). With unit
  directions a and b from the corner P to its neighbours and φ the
  angle between them, the corner is cut back by d = `round` / tan(φ/2),
  or by half the shorter of its two segments where that is less; the
  arc runs from P + d a to P + d b about the centre the two share, in
  the plane of the two segments, in ⌈(π − φ) / (π/2) × `segments`⌉
  equal steps (`segments` is 4 when absent). A corner that does not
  turn, or that doubles straight back, keeps its point. A path with
  handles is as round as it is drawn, and `round` does nothing to it.
- **The frame.** Each segment of the path so made has a way H: its
  direction with what lies along the axis A taken out, made unit. A
  segment that runs straight along the axis takes the H of the segment
  before it (the one after, at the start); a path with no H at all
  makes no mesh. A segment's side is O = A × H. At an end of an open
  path the ring stands on its one segment's O; at every other point on
  the mitre M, the two segments' O summed and made unit (the next
  segment's own O where they cancel), reaching 1 / max(M · O, 0.25)
  times as far, so a face keeps its distance from the path on both
  sides of the corner. A profile point (x, y) stands at
  `P + reach x M + y A`. The path may climb: the profile stays upright.
- **The mesh.** One ring of points per point of the path, in path
  order, each in profile order. Faces: for each ring and the next (and
  on a closed path the last and the first), for each edge k of the
  profile, the quad `[aₖ, aₖ₊₁, bₖ₊₁, bₖ]`. An open profile makes a
  sheet, and each face looks to the profile's left as it is drawn (out
  to the right, the axis downward): a stretch drawn going down faces
  out, one drawn going out faces up. A closed profile makes a moulding:
  it is taken in reverse when its signed area (Σ xₖ yₖ₊₁ − xₖ₊₁ yₖ) is
  negative, so it faces out, and on an open path with `caps` (true when
  absent) the first ring reversed and the last ring as it is close its
  ends.
- `normals`, `angle`, `smooth`, `creases`, `colors` and `paint` (over
  the generated faces, in the order above: a profile of two edges along
  a path of five segments has ten, edge by edge within each segment),
  `texture`, `mapping`, `mods` and `bake` apply as to the other sweeps.
  A rail has no `points`, does not morph, and never occurs in
  `collision`.
- Error `rail`: a closed rail with fewer than three path points. A
  closed profile with fewer than three points, or handles with the
  wrong count, are `curve`; a rail without a `path` or a `profile` is
  `schema`.
- A 1.10 validator refuses `op: "rail"` at the schema stage. A loader
  that does not know the op draws the shape's `bake` when it has one.

## Images (1.12)

A drawing is the format's own way to say a pattern, and the right one
for anything authored in it. A model brought in from elsewhere arrives
with its textures painted: bark, rust, a face, a baked normal map. Those
are pictures, and tracing them into drawings loses what they are. So a
map may name a picture instead of a drawing:

```json
"textures": [
  {"name": "stick", "cell": [512, 512], "maps": {
    "color":  {"image": "textures/stick.color.png"},
    "normal": {"image": "textures/stick.normal.png"},
    "mask":   {"image": "textures/stick.mask.png"}
  }}
]
```

- `image` is a relative path (as `ref` is) to a **PNG** file. A map has
  exactly one of `ref` and `image`; an image map has no `palette` and no
  `state`, which are a drawing's (`schema`). An absolute `image` is
  `path`. An image that cannot be read is the `unresolved` warning, as a
  ref is, and the shape is drawn as if the map were absent.
- **The picture is the cell.** Its pixels stretch over the tile, from
  `[0, 0]` to `cell`, whatever their count: pixel column i of an image W
  wide covers pattern x from `i × w / W` to `(i + 1) × w / W`, row j
  likewise along y, with row 0 at y = 0 (the top of the picture, as
  pattern v runs down). It repeats with the cell's period as a drawing
  does. The reference samples the pixel a point falls in; a renderer
  may filter (bilinear, mipmaps) and conforms. A cell the size of the
  picture in pixels makes pattern coordinates pixel coordinates.
- Its pixels are read as 8-bit sRGB with alpha, whatever the PNG's own
  colour type and depth (grey widens to RGB, a palette is looked up,
  16 bits keep their high byte, no alpha is opaque). From there the map
  is read exactly as a drawing's: `mode` `paint` lays the picture over
  the shape's token by its alpha, `mask` multiplies the token by its
  value, a scalar is luminance times alpha, and `soften` blurs it.
- **The map named `normal`** is read by the reference tools as a
  tangent-space normal map in the convention `fart bake` writes (1.10):
  `n × 0.5 + 0.5`, red along +u, green **up the image**, blue out, in
  each face's pattern frame. A renderer lights by it; a texture with
  both a `normal` map and a relief lights by the `normal` map, and the
  bake writes `<texture>.normal.png` from it. Any map may be a picture
  or a drawing, `normal` included.
- A palette swap does not reach into a picture: a `paint` picture
  covers the token where it is opaque, so a recolourable model wears its
  colour map as `mask` over a light token, or keeps its pictures for
  the maps that are not colour.
- A 1.11 reader refuses an image map at the schema stage (a map without
  `ref`). A lenient loader draws the shape's token flat.

## Color at runtime

Tokens are the recolor surface: a file's palette is its set of colour
slots, and a palette file is a map from slot names to colours. Engines
may lay a palette over a document at load time (a *swap*: same names take
the new colour, new names join, so one slime file is the red one and the
blue one), or tint resolved colors (damage flashes, lighting) — both
outside the format. The reference loaders offer the swap as
`applyPalette` / `apply_palette`. The format promises only: shapes name
tokens, palettes resolve them, resolution order is specified above.

## Collision (optional)

A doc may carry a `collision` array of shapes -- the document's kinds,
no `color` required. They are never drawn; an engine that cares reads
them and treats them as solid however it likes.

```json
"collision": [
  {"kind": "line", "a": [-3, 0], "b": [3, 0], "w": 12},
  {"kind": "box", "at": [0, 4, 0], "size": [8, 2, 8], "layer": "surface"},
  {"kind": "mesh", "part": "flap", "points": [...], "faces": [...]}
]
```

- A **line with width is a capsule** (the natural furniture shape); a
  **circle** is a circle; a **poly** is a convex region. In a 3D document
  a `rod` is a capsule, a `ball` a sphere, a `mesh` a **convex** solid,
  and a `box` (collision only, 1.4) is `at` its centre with `size` the
  full extents and an optional `rotate` (`[x, y, z]`, applied as a
  pose's turn). A validator checks a collision `mesh` is convex: every
  point on or behind the plane of every face (error `convex`, naming
  the face). A concave solid is authored as several convex pieces, or
  as a `box` and a few balls; `fart hull` derives a convex hull from a
  part's visible shapes. A `box` inside a part's `shapes` is refused
  (`schema`): it is not a drawn kind.
- **Posed collision (1.4)**: a collision shape may name a `part`. It is
  then authored in that part's rest space, like the part's own shapes,
  and rides the part's world transform under any state or clip:
  `W(part) = W(parent) · L(part)`, mirror, scale and parents included;
  a ball's radius and a rod's width scale with the part. A shape
  without `part` is document space, at rest, whatever the pose. A part
  drawn `like` another carries the collision shapes that name its
  source, in its own place. A `part` that names no part is `ref.part`.
  This holds in 2D documents too. The reference loaders turn the whole
  list into document-space colliders for a pose list (`collisionWorld`,
  `collision_world_3d`), boxes expanded to eight-point, six-face meshes
  so a consumer sees only balls, rods and meshes (circles, lines and
  polys in 2D).
- **Layers (1.4)**: a collision shape may carry a `layer`, a non-empty
  string an engine reads and the format does not interpret; absent
  means `"solid"`. A game's own words: `solid`, `surface`, `player`,
  `trigger`.
- A generated hull carries `"meta": {"hull": true}` so a tool can
  replace it; `meta` on a collision shape is otherwise yours.
- Loaders that predate this field ignore it, and loaders that predate
  1.4 read every collision shape as document space and at rest; the
  version stays 1.

## Validation

`fart.schema.json` (JSON Schema, draft 2020-12) checks structure. It
cannot see across a document, so a validator adds the rest: every `color`
resolves to a token (locally or through `palette_refs`), every state
entry names a real part, `tris` index the points, names are unique, refs
are relative. `packages/core` implements both halves and a command line:

    fart validate path/to/art      # every .fart below, refs resolved

`examples/manifest.json` is the conformance corpus: files that must load,
files that must be refused, and the **error code** each refusal carries.
The codes are part of the contract so that a "why won't this load" reads
the same from any tool:

| code        | meaning                                                          |
|-------------|------------------------------------------------------------------|
| `json`      | not JSON                                                         |
| `version`   | version missing, not an integer, or newer than 1                 |
| `schema`    | structure the schema rejects (a missing field, a reserved kind)  |
| `ref.token` | a shape names a token nothing supplies                           |
| `ref.part`  | a state names a part the document does not have                  |
| `tris`      | tris are not triples, or an index is out of range                |
| `dup.part` `dup.state` `dup.token` `dup.clip` `dup.constraint` | siblings sharing a name |
| `path`      | an absolute `palette_ref`                                        |
| `ref.parent` | a part names a parent the document does not have               |
| `cycle`     | parents that loop                                                |
| `clip`      | keys empty, out of order, or a key with neither/both of `state` and `parts` |
| `ref.state` | a clip key names a state the document does not have              |
| `chain`     | a constraint's chain is empty, or its parts are not parented in order |
| `ref.anchor` | a constraint's `end` is not `part/anchor` on the chain's last part |
| `like`      | a part is like itself, like a part that is itself like another, or carries its own shapes or anchors |
| `ref.chain` | a target names a constraint the document does not have           |
| `space`     | a space the reader does not know (1.3)                          |
| `convex`    | a collision mesh is not convex: a point lies in front of the named face (1.4) |
| `ref.texture` | a shape names a texture the document does not have (1.5)       |
| `dup.texture` | two textures share a name (1.5)                                |
| `face`      | a mesh face with fewer than three indices, or an index past the last point (1.3) |
| `morph`     | a morph on a `like` part, naming a shape the part lacks or one without points, or with a point count that differs from the base (1.6) |
| `curve`     | a path's `in`/`out` with a count that differs from its points, an open path without `w`, a closed one with fewer than three points (1.7) |
| `crease`    | a crease outside 0–1, on a point the mesh lacks, or on a pair that is not an edge (1.7) |
| `paint`     | `paint` with a count that differs from the faces, an index past the last of `colors`, or `paint` without `colors` (1.8) |
| `shades`    | `shades` with a count that differs from the points, or on a sweep (1.8) |
| `mod`       | a modifier whose `op` this version does not have (1.8)          |
| `pipe`      | a pipe's `radii` with a count that differs from its path's points, or a closed pipe with fewer than three path points (1.8) |
| `rail`      | a closed rail with fewer than three path points (1.11) |
| `skin`      | a skin naming a joint the document lacks, with an entry count that differs from the points, a malformed entry, weights that do not add up to 1, or beside `mods` or `smooth` levels (1.9) |

Warnings (`unknown`, `reserved`, `unresolved`) never fail a file. A loader
inside a game may be as lenient as it likes past `json` and `version`;
the corpus only requires it to load every valid file and refuse those two.

## Versioning

`version` is the format's **major**, and the only number a file carries.

- Within a major, changes are additive: new optional fields, new
  top-level sections. Older readers ignore what they don't know (and skip
  shapes whose `kind` they don't know), older editors preserve it. A file
  written by a newer tool still loads in an older one, minus the news.
- Meaning never changes within a major. A field that must mean something
  different, or a required field, is a new major -- and readers refuse
  majors they don't know, loudly, rather than drawing them wrong.
- The schema and the corpus are versioned with the format: this file,
  `fart.schema.json` and `examples/` describe version 1 and are tagged
  `format-v1.x.y` together. A patch bump clarifies wording; a minor bump
  adds a field.
- 1.1 added `parent` on parts, `clips`, and `constraints`. Files that use
  none of them are byte-for-byte 1.0 files.
- 1.2 added `like` on parts, `mirror` on state entries, `angle` on
  anchors, `targets` on states and keys, `events` and `curve` on keys,
  `emissive` on tokens, and defined blending, layering and attaching for
  runtimes. Every one is optional; a 1.1 reader draws a `like` part empty
  and eases by name, and is otherwise right.
- 1.3 added `shade` on shapes, and `space: "3d"`: 3D documents with
  `mesh`, `ball` and `rod` shapes, three-coordinate points, `[x, y, z]`
  turns, `dir` on anchors and `pole` on chains, plus `PROJECT.md`, the
  rules that turn a 3D document into 2D ones. A 2D file without `shade`
  is a 1.2 file; a 1.2 reader draws `shade` flat and refuses a 3D file
  at the schema stage.
- 1.4 added collision that poses (`part` on a collision shape), the
  collision-only `box` kind, `layer` on collision shapes, and the rule
  that a collision `mesh` is convex (error `convex`). A file that uses
  none of them is a 1.3 file; a 1.3 reader reads posed collision at
  rest and refuses a `box` at the schema stage.
- 1.5 added `textures` (maps that are drawings, tiled over a cell) and
  `texture` + `mapping` on shapes. A file without them is a 1.4 file; a
  1.4 reader draws textured shapes flat.
- 1.6 added `morph` on state entries and clip keys: a shape's points as
  they are in that pose, lerped between keys (error `morph`). A file
  without it is a 1.5 file; a 1.5 reader draws the base shape in every
  state.
- 1.7 added the `path` kind with its `bake`, `in`/`out` on morphs,
  `normals`, `angle`, `smooth`, `creases` and `bake` on meshes, and the
  `sweep` kind (errors `curve`, `crease`). A file without them is a 1.6
  file; a 1.6 reader skips paths and sweeps (unknown kinds) and draws a
  smooth mesh's cage flat.
- 1.8 added `colors` and `paint` on meshes and sweeps, `shades` on
  meshes, `mods` (`mirror`, `solidify`, `crease`) on both, `paint` and
  `shades` in a mesh bake with `of` covering the mods, the sweep op
  `pipe` with `path`, `radius`, `radii`, `caps` and `closed`, and the
  compiled sidecar `name.fart.glb` (errors `paint`, `shades`, `mod`,
  `pipe`). A file without them is a 1.7 file; a 1.7 reader draws a
  painted shape in its one colour and a shape with mods as its cage,
  ignores `shades`, and refuses a pipe at the schema stage (a lenient
  loader draws nothing for it, or its bake).
- 1.9 added `skin` on meshes: joints and per-point weights, a mesh that
  gives at its joints (error `skin`). A file without it is a 1.8 file; a
  1.8 reader draws a skinned shape rigid, with its part.
- 1.10 added `soften` on a texture's maps and `relief` on a texture: a
  map blurred, and a height map lit as a surface. A file without them
  is a 1.9 file; a 1.9 reader draws the maps hard and the faces flat.
- 1.11 added the sweep op `rail` with `round` (error `rail`): a profile
  carried upright along a path, its corners mitred and rounded. A file
  without it is a 1.10 file; a 1.10 reader refuses a rail at the schema
  stage (a lenient loader draws nothing for it, or its bake).
- 1.12 added `image` on a texture's maps: a map that is a PNG, stretched
  over the cell, and the map name `normal` the reference tools light by.
  A file without them is a 1.11 file; a 1.11 reader refuses an image map
  at the schema stage (a lenient loader draws the shape flat).

## Reserved for later

Names the format has plans for. Version-1 files may not use them for
anything else; validators warn when they appear.

- `children` on a part: nesting, should `parent` ever prove the wrong way
  round.
- (`space` stopped being reserved in 1.3.)
- Shape kind `ring`. (`path` stopped being reserved in 1.7.)
