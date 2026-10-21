# fastart

JSON vector art for games (`.fart`). The format is
the contract: `spec/FORMAT.md` + `spec/fart.schema.json` + the corpus in
`spec/examples` change together and are tagged `format-vX.Y.Z`. Tools
follow the spec, never the other way round.

- `packages/core`: `@fastart/core`, TypeScript, zero deps, Node type
  stripping (no parameter properties). Tests: `npm test -w @fastart/core`.
- `loaders/odin`: the reference loader; `odin test loaders/odin/test`.
  Build the raylib example with `odin build loaders/odin/examples/raylib_spin
  -out:/tmp/spin "-extra-linker-flags:-isysroot $(xcrun --show-sdk-path)"`.
  A copy lives in the user's game (qftebl2/fastart): copy it over after
  changing the loader and build the game.
- `studio/`: Uranus, the app ("the reference editor for the Fast Art Format"): Wails 3 (Go shell, thin: dialogs, rooted file IO, recents,
  serve) + Preact frontend. `studio/DESIGN.md` governs the UI language;
  `frontend/src/state/actions.ts` is the one command registry. Every
  canvas view is a state (there is no separate draw mode); a clip poses
  the key under the playhead (`editPose` in `state/editor.ts` and
  `state/model.ts`: a key naming a state takes its own copy, a change
  between keys makes one; `make check-keys`); a palette file opens as
  swatches.
- Verify studio changes headlessly: build (`npx tsc && npx vite build`
  in `studio/frontend`, `go build -o bin/studio .` in `studio`), run
  `./studio/bin/studio --serve <dir>`, drive it with Playwright, read
  `globalThis.fastart` (store, view, sidebar, `frameW()`) to assert.
  `make check-ui` (`studio/test/workspace.mjs`) is the standing tour of
  the workspace; run it after touching the frame. The Chrome extension
  is unreliable here.
- The studio's look is a design system: `frontend/src/tokens.css` (every
  colour, Light and Dark, type, space), `ur.css` + `ui/ur.tsx` (the `Ur`
  components: PaneHeader, PathBar, StatusBar, SidebarRow, InspectorSection,
  Property, NumberField, Sheet, …). Tokens only: no hex, size or font
  stack outside them. `app.css` is the frame's layout, `styles/*.css` each
  screen's own, `theme.css` the older widgets (its names alias tokens).
  Icons: add a Lucide name to `scripts/icons.mjs`, run it.
- The studio's frame: the launcher (`screens/Welcome.tsx`, a small fixed
  window) then the workspace (`screens/Workspace.tsx`), three columns
  each with its own header: the navigator (`ui/Sidebar.tsx`,
  `state/sidebar.ts`: assets, outline, search, source control), the
  content (`ui/ProjectBar.tsx`: the header with project picker and
  activity view, the path bar with history `state/nav.ts`; the asset
  browser `ui/Shelf.tsx`; the status bar), the inspector
  (`ui/InspectorPane.tsx`: selection, view, history, Ask). Nothing floats
  over the canvas. Each asset screen (`Editor.tsx`, `Model.tsx`,
  `Scene.tsx`) only exports its parts (outline, tools, canvas, status,
  inspector, view). Sheets: `state/prompt.ts` + `ui/Sheets.tsx`. Menus:
  `state/menu.ts` (a right click is the platform's menu, via
  `native.go`'s `PopupMenu`; file and folder choices are the platform's
  dialogs). The window is frameless on macOS with inline traffic lights
  (`main.go`; `inlineLights()` in `state/project.ts` leaves them room,
  not in full screen). Git and window sizing live in `workspace.go`.
  Regenerate bindings after changing the Go service: `cd studio && wails3
  generate bindings -ts -i -clean=true`. `node studio/test/look.mjs <dir>`
  shoots the workspace in both appearances.
- The file on disk is the document: edits land in it at once (atomic
  write), ⌘S makes the checkpoint (`name.fart~`), nothing reverts on its
  own. `make check-save` proves it end to end in a headless browser; run
  it after touching editor.ts's disk code.
- `make` lists the shortcuts; `make test` runs everything.
- Self-update: `studio/update.go` (version from the embedded
  `build/config.yml`, GitHub `studio-v*` releases, platform asset by
  suffix, swap in place, relaunch); `state/update.ts` + `ui/UpdateBadge.tsx`
  in the frontend. `FASTART_VERSION=0.1.0` makes a build believe it is
  old; `FASTART_LIVE=1 go test -run TestUpdateLive ./studio` talks to
  GitHub for real.
- Writing `.fart` files: follow `skills/fastart/SKILL.md` (a short core;
  `references/*.md` for 3D, textures, scenes, loaders). The agent path
  (`spec/TOOLING.md`): `fart outline` / `get_document` first, edits by
  `apply_patch` (name-addressed, `core/patch.ts`) or the verbs in
  `core/verbs.ts` (`pose`, `morph`, `setClip`, `make`), generators with
  `@fastart/make` (`packages/make`) kept in `assets/gen/` and rerun by
  Uranus (meta.gen → Regenerate), `stringifyDoc` writes inline number
  arrays (`fart fmt` reformats), `fart tokens` measures.
- Seeing motion without a window: `fart render` (core's `motion.ts`
  samples a clip with targets reached; `render.ts` is a software
  rasteriser: a strip in one world box, ghosts, trails, the axis gizmo;
  `--frames-dir`, `--mp4` through ffmpeg) and `fart check-clip`
  (`clipcheck.ts`: bone lengths, short-way turns, snaps, knee flips,
  loop seams, feet sliding and travel direction); both in
  `motionCmd.ts`, tested by `test/motion.test.ts`.
- Art direction (`spec/DIRECTION.md`): `style.gas` at a project's
  root (`core/direction.ts`: merge, `extends`, `classes`, the fixed
  checks, `lintDirection`); `fart lint`, `fart new --class`, the
  `get_direction` tool, the Direction panel in the project inspector.
  The extension is one constant (`DIRECTION_EXT`) in case the name changes.
- Scenes: `.shart` (Scene Hierarchy of Art), `spec/SHART.md` +
  `spec/shart.schema.json`, shart cases in the corpus manifest carry
  `"shart": true`. Core: `scene.ts` (validateScene, loadScene,
  flattenScene, sceneCollision); Odin: `shart.odin` (load_scene,
  flatten_scene with a Scene_Cache). `fart validate` takes scenes, `fart
  flatten` lists their instances.
- 3D (format 1.3): `spec/PROJECT.md` is the projection contract; core's
  `space3.ts` + `project.ts` implement it, `fart project` drives it,
  `examples/pistol/generate.mjs` is the proof. In the studio a 3D file
  opens the model screen (`state/model.ts` store, `canvas/model3.ts`
  render+interact, `screens/Model.tsx`): the solids are drawn by WebGL
  with a depth buffer (`canvas/gl3.ts`, under a 2D overlay; the painter's
  `projectFrame` is the fallback and does picking), the four tools
  extrude solids in the view plane, Project… writes the 2D views.
  Solid helpers live in core's `solids.ts` (use them in generators), 3D
  chains in `ik3.ts`, glTF export in `gltf.ts` (`fart gltf`), collision
  (1.4: posed by `part`, `box`, `layer`, convexity, hulls) in
  `collision.ts` (`fart hull`), textures (1.5: maps that are drawings,
  box mapping, a software rasteriser, `fart bake --textures`) in
  `textures.ts` + `png.ts`, morphs (1.6: `morph` on state entries,
  lerped in `clips.ts`/`space3.ts`, `shapesOfPosed`/`shapesOf3Posed`,
  glTF targets; the model screen's Deform toggle), curves and smooth
  surfaces (1.7: `path` with relative handles + `bake` in `curves.ts`,
  `normals`/`smooth`/`creases` + Catmull-Clark in `subdiv.ts`, `sweep`
  in `solids.ts`; `asMesh` is the surface a renderer draws, `cageOf`
  the file's cage; the pen tool and 2D Deform in the editor; the Odin
  loader's `curves.odin` subdivides and flattens itself); the studio renders maps in
  `state/textures.ts` for the 2D painter's patterns and WebGL; the Odin
  loader's `flatten_part` + `Y_UP` and `loaders/odin/examples/raylib_spin`
  are the 3D game path.
- 1.8, 1.9, 1.11 in core: `paint`/`colors`, `shades`, `mods`
  (`applyMods`, `builtOf`) and the `pipe` and `rail` (1.11) sweeps in
  `solids.ts`; skins (1.9) in `space3.ts` (`shapesOf3Skinned`,
  `shapesOf3Worn` for a host's), carried by `gltf.ts` and kept by the
  import; the Odin loader reads `skin` but draws it rigid. The compiled
  sidecar (`name.fart.glb`): `gltf.ts` (`buildSidecar`, `sidecarFresh`),
  `fart build`, `loaders/odin/sidecar.odin`, the studio's
  `state/sidecar.ts`. glTF import: core's `gltfImport.ts` +
  `importCmd.ts` (`fart import`), the studio's `state/importGltf.ts`
  (File › Import glTF…, which leaves textures to the CLI).
- Relief (1.10): `soften` on a texture's map and `relief` on a texture.
  Core: `textures.ts` (`mapValues`, `normalRaster`, `ormRaster`,
  `bakeTexture`; `fart bake --textures` writes `.normal.png` and
  `.orm.png`), `unwrap.ts` (`unwrapDoc`, `fart unwrap`: a cage's faces
  as islands packed into the texture's cell), `gltf.ts` (normal and
  metallic-roughness textures, tangents; `fart gltf --px`). Studio:
  `state/textures.ts` renders the normal map, `canvas/gl3.ts` lights by
  it per pixel (the pattern's axes ride in each vertex), the textures
  panel has Relief and Soften, the model inspector Unwrap and Box map.
- Images (1.12): a texture map may be `image` (a PNG, stretched over the
  cell) instead of `ref`; a map named `normal` is a tangent-space normal
  map. Core reads PNGs itself (`png.ts`: `fromPng` with its own inflate;
  `textures.ts` samples a picture where it rasterises a drawing);
  `fart import --map name=file.png` (or a glTF's own PNGs) writes them
  beside the document with the uvs as `mapping.uvs` (`gltfImport.ts`
  `textures` option, `gltfImages`); the studio reads them through
  `shell.readImage`; the Odin loader's `load_map_image` (`Map_Doc.pixels`).
- Mesh editing in the model screen: `frontend/src/state/meshops.ts` is
  the geometry (pure, no imports: extrude, inset, loop cut, rims, merge,
  flip, wind outward, creases; every result says where each point and
  face came from, so creases, uvs and morphs are carried), tested by
  `npm test -w @fastart/studio`. `state/model.ts` lays a result into the
  document as one undo step (`runMeshOp`, and `startOp`/`adjustOp` for
  an operation whose numbers stay open); `canvas/meshtool3.ts` is E I K
  following the pointer; `state/tools.ts` + `mcp.go` offer the same to
  Claude as `mesh_*` tools. `state/workspace.ts` holds what is the
  studio's and never the file's (symmetry, reference images, the
  mannequin, clay shading), in localStorage per document. `make
  check-mesh` (`studio/test/mesh.mjs`) drives all of it headlessly.
