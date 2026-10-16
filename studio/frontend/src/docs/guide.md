# Uranus

Uranus is the reference editor for the Fast Art Format. It edits `.fart`
documents and `.shart` scenes, and nothing else: it holds no knowledge
of any game or engine, and it confers none. Its function is to produce
files that conform to the specification, and to show them as a
conforming reader would.

Help follows you: the ? tab of the inspector (or the `?` key) shows the
part of this guide for the screen you are on and the thing you have
chosen, and a ? anywhere else opens the topics for that place. The Help
menu searches this guide by word (Cmd+Shift+/), lists the keyboard
shortcuts that work on the screen you are on (Cmd+/), and starts from
the common questions: getting started, drawing, colours, rigging and
animation, 3D, scenes, games, and projects and setup.

## Projects

A folder is a project. The app opens on the **launcher**, a small
welcome window: **Create new project…** (Cmd+Shift+N) asks for a name, a
location, what to start with and whether to make a git repository, then
makes the folder with `assets/` inside (new assets land there); **Open
existing project…** (Cmd+O) takes any folder of `.fart` files; **Clone
git repository…** (Cmd+Alt+C) checks one out from a remote. Recent
projects wait on the right (arrows and Return, Backspace forgets one).
Dropping a folder on the window, double-clicking a `.fart` in the Finder,
or `studio some/dir` and `studio thing.fart` from a terminal open one too.

A project is one window in three columns, each with its own header. The
**navigator** on the left (Cmd+0) has four tabs: the **assets** as a tree,
with a filter and a **+** at the bottom that adds an asset, a 3D asset, a
palette, a scene or a 3D scene; the open asset's **outline** (parts,
states, clips; a scene's nodes), each group with its own +; **search**
across names; and **source control** (branches, what is uncommitted,
Review & commit…). With nothing open the middle is the **asset browser**,
every asset as a live thumbnail: click one to pick it (the inspector
shows it, and renames it), double-click or press Return to open it.
Cmd+W closes the asset and shows the browser again.

The middle column's header holds the **project picker** (the project
over its branch: recent projects, the branches, New branch…) and, dead
centre, the **activity view**: Saved, Edited, or what Uranus is busy
with; click it for what happened lately, and for Save and Revert. Under
it the **path bar**: back and forward (Cmd+[ and Cmd+]), then project ›
folders › asset › state, every segment a menu of its siblings
(Cmd+Shift+P and Cmd+Shift+S open the asset's and the state's), then the
tools. Nothing floats over the canvas; the hint and the zoom are in the
status bar under it. The **inspector** on the right (Cmd+Alt+0) has four
tabs: what is selected (else the asset, else the project; a click on
empty canvas lets go of everything), the **view** (camera, overlays,
zoom), **history** (the checkpoint, undo, the log) and **Ask**.

## The project's direction

A `style.gas` file at the project's root is the art direction
every asset follows: a statement, the shared palettes and the roles
their colours play, scale, line, shape budgets, light, motion, naming,
the assets to copy from, rules the tools can check, and a list to
avoid. With nothing open the inspector shows it; a new asset starts
with its palette refs; an asset that breaks a rule shows a **direction**
line in its inspector; `fart lint` reports the whole project. Ask
Claude reads it before designing. The format is `spec/DIRECTION.md`.

## Generated assets

An asset written by a generator (`meta.gen` names the script, the way
`@fastart/make`'s `write` records it) shows **from gen/…** in its
inspector with **regenerate**, which runs the script with node and
reloads what it writes. Keep generators in `assets/gen/`; change a
line, regenerate, and the set follows.

## The editor

The **pen** (P) draws paths: click for a corner, drag to pull a pair of
mirrored handles for a curve, click the first point or press Enter to
close. A selected path shows its vertices and, as rings, its tangent
handles; drag a handle to bend the curve (Alt breaks the pair), drag a
vertex to move it with its handles. The inspector's **closed** box turns
a fill into a stroke with a **width**. Save writes the flattened polygon
into the file beside the curve, so older tools draw the shape. **Deform**
(D) in 2D works as in the model screen: drags land in the current
state's morph, and clips lerp the corners.

Four regions, the way Rive, Spine and Figma lay it out: **structure on
the left** (the navigator: the project's assets, and the open asset's
outline of parts, states and clips), **the canvas in the middle** with
the tools in the path bar above it and the status bar below, **the
inspector on the right** (whatever is selected), and **the timeline
along the bottom** when a clip is chosen.

- **Tools**: Select `V`, Rect `R`, Circle `O`, Line `L`, Pen `P`, in the
  path bar. The digits `1`–`5` still work in 2D. `D` is Deform, `C` the
  collision lens, and the grid button snaps.
- **Canvas**: the tool is what a click does. Hold `Space` and drag (or
  middle-drag) to pan; scroll pans; `Cmd`+scroll or a pinch zooms about
  the cursor. `Cmd =` / `Cmd -` zoom, `Shift 0` is actual size, `Shift 1`
  fits everything, `Shift 2` fits the selection. Right-click for the
  short list. `Cmd K` for the long one.
- **Select**: hovering outlines what a click would pick; a selected shape
  shows handles (circle radius, line ends, every vertex) and its body
  drags. `Shift`-click adds to the selection; drag on empty ground for a
  rubber band; `Cmd A` takes everything. Arrows nudge a unit, `Shift`
  arrows ten. `Alt`-drag drags away a copy. `X` or `Delete` deletes.
- **Snapping**: points pull to other shapes' corners, ends, centres and
  pivots as you draw or drag; `Cmd '` adds the half-unit grid. Hold `Cmd`
  during a gesture to snap to nothing. A small × marks where a point
  landed.
- **Constrain**: `Shift` while drawing keeps a line to 45° steps and a
  rect square. `Alt` on a rect's corner breaks it into a free quad;
  without it the rect stays a rect.
- **Poly**: click to add points; click the first point again, or press
  `Enter`, to close. `Esc` drops it.
- **Rename** anything inline: double-click a part, a state, a clip, a
  token, an anchor, or press `Enter` with a part current. New things
  arrive already being renamed.

## Parts and the outline

The navigator's Outline tab lists the parts of the file as a tree: children
sit under their parents, and a parent folds. The + beside Parts adds one. Click
to make a part current (new shapes land there); the **eye** hides a part
while you work and the **lock** keeps it out of reach, and neither is
saved. Right-click a row for rename, pivot, anchor, order and delete
(⌫ on a row deletes too).
File order is paint order; raise and lower a part from the inspector or
the menu.

A part of several shapes opens to them too: one row a shape, above the
part's children, in file order (later paints over earlier). Shapes have
no names in the file, so a row reads as what the shape is and the colour
it names (`circle · ink`, `mesh · white_plate`, `pipe · helm_trim`),
with a number only where two in the part would read the same, and its
colour as a swatch at the right. A click on a row chooses the shape
exactly as a click on it on the canvas does, and ⇧ or ⌘ adds one or
takes it out; a shape chosen on the canvas opens its part and marks its
row. ↑ and ↓ walk the rows, ⌫ on a row deletes the shape, and a right
click offers what the canvas does. A part of one shape stays a plain
row, and a part holding more than twelve shapes and no children starts
folded. What is open is the studio's and lasts the session; opening,
folding and choosing never touch the file.

## The inspector

The properties of whatever is selected, as numbers you can type (Return
or leaving the field commits, ↑ ↓ step, drag an X/Y/Z badge to scrub).
Sections fold. Its other tabs are the view, history, Ask and this help:

- **Shape**: its fill (a palette token, picked from a grid), its numbers
  (centre and radius, ends and width), raise, lower, to part, delete.
- **Part**: name, pivot, parent, the buttons that arm the pivot and
  anchor crosshairs, its anchors with their coordinates, and its IK
  chains.
- **Pose** (with a state chosen): where the pivot lands, turn, size,
  reset, and whether the part is drawn in this state.
- **Document** (nothing selected): the file's name, the palette with a
  colour picker behind every swatch, the shared tokens, the collision
  count.

## Colours

A shape never holds a colour. It names a **slot** (`skin`, `cloth`), and
the file's Colours list says what that slot means today: change a colour
there and every shape using it follows. Click the canvas with nothing
selected to see the list in the inspector: the **+** beside Colours adds
a slot, a click on a swatch opens the picker, a double-click on a name
renames it (shapes follow), and the selected colour shows its hex and a
delete (also in its right-click menu, and on ⌫).

A **palette file** is a `.fart` with colours and no parts: a project's
shared vocabulary of slots. **Palette** in the navigator's + makes one (a
plain name lands in `palettes/`), and opening one shows only its
swatches. Link a palette file to an art file with the **+** beside
**Shared palettes**; its slots then appear under *From shared*, greyed, to paint
with. The file's own colours win over shared ones, so **override** copies
a shared slot into the file when one chest wants its own wood. A linked
palette that cannot be found is marked *missing* and its slots paint
magenta.

At runtime the same slots are the recolour surface: a game lays a
palette file over a document (`apply_palette` in the Odin loader,
`applyPalette` in core) and the red slime and the blue one are one
file.

## Ask Claude

**⌘J** opens a panel where you tell Claude what to change: "make the
left arm longer", "add a blink clip that shuts the eyes for a frame",
"give this a burnt palette variant". It runs your own Claude Code (the
one installed on this machine, with the fastart skill), and works
*through the editor*: it reads the open file and what you have selected,
changes the document as one undo step, so ⌘Z takes it back, looks at a
state or a clip frame to check its work, and validates before applying.
The transcript shows what it did (read, looked, changed, with a note)
and what it said. A conversation continues per project; the + starts a
fresh one. Each turn takes a few seconds and costs what a Claude Code
turn costs; the panel keeps a running total. In the browser, with no file
open, it can open files and talk about the project. Setup says whether
Claude Code was found.

## Setup: agents and loaders

**Setup** (Help › Setup…, or Settings, Cmd+,) checks
what this machine and the open project's repository have in place for
fastart, and installs what is missing with one click: the Claude Code
skill in `~/.claude/skills/fastart` (the format in one page, so Claude
in any project can write and check `.fart` files; `/fastart` invokes
it), a fastart section in the repository's `CLAUDE.md`, a `.gitignore`
line for the studio's `*.fart~` checkpoints, and, in an Odin project,
the reference loader copied in or brought up to date. The rows are
facts the studio just checked, so the screen doubles as a health check
after pulling a new studio. It writes only those four files.

## Rigs: parents

A part may have a **parent** (the select under the parts list). A child
is posed in its parent's frame, so moving or turning the torso carries
the head and the arms with it, and their own state entries stay at rest.
Nothing changes at rest: parents only matter once something moves. The
rig shows as dashed bones from each pivot to its parent's.
Paint order is still the state's list; parents are about motion, not
layering.

## States

Every view is a state. A file opens on its first state (a file that has
none gets one, `default`, with every part where it was drawn), and
everything you do happens in whichever state you are looking at: shapes
are drawn and reshaped in place, even inside a part that the state has
turned, and the part itself is placed by dragging its ⌖ and turned by
its lever. The **+** beside States makes a new state as a copy of the one on the
canvas; right-click any state to duplicate that one instead. A state
says which parts show (the checkboxes in Layers), where each sits, and
in what order (raise and lower in the inspector). The last state cannot
be deleted; there is always one. Drag a part to place it
(its offset is where the part's pivot lands), pull the lever off the
pivot to turn it, and the Pose card gives turn and size sliders and a
reset. Geometry is locked until you go back to **all parts**. State order
is paint order, so a lid may layer differently open and closed.

## Clips: states in time

A clip is a list of keys, each at a time in seconds, each naming a state.
The **+** beside Clips in the outline makes one with a single key
at 0. Select a clip and its transport appears in the path bar and the
timeline under the canvas: **▶** (or Space) plays, the ruler
scrubs, **+ key** drops a key at the playhead, and a key drags along the
ruler. The selected key's state, its ease (how time approaches it), and
its time sit to the right. Between keys the parts tween: offset and size
linearly, turns the short way round; which parts show, and their paint
order, switch at the key. **loop** wraps time at the last key. Keys name
states, so to change what a key looks like you pose that state; a clip
never carries its own pose.

## Mirror and reuse

A part can be **drawn like** another (the select under its parent): it
shows that part's shapes and anchors and has none of its own, with its
own pivot, parent and pose. The left claw is the right claw's geometry.
Then **mirror** in the part's pose block flips it left-to-right about
its pivot, before the turn, so it still turns the way its parent does.
Editing shapes on a part drawn like another edits the source. A child of
a mirrored part rides the flip, so the flame on a mirrored engine needs
no mirror of its own.

## Sockets: anchors with a direction

An anchor may point somewhere: the ↗ on its row gives it a direction
(degrees), drawn as a short line on the canvas. A game attaches things
by aligning anchors, the cutlass's `grip` onto the hand's `hand`, and
where both have a direction the item turns to match. Which item sits in
which hand is the game's business; the file only says where and which way.

## Pinned reach

Dragging a chain's ring now **pins** the point: the chain keeps reaching
it while the rest of the pose changes, so the hand stays on the latch
when the torso leans. The ring shows a filled centre when pinned, the
chain's card says where, and **release** lets go, leaving the rotations
as they are. Pins are saved with the state (`targets`), and a clip
tweens them between keys, re-solving as it plays.

## Events and curves

A key can carry **events**, names typed into the field beside its time:
`footstep`, `hit`. A game hears them when the playhead crosses the key;
the timeline marks such keys with a dot. A key can also carry a
**curve**, a bezier picked from presets (back out, quint in, …) or
tuned as four numbers; it wins over the named ease, which stays set to
the nearest name so older readers stay close.

## Glow

A colour slot can be **emissive**: the glow field in the colour picker,
from 0. The studio only marks it (☀ on the row); a game with lighting
reads it, one without ignores it.

## Chains: reaching with IK

Give a part an anchor (a hand, a foot), then the **+** beside IK in
the inspector: the chain runs from the part's parent to the part and reaches
with that anchor. **longer** adds the next parent; **bend** says which
way an elbow should fold when it could go either way. Every chain shows
a teal ring at its reach point: drag the ring and the chain's
parts turn to follow. Only rotations change, and the result is an
ordinary state, so games need nothing new to draw it. The chain itself is
saved too, for games that want to solve live.

## The collision lens

The Collision button (or C) dims the art and edits the document's
`collision` list with the same tools: shapes a game may treat as solid.
A line is a capsule (a girth slider when selected); they never draw
in-game. Esc deselects, X deletes, C flips back.

## Appearance

Uranus comes in Light and Dark and follows the OS. The sun/moon button
at the right of the content header pins the other one; Settings (Cmd+,)
goes back to following the system. The canvas grid, selection and
handles follow the panels. The choice is remembered per device, so a
tablet can wear a different one than the desk.

## Clipboard and keys

Everything the studio does is in the menu bar, in `Cmd K`, and on a
key; the same list drives all three. Cmd+C / Cmd+V copy and paste the
selection; Cmd+X cuts; Cmd+D duplicates in place. Pasted shapes land in the part they were copied from (matched
by name, so pasting works across files), or the current part when no
name matches, nudged a little each paste. Esc deselects or cancels;
Cmd+Z undoes; Cmd+Shift+Z (or Cmd+Y) redoes. `?` opens these docs.

## The panels

The navigator and the inspector each have a draggable edge. Drag to
resize, double-click the edge to put it back. Sizes are remembered on this device.
Each hides from its own header (Cmd+0, Cmd+Alt+0); hidden, its button
moves to the content header.

The inspector's **View** tab holds how things are shown rather than what
they are: the tile size, the sort and whether subfolders are included in
the asset browser; the zoom, the grid snap and the overlays on a canvas;
the camera in a 3D view. **History** shows the open asset's checkpoint
and what Uranus did lately. **Help** (the ? tab, or the `?` key) shows
the part of this guide that answers what is on screen and what is
chosen; a ? elsewhere (the launcher, Settings, Ask, source control)
opens its own topics. The navigator's **search** tab finds assets, parts,
states, clips and colours by name, and **source control** lists what is
uncommitted and commits it.

## Saving is a checkpoint, not a copy

The file on disk always mirrors what you see, written a beat after every
change, so a game hot-reloading the file shows your experiment live.
**Save** (Cmd+S) marks the checkpoint: the version **Revert** goes back
to. Nothing reverts on its own. The dot by the asset's name (in the path
bar, the navigator and the activity view's "Edited") means it has
changed since its checkpoint; leaving it then asks once whether to save
one (Don't save · Cancel · Save), and your edits stay in the file either
way. The checkpoint lives beside the file as `<name>.fart~`. The
inspector's History tab shows when each was written, with Undo, Redo,
Revert and Save.

The studio watches the open file. When another tool writes it (a game's
build step, Claude in a terminal) and you have nothing pending, the
studio reloads it and says so; the reload is an undo step. When you do
have an edit pending, it asks before writing: Reload takes the file's
version and keeps your edit one ⌘Z away, Cancel keeps yours. It never
writes over a change it has not shown you. `meta` and any field the
studio does not know ride along untouched, load to save.

## Serve: the tablet workflow

**Serve** (in the project picker, and the File menu) puts this same editor on your network (port 4747)
and shows the URL and a QR code. Scan it and the editor opens in the
tablet's browser, on the same project. Draw with the pencil; one finger
draws, two fingers pan and pinch. Every change streams back to disk. No
cloud, no app store: your machine serves, your tablet draws. From a
terminal, `studio --serve some/dir` does the same without a window.

## Textures

A texture is a set of maps, and every map is a drawing: a 2D file of
the project tiled over a **cell**. There are no bitmaps. In the
inspector's **Textures** section give a texture a name, its cell, and
its maps: the **color** map is what is painted; a **height**, **glow**
or any other map is the same idea for the game to read (grey levels
read as a value). One drawing under another **palette** or **state** is
another map, so they line up for free. **open** edits the drawing.

A shape takes a texture in its section: in 2D with a placement (where
the pattern's origin lands, its turn, its size); in the model screen
with a **size** only, since faces are box mapped: each face reads the
two world axes across its normal, so planks line up across a wall
with nothing authored. **paint** lays the map's colours over the
shape's slot where it paints; **mask** multiplies the slot by the
map's value. A palette swap still recolours the slot underneath.

## Shade

A shape may carry a **shade** (in the inspector, under its numbers):
the slot's colour times that number, alpha kept. 1 is the colour as
is, 0.6 is the shadowed side of a barrel, 1.2 a highlight. A palette
swap recolours a shaded shape along with the rest; that is the point of
shading the slot instead of picking a darker colour.

## 3D models

A file with `"space": "3d"` is a model, not a drawing: mesh, ball and
rod shapes, three-coordinate points, turns about x, y and z. **3D
Asset** in the navigator's + makes one; opening one lands in the model screen,
the same four regions with the model turned under a **view**.

- **The view** is a turn laid on the model. Press `1` for the front,
  `3` for the right, `7` for the top and `9` for the other side, click
  X, Y or Z in the status bar to look along that axis, or pick a camera
  in the inspector's View tab.
- **Orbit** with the middle button, with two fingers on a trackpad, or
  with Alt-drag anywhere. The view turns like a
  turntable about what is chosen, which stays where it is on the canvas,
  and the horizon stays level; hold ⌘ to tumble freely. Shift with the
  middle button (or with two fingers), or Space-drag, pans. A mouse wheel
  or a pinch zooms at the cursor. `F` frames what is chosen.
  The other digits are the view's too: `4` and `6` turn it a step, `8`
  and `2` tilt it, `5` fits everything. No digit picks a tool in a 3D
  view; the tools are on their letters.
- **A part opens to its shapes** in the outline: a model that is one
  part of many shapes (a prop a script wrote) shows what it is made of,
  one row a shape (`mesh · barn_trim 3`, `ball · iron`, `pipe ·
  helm_trim`; a sweep goes by what it does: lathe, extrude, pipe). Click
  a row to choose the shape, right-click it for Duplicate, Mirror across
  x and Delete. See Parts and the outline.
- **Choose several shapes** by dragging a marquee over them from empty
  canvas, or by Shift-clicking them one at a time, on the canvas or on their rows in the outline. They move, turn, size,
  duplicate and delete together; the inspector shows the first.
- **Move, turn and size along the world's axes.** A picked part (or a
  selected shape) wears three arrows, X Y and Z: drag one to move along
  that axis whatever the view. A part wears three rings too: drag one to
  turn about that axis. Or use the keys: `G` moves, `T` turns, `S`
  sizes, following the pointer; then `X`, `Y` or `Z` holds an axis and a
  typed number is the amount (`G` `Y` `2.5`, `T` `Z` `90`, `S` `2`).
  Return or a click keeps it, Esc or a right click puts it back, Shift
  snaps. The pivot's ring still moves a part freely in the view plane and
  its lever still turns it about the view.
- **With Deform on**, moving, turning and sizing a mesh (by drag, by
  handle or by key) reshapes it in this state only, like a corner drag
  does. A ball or a rod cannot be deformed; Uranus says so rather than
  changing every state.
- **The tools make solids.** Rect (R) drags a **box**, Circle (O) a
  **ball**, Line (L) a **rod**, Poly (P) clicks a profile and closes it
  into a **prism**. Each is drawn in the view plane and is as deep as the
  **depth** field in the path bar, centred on the depth of what is
  selected (else the part's pivot). So the way to model a pistol is to
  pick the left view, click its profile, close it, then turn to the top
  and drag the barrel's octagon... or just its box.
- **Drag a shape** to move it along the view plane; select a mesh and
  **drag a corner** to pull it along the view plane. The inspector moves
  either on any axis by number, and turns a corner's or a ball's fields
  into the model's coordinates. **Mirror across x** (right-click) copies
  a shape reflected through the model's middle, faces turned to stay
  outward.
- **Poses are the same as in 2D** with a third axis: the ⌖ moves the
  part, the lever turns it about the view axis, and the inspector has
  the turn about x, y and z in degrees. A turn about the view axis is
  what survives projection exactly; the rest bakes.
- **Clips preview** with a scrubber under the canvas; keys name states.
- **Project…** writes the 2D files a game draws, beside the model:
  `pistol-left.fart`, `pistol-top.fart`, ordinary files this editor
  opens: faces that face the viewer as shaded polys, and every pose
  either a real 2D pose (a turn about the view axis; parents kept, clips
  tweened) or a baked variant part (`hammer@1`) with the clip subdivided
  at 12 fps. The same comes from the command line:

      npx fart project pistol.fart --view left --view top --outline ink:0.25

  `spec/PROJECT.md` has the rules; the spec page here has the format.
- **The file on disk is the document** here too: edits land at once,
  ⌘S is the checkpoint, Revert goes back to it. ⌘J asks Claude, who can
  read and write the model like any file.
- **Collision** (the Collision button, C) shows the file's solids as
  wireframes posed with the frame, coloured by layer and labelled.
  A part's **hull** button writes a convex hull of its shapes into the
  collision list, riding the part; hand-made solids go in the file
  (`box`, `ball`, `rod`, convex `mesh`, with `part` and `layer`).
- **For a 3D game** the model loads as it is: the Odin loader flattens
  each part to triangles (`flatten_part`) and poses them through
  `Y_UP * world_xf_3d`; `npx fart gltf model.fart` writes a `.glb` with
  its animations for any other engine. Chains work in 3D with a `pole`
  in place of `bend`; the model screen does not show them yet.
- **Import glTF…** (File menu, ⌘I) brings a model in from Blender or any
  tool that writes glTF: export a `.glb` (or a `.gltf` with its `.bin`
  beside it), choose it, and a sheet shows what it would make before
  anything is written: parts, shapes, points, faces, colours, clips, the
  size in units, and whatever had to be left out. Every mesh node is a
  part named for it, its origin the pivot, the mesh node above it its
  parent; every material is a colour; a mesh of several materials is
  one shape painted with them. glTF holds only triangles, so two in one
  plane that share an edge come back as the quad they were, and
  vertices split for shading weld into one corner. Smooth shading comes
  across as smooth normals, animations as clips keyed where the source
  keyed them, morph targets as states. **Size** is a scale or a height
  in units (Blender works in metres; a prop here is tens of units, and
  coordinates keep three decimals, so scale a small model up).
  **Merge into one part** drops the rig; **A shape per material** is
  for readers older than format 1.8. A file of the same name is replaced
  only after asking. Textures, cameras and lights are not imported, and
  a skin is flattened: each face rides the joint that holds most of it.
  For a cage you mean to edit, export without applying subdivision and
  set **smooth** here. A model dropped on the window opens the same
  sheet, and the command line does the same:

      npx fart import helm.glb --height 24
- **Deform** (D) in the path bar makes corner drags reshape the
  part *in the current state only*: a morph (format 1.6) the clips lerp
  between keys. The part's row says **morph**, the inspector counts the
  reshaped meshes and has **reset**. Off, corner drags edit the base
  mesh every state shares. A part drawn like another cannot morph.
- **Smooth surfaces (1.7).** A mesh's inspector has **normals** (flat, or
  smooth for averaged vertex normals, with an **angle** past which edges
  stay sharp) and **smooth**, the number of subdivision levels drawn
  over the cage. The cage stays the file and keeps its corner handles;
  with smooth on, a dashed wire shows it over the surface. Shift-click a
  second corner to choose an edge, then set its **crease** (0 smooth, 1
  sharp, a fraction a fillet). Deform moves cage corners and the surface
  follows, so a breathing or squashing smooth thing is still two states
  and a clip.
- **Sweeps.** A `sweep` shape (a lathe or an extrude of a profile, from
  a generator or the file; a pipe along a path, from the Pipe tool)
  shows its op, axis, segments or depth in the inspector and is drawn as
  the mesh it makes.
- **Corners, edges and faces.** A selected mesh has a **Mesh** section
  in the inspector, and **Choose** there says what a click on it
  chooses: its corners, its edges or its faces. Hover shows which, a
  click chooses one, Shift adds one or takes it out, ⌘A chooses them
  all, Esc lets go of them (and again of the mesh). What is chosen drags
  along the view plane, nudges with the arrows, and takes `G` `T` `S` and
  the axis arrows, which then move only what is chosen. In a straight-on
  view two edges or corners can lie one behind the other; the nearer one
  is taken. Choosing edges or faces draws the mesh's wire, and creased
  edges in green.
- **Extrude, inset, loop cut.** With faces chosen, **Extrude** (`E`)
  pushes them out along their normal and walls the border with quads,
  and **Inset** (`I`) shrinks them inside a border ring of quads, with
  an optional **raise**. With an edge chosen, **Loop cut** (`K`) runs a
  new edge loop across the ring of four-sided faces the edge belongs to.
  By key the pointer says how far: move it, or type a number, then
  Return or a click keeps it and Esc or a right click puts it back,
  leaving no undo step. From the button the operation is simply done.
  Either way its numbers stay open at the foot of the Mesh section (the
  amount, the raise, the cut's place as a slider) until something else
  changes, and changing one runs it again inside the same undo step.
- **Rims.** An open edge is one with a face on one side only, and a
  **rim** is a loop of them, around a hole. Delete a face (⌫ with faces
  chosen) and it leaves one. With an edge of it chosen, **Rim** chooses
  the whole loop, **Extrude** (`E`) grows a band of quads from the
  chosen open edges, **Fill** closes the rim with one face, and
  **Bridge** joins two rims of the same count with a band of quads:
  choose an edge on each. A rim that will not bridge says why.
- **Merge, flip, wind outward.** **Merge** (`M`) welds corners that lie
  within a distance of each other into one (the chosen corners when
  several are, else all of them). **Flip** turns the chosen faces to
  wind the other way, and **Wind outward** puts the whole mesh right:
  neighbours are made to agree, then each piece is turned so that the
  volume it encloses is positive.
- **Creases on a selection.** With edges chosen the **Crease** field
  sets them all (Shift-clicking a second, neighbouring corner still
  chooses the edge between the two). **Crease by angle** creases every
  edge whose faces meet at more than an angle, leaving alone the edges
  that have a crease already.
- **What an operation keeps.** Each is one undo step. Creases follow
  their edges, explicit pattern coordinates stay one pair per corner,
  and a morph of the mesh in any state or key is carried through, so
  cutting a loop into a mesh that breathes leaves it breathing.
  Operations change the base mesh every state shares; Deform is for
  moving corners in one state.
- **Symmetry.** **Mirror across x** in the Mesh section is a working
  aid for that one mesh: while it is on, moving a corner moves its
  mirror, a corner on the plane stays on it, and every operation is
  done to the mirrored corners, edges and faces too. The dashed red line
  is the plane. It is the studio's note, not a field: the file holds
  plain geometry, both halves.
- **Colours by face (1.8).** A shape names one colour, its **Fill**; a
  mesh may give some of its faces others. Choose faces, pick a
  **Colour** in the Mesh section (any colour of the palette) and press
  **Paint**. Or press **Brush** (`B`) and click or drag over the mesh:
  every face the pointer crosses takes the colour, one stroke one undo
  step, until `B` or Esc puts the brush down. The file gains `colors`
  and `paint` and keeps them small: paint a face the fill again and its
  paint goes, and a colour no face wears is dropped. Extrude a painted
  face and its walls wear the same; **Inset** has a **Border** colour
  for its ring of quads, which with a little **Raise** is a trim band in
  one step. Mirrored faces are painted too while symmetry is on.
- **Modifiers (1.8).** The **Modifiers** section of a mesh or a sweep is
  a list the file keeps and every reader applies to the cage, in order,
  each time it is drawn: model half a helm with no thickness and let the
  list make the rest. **Mirror** reflects the cage through the plane
  where x, y or z is 0 and welds the corners that lie on it (**Merge**
  is how near counts). **Solidify** gives a surface a wall: **Thick**,
  an **Offset** (−1 the cage is the outside, 1 the inside, 0 the
  middle), and an **Inner** and a **Rim** colour of their own.
  **Crease** creases every edge sharper than an **Angle**, which with
  smooth levels is a bevel. Add one from the menu at the foot of the
  list, reorder with the arrows, remove with the bin; every change is
  one undo step and shows at once. What you choose and drag is still the
  cage, drawn as a dashed wire over the result. **Apply** bakes a
  modifier (and the ones above it) into the mesh's own points and faces,
  carrying its paint, creases, shades and every morph; a sweep applied
  becomes a mesh. Leave them unapplied for as long as you can: an
  applied mirror is twice the corners to move.
  While a mesh has a Mirror modifier across x the working **Symmetry**
  stands down, since the file is doing the mirroring: edit the half that
  is there.
- **Shades (1.8).** **Shade corners** in the Mesh section works out, for
  every corner of the mesh, how much of the sky it can see past the
  model's own geometry as this state poses it, and writes the answer as
  `shades`: the inside of a hood, the foot of a plume and the fold
  under a brim sit darker, and the canvas, a game and every projection
  show it. From each corner 48 rays go out over the half of the sky its
  normal faces; each that meets the model within reach counts as shadow,
  nearer ones more. **Strength** is how dark a wholly hidden corner
  gets; **Clear** takes the shades away. It is worked out once, when you
  ask: shade last, and again after the shape changes. It reads the cage
  with its modifiers, before smoothing, so both walls of a solidified
  shell share a corner's shade.
- **Pipes (1.8).** The **Pipe** tool (`U`) sweeps a round section along
  a path: a horn, a plume's spine, a strap, a curl of trim. Click its
  points, then Return (or click the last point again); Esc drops it. It
  is as wide as a rod (half the **depth** field) and its points land on
  the view plane through the part's pivot, so in the front, side or top
  view you are drawing in a plane you can name. Turn **On surface** on
  (the magnet in the path bar) and each click lands on the mesh under
  the pointer instead, lifted off it along its normal by **Lift**, and
  the pipe is given the points it needs to follow the surface between
  your clicks: a curl drawn on a helm lies on the helm. The path's
  points are then handles: drag one (it stays on the surface while On
  surface is on), nudge it with the arrows, or type its coordinates; ⌫
  takes the chosen point out. The inspector has the **Radius**, the
  **Radius here** of the chosen point (0 at an end is a tapered tip),
  **Segments**, **Caps**, **Closed** and **Round the path** (curved
  through its points, or straight runs). With **Symmetry** on (it is
  already on when the mesh you were on is mirrored) the pipe has a twin
  across x that follows every change. A pipe is a sweep: it takes
  modifiers too.
- **Compiled sidecars (1.8).** Wherever Uranus shows a model it is not
  editing (a tile in the browser, a model placed in a scene, the
  mannequin) it draws the model from `name.fart.glb`, a compiled copy
  kept beside the file with every mesh already generated, and makes that
  copy first when it is missing or was made from an older file. So a
  scene of heavy models opens at once the second time. The copies are
  build artifacts, as `npx fart build` makes them: the studio never
  opens or lists one, they are no part of a checkpoint, and a recolour
  needs no rebuild because they hold each colour by name. The model you
  are editing is always drawn from the file itself; its copy is made
  again when you save. In a git repository that would commit them the
  studio asks once whether to add `*.fart.glb` to `.gitignore`. **Build
  compiled sidecars** in the File menu makes them for the whole project.
- **Reference images.** The View tab's **Reference images** pins an
  image of the project (png, jpg, webp, gif) behind the model in the
  front, side or top view: its position, its width in the canvas's
  units, its opacity. It shows only when the canvas looks straight from
  that view (`1`, `3`, `7`), under the model and over the grid.
- **A mannequin.** The View tab's **Mannequin** shows another 3D file of
  the project under the one being edited, dimmed, in one of its states,
  where its own coordinates put it: a body to fit a helm or a coat to.
  It cannot be selected, picked or changed from here, and fit and frame
  ignore it.
- **Reference images, the mannequin and symmetry are remembered per
  document on this device** and are never written into the `.fart`.
- **Clay shading.** **Shading** in the View tab's Camera section swaps
  the plain light (one flat light, the way Project draws) for **Clay**:
  a warm key light with a soft edge, a cool fill from the other side and
  a little rim, worked out per pixel from the mesh's normals. Rounded
  forms then read the way a cel or clay shaded game shows them; set a
  mesh's normals to smooth (or give it smooth levels) to see it. It
  changes the canvas only.
- **Ask Claude to model.** Claude has the same operations as tools
  (extrude, inset, loop cut, bridge, fill, delete faces, merge, flip,
  wind outward, crease, crease by angle, and a measure of the mesh),
  each one undo step, each answering with what the mesh is now; and it
  can look at the model from the front, the left, the top and a
  three-quarter view in one go. It paints faces, sets and applies
  modifiers, shades corners, draws a pipe from points (on a shape's
  surface, if asked) and builds sidecars the same way, and it can look
  at another model of the project without opening it.

## Scenes

A `.shart` file (a Scene Hierarchy of Art, dot-s-h-art) composes the
project's files into a scene and draws nothing of its own. **Scene** or
**3D Scene** in the navigator's + makes one; opening one lands in the
scene screen.

Nodes work like parts do in the model view. A chosen node wears the X, Y
and Z arrows and three rings; `G`, `T` and `S` move, turn and size it,
with `X` `Y` `Z` to hold an axis and digits for the amount. Drag a
marquee from empty canvas, or Shift-click, to choose several: they move
together, and each turns and sizes about its own origin. In a 3D scene
the middle button (or two fingers, or Alt-drag) orbits about what is
chosen and `F` frames it; a 2D scene has the same handles in its plane.

- **Nodes** on the left are the tree: an **instance** places a file of
  the project, a **scene** places another scene whole, a **group** is a
  frame for its children. Children ride their parents. In a 2D scene
  the list is paint order; raise and lower move a node among its
  siblings.
- **Place** with **+ instance** (a file of the project of the scene's
  space, under the chosen node or at the root) or **+ group**. Click an
  instance on the canvas to choose its node; **drag** it to move it,
  arrows nudge; its fields are on the right: where it sits, its turn
  and size, mirror, what it **shows** (a state, or a clip at a time), a
  **palette** laid over it, and **hangs from**: a socket of the parent's
  art, by one of its own anchors, positions and directions matched, so a
  lantern hangs from a swinging hook.
- The scene's own **palettes** lay over every instance, in order: one
  night palette darkens the camp.
- **Play** runs every clip in the scene from its `t`. A 3D scene has a
  view like the model screen: pick one, or drag on nothing to orbit.
- The file on disk is the scene, as ever: edits land at once, ⌘S is the
  checkpoint. `npx fart validate camp.shart` checks a scene with its
  files in hand, `npx fart flatten camp.shart` lists what a renderer
  would draw, and the loaders' `flattenScene` / `flatten_scene` give a
  game the same list.

## Updates

The app looks at GitHub a moment after it starts, and every few hours,
for a newer Uranus. When there is one a small window appears top right:
**Update** downloads the release for this machine, replaces the app in
place and offers a **Restart**; **×** puts it away for now. **Help ›
Check for Updates…** (or the command palette) asks at once. A release
whose build for this machine is still on its way offers the release
page instead. On macOS the new app is not quarantined, since you asked
for it here. In a browser (Serve) there is nothing to update.

## Files a tool refused

A file that is not JSON, carries a version the studio does not know, or
breaks the schema will not open; a notice says why. A file with softer
trouble — a token nothing supplies, a state naming a part that is gone —
opens anyway, renders the trouble in loud magenta, and counts it at the
right of the content header (click the count for the list) so you can
fix it. The format spec (in the docs) has the full list
of what is checked, and `fart validate` checks a whole folder from the
command line.
