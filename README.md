# fastart -- the Fast Art Format

## A note on pronunciation

This is a serious project for serious people. To forestall any
confusion:

- A `.fart` file is pronounced **dot-f-art** file. It holds Fast Art.
- A `.shart` file is a **Scene Hierarchy of Art**, pronounced
  **dot-s-h-art**. It composes `.fart` files into a scene.

Any resemblance to a potentially humorous word is unintentional. We ask
that readers, contributors and users maintain a level of maturity and
dignity sufficient to their station.

## Abstract

fastart is a specification, accompanied by reference implementations,
for the description of two- and three-dimensional vector art intended
for consumption by interactive software. A document of the Fast Art
Format enumerates shapes; the colour slots those shapes reference; the
parts into which shapes are grouped; and the states, clips, constraints
and textures by which those parts are posed, animated and surfaced. A
document of the Scene Hierarchy of Art composes such documents into a
scene. Both are expressed in JSON, and are designed to be authored by
hand or by program, inspected without tooling, and interpreted by any
runtime capable of parsing JSON.

The specification is the authority. Every tool in this repository
conforms to it, and none extends it.

    spec/            the format: FORMAT.md, fart.schema.json, the conformance corpus; SHART.md and shart.schema.json for scenes
    packages/core    @fastart/core: the format as a TypeScript library + `fart` CLI
    loaders/odin     the reference Odin loader (and its corpus test)
    studio/          Uranus, the reference editor for the Fast Art Format, as a desktop application (Wails 3 + web)
    examples/space   a sample project: ships, a station, rocks, palettes to swap; hull plating and craters as textures (1.5)
    examples/pistol  a flintlock modelled once in 3D, projected to its side, top and front (1.3); a wood-grain texture on the stock
    examples/lantern a lantern built with core's box, extrude and lathe helpers, and its projections; a hammered texture on the dish
    examples/cabin   textures end to end: planks and cobbles as drawings, height maps under a palette, a textured hut and crate; camp.shart, a 3D scene
    examples/space/scenes/patrol.shart   the space set placed as a 2D scene
    examples/models  models made in Uranus by hand: a dog, a flintlock with a pan flash
    skills/fastart   how an agent writes and loads .fart files (make skill installs it)

## The format

Read `spec/FORMAT.md`. Structure is checked by `spec/fart.schema.json`;
everything a schema cannot see (tokens resolve, states name real parts,
tris index the points) is checked by the validator in `packages/core`:

    npm install
    npx fart validate path/to/art          # every .fart below, refs resolved
    npx fart bake enemies/bat.fart         # write tris into each poly (or mesh)
    npx fart project pistol.fart --view left --view top   # 2D views of a 3D file (1.3)
    npx fart gltf pistol.fart                             # the model as a .glb, animations included
    npx fart hull hut.fart --part table                   # a convex hull into collision, riding the part (1.4)
    npx fart bake --textures out/ --px 64 crate.fart      # every texture map as a PNG (1.5); maps are drawings, tiled, or PNGs (1.12)
    npx fart import stick.glb --map color=albedo.png --map normal=normal.png   # a glTF as a .fart, its textures as image maps (1.12)
    npx fart unwrap bag.fart                              # uvs for textured meshes: islands packed into the texture's cell (1.10)
    npx fart validate camp.shart                          # a scene, checked with its files in hand
    npx fart flatten camp.shart --t 0.5                   # a scene's instances, placed: what a renderer draws
    npx fart build art/                                   # the compiled sidecar name.fart.glb of every 3D file (1.8)

`spec/examples/manifest.json` is the conformance corpus: files that must
load, files that must be refused, and the error code each refusal
carries. Every loader runs it (`npm test`, `odin test loaders/odin/test`).

The format is versioned separately from the tools: `format-vX.Y.Z` tags
release the spec, schema and corpus; `version` inside a file is the
major, and readers refuse majors they don't know.

Since 1.3 a file may be a 3D model (`"space": "3d"`: mesh, ball and rod
shapes, `[x, y, z]` turns), and `spec/PROJECT.md` fixes how such a model
becomes the 2D files a game draws: a view, a light, faces to shaded
polys, and every pose either an exact 2D pose (a turn about the view
axis) or a baked variant part, clips included. Model the pistol once,
export the side view as a rig and the top view as a flipbook. Uranus
opens a 3D file in its model screen: orbit it, draw boxes, balls, rods
and prisms in any view, pose it, and Project… the 2D files. A 3D game
loads the model itself: `loaders/odin/examples/raylib_spin` is the whole
loop in Odin and raylib (flatten each part to triangles once, draw them
through `Y_UP * world_xf_3d` every frame, chains solved live), and `fart
gltf` writes a `.glb` for any other engine.

Since 1.8 a mesh may be painted face by face (`colors`, `paint`),
shaded point by point (`shades`), and built from a cage by modifiers
(`mods`: `mirror`, `solidify`, `crease`); a `pipe` sweep carries a
section along a path. `examples/helm` is all of it in one file.

A 3D file full of cages and modifiers is quick to write and slow to turn
into triangles, so a build may compile it: `fart build art/` writes
`name.fart.glb` beside each 3D `name.fart`, a binary glTF with everything
generated and each triangle's token kept by name. The sidecar is a build
artifact, never the source: a loader uses it only while its hash matches
the `.fart`, and nothing edits it. Keep it out of version control and
make it in the build:

    # .gitignore
    *.fart.glb

    # Makefile
    art:
    	npx fart build art/
    check-art:
    	npx fart build --check art/     # CI: fails when a sidecar is missing or stale

`fart build --clean art/` removes them. `spec/FORMAT.md` ("The compiled
sidecar") has the layout.

## Scenes

A `.shart` (Scene Hierarchy of Art) is a tree of placed instances of
`.fart` files and other scenes: each with a pose, a state or a moment
of a clip, a palette laid over, children riding it or hanging from one
of its sockets. A shart draws nothing of its own, so one cabin file is
every cabin in the scene. `spec/SHART.md` is the contract; the loaders
flatten a scene into the list a renderer draws (`flattenScene`,
`flatten_scene`) and gather its solids (`sceneCollision`).

## The studio

`make install` builds the app into `~/Applications/Uranus.app` and
replaces it there on every run, so pin that one to the Dock. A released
build updates itself: it checks GitHub for a newer `studio-v*` release
and offers it top right (Help › Check for Updates… asks at once). ⌘J in the
app asks your own Claude Code to change the open file: it reads, edits
(one undo step), renders and validates through the editor itself.

`studio/` is the editor as a real application: a folder is a project,
recent projects on a welcome screen, drag-and-drop, double-click a
`.fart` in the Finder, docs inside the app, and a **Serve** button that
puts the same editor on your network for a tablet (one finger draws, two
pan and pinch). The interface is the web (Preact + a canvas) in a thin Go
shell (Wails 3); the same frontend runs from the shell's LAN server.

    make setup                    # once: npm deps + the Wails CLI
    make dev                      # live-reload development
    make run                      # build studio/bin/Uranus.app and open it
    make serve DIR=path/to/art    # headless: just the LAN server
    make                          # the rest

It needs Go, Node, and the Wails CLI (`go install
github.com/wailsapp/wails/v3/cmd/wails3@latest`). Releases are cut by
tagging `studio-vX.Y.Z`; see `.github/workflows/release.yml`.

How to use it is in the app (Docs) and in `studio/frontend/src/docs/guide.md`.

The original Odin + raylib editor lives on at the `classic-v0.1.0` tag,
for the curious.

## Using .fart in a game

The reference loaders show the shape of it: `loaders/odin/fastart.odin`
(types, palette resolution, ear clipping, ~200 lines) and
`packages/core` for anything that speaks JavaScript. Rendering is fifty
lines in whatever you draw with: for each part in `drawList`, for each
shape, `colorOf(tokens, shape.color)` and `posePoint(p, part, statePart)`.
