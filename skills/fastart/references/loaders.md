# Loading in a game

Read this when a game (Odin or TypeScript) loads the files: the loader API, posing, clips, blending, collision, textures, the sidecar.

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
