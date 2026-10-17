# Textures

Read this when a shape needs a pattern: textures are drawings tiled over a cell (1.5), or pictures (1.12).

## Textures

A texture is a set of **maps** and every map is a 2D `.fart` tiled over
a `cell`, in 2D and 3D alike; or (1.12) a PNG, for art painted
elsewhere (see **Images** below). Author new patterns as drawings.

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
  authored) or `{"uvs": [[[u, v], ...] per face]}` per corner, in
  pattern units (0 to `cell` is one tile; v runs down). Explicit uvs
  come from `fart unwrap` (1.10) or `fart import` (a glTF's own) and
  ride through mods and `smooth`. Balls and rods box-map as the meshes
  they flatten to. A palette swap still
  recolours the slot underneath.
- Draw the map in the 2D editor (its cell is `[0, 0]` to `[w, h]` of the
  drawing's space; shapes crossing the edge wrap). `npx fart bake
  --textures out/ --px 64 model.fart` writes each map as a PNG for a
  build; `fart gltf` embeds the colour map; the projector carries a
  face's mapping into the 2D file as an `xf`. Loaders give pattern
  coordinates per vertex (`triMesh(...).uvs`, `Tri_Mesh.uvs`; divide by
  the cell for 0..1) and `resolve_textures_3d` reads the maps' drawings;
  the raylib example rasterises one with `draw_2d` (an image map it
  uploads as it is). Sample textures: `examples/cabin/textures`,
  `examples/space/textures`; `spec/examples/valid/imaged.fart` wears
  pictures.

## Relief, soften, sheets (1.10)

- `soften` on a map blurs it, in pattern units, wrapping at the cell: a
  hard line in a height map becomes a ridge with a slope, a patch in a
  colour map a stain.
- `relief` on a texture gives its `height` map a size (value 1 stands
  `relief` pattern units proud of 0) and renderers light by it. Draw the
  height map on mid grey with lighter ridges and darker valleys,
  `soften` about half a line's width.
- `rough` (1 matte), `metal`, `ao` (1 open) are the other maps the tools
  read. `fart bake --textures` writes `<texture>.normal.png` (from the
  relief, or the `normal` map) and `<texture>.orm.png`; `fart gltf` puts
  them in the material.
- One sheet over a mesh: make the texture's `cell` the sheet and run
  `fart unwrap file` (or `unwrapDoc`): each side an island, packed into
  the cell. With `paint` under it, make the colour map `"mode": "mask"`
  so each token keeps its colour. `references/curves-and-3d.md` has
  the modelling side.

## Images (1.12)

A map may name a PNG instead of a drawing: `{"image": "textures/stick.color.png"}`
(relative, never with `ref`, `palette` or `state`; `mode` and `soften`
still apply). The picture stretches over the cell whatever its pixel
count, row 0 at the top (pattern v runs down, as glTF's does); a cell
the picture's size in pixels makes pattern coordinates pixels. A map
named `normal` is a tangent-space normal map (red +u, green up the
image), lit by and baked as given; it wins over a relief.

```json
"textures": [{"name": "stick", "cell": [512, 512], "maps": {
  "color":  {"image": "textures/stick.color.png"},
  "normal": {"image": "textures/stick.normal.png"},
  "mask":   {"image": "textures/stick.mask.png"}}}]
```

- `npx fart import model.glb --map color=albedo.png --map normal=n.png
  --map mask=m.png` writes the pictures to `textures/` beside the
  document and the meshes' glTF uvs as `mapping.uvs` (`--textures dir`
  moves them; `--no-textures` leaves them out). Without `--map` the
  glTF's own PNGs come in, a texture per material: colour, normal,
  metal-roughness split into `rough` and `metal`, occlusion as `ao`,
  emission as `glow`. A JPEG is named in a warning: convert it to PNG
  and pass it with `--map`.
- A palette swap cannot reach into a picture: for a recolourable model
  use `"mode": "mask"` over a light token.
- Core reads PNGs itself (`fromPng`, `resolveTextures(..., readBytes)`);
  `fart bake --textures` and `fart gltf` keep a picture's own size
  unless `--px` says otherwise. The Odin loader puts the pixels on
  `Map_Doc.pixels` (8-bit RGBA, `width` × `height`).
