# How the studio speaks

The conventions the studio follows, so that everything added later lands
where a user of any other art tool expects it. Distilled from Figma and
Penpot (vector editing), Rive and Spine (2D rigging and animation),
Aseprite and Godot (game art), and the keyboard habits they share.

## The look

The design system is the contract for look and layout: `frontend/src/tokens.css`
holds every colour (Light and Dark), type style, space, radius and shadow;
`frontend/src/ur.css` and `ui/ur.tsx` are the components built from them
(`Ur` in the system's own words). Nothing picks a hex, a size or a font
stack of its own. Chrome is neutral and the artwork is the only loud
thing on screen: the accent shows on the selection, the active tool and
the unsaved dot. Sentence case everywhere; group headers are never
upper-cased or letter-spaced; names show exactly as stored. Icons are
Lucide (`scripts/icons.mjs` writes `ui/icons.ts`). Appearance follows the
OS, with the sun/moon button and Settings to pin it.

## The layout

The app opens on a **launcher**, a small fixed window the way Xcode
opens (800 × 460, centred): the mark, the version and three ways in on
the left (Create new project…, Open existing project…, Clone git
repository…), the recent projects on the right (↑ ↓ Return, ⌫ forgets).
A project is a folder; opening one grows the window into the
**workspace**: one window, three columns, three headers, and no toolbar
across them.

    ┌─ navigator header ──┬─ content header ─────────────────────────┬─ inspector header ──┐
    │ ●●●  ▣ ◫ ⌕ ⎇    ◧   │ [▣ art ⇕]   [ art · main  ● Edited ]  ☀  │ ≡ ◉ ↺ ✉         ◨   │
    │                     ├──────────────────────────────────────────┤                     │
    │                     │ ‹ › art › ships › ● fighter › idle  tools │                     │
    ├─────────────────────┼──────────────────────────────────────────┼─────────────────────┤
    │ assets / outline /  │ the asset browser, or the canvas          │ sections            │
    │ search / git        │                                          │                     │
    │ filter         +    ├──────────────────────────────────────────┤                     │
    │                     │ status: state · hint · zoom          XYZ │                     │
    └─────────────────────┴──────────────────────────────────────────┴─────────────────────┘

- **The window has no title bar.** On a Mac the traffic lights sit
  inline, in the navigator's header (in the content header when the
  navigator is hidden); the header leaves them room and takes it back in
  full screen, where they hide. Every header drags the window.
- **Left is the navigator**, four tabs in its header: the project's
  **assets** as a tree (a filter and a New asset menu pinned to the
  bottom), the open asset's **outline** (parts as a tree, a part of
  several shapes opening to them, then states, then clips, each group
  with a +; a scene's nodes), **search** (assets,
  parts, states, clips and colours by name) and **source control**
  (branches, what is uncommitted, Review & commit…).
- **The content header** holds the project picker (the project over its
  branch: recent projects, reveal, serve, close, the branches, New
  branch…), the **activity view** dead centre (Saved, Edited, busy with
  progress, or what failed; its popover lists what happened and offers
  Save and Revert), and the appearance button.
- **The path bar** sits under it: back and forward through the folders
  and assets visited, the breadcrumb project › folders › asset › state
  with every segment a menu of its siblings, and on the right what the
  content needs: the kind filter and New asset… in the browser; the
  tools, the modes and a clip's transport in an editor.
- **Nothing floats over the canvas.** Tools live in the path bar, the
  hint and the zoom in the **status bar** under the content (with the
  X Y Z key in a 3D view).
- **With no asset open the content is the asset browser**: tiles with
  live thumbnails. A click picks one (the inspector shows it, and renames
  it), a double click or Return opens it.
- **Right is the inspector**, four tabs: the **selection** (a shape, a
  part and its pose, or the document; in the browser the picked asset
  and the project), the **view** (camera, overlays, zoom; tile size and
  sort in the browser), **history** (the checkpoint, undo, the activity
  log) and **Ask**. A part counts as selected when it was chosen on
  purpose (a row in the outline, a shape hit, a grip grabbed); a click on
  empty canvas lets go of everything and the inspector returns to the
  document.
- **Bottom is time**: the timeline, only when a clip is chosen.
- **Anything that needs input before it can happen is a sheet**, dropped
  from the top of the window: Return is the primary button (named with
  its verb, disabled until the fields are valid), Escape cancels.
- **The platform draws what it can**: a right click is the platform's
  own context menu, a file or a folder is chosen in the platform's own
  dialog. Dropdowns from a button are the one in-window menu.
- **The file on disk is the document.** Edits land in it at once, whole
  and atomic; ⌘S keeps a checkpoint (`name.fart~`) to revert to by
  choice, never by surprise. Leaving an asset that has changed since its
  checkpoint asks once: Don't save · Cancel · Save.
- **Every view is a state.** There is no separate drawing mode: shapes
  are edited inside whichever state is on the canvas, through its pose,
  and the part is placed and turned by its own grips. A new state copies
  the current one. A clip poses its keys: the key under the playhead
  is the pose the rig's grips change (a key naming a state takes its
  own copy first; between keys a change makes a key), and shapes do
  not edit there.
- **The canvas is the tool**: hover tells you what a click would do, the
  status bar says what mode you are in.

## The words

The file's words and the studio's words are the same words. One
definition each, and the tooltips repeat them.

| word       | in the file     | what it is                                                  |
|------------|-----------------|-------------------------------------------------------------|
| shape      | `shapes[]`      | a circle, a line, a poly; paints one token                  |
| colour     | `palette[]`     | a named slot; shapes name slots, never colours. A palette file is a map of slots other files draw from |
| drawn like | `like`          | a part showing another's shapes and anchors, with its own pivot and pose (1.2) |
| mirror     | `mirror`        | a pose flag: flipped about the pivot before the turn (1.2)   |
| direction  | `angle` on an anchor | which way an attached thing points; anchors with one are sockets (1.2) |
| pin        | `targets`       | a point a chain keeps reaching while the pose changes (1.2)  |
| event      | `events` on a key | a name a game hears crossing the key (1.2)                  |
| curve      | `curve` on a key | a bezier toward the key, over the named ease (1.2)          |
| glow       | `emissive`      | light a slot gives off, for games that have light (1.2)      |
| path       | `path`          | a curve: vertices with tangent handles (1.7); the pen draws one, a poly is a path with none |
| part       | `parts[]`       | a layer with a pivot; the unit that poses; may ride a parent |
| pivot      | `pivot`         | the point a part turns about and is placed by               |
| anchor     | `anchors[]`     | a named point on a part a game or a chain reaches for       |
| parent     | `parent`        | the part this one rides                                     |
| state      | `states[]`      | a view of the parts: who shows, where each sits, in what order; the first one is the drawing |
| clip       | `clips[]`       | states in time: keys, eased                                 |
| chain      | `constraints[]` | parts in a row that IK turns to reach an anchor             |
| collision  | `collision[]`   | shapes a game may treat as solid; never drawn               |

"Layers" is the panel; "parts" are what it lists. A part is a layer
that can move, which is why it is not just called a layer.

A part's shapes are rows under it, in file order, when it has more than
one. A shape has no name in the file and the studio gives it none to
keep: its row reads as its kind and the colour it names, `mesh ·
white_plate`, numbered (`mesh · slit 2`) only where two in the part
would read the same. The kind is the file's word, and a sweep goes by
its `op`: lathe, extrude, pipe. A shape's row and the shape on the
canvas are one selection.

A 3D file (`space: "3d"`, 1.3) opens in the **model screen**: the same
four regions, the canvas showing the model turned under a **view**. The
words gain a coordinate, not a vocabulary:

| word       | in the file     | what it is                                                  |
|------------|-----------------|-------------------------------------------------------------|
| box, ball, rod, prism | `mesh`, `ball`, `rod` | what the four drawing tools make: R drags a box, O a ball, L a rod, P clicks a prism's profile; each as deep as the **depth** field, along the view axis. A fifth, U, clicks a **pipe**'s path |
| corner     | `points[i]`     | a mesh's vertex; drags along the view plane                  |
| view       | (not saved)     | a turn laid on the model: front, back, left, right, top, bottom, or free after an orbit |
| orbit      |                 | a turntable about what is chosen: middle-drag, two fingers on a trackpad, or Alt-drag anywhere; `Cmd` held tumbles freely |
| turn       | `rotate` `[x,y,z]` | a pose's turn about x, then y, then z; the lever turns about the view axis |
| morph      | `morph` on a state entry | a mesh's corners as this state has them (1.6); **Deform** (D) sends corner drags there instead of the base |
| edge, face | `faces[i]`      | a mesh's edge (two corners a face joins) and its face; **Choose** in the Mesh section says which of corners, edges and faces a click takes |
| rim        |                 | a loop of open edges (a face on one side only), around a hole: what Fill closes and Bridge joins |
| extrude, inset, loop cut | `points`, `faces` | faces pushed out along their normal; faces shrunk inside a border ring; a new edge loop across a ring of quads. Plain geometry in the file, one undo step each |
| symmetry   | (not saved)     | a mesh edited with its mirror across x: a working aid, the file holds both halves |
| reference image | (not saved) | an image pinned behind the model in the front, side or top view |
| mannequin  | (not saved)     | another model of the project under this one, dimmed and out of reach, to fit to |
| clay       | (not saved)     | the canvas lit softly (warm key, cool fill, a rim) in place of the plain light |
| smooth     | `smooth`, `normals`, `creases` | the cage drawn subdivided (1.7), lit by averaged normals; an edge's crease keeps it sharp |
| paint      | `colors`, `paint` | faces of a mesh in other colours of the palette than its fill (1.8); **Paint** gives the chosen faces the picked colour, the **Brush** paints the faces the pointer crosses |
| modifier   | `mods[]`      | an operation the file keeps and every reader applies to the cage, in order (1.8): **Mirror**, **Solidify**, **Crease**. **Apply** bakes one into plain geometry |
| cage       | `points`, `faces` | what the file holds and the hand edits, under smoothing and modifiers; drawn as a dashed wire over the result |
| shades     | `shades`      | a number per corner, darkening it (1.8); **Shade corners** works them out from how much sky each corner sees |
| pipe       | `sweep` with `op: "pipe"` | a round section carried along a path of points (1.8); the pipe tool clicks the points, which are then handles |
| on surface | (not saved)     | a pipe's points land on the mesh under the pointer, lifted off it by **lift** |
| sidecar    | `name.fart.glb` | a model compiled to triangles beside its file (1.8): what the studio draws a model from when it is not being edited. A build artifact, never opened or listed |
| sweep      | `sweep`         | a solid from a profile (lathe, extrude), kept as the profile (1.7) |
| Project…   |                 | write the 2D views (`name-left.fart`, …) beside the model    |

Everything else is the editor's: states, clips, the pivot and lever,
the timeline, the inspector, undo, the file on disk as the document.

A scene (`.shart`, a Scene Hierarchy of Art) opens the **scene
screen**: the same regions, the canvas showing the placed files.

| word       | in the file     | what it is                                                  |
|------------|-----------------|-------------------------------------------------------------|
| node       | `nodes[]`       | a placed thing: an instance of a file, a scene placed whole, or a group |
| instance   | `ref` to a .fart | one file, placed; the same file placed twice is two instances |
| group      | a node with no `ref` | a frame for children, nothing drawn                    |
| shows      | `state` / `clip` + `t` | what an instance shows: a state, or a moment of a clip |
| hangs from | `attach`        | a child on a socket of its parent's art (`to`), by its own anchor (`by`) |
| palettes   | `palette_refs`, `palette` | laid over every instance, then over one          |

Nodes are chosen by clicking their art; they drag along the canvas (or
the view plane), nudge with arrows, raise and lower among siblings.

## The keys

Figma's letters, because everyone's hands already know them.

| key                     | does                                          |
|-------------------------|-----------------------------------------------|
| `V`                     | select                                        |
| `R` `O` `L` `P`         | rect, circle (O for ellipse), line, pen (click: corner, drag: curve) |
| `D`                     | deform: drags reshape the part in this state   |
| `C`                     | the collision lens                            |
| `Space` drag, `H`       | pan (hand)                                    |
| wheel, `Cmd` wheel      | pan, zoom about the cursor                    |
| `Cmd =` `Cmd -` `Shift 0` | zoom in, out, 100%                          |
| `Shift 1` `Shift 2`     | zoom to fit, zoom to selection                |
| `Cmd '`                 | snap to grid on and off                       |
| arrows, `Shift` arrows  | nudge 1 unit, 10 units                        |
| `Cmd A` `Esc`           | select all, deselect / cancel                 |
| `Delete` `Backspace` `X`| delete                                        |
| `[` `]`                 | lower, raise                                  |
| `Cmd C` `V` `X` `D`     | copy, paste, cut, duplicate                   |
| `Alt` drag              | duplicate as you drag                         |
| `Shift` drag            | constrain: 45° lines, square rects, add to selection |
| `Alt` on a rect corner  | break it into a free quad                     |
| `Cmd Z` `Cmd Shift Z`   | undo, redo                                    |
| `Cmd S`                 | save (the checkpoint)                         |
| `Cmd N` `Cmd W`         | new asset, close the asset (the browser)      |
| `Cmd Shift N` `Cmd O` `Cmd Alt C` | new project, open project, clone a repository |
| `Cmd I`                 | import a glTF model (.glb, .gltf) as a 3D asset |
| `Cmd Shift 1` `Cmd ,`   | the welcome window, settings                  |
| `Cmd 0` `Cmd Alt 0`     | the navigator, the inspector                  |
| `Cmd 1`–`Cmd 4`         | the navigator's tabs: assets, outline, search, source control |
| `Cmd [` `Cmd ]`         | back, forward                                 |
| `Cmd J`                 | Ask                                           |
| `Cmd Shift P` `Cmd Shift S` | switch asset, switch state               |
| `Cmd K`                 | every command, by name                        |
| `Enter` on a row        | rename inline                                 |
| `Space` with a clip     | play / pause                                  |
| `?`                     | help for what is on screen and what is chosen (the inspector's ? tab) |
| `Cmd /` `Cmd Shift /`   | this screen's keyboard shortcuts, search help |

Digits `1`–`5` still pick tools in the 2D editor, for the hands that learned the classic.

A 3D view (the model screen, a 3D scene) navigates the way 3D tools do,
Blender's hands first:

| key or gesture              | does                                          |
|-----------------------------|-----------------------------------------------|
| middle drag                 | orbit: a turntable about what is chosen; the horizon never rolls |
| `Shift` middle drag, `Space` drag | pan                                     |
| mouse wheel                 | zoom at the cursor                            |
| two fingers, `Shift` two fingers, pinch | orbit, pan, zoom                  |
| `Alt` drag                  | orbit, for a mouse with no middle button      |
| drag on nothing             | a marquee: every shape it touches is chosen; `Shift` adds, `Shift`-click adds or takes out one. Chosen shapes move, turn, size, duplicate and go together |
| `Cmd` while orbiting        | tumble freely instead                         |
| `1` `3` `7` `9`             | front, right, top, the other side             |
| `4` `6`, `8` `2`, `5`       | turn left and right, tilt up and down (15° a step), fit everything. Every digit is the view's in 3D; no digit picks a tool there, the tools are on their letters |
| `F` or `.`                  | frame what is chosen (everything, when nothing is) |
| the X Y Z in the status bar | look along that axis; again for the other side |
| the arrows on what is chosen | move it along that axis of the world, whatever the view |
| the rings on a picked part  | turn it about that axis                       |
| `G` `T` `S`                 | move, turn, size what is chosen, by pointer (the studio's words: R is the box tool) |
| then `X` `Y` `Z`            | hold that axis (again lets go)                |
| then digits                 | the amount: units, degrees, a factor          |
| `Shift` while transforming  | snap: whole units, 15°, tenths                |
| `Return` or a click, `Esc` or a right click | keep it, put it back (one undo step either way) |
| `E` `I` `K` `M`             | on a selected mesh: extrude what is chosen, inset the chosen faces, cut a loop across the chosen edge, merge corners. `E` `I` `K` then follow the pointer or a typed amount; `Return` or a click keeps, `Esc` or a right click puts back and leaves no undo step |
| `Cmd A`, `Shift` click      | on a selected mesh: choose every corner, edge or face; add one or take it out |
| `B`                         | on a selected mesh: the brush. A click or a drag paints the faces under the pointer with the picked colour; `B` or `Esc` puts it down |
| `U`                         | the pipe tool: click a path's points, `Return` (or a click on the last point) makes the pipe, `Esc` drops it |

With corners, edges or faces chosen on a mesh, the arrows and `G` `T`
`S` move, turn and size those and leave the rest of the mesh where it is.

With **Deform** on, every one of these reshapes the mesh in this state
only (its morph), never the base; a ball or a rod has no morph and is
refused with a word why. A **scene**'s nodes take the same handles, keys
and marquee (a 2D scene in its plane: X and Y arrows, one ring); several
nodes move as one and each turns and sizes about its own origin; a node
inside another chosen one rides it. A 3D scene orbits about the chosen
nodes.

## The rules

- **Everything is reachable three ways**: the menu bar, the command
  palette (`Cmd K`), and a key. The registry in `state/commands.ts` is the
  one list; the others read it.
- **Rename inline** in the outline: double-click or `Enter` on a row. A
  file is renamed in the inspector's field, or in a sheet.
  New things get a name and are already being renamed.
- **Numbers are fields.** Anything with a value shows the value and takes
  a typed one. Sliders only where the range is the point (colour channels).
- **Live, always.** A change shows as it happens and reaches disk a beat
  later; Save is a checkpoint, not a commit dialog. No apply buttons.
- **Hover foretells.** What a click would pick is outlined before the click.
- **Snap, with a way out.** Grid snap is a toggle; geometry snap (to other
  shapes' points) is on, with `Cmd` held to defeat it for one gesture.
- **Right-click is the short list**, drawn by the platform: the four
  things you do most to that thing, and its delete (never a red ×). The
  long list is `Cmd K`.
- **Modes are visible.** A state, a clip's key, the collision lens:
  the status bar names which, the path bar dims what does not apply.
- **Settings stay small.** Appearance, the welcome window and the setup
  checklist share one page (`Cmd ,`); everything else is a toggle where
  it acts.
