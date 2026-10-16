package fastart

// 1.3: 3D documents (space: "3d"). The same words with a third
// coordinate: parts with pivots and parents, mesh/ball/rod shapes that
// each paint one token, states and clips that pose them with [x, y, z]
// turns. load_bytes refuses these (a 2D reader cannot draw them);
// load_bytes_3d loads them. Rendering is the game's: for each part in a
// pose, world_xf_3d, then the mesh's tris (index triples into points)
// in color_of_3d(token), times the shape's shade.
//
// 1.8: a mesh or a sweep may paint its faces in several tokens (`colors`,
// `paint`), darken point by point (`shades`), carry modifiers (`mods`:
// mirror, solidify, crease) and be a `pipe`. None of it changes the
// calls: flatten_part still gives one Tri_Mesh per shape, now with
// `tokens` (one per triangle, when the shape is painted) and `shades`
// (one per vertex, when it is shaded) beside the one `color` and `shade`.
// gen.odin makes the meshes (as_mesh); sidecar.odin reads them ready-made
// from a compiled sidecar (`name.fart.glb`) when a build left a fresh one.

import "core:encoding/json"
import "core:math"
import "core:math/linalg"

V3 :: [3]f32

// 1.9: a mesh that gives at its joints. `joints` names parts (of the document; of the host it is drawn on, with
// `host`); `weights` has, for each point, pairs of [index into joints, weight], one to four of them.
Skin3 :: struct {
	host:    bool,
	joints:  [dynamic]string,
	weights: [dynamic][dynamic]f32,
}

Shape3 :: struct {
	kind:   string, // "mesh" | "ball" | "rod"; in collision (1.4) also "box"
	color:  string,
	shade:  f32, // 0 = 1 (absent): multiplies r, g, b
	at:     V3, // ball; box centre
	r:      f32,
	a:      V3, // rod
	b:      V3,
	w:      f32,
	points: [dynamic]V3, // mesh
	faces:  [dynamic][dynamic]u16, // index loops, wound outward
	tris:   [dynamic]u16, // baked triangulation
	size:   V3, // 1.4, box: the full extents
	rotate: V3, // 1.4, box: a pose's turn about at
	part:   string, // 1.4, collision: the part it rides ("" = document space, at rest)
	layer:  string, // 1.4, collision: an engine's tag; "" reads as "solid"
	texture: string, // 1.5: a texture of the document, tiled over the shape; "" for none
	mapping: Mapping3, // 1.5
	normals:  string, // 1.7: "" or "flat" (one normal per face), "smooth" (averaged up to sharp edges; the default once smooth > 0)
	angle:    f32, // 1.7: degrees; faces meeting at more than this keep their own normals (0 = no limit)
	smooth:   int, // 1.7: Catmull-Clark levels; the cage stays the file
	creases:  [dynamic][dynamic]f32, // 1.7: [a, b, c] an edge's crease in 0..1, [a, c] a corner
	bake:     Mesh_Bake, // 1.7: the subdivided or generated surface, when a tool wrote one
	op:       string, // 1.7, sweep: "lathe" | "extrude" (1.8: "pipe"; 1.11: "rail")
	axis:     string, // 1.7, sweep: "x" | "y" | "z"
	profile:  Profile, // 1.7, sweep
	segments: int, // 1.7, sweep (lathe): steps around the axis, 12 when 0
	from:     f32, // 1.7, sweep (extrude)
	to:       f32,
	colors:   [dynamic]string, // 1.8: further tokens the faces may wear
	paint:    [dynamic]int, // 1.8: one per face (a sweep's: of the mesh it generates): 0 is `color`, n is colors[n - 1]
	shades:   [dynamic]f32, // 1.8, mesh: one per point, multiplying `shade` there
	skin:     Skin3, // 1.9, mesh: the parts its points follow, and by how much
	mods:     [dynamic]Mod, // 1.8: applied to the cage in order, after a morph and before `smooth`
	path:     Path3, // 1.8, sweep (pipe): the spine
	radius:   Maybe(f32), // 1.8, pipe: the section's scale; 1 when absent
	radii:    [dynamic]f32, // 1.8, pipe: one factor per path point, linear between
	caps:     Maybe(bool), // 1.8, pipe: close the ends of an open pipe; true when absent
	closed:   bool, // 1.8, pipe: the path joins its last point to its first (1.11: a rail's too)
	round:    f32, // 1.11, rail: the radius its path's corners are rounded to; 0 leaves them sharp
	rest:     []V3 `json:"-"`, // 1.8: under a morph, the rest cage the mods decide on (flatten_part_posed sets it)
}

// 1.7: a subdivided (or generated) surface a tool baked; `of` hashes the cage it came from.
Mesh_Bake :: struct {
	points: [dynamic]V3,
	faces:  [dynamic][dynamic]u16,
	tris:   [dynamic]u16,
	of:     string,
	uvs:    [dynamic][dynamic]V2, // the cage's explicit pattern coordinates on the surface: one list per face of the bake
	uv_of:  string `json:"uvOf"`, // a hash of the cage's own
	paint:  [dynamic]int, // 1.8: one per face of the bake; a reader drawing the bake uses these, never the cage's
	shades: [dynamic]f32, // 1.8: one per point of the bake
}

// 1.7: a sweep's profile, a path body: [radius, along] for a lathe, an outline for an extrude.
Profile :: struct {
	points: [dynamic]V2,
	in_:    [dynamic]V2 `json:"in"`,
	out:    [dynamic]V2,
	closed: bool,
}

// 1.5: a 3D shape's mapping: world units per pattern unit (0 = 1), or explicit pattern coordinates per face corner.
Mapping3 :: struct {
	scale: f32,
	uvs:   [dynamic][dynamic]V2,
}

// 1.5: one map of a texture: a drawing (a 2D .fart, by relative path), tiled.
Texture_Map :: struct {
	ref:     string,
	palette: string, // a palette file laid over the drawing's tokens; "" for none
	state:   string, // which of the drawing's states; "" for its first
	mode:    string, // "paint" (default) | "mask"
	soften:  f32, // 1.10: a blur over the map, a Gaussian's deviation in pattern units, wrapping at the cell; 0 for none
}

Texture :: struct {
	name: string,
	cell: V2, // the tile, from [0, 0] in the maps' document space
	maps: map[string]Texture_Map, // "color" is what a reader paints; the rest are the engine's
	relief: f32, // 1.10: how far the height map's value 1 stands proud of 0, in pattern units; 0 for none
}

Anchor3 :: struct {
	name: string,
	at:   V3,
	dir:  V3, // the direction an attached thing points; zero when absent
}

Part3 :: struct {
	name:    string,
	parent:  string,
	like:    string,
	pivot:   V3,
	shapes:  [dynamic]Shape3,
	anchors: [dynamic]Anchor3,
}

State_Part3 :: struct {
	part:   string,
	offset: V3,
	rotate: V3, // radians about x, then y, then z
	scale:  f32, // 0 = 1
	mirror: bool,
	morph:  [dynamic]Morph3, // 1.6: meshes of the part reshaped in this pose
}

// 1.6: a mesh's points as they are in one pose; the count matches the base.
Morph3 :: struct {
	shape:  int,
	points: [dynamic]V3,
}

// The points a mesh has under a pose entry: its morph's, else the base's.
shape_points_3d :: proc(doc: ^Doc3, part: ^Part3, sp: ^State_Part3, shape: int) -> []V3 {
	shapes := shapes_of_3d(doc, part)
	if shape < 0 || shape >= len(shapes) do return nil
	base := shapes[shape].points[:]
	if sp == nil || part.like != "" do return base
	for &m in sp.morph do if m.shape == shape && len(m.points) == len(base) do return m.points[:]
	return base
}

// Does this entry reshape the part? (A morph on a `like` part does nothing.)
morphs_3d :: proc(doc: ^Doc3, sp: ^State_Part3) -> bool {
	if sp == nil || len(sp.morph) == 0 do return false
	part := part_of_3d(doc, sp.part)
	return part != nil && part.like == ""
}

@(private)
mix_morphs_3d :: proc(doc: ^Doc3, part_name: string, a, b: []Morph3, u: f32) -> [dynamic]Morph3 {
	if len(a) == 0 && len(b) == 0 do return nil
	part := part_of_3d(doc, part_name)
	if part == nil || part.like != "" do return nil
	shapes := shapes_of_3d(doc, part)
	out: [dynamic]Morph3
	for si in 0 ..< len(shapes) {
		if shapes[si].kind != "mesh" do continue
		base := shapes[si].points[:]
		pa, pb := base, base
		got := false
		for &m in a do if m.shape == si && len(m.points) == len(base) {
			pa = m.points[:]
			got = true
		}
		for &m in b do if m.shape == si && len(m.points) == len(base) {
			pb = m.points[:]
			got = true
		}
		if !got do continue
		pts := make([dynamic]V3, len(base))
		for i in 0 ..< len(base) do pts[i] = pa[i] + (pb[i] - pa[i]) * u
		append(&out, Morph3{shape = si, points = pts})
	}
	return out
}

// Where a chain should reach in a pose, document space.
Target3 :: struct {
	chain: string,
	at:    V3,
}

State3 :: struct {
	name:    string,
	parts:   [dynamic]State_Part3,
	targets: [dynamic]Target3,
}

Clip_Key3 :: struct {
	t:       f32,
	state:   string,
	parts:   [dynamic]State_Part3,
	ease:    string,
	curve:   [dynamic]f32,
	targets: [dynamic]Target3,
	events:  [dynamic]string,
}

// A chain in 3D: the 2D Constraint's fields, with a pole instead of a bend.
Constraint3 :: struct {
	name:  string,
	chain: [dynamic]string,
	end:   string, // "part/anchor"
	pole:  V3, // the point the first elbow leans toward; zero when absent
	has_pole: bool `json:"-"`,
}

Clip3 :: struct {
	name: string,
	loop: bool,
	keys: [dynamic]Clip_Key3,
}

Doc3 :: struct {
	version:      int,
	space:        string,
	name:         string,
	palette_refs: [dynamic]string,
	palette:      [dynamic]Tok,
	parts:        [dynamic]Part3,
	states:       [dynamic]State3,
	clips:        [dynamic]Clip3,
	constraints:  [dynamic]Constraint3,
	collision:    [dynamic]Shape3,
	textures:     [dynamic]Texture, // 1.5
	resolved:     [dynamic]Tok `json:"-"`,
	// 1.5: filled by resolve_textures_3d; the maps' drawings, by texture name then map name
	texture_docs: map[string]map[string]Map_Doc `json:"-"`,
}

// 1.5: a map's drawing, read and ready to draw: the 2D document, the pose to draw, its tokens resolved (the map's palette laid over).
Map_Doc :: struct {
	tmap:  Texture_Map,
	doc:   Doc,
	state: string, // the state to draw, or "" for every part
}

// Does the document say space: "3d"? (Cheap: the raw tree, no unmarshal.)
is_3d :: proc(data: []byte) -> bool {
	tree, terr := json.parse(data, allocator = context.temp_allocator)
	if terr != nil do return false
	root, is_obj := tree.(json.Object)
	if !is_obj do return false
	return space_of(root) == "3d"
}

@(private)
space_of :: proc(root: json.Object) -> string {
	if s, ok := root["space"].(json.String); ok do return s
	return "2d"
}

load_bytes_3d :: proc(data: []byte) -> (doc: Doc3, ok: bool) {
	tree, terr := json.parse(data, allocator = context.temp_allocator)
	if terr != nil do return {}, false
	root, is_obj := tree.(json.Object)
	if !is_obj || !version_ok(root["version"]) || space_of(root) != "3d" do return {}, false
	if json.unmarshal(data, &doc) != nil do return {}, false
	// an absent offset means the pivot lands on itself
	fill :: proc(doc: ^Doc3, raw: json.Array, parts: []State_Part3) {
		for sp_v, j in raw {
			if j >= len(parts) do break
			sp := sp_v.(json.Object) or_continue
			if "offset" in sp do continue
			if part := part_of_3d(doc, parts[j].part); part != nil do parts[j].offset = part.pivot
		}
	}
	states := root["states"].(json.Array) or_else nil
	for st_v, i in states {
		if i >= len(doc.states) do break
		st := st_v.(json.Object) or_continue
		parts := st["parts"].(json.Array) or_continue
		fill(&doc, parts, doc.states[i].parts[:])
	}
	clips := root["clips"].(json.Array) or_else nil
	for c_v, i in clips {
		if i >= len(doc.clips) do break
		c := c_v.(json.Object) or_continue
		keys := c["keys"].(json.Array) or_continue
		for k_v, j in keys {
			if j >= len(doc.clips[i].keys) do break
			k := k_v.(json.Object) or_continue
			parts := k["parts"].(json.Array) or_continue
			fill(&doc, parts, doc.clips[i].keys[j].parts[:])
		}
	}
	cons := root["constraints"].(json.Array) or_else nil
	for c_v, i in cons {
		if i >= len(doc.constraints) do break
		c := c_v.(json.Object) or_continue
		doc.constraints[i].has_pole = "pole" in c
	}
	return doc, true
}

// Read every texture's maps through the resolver (paths as written, relative
// to this document): the drawing, its own palette refs (relative to the
// drawing), then the map's palette laid over as a swap. A ref that fails is
// left out; the game draws the token flat.
resolve_textures_3d :: proc(doc: ^Doc3, resolver: Resolver, user: rawptr) {
	for &t in doc.textures {
		by_map := make(map[string]Map_Doc)
		for name, m in t.maps {
			data, ok := resolver(m.ref, user)
			if !ok do continue
			d, dok := load_bytes(data)
			if !dok do continue
			resolve_palettes(&d, resolver, user)
			if m.palette != "" {
				if pdata, pok := resolver(m.palette, user); pok {
					if pal, ppok := load_bytes(pdata); ppok do apply_palette(&d, pal.palette[:])
				}
			}
			st := m.state
			if st == "" && len(d.states) > 0 do st = d.states[0].name
			by_map[name] = Map_Doc{tmap = m, doc = d, state = st}
		}
		doc.texture_docs[t.name] = by_map
	}
}

texture_of_3d :: proc(doc: ^Doc3, name: string) -> ^Texture {
	for &t in doc.textures do if t.name == name do return &t
	return nil
}

// 1.5: box mapping: a face's pattern coordinates from the two axes across its dominant normal, world units over scale.
box_uv :: proc(p: V3, n: V3, scale: f32) -> V2 {
	s := scale == 0 ? f32(1) : scale
	ax, ay, az := abs(n.x), abs(n.y), abs(n.z)
	if ax >= ay && ax >= az do return {p.z / s, p.y / s}
	if ay >= az do return {p.x / s, p.z / s}
	return {p.x / s, p.y / s}
}

destroy_3d :: proc(doc: ^Doc3) {
	free_shapes :: proc(shapes: ^[dynamic]Shape3) {
		for &s in shapes {
			delete(s.points)
			for &f in s.faces do delete(f)
			delete(s.faces)
			delete(s.tris)
			delete(s.colors)
			delete(s.paint)
			delete(s.shades)
			delete(s.skin.joints)
			for &w in s.skin.weights do delete(w)
			delete(s.skin.weights)
			delete(s.mods)
			delete(s.radii)
			delete(s.path.points)
			delete(s.path.in_)
			delete(s.path.out)
		}
		delete(shapes^)
	}
	for &p in doc.parts {
		free_shapes(&p.shapes)
		delete(p.anchors)
	}
	delete(doc.parts)
	free_shapes(&doc.collision)
	for &st in doc.states {
		delete(st.parts)
		delete(st.targets)
	}
	delete(doc.states)
	for &c in doc.clips {
		for &k in c.keys {
			delete(k.parts)
			delete(k.curve)
			delete(k.targets)
			delete(k.events)
		}
		delete(c.keys)
	}
	delete(doc.clips)
	for &c in doc.constraints do delete(c.chain)
	delete(doc.constraints)
	delete(doc.palette)
	delete(doc.palette_refs)
	delete(doc.resolved)
}

// ------------------------------------------------------------ palette, the same rules as 2D

resolve_palettes_3d :: proc(doc: ^Doc3, resolver: Resolver, user: rawptr) {
	clear(&doc.resolved)
	for ref in doc.palette_refs {
		if data, ok := resolver(ref, user); ok {
			if pal, pok := load_bytes(data); pok {
				for t in pal.palette do append(&doc.resolved, t)
			}
		}
	}
	for t in doc.palette do append(&doc.resolved, t)
}

apply_palette_3d :: proc(doc: ^Doc3, palette: []Tok) {
	if len(doc.resolved) == 0 {
		for t in doc.palette do append(&doc.resolved, t)
	}
	for p in palette {
		hit := false
		for i := len(doc.resolved) - 1; i >= 0; i -= 1 {
			if doc.resolved[i].name == p.name {
				doc.resolved[i].rgb = p.rgb
				hit = true
				break
			}
		}
		if !hit do append(&doc.resolved, p)
	}
}

color_of_3d :: proc(doc: ^Doc3, token: string) -> [4]u8 {
	if len(doc.resolved) > 0 {
		for i := len(doc.resolved) - 1; i >= 0; i -= 1 {
			if doc.resolved[i].name == token do return doc.resolved[i].rgb
		}
	}
	for i := len(doc.palette) - 1; i >= 0; i -= 1 {
		if doc.palette[i].name == token do return doc.palette[i].rgb
	}
	return {255, 0, 255, 255}
}

// 1.3: a shape's shade laid on a colour: r, g, b multiplied and clamped, alpha kept. 0 means 1.
shade_color :: proc(rgb: [4]u8, shade: f32) -> [4]u8 {
	if shade == 0 || shade == 1 do return rgb
	k := max(shade, 0)
	c := #force_inline proc(v: u8, k: f32) -> u8 {return u8(min(255, math.round(f32(v) * k)))}
	return {c(rgb[0], k), c(rgb[1], k), c(rgb[2], k), rgb[3]}
}

// ------------------------------------------------------------ lookups

part_of_3d :: proc(doc: ^Doc3, name: string) -> ^Part3 {
	for &p in doc.parts do if p.name == name do return &p
	return nil
}

source_of_3d :: proc(doc: ^Doc3, part: ^Part3) -> ^Part3 {
	if part.like != "" {
		if src := part_of_3d(doc, part.like); src != nil && src != part && src.like == "" do return src
	}
	return part
}

shapes_of_3d :: proc(doc: ^Doc3, part: ^Part3) -> []Shape3 {
	return source_of_3d(doc, part).shapes[:]
}

anchors_of_3d :: proc(doc: ^Doc3, part: ^Part3) -> []Anchor3 {
	return source_of_3d(doc, part).anchors[:]
}

state_of_3d :: proc(doc: ^Doc3, name: string) -> ^State3 {
	for &s in doc.states do if s.name == name do return &s
	return nil
}

clip_of_3d :: proc(doc: ^Doc3, name: string) -> ^Clip3 {
	for &c in doc.clips do if c.name == name do return &c
	return nil
}

// ------------------------------------------------------------ turns and maps
// A turn is [x, y, z]: about x, then y, then z, each right-handed.
// q = qz · qy · qx; between keys, slerp the short way round.

Xf3 :: matrix[4, 4]f32
XF3_ID :: Xf3(1)

quat_from_euler :: proc(e: V3) -> quaternion128 {
	qx := linalg.quaternion_angle_axis_f32(e.x, {1, 0, 0})
	qy := linalg.quaternion_angle_axis_f32(e.y, {0, 1, 0})
	qz := linalg.quaternion_angle_axis_f32(e.z, {0, 0, 1})
	return qz * qy * qx
}

// Back to the file's [x, y, z]; gimbal lock puts the whole turn on z.
euler_from_quat :: proc(q: quaternion128) -> V3 {
	m := linalg.matrix3_from_quaternion_f32(q)
	sy := -m[2, 0]
	if abs(sy) > 1 - 1e-6 {
		return {0, math.asin(clamp(sy, -1, 1)), math.atan2(-m[0, 1], m[1, 1])}
	}
	return {math.atan2(m[2, 1], m[2, 2]), math.asin(sy), math.atan2(m[1, 0], m[0, 0])}
}

lerp_euler :: proc(a, b: V3, u: f32) -> V3 {
	return euler_from_quat(linalg.quaternion_slerp_f32(quat_from_euler(a), quat_from_euler(b), u))
}

xf3_apply :: proc(T: Xf3, p: V3) -> V3 {
	v := T * [4]f32{p.x, p.y, p.z, 1}
	return {v.x, v.y, v.z}
}

xf3_apply_dir :: proc(T: Xf3, d: V3) -> V3 {
	v := T * [4]f32{d.x, d.y, d.z, 0}
	return {v.x, v.y, v.z}
}

// translate(offset) · Rz · Ry · Rx · scale · mirror · translate(-pivot). A nil pose is rest.
local_xf_3d :: proc(part: ^Part3, sp: ^State_Part3) -> Xf3 {
	if sp == nil do return XF3_ID
	s := sp.scale == 0 ? f32(1) : sp.scale
	R := linalg.matrix4_from_quaternion_f32(quat_from_euler(sp.rotate))
	S := linalg.matrix4_scale_f32({sp.mirror ? -s : s, s, s})
	T0 := linalg.matrix4_translate_f32(-part.pivot)
	T1 := linalg.matrix4_translate_f32(sp.offset)
	return T1 * R * S * T0
}

// The world map of one part under a pose list: W = W(parent) · L.
world_xf_3d :: proc(doc: ^Doc3, poses: []State_Part3, name: string, depth := 0) -> Xf3 {
	part := part_of_3d(doc, name)
	if part == nil || depth > 64 do return XF3_ID
	sp: ^State_Part3
	for &p in poses do if p.part == name {
		sp = &p
		break
	}
	local := local_xf_3d(part, sp)
	if part.parent == "" do return local
	return world_xf_3d(doc, poses, part.parent, depth + 1) * local
}

// The transform that puts an item's anchor onto a host's: positions
// matched, and where both have a dir, the shortest turn taking the
// item's onto the host's. Draw the item's rest space through it.
attach_xf_3d :: proc(host_xf: Xf3, host, item: ^Anchor3) -> Xf3 {
	R := XF3_ID
	if host.dir != {} && item.dir != {} {
		a := linalg.normalize(item.dir)
		b := linalg.normalize(host.dir)
		axis := linalg.cross(a, b)
		d := clamp(linalg.dot(a, b), -1, 1)
		if linalg.length(axis) > 1e-6 {
			R = linalg.matrix4_from_quaternion_f32(linalg.quaternion_angle_axis_f32(math.acos(d), linalg.normalize(axis)))
		} else if d < 0 {
			perp := abs(a.x) < 0.9 ? linalg.cross(a, V3{1, 0, 0}) : linalg.cross(a, V3{0, 1, 0})
			R = linalg.matrix4_from_quaternion_f32(linalg.quaternion_angle_axis_f32(math.PI, linalg.normalize(perp)))
		}
	}
	moved := xf3_apply_dir(R, item.at)
	return host_xf * linalg.matrix4_translate_f32(host.at - moved) * R
}

// ------------------------------------------------------------ clips

clip_duration_3d :: proc(c: ^Clip3) -> f32 {
	return len(c.keys) > 0 ? c.keys[len(c.keys) - 1].t : 0
}

key_poses_3d :: proc(doc: ^Doc3, k: ^Clip_Key3) -> []State_Part3 {
	if len(k.parts) > 0 || k.state == "" do return k.parts[:]
	if st := state_of_3d(doc, k.state); st != nil do return st.parts[:]
	return nil
}

@(private)
ease_key_3d :: proc(u: f32, k: ^Clip_Key3) -> f32 {
	if len(k.curve) == 4 do return bezier({k.curve[0], k.curve[1], k.curve[2], k.curve[3]}, clamp(u, 0, 1))
	return ease(u, k.ease)
}

@(private)
// Morphs (1.6) mix too; their points are allocated with the context allocator (a game's frame arena).
mix_pose_3d :: proc(doc: ^Doc3, a, b: ^State_Part3, u: f32, mirror: bool) -> State_Part3 {
	sa := a.scale == 0 ? f32(1) : a.scale
	sb := b.scale == 0 ? f32(1) : b.scale
	return {
		part   = a.part,
		offset = a.offset + (b.offset - a.offset) * u,
		rotate = lerp_euler(a.rotate, b.rotate, u),
		scale  = sa + (sb - sa) * u,
		mirror = mirror,
		morph  = mix_morphs_3d(doc, a.part, a.morph[:], b.morph[:], u),
	}
}

// The frame at time t, into `out` (cleared first): membership and order
// from the outgoing key, poses tweened toward the incoming one.
sample_clip_3d :: proc(doc: ^Doc3, c: ^Clip3, t: f32, out: ^[dynamic]State_Part3) {
	clear(out)
	n := len(c.keys)
	if n == 0 do return
	dur := clip_duration_3d(c)
	time := t
	if c.loop && dur > 0 do time = math.mod(math.mod(t, dur) + dur, dur)
	if time <= c.keys[0].t {
		append(out, ..key_poses_3d(doc, &c.keys[0]))
		return
	}
	if time >= c.keys[n - 1].t {
		append(out, ..key_poses_3d(doc, &c.keys[n - 1]))
		return
	}
	i := 0
	for i + 1 < n && c.keys[i + 1].t <= time do i += 1
	A, B := &c.keys[i], &c.keys[i + 1]
	span := B.t - A.t
	u := ease_key_3d(span > 0 ? (time - A.t) / span : 1, B)
	to := key_poses_3d(doc, B)
	for &a in key_poses_3d(doc, A) {
		b: ^State_Part3
		for &q in to do if q.part == a.part {
			b = &q
			break
		}
		if b == nil {
			append(out, a)
			continue
		}
		append(out, mix_pose_3d(doc, &a, b, u, a.mirror))
	}
}

// Two poses at once; membership and order from the heavier side.
blend_poses_3d :: proc(doc: ^Doc3, a, b: []State_Part3, w: f32, out: ^[dynamic]State_Part3) {
	clear(out)
	u := clamp(w, 0, 1)
	lead, other := a, b
	if u >= 0.5 do lead, other = b, a
	for &sp in lead {
		o: ^State_Part3
		for &q in other do if q.part == sp.part {
			o = &q
			break
		}
		if o == nil {
			append(out, sp)
			continue
		}
		if u < 0.5 do append(out, mix_pose_3d(doc, &sp, o, u, sp.mirror))
		else do append(out, mix_pose_3d(doc, o, &sp, u, sp.mirror))
	}
}

// A layer over a base: the layer's parts tween toward it by w.
layer_poses_3d :: proc(doc: ^Doc3, base, over: []State_Part3, w: f32, out: ^[dynamic]State_Part3) {
	clear(out)
	u := clamp(w, 0, 1)
	for &sp in base {
		o: ^State_Part3
		for &q in over do if q.part == sp.part {
			o = &q
			break
		}
		if o == nil do append(out, sp)
		else do append(out, mix_pose_3d(doc, &sp, o, u, u < 0.5 ? sp.mirror : o.mirror))
	}
	if u >= 0.5 {
		for &q in over {
			have := false
			for &sp in base do if sp.part == q.part {
				have = true
				break
			}
			if !have do append(out, q)
		}
	}
}

// The events crossed from t0 to t1; the same rule as 2D.
clip_events_3d :: proc(c: ^Clip3, t0, t1: f32, out: ^[dynamic]string) {
	dur := clip_duration_3d(c)
	if len(c.keys) == 0 do return
	fire :: proc(c: ^Clip3, lo, hi: f32, wrap_end: bool, out: ^[dynamic]string) {
		for &k in c.keys {
			if len(k.events) == 0 do continue
			if k.t > lo && (wrap_end ? k.t < hi : k.t <= hi) do append(out, ..k.events[:])
		}
	}
	if !c.loop || dur <= 0 {
		fire(c, t0, t1, false, out)
		return
	}
	if t1 - t0 >= dur {
		fire(c, -1e30, dur, true, out)
		return
	}
	a := math.mod(math.mod(t0, dur) + dur, dur)
	b := math.mod(math.mod(t1, dur) + dur, dur)
	if b >= a {
		fire(c, a, b, false, out)
	} else {
		fire(c, a, dur, true, out)
		fire(c, -1, b, false, out)
	}
}

// ------------------------------------------------------------ meshes

// A face's outward normal, unnormalised (Newell's method).
face_normal :: proc(points: []V3, face: []u16) -> V3 {
	n: V3
	if len(face) < 3 do return n
	for i in 0 ..< len(face) {
		a := points[face[i]]
		b := points[face[(i + 1) % len(face)]]
		n.x += (a.y - b.y) * (a.z + b.z)
		n.y += (a.z - b.z) * (a.x + b.x)
		n.z += (a.x - b.x) * (a.y + b.y)
	}
	return n
}

// Triangles for a mesh with no baked tris: every face fanned from its
// first point (right for convex faces; editors bake concave ones).
fan_faces :: proc(sh: ^Shape3) {
	clear(&sh.tris)
	for f in sh.faces {
		for i in 1 ..< len(f) - 1 do append(&sh.tris, f[0], f[i], f[i + 1])
	}
}

// ------------------------------------------------------------ what a renderer uploads
// Flat triangles with one normal per face, per shape: positions and
// normals in the part's rest space, plus the token and shade to paint
// them. Upload once, draw through world_xf_3d every frame.

Tri_Mesh :: struct {
	color:     string,
	shade:     f32, // 0 = 1
	positions: [dynamic]V3, // three per triangle
	normals:   [dynamic]V3, // the face's, per vertex
	texture:   string, // 1.5: "" for none
	uvs:       [dynamic]V2, // 1.5: pattern coordinates per vertex, in the map drawings' units (divide by the cell for 0..1)
	tokens:    [dynamic]string, // 1.8: the token each triangle paints, one per triangle, when the shape is painted; empty, every triangle is `color`
	shades:    [dynamic]f32, // 1.8: the shade at each vertex, when the shape has `shades` (or came from a sidecar); it multiplies `shade`
}

// The token triangle `t` of a flattened shape paints: its own under paint (1.8), else the shape's.
tri_token :: proc(tm: ^Tri_Mesh, t: int) -> string {
	return t >= 0 && t < len(tm.tokens) ? tm.tokens[t] : tm.color
}

// The shade at vertex `v` of a flattened shape: the shape's `shade` times the point's own (1.8).
vertex_shade :: proc(tm: ^Tri_Mesh, v: int) -> f32 {
	s := tm.shade == 0 ? f32(1) : tm.shade
	return v >= 0 && v < len(tm.shades) ? s * tm.shades[v] : s
}

// One face's triangles by ear clipping in the face's own plane, as index triples.
triangulate_face :: proc(points: []V3, face: []u16, out: ^[dynamic]u16) {
	if len(face) < 3 do return
	if len(face) == 3 {
		append(out, face[0], face[1], face[2])
		return
	}
	n := face_normal(points, face)
	ax, ay, az := abs(n.x), abs(n.y), abs(n.z)
	flat := make([dynamic]V2, 0, len(face), context.temp_allocator)
	for i in face {
		p := points[i]
		if ax >= ay && ax >= az do append(&flat, n.x > 0 ? V2{p.y, p.z} : V2{p.z, p.y})
		else if ay >= az do append(&flat, n.y > 0 ? V2{p.z, p.x} : V2{p.x, p.z})
		else do append(&flat, n.z > 0 ? V2{p.x, p.y} : V2{p.y, p.x})
	}
	tris := make([dynamic]u16, context.temp_allocator)
	triangulate(flat[:], &tris)
	if len(tris) == 0 {
		for i in 1 ..< len(face) - 1 do append(out, face[0], face[i], face[i + 1])
		return
	}
	for i in tris do append(out, face[i])
}

// Bake tris into every mesh, the way an editor does on save.
bake_tris_3d :: proc(doc: ^Doc3) {
	bake :: proc(shapes: []Shape3) {
		for &sh in shapes {
			if sh.kind != "mesh" do continue
			clear(&sh.tris)
			for f in sh.faces do triangulate_face(sh.points[:], f[:], &sh.tris)
		}
	}
	for &p in doc.parts do bake(p.shapes[:])
	bake(doc.collision[:])
}

@(private)
push_tri :: proc(out: ^Tri_Mesh, a, b, c: V3, outward: V3, oriented: bool, scale: f32 = 1) {
	n := linalg.cross(b - a, c - a)
	if oriented {
		mid := (a + b + c) / 3
		if linalg.dot(n, mid - outward) < 0 do n = -n
	}
	nn := linalg.normalize0(n)
	append(&out.positions, a, b, c)
	append(&out.normals, nn, nn, nn)
	if out.texture != "" do append(&out.uvs, box_uv(a, nn, scale), box_uv(b, nn, scale), box_uv(c, nn, scale))
}

// One shape, flattened: a mesh through its tris (baked or fanned), a
// ball as a sphere of `rings` × `segments`, a rod as a `sides` cylinder.
flatten_shape :: proc(sh: ^Shape3, out: ^Tri_Mesh, rings := 7, segments := 12, sides := 10) {
	out.color = sh.color
	out.shade = sh.shade
	out.texture = sh.texture
	scale := sh.mapping.scale
	switch sh.kind {
	case "sweep", "mesh":
		if generated(sh) {
			// 1.7, 1.8: the cage generated, its mods applied, subdivided (or the bake a tool wrote), then on as a plain mesh
			m := as_mesh(sh, context.temp_allocator)
			if !generated(&m) do flatten_shape(&m, out, rings, segments, sides)
			return
		}
		for f in sh.faces do for i in f do if int(i) >= len(sh.points) do return // a face that names no point: nothing to draw
		// paint (1.8): a token per triangle, from its face; a paint the reader cannot use leaves the shape in `color`
		painted := false
		if paint_fits(sh.paint[:], len(sh.faces), len(sh.colors)) do for p in sh.paint do if p > 0 do painted = true
		shaded := len(sh.shades) == len(sh.points) && len(sh.points) > 0
		// explicit uvs (1.5) and paint need the face each triangle came from: triangulate per face then
		explicit := sh.texture != "" && len(sh.mapping.uvs) == len(sh.faces)
		tris := sh.tris[:]
		ok := len(tris) % 3 == 0 && len(tris) > 0 && !painted && !explicit
		for i in tris do if int(i) >= len(sh.points) do ok = false
		face_of: [dynamic]int
		if !ok {
			fresh := make([dynamic]u16, context.temp_allocator)
			face_of = make([dynamic]int, context.temp_allocator)
			for f, fi in sh.faces {
				triangulate_face(sh.points[:], f[:], &fresh)
				for len(face_of) * 3 < len(fresh) do append(&face_of, fi)
			}
			tris = fresh[:]
		}
		uv_of :: proc(f: [dynamic]u16, uvs: [dynamic]V2, idx: u16) -> V2 {
			for k, ci in f do if k == idx && ci < len(uvs) do return uvs[ci]
			return {}
		}
		for i := 0; i + 2 < len(tris); i += 3 {
			a, b, c := sh.points[tris[i]], sh.points[tris[i + 1]], sh.points[tris[i + 2]]
			nn := linalg.normalize0(linalg.cross(b - a, c - a))
			append(&out.positions, a, b, c)
			append(&out.normals, nn, nn, nn)
			if explicit {
				fi := face_of[i / 3]
				f, uvs := sh.faces[fi], sh.mapping.uvs[fi]
				append(&out.uvs, uv_of(f, uvs, tris[i]), uv_of(f, uvs, tris[i + 1]), uv_of(f, uvs, tris[i + 2]))
			} else if out.texture != "" {
				append(&out.uvs, box_uv(a, nn, scale), box_uv(b, nn, scale), box_uv(c, nn, scale))
			}
			if painted {
				p := sh.paint[face_of[i / 3]]
				append(&out.tokens, p > 0 ? sh.colors[p - 1] : sh.color)
			}
			if shaded do append(&out.shades, sh.shades[tris[i]], sh.shades[tris[i + 1]], sh.shades[tris[i + 2]])
		}
		if smooth_normals(sh) do smooth_tri_normals(sh, out)
	case "ball":
		pt :: proc(c: V3, r: f32, ph, th: f32) -> V3 {
			return c + V3{math.sin(ph) * math.cos(th), -math.cos(ph), math.sin(ph) * math.sin(th)} * r
		}
		for i in 0 ..< rings {
			ph0 := f32(i) / f32(rings) * math.PI
			ph1 := f32(i + 1) / f32(rings) * math.PI
			for j in 0 ..< segments {
				th0 := f32(j) / f32(segments) * math.TAU
				th1 := f32(j + 1) / f32(segments) * math.TAU
				a, b := pt(sh.at, sh.r, ph0, th0), pt(sh.at, sh.r, ph0, th1)
				c, d := pt(sh.at, sh.r, ph1, th0), pt(sh.at, sh.r, ph1, th1)
				if i > 0 do push_tri(out, a, c, b, sh.at, true, scale)
				if i < rings - 1 do push_tri(out, b, c, d, sh.at, true, scale)
			}
		}
	case "rod":
		d := sh.b - sh.a
		l := linalg.length(d)
		if l < 1e-6 do return
		w := d / l
		seed := abs(w.x) < 0.9 ? V3{1, 0, 0} : V3{0, 1, 0}
		u := linalg.normalize(linalg.cross(w, seed))
		v := linalg.cross(w, u)
		r := sh.w / 2
		ring :: proc(a: V3, u, v: V3, r: f32, j, sides: int) -> V3 {
			th := f32(j) / f32(sides) * math.TAU
			return a + (u * math.cos(th) + v * math.sin(th)) * r
		}
		for j in 0 ..< sides {
			p0 := ring(sh.a, u, v, r, j, sides)
			p1 := ring(sh.a, u, v, r, j + 1, sides)
			q0 := p0 + d
			q1 := p1 + d
			mid := (p0 + p1 + q0 + q1) / 4
			on := sh.a + w * linalg.dot(mid - sh.a, w)
			push_tri(out, p0, p1, q0, on, true, scale)
			push_tri(out, p1, q1, q0, on, true, scale)
			push_tri(out, sh.a, p1, p0, sh.a + w * -1, true, scale) // the near cap faces back along the axis
			push_tri(out, sh.b, q0, q1, sh.b + w, true, scale) // the far cap faces on
		}
	}
}

// Every shape of a part (through `like`), one Tri_Mesh each, appended to `out`.
flatten_part :: proc(doc: ^Doc3, part: ^Part3, out: ^[dynamic]Tri_Mesh) {
	for &sh in shapes_of_3d(doc, part) {
		m: Tri_Mesh
		flatten_shape(&sh, &m)
		append(out, m)
	}
}

// The same under a pose entry (1.6): a mesh the entry morphs is flattened
// with the morph's points (faces, tris and mapping are the base's). Call
// it each frame for the parts morphs_3d says yes to, and re-upload.
flatten_part_posed :: proc(doc: ^Doc3, part: ^Part3, sp: ^State_Part3, out: ^[dynamic]Tri_Mesh) {
	for _, si in shapes_of_3d(doc, part) {
		m: Tri_Mesh
		posed := posed_shape_3d(doc, part, sp, si, context.temp_allocator)
		flatten_shape(&posed, &m)
		append(out, m)
	}
}

// One shape of a part as a pose entry has it (1.6): a mesh the entry
// morphs comes back with the morph's points (a copy), its bake dropped
// (a bake is the rest cage's surface) and the rest cage remembered for
// the mods (1.8: what a mod decides, it decides at rest). Any other
// shape, or a nil entry, is the shape itself. Hand the result to as_mesh
// or flatten_shape.
posed_shape_3d :: proc(doc: ^Doc3, part: ^Part3, sp: ^State_Part3, shape: int, allocator := context.allocator) -> Shape3 {
	shapes := shapes_of_3d(doc, part)
	if shape < 0 || shape >= len(shapes) do return {}
	sh := &shapes[shape]
	pts := shape_points_3d(doc, part, sp, shape)
	if sh.kind != "mesh" || raw_data(pts) == raw_data(sh.points[:]) do return sh^
	posed := sh^
	posed.points = make([dynamic]V3, len(pts), allocator)
	copy(posed.points[:], pts)
	posed.rest = sh.points[:]
	posed.bake = {}
	return posed
}

destroy_tri_meshes :: proc(ms: ^[dynamic]Tri_Mesh) {
	for &m in ms {
		delete(m.positions)
		delete(m.normals)
		delete(m.uvs)
		delete(m.tokens)
		delete(m.shades)
	}
	delete(ms^)
}

// The format is y-down, z-away; most engines are y-up, z-toward-the-viewer
// (both right-handed: the same frame turned half a turn about x). Lay
// Y_UP on a world map (Y_UP * world_xf_3d(...)) and draw in engine space.
Y_UP :: Xf3{1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1}

to_y_up :: proc(p: V3) -> V3 {
	return {p.x, -p.y, -p.z}
}

// ------------------------------------------------------------ collision (1.4)
// The document's solids under a pose, in document space: shapes that
// name a part ride its world map (radius and width scaled with it), the
// rest pass through, boxes expand to meshes. A part drawn like another
// carries the shapes that name its source.

Collider3 :: struct {
	kind:   string, // "ball" | "rod" | "mesh" (a box arrives as a mesh)
	layer:  string, // "solid" when the file said nothing
	part:   string, // the part it rode, "" for none
	at:     V3,
	r:      f32,
	a:      V3,
	b:      V3,
	w:      f32,
	points: [dynamic]V3, // mesh, document space
	faces:  [dynamic][dynamic]u16,
	tris:   [dynamic]u16,
}

// A box as its eight points and six outward faces.
box_mesh_3d :: proc(sh: ^Shape3, points: ^[dynamic]V3, faces: ^[dynamic][dynamic]u16) {
	h := sh.size / 2
	R := linalg.matrix3_from_quaternion_f32(quat_from_euler(sh.rotate))
	signs := [2]f32{-1, 1}
	for dz in signs {
		for dy in signs {
			for dx in signs {
				append(points, sh.at + R * V3{dx * h.x, dy * h.y, dz * h.z})
			}
		}
	}
	quads := [6][4]u16{{0, 2, 3, 1}, {4, 5, 7, 6}, {0, 1, 5, 4}, {2, 6, 7, 3}, {0, 4, 6, 2}, {1, 3, 7, 5}}
	for q in quads {
		f := make([dynamic]u16, 0, 4)
		for i in q do append(&f, i)
		append(faces, f)
	}
}

@(private)
place_collider :: proc(doc: ^Doc3, sh: ^Shape3, T: Xf3, posed: bool, part: string, out: ^[dynamic]Collider3) {
	c := Collider3{kind = sh.kind, layer = sh.layer == "" ? "solid" : sh.layer, part = part}
	s: f32 = 1
	if posed do s = math.pow(abs(linalg.determinant(T)), 1.0 / 3.0)
	mv :: proc(T: Xf3, posed: bool, p: V3) -> V3 {return posed ? xf3_apply(T, p) : p}
	switch sh.kind {
	case "ball":
		c.at = mv(T, posed, sh.at)
		c.r = sh.r * s
	case "rod":
		c.a = mv(T, posed, sh.a)
		c.b = mv(T, posed, sh.b)
		c.w = sh.w * s
	case "mesh", "box":
		c.kind = "mesh"
		if sh.kind == "box" do box_mesh_3d(sh, &c.points, &c.faces)
		else {
			for p in sh.points do append(&c.points, p)
			for f in sh.faces {
				g := make([dynamic]u16, 0, len(f))
				append(&g, ..f[:])
				append(&c.faces, g)
			}
		}
		if posed do for &p in c.points do p = xf3_apply(T, p)
		if posed && linalg.determinant(T) < 0 {
			// a mirror turns the winding inside out: turn it back
			for &f in c.faces do slice_reverse(f[:])
		}
		if sh.kind == "mesh" && len(sh.tris) > 0 && len(sh.tris) % 3 == 0 && !(posed && linalg.determinant(T) < 0) {
			append(&c.tris, ..sh.tris[:])
		} else {
			for f in c.faces do for i in 1 ..< len(f) - 1 do append(&c.tris, f[0], f[i], f[i + 1])
		}
	case:
		return
	}
	append(out, c)
}

@(private)
slice_reverse :: proc(s: []u16) {
	for i, j := 0, len(s) - 1; i < j; i, j = i + 1, j - 1 do s[i], s[j] = s[j], s[i]
}

// Every collision shape in document space under `poses`, appended to `out`.
collision_world_3d :: proc(doc: ^Doc3, poses: []State_Part3, out: ^[dynamic]Collider3) {
	for &sh in doc.collision {
		if sh.part == "" {
			place_collider(doc, &sh, XF3_ID, false, "", out)
			continue
		}
		for &p in doc.parts {
			src := p.like == "" ? p.name : p.like
			if src != sh.part do continue
			place_collider(doc, &sh, world_xf_3d(doc, poses, p.name), true, p.name, out)
		}
	}
}

destroy_colliders_3d :: proc(cs: ^[dynamic]Collider3) {
	for &c in cs {
		delete(c.points)
		for &f in c.faces do delete(f)
		delete(c.faces)
		delete(c.tris)
	}
	delete(cs^)
}

// ------------------------------------------------------------ chains in 3D
// Cyclic coordinate descent with a third axis: each joint, end first,
// turns about (joint → end) × (joint → target) in its parent's frame;
// a pole then swings the chain about its root-to-end line. The same
// sums as @fastart/core, so a target solved here lands where the
// projector put it.

constraint_of_3d :: proc(doc: ^Doc3, name: string) -> ^Constraint3 {
	for &c in doc.constraints do if c.name == name do return &c
	return nil
}

anchor_of_3d :: proc(doc: ^Doc3, part: ^Part3, name: string) -> ^Anchor3 {
	for &a in anchors_of_3d(doc, part) do if a.name == name do return &a
	return nil
}

chain_end_3d :: proc(doc: ^Doc3, c: ^Constraint3) -> (part: ^Part3, at: V3, ok: bool) {
	slash := -1
	for ch, i in c.end do if ch == '/' {
		slash = i
		break
	}
	if slash < 0 || len(c.chain) == 0 do return
	pname, aname := c.end[:slash], c.end[slash + 1:]
	if c.chain[len(c.chain) - 1] != pname do return
	part = part_of_3d(doc, pname)
	if part == nil do return
	a := anchor_of_3d(doc, part, aname)
	if a == nil do return
	return part, a.at, true
}

chain_end_world_3d :: proc(doc: ^Doc3, poses: []State_Part3, c: ^Constraint3) -> (V3, bool) {
	part, at, ok := chain_end_3d(doc, c)
	if !ok do return {}, false
	return xf3_apply(world_xf_3d(doc, poses, part.name), at), true
}

// Turn a pose about a world-space axis through its pivot, in its parent's frame.
@(private)
turn_about_3d :: proc(doc: ^Doc3, poses: []State_Part3, name: string, axis_world: V3, angle: f32) {
	part := part_of_3d(doc, name)
	if part == nil || abs(angle) < 1e-9 do return
	axis := axis_world
	a := angle
	if part.parent != "" {
		P := world_xf_3d(doc, poses, part.parent)
		axis = linalg.normalize(xf3_apply_dir(linalg.inverse(P), axis_world))
		if linalg.determinant(P) < 0 do a = -a
	}
	for &sp in poses do if sp.part == name {
		q := linalg.quaternion_angle_axis_f32(a, axis) * quat_from_euler(sp.rotate)
		sp.rotate = euler_from_quat(q)
		break
	}
}

// Turn the chain's parts so the end anchor reaches `target` (document
// space), editing `poses` in place; entries are added for chain parts
// the list lacks. Returns the distance left.
solve_chain_3d :: proc(doc: ^Doc3, poses: ^[dynamic]State_Part3, c: ^Constraint3, target: V3, iterations := 16, tolerance: f32 = 0.01) -> f32 {
	end_part, end_at, ok := chain_end_3d(doc, c)
	if !ok do return 1e30
	for name in c.chain {
		found := false
		for &sp in poses do if sp.part == name {
			found = true
			break
		}
		if !found {
			part := part_of_3d(doc, name)
			append(poses, State_Part3{part = name, offset = part == nil ? V3{} : part.pivot})
		}
	}
	dist: f32 = 1e30
	for _ in 0 ..< iterations {
		for i := len(c.chain) - 1; i >= 0; i -= 1 {
			part := part_of_3d(doc, c.chain[i])
			if part == nil do continue
			e := xf3_apply(world_xf_3d(doc, poses[:], end_part.name), end_at)
			j := xf3_apply(world_xf_3d(doc, poses[:], part.name), part.pivot)
			ve, vt := e - j, target - j
			le, lt := linalg.length(ve), linalg.length(vt)
			if le < 1e-9 || lt < 1e-9 do continue
			axis := linalg.cross(ve, vt)
			if linalg.length(axis) < 1e-9 do continue
			angle := math.acos(clamp(linalg.dot(ve, vt) / (le * lt), -1, 1))
			turn_about_3d(doc, poses[:], part.name, linalg.normalize(axis), angle)
		}
		e, eok := chain_end_world_3d(doc, poses[:], c)
		if !eok do return 1e30
		dist = linalg.length(e - target)
		if dist < tolerance do break
	}
	if c.has_pole && len(c.chain) >= 2 {
		root := part_of_3d(doc, c.chain[0])
		elbow := part_of_3d(doc, c.chain[1])
		if root != nil && elbow != nil {
			r := xf3_apply(world_xf_3d(doc, poses[:], root.name), root.pivot)
			e := xf3_apply(world_xf_3d(doc, poses[:], end_part.name), end_at)
			m := xf3_apply(world_xf_3d(doc, poses[:], elbow.name), elbow.pivot)
			if linalg.length(e - r) > 1e-9 {
				axis := linalg.normalize(e - r)
				flat :: proc(p, r, axis: V3) -> V3 {
					d := p - r
					return d - axis * linalg.dot(d, axis)
				}
				a, b := flat(m, r, axis), flat(c.pole, r, axis)
				if linalg.length(a) > 1e-9 && linalg.length(b) > 1e-9 {
					angle := math.atan2(linalg.dot(linalg.cross(a, b), axis), linalg.dot(a, b))
					turn_about_3d(doc, poses[:], root.name, axis, angle)
				}
			}
		}
	}
	return dist
}

solve_targets_3d :: proc(doc: ^Doc3, poses: ^[dynamic]State_Part3, targets: []Target3) {
	for tg in targets {
		if c := constraint_of_3d(doc, tg.chain); c != nil do solve_chain_3d(doc, poses, c, tg.at)
	}
}

key_targets_3d :: proc(doc: ^Doc3, k: ^Clip_Key3) -> []Target3 {
	if len(k.targets) > 0 || k.state == "" do return k.targets[:]
	if st := state_of_3d(doc, k.state); st != nil do return st.targets[:]
	return nil
}

// Where the chains should reach at time t, into `out`.
sample_targets_3d :: proc(doc: ^Doc3, c: ^Clip3, t: f32, out: ^[dynamic]Target3) {
	clear(out)
	n := len(c.keys)
	if n == 0 do return
	dur := clip_duration_3d(c)
	time := t
	if c.loop && dur > 0 do time = math.mod(math.mod(t, dur) + dur, dur)
	if time <= c.keys[0].t {
		append(out, ..key_targets_3d(doc, &c.keys[0]))
		return
	}
	if time >= c.keys[n - 1].t {
		append(out, ..key_targets_3d(doc, &c.keys[n - 1]))
		return
	}
	i := 0
	for i + 1 < n && c.keys[i + 1].t <= time do i += 1
	A, B := &c.keys[i], &c.keys[i + 1]
	span := B.t - A.t
	u := ease_key_3d(span > 0 ? (time - A.t) / span : 1, B)
	to := key_targets_3d(doc, B)
	for a in key_targets_3d(doc, A) {
		b: ^Target3
		for &q in to do if q.chain == a.chain {
			b = &q
			break
		}
		if b == nil {
			append(out, a)
			continue
		}
		append(out, Target3{chain = a.chain, at = a.at + (b.at - a.at) * u})
	}
}
