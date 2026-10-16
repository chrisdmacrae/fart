# Textures

Read this when a shape needs a pattern: textures are drawings tiled over a cell (1.5).

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
