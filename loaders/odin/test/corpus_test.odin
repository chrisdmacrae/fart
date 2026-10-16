package fastart_test

// The conformance corpus (spec/examples) against the reference loader.
// A game loader is allowed to be lenient: past `json` and `version` it
// need not refuse anything, so only those two codes must fail here.

import "core:encoding/json"
import "core:fmt"
import "core:math"
import "core:math/linalg"
import "core:os"
import "core:testing"
import fart ".."

EXAMPLES :: #directory + "/../../../spec/examples/"

Case :: struct {
	file:  string,
	valid: bool,
	code:  string,
	space: string, // "3d" for the 1.3 3D cases
	shart: bool, // a scene (.shart)
}
Manifest :: struct {
	cases: []Case,
}

// The loader's strings live wherever unmarshal put them; a game drops the
// whole arena. Here, the temp allocator plays that arena.
@(private = "file")
arena_load :: proc(data: []byte) -> (fart.Doc, bool) {
	context.allocator = context.temp_allocator
	return fart.load_bytes(data)
}

@(test)
corpus :: proc(t: ^testing.T) {
	mdata, merr := os.read_entire_file(EXAMPLES + "manifest.json", context.temp_allocator)
	if !testing.expect(t, merr == nil, "manifest.json should be readable") do return
	m: Manifest
	if !testing.expect(t, json.unmarshal(mdata, &m, allocator = context.temp_allocator) == nil, "manifest.json should parse") do return
	testing.expect(t, len(m.cases) > 20, "the corpus has cases")
	for c in m.cases {
		data, err := os.read_entire_file(fmt.tprintf("%s%s", EXAMPLES, c.file), context.temp_allocator)
		if !testing.expectf(t, err == nil, "%s should be readable", c.file) do continue
		if c.shart {
			context.allocator = context.temp_allocator
			_, sok := fart.load_scene(data)
			if c.valid do testing.expectf(t, sok, "%s should load as a scene", c.file)
			else if c.code == "json" || c.code == "version" do testing.expectf(t, !sok, "%s should be refused (%s)", c.file, c.code)
			continue
		}
		if c.space == "3d" {
			context.allocator = context.temp_allocator
			_, ok3 := fart.load_bytes_3d(data)
			testing.expectf(t, ok3 == c.valid || !c.valid, "%s should load as 3D", c.file)
			_, ok2 := fart.load_bytes(data)
			testing.expectf(t, !ok2, "%s is 3D: the 2D loader refuses it", c.file)
			continue
		}
		doc, ok := arena_load(data)
		if c.valid {
			testing.expectf(t, ok, "%s should load", c.file)
		} else if c.code == "json" || c.code == "version" {
			testing.expectf(t, !ok, "%s should be refused (%s)", c.file, c.code)
		}
		_ = doc
	}
}

@(test)
absent_offset_is_rest :: proc(t: ^testing.T) {
	data, err := os.read_entire_file(EXAMPLES + "valid/chest.fart", context.temp_allocator)
	if !testing.expect(t, err == nil) do return
	doc, ok := arena_load(data)
	if !testing.expect(t, ok) do return
	closed := fart.state_of(&doc, "closed")
	open := fart.state_of(&doc, "open")
	if !testing.expect(t, closed != nil && open != nil) do return
	lid := fart.part_of(&doc, "lid")
	// closed leaves offset out: the lid's pivot lands on itself
	testing.expect_value(t, closed.parts[1].offset, lid.pivot)
	testing.expect_value(t, closed.parts[1].offset, fart.V2{-8, -5})
	// open says where explicitly; untouched
	testing.expect_value(t, open.parts[0].offset, fart.V2{-8, -5})
	testing.expect_value(t, open.parts[0].rotate, f32(-2.4))
}

@(test)
version_gate :: proc(t: ^testing.T) {
	_, ok0 := arena_load(transmute([]byte)string(`{"name": "no version"}`))
	testing.expect(t, !ok0, "a document without a version is refused")
	_, ok2 := arena_load(transmute([]byte)string(`{"version": 2}`))
	testing.expect(t, !ok2, "a newer major is refused")
	doc, ok1 := arena_load(transmute([]byte)string(`{"version": 1}`))
	testing.expect(t, ok1, "the smallest legal document loads")
	_ = doc
}

@(test)
parents_compose :: proc(t: ^testing.T) {
	data, err := os.read_entire_file(EXAMPLES + "valid/hero.fart", context.temp_allocator)
	if !testing.expect(t, err == nil) do return
	doc, ok := arena_load(data)
	if !testing.expect(t, ok) do return
	// a quarter turn of the torso carries the head's pivot from (0,-8) to (8,0)
	poses := [?]fart.State_Part{{part = "torso", rotate = math.PI / 2}, {part = "head", offset = {0, -8}}}
	W := fart.world_xf(&doc, poses[:], "head")
	p := fart.xf_apply(W, {0, -8})
	testing.expect(t, abs(p.x - 8) < 1e-4 && abs(p.y) < 1e-4, "the head rides the torso")
	// the wave clip tweens the upper arm halfway at t = 0.15 (in-out is symmetric)
	frame := make([dynamic]fart.State_Part, context.temp_allocator)
	wave: ^fart.Clip
	for &c in doc.clips do if c.name == "wave" do wave = &c
	if !testing.expect(t, wave != nil) do return
	fart.sample_clip(&doc, wave, 0.15, &frame)
	for sp in frame do if sp.part == "upper_l" {
		testing.expect(t, abs(sp.rotate - (-0.95)) < 1e-4, "halfway to the wave")
	}
	// the loop wraps
	fart.sample_clip(&doc, wave, 0.6, &frame)
	for sp in frame do if sp.part == "upper_l" do testing.expect(t, abs(sp.rotate) < 1e-4, "back at rest")
	testing.expect_value(t, len(doc.constraints), 1)
	testing.expect_value(t, doc.constraints[0].end, "fore_l/hand")
}

// A palette swap lays a palette file over a loaded doc by name.
@(test)
palette_swap :: proc(t: ^testing.T) {
	context.allocator = context.temp_allocator
	art, ok := fart.load_bytes(transmute([]byte)string(`{"version":1,"palette":[{"name":"skin","rgb":[1,2,3,255]},{"name":"cloth","rgb":[4,5,6,255]}],"parts":[]}`))
	if !testing.expect(t, ok, "the art loads") do return
	swap, sok := fart.load_bytes(transmute([]byte)string(`{"version":1,"palette":[{"name":"cloth","rgb":[9,9,9,255]},{"name":"trim","rgb":[7,7,7,255]}]}`))
	if !testing.expect(t, sok, "the palette file loads") do return
	fart.apply_palette(&art, swap.palette[:])
	testing.expect(t, fart.color_of(&art, "cloth") == {9, 9, 9, 255}, "same names take the new colour")
	testing.expect(t, fart.color_of(&art, "skin") == {1, 2, 3, 255}, "the rest keep theirs")
	testing.expect(t, fart.color_of(&art, "trim") == {7, 7, 7, 255}, "new names join")
	testing.expect(t, art.palette[1].rgb == {4, 5, 6, 255}, "the file's own palette is untouched")
}

// ---- 1.2

@(test)
v12_mirror_like :: proc(t: ^testing.T) {
	context.allocator = context.temp_allocator
	doc, ok := fart.load_bytes(transmute([]byte)string(`{"version":1,"palette":[{"name":"c","rgb":[1,1,1,255]}],
		"parts":[{"name":"body","pivot":[0,0],"shapes":[]},
		{"name":"claw_r","parent":"body","pivot":[5,0],"shapes":[{"kind":"line","color":"c","a":[5,0],"b":[9,-2],"w":1}],"anchors":[{"name":"tip","at":[9,-2],"angle":0.5}]},
		{"name":"claw_l","like":"claw_r","parent":"body","pivot":[5,0]}],
		"states":[{"name":"idle","parts":[{"part":"body"},{"part":"claw_r"},{"part":"claw_l","mirror":true,"offset":[-5,0]}]}]}`))
	if !testing.expect(t, ok, "loads") do return
	l := fart.part_of(&doc, "claw_l")
	testing.expect(t, len(fart.shapes_of(&doc, l)) == 1, "shapes come through like")
	testing.expect(t, fart.anchor_of(&doc, l, "tip") != nil, "anchors come through like")
	testing.expect(t, fart.anchor_of(&doc, l, "tip").angle == 0.5, "the anchor's angle loads")
	st := fart.state_of(&doc, "idle")
	W := fart.world_xf(&doc, st.parts[:], "claw_l")
	p := fart.xf_apply(W, {9, -2})
	testing.expect(t, abs(p.x + 9) < 1e-3 && abs(p.y + 2) < 1e-3, "the mirrored claw lands on the other side")
	testing.expect(t, fart.xf_flipped(W), "a mirrored frame is flipped")
}

@(test)
v12_curves_events :: proc(t: ^testing.T) {
	testing.expect(t, abs(fart.bezier({0, 0, 1, 1}, 0.3) - 0.3) < 1e-3, "a straight curve is linear")
	testing.expect(t, fart.bezier({0.42, 0, 0.58, 1}, 0.25) < 0.25, "ease-in-out starts slow")
	testing.expect(t, fart.bezier({0.34, 1.56, 0.64, 1}, 0.7) > 1, "a back-out overshoots")
	context.allocator = context.temp_allocator
	doc, ok := fart.load_bytes(transmute([]byte)string(`{"version":1,"parts":[{"name":"a","shapes":[]}],
		"states":[{"name":"s","parts":[{"part":"a"}]}],
		"clips":[{"name":"walk","loop":true,"keys":[{"t":0,"state":"s","events":["plant_l"]},{"t":0.5,"state":"s","events":["plant_r"],"curve":[0.42,0,0.58,1]},{"t":1,"state":"s","events":["never"]}]}]}`))
	if !testing.expect(t, ok, "loads") do return
	c := fart.clip_of(&doc, "walk")
	testing.expect(t, len(c.keys[1].curve) == 4, "the curve loads")
	ev := make([dynamic]string)
	fart.clip_events(c, 0.1, 0.6, &ev)
	testing.expect(t, len(ev) == 1 && ev[0] == "plant_r", "an event fires when crossed")
	fart.clip_events(c, 0.6, 1.1, &ev)
	testing.expect(t, len(ev) == 2 && ev[1] == "plant_l", "the wrap fires the first key, never the last")
}

@(test)
v12_blend_layer_solve :: proc(t: ^testing.T) {
	context.allocator = context.temp_allocator
	doc, ok := fart.load_bytes(transmute([]byte)string(`{"version":1,"parts":[
		{"name":"torso","pivot":[0,0],"shapes":[]},
		{"name":"upper","parent":"torso","pivot":[0,0],"shapes":[]},
		{"name":"fore","parent":"upper","pivot":[5,0],"shapes":[],"anchors":[{"name":"hand","at":[10,0]}]}],
		"constraints":[{"name":"arm","chain":["upper","fore"],"end":"fore/hand","bend":1}],
		"states":[{"name":"a","parts":[{"part":"torso"},{"part":"upper"},{"part":"fore"}]},
		{"name":"b","parts":[{"part":"torso","rotate":1},{"part":"fore","rotate":0.5}]}]}`))
	if !testing.expect(t, ok, "loads") do return
	a, b := fart.state_of(&doc, "a"), fart.state_of(&doc, "b")
	out := make([dynamic]fart.State_Part)
	fart.blend_poses(&doc, a.parts[:], b.parts[:], 0.25, &out)
	testing.expect(t, len(out) == 3 && abs(out[0].rotate - 0.25) < 1e-4, "a blend below half keeps a's parts and tweens")
	fart.blend_poses(&doc, a.parts[:], b.parts[:], 0.75, &out)
	testing.expect(t, len(out) == 2 && abs(out[0].rotate - 0.75) < 1e-4, "above half, b's parts")
	fart.layer_poses(&doc, a.parts[:], b.parts[:], 0.5, &out)
	testing.expect(t, len(out) == 3 && abs(out[2].rotate - 0.25) < 1e-4 && out[1].rotate == 0, "a layer moves only what it names")
	poses := make([dynamic]fart.State_Part)
	append(&poses, ..a.parts[:])
	left := fart.solve_chain(&doc, &poses, &doc.constraints[0], {0, 8})
	testing.expect(t, left < 0.05, "the chain reaches")
	e, _ := fart.chain_end_world(&doc, poses[:], &doc.constraints[0])
	testing.expect(t, abs(e.x) < 0.1 && abs(e.y - 8) < 0.1, "the hand is on the target")
	host := fart.Anchor{name = "hand", at = {10, 0}, angle = math.PI / 2}
	item := fart.Anchor{name = "grip", at = {0, 3}, angle = 0}
	A := fart.attach_xf(fart.XF_ID, &host, &item)
	g := fart.xf_apply(A, {0, 3})
	testing.expect(t, abs(g.x - 10) < 1e-3 && abs(g.y) < 1e-3, "attach lands the grip on the hand")
}

// 1.3: a 3D document loads, its turns compose like the TypeScript reference, and shade multiplies.
@(test)
space_3d :: proc(t: ^testing.T) {
	context.allocator = context.temp_allocator
	data, err := os.read_entire_file(EXAMPLES + "valid/chest3d.fart", context.temp_allocator)
	if !testing.expect(t, err == nil) do return
	doc, ok := fart.load_bytes_3d(data)
	if !testing.expect(t, ok, "chest3d loads as 3D") do return
	testing.expect_value(t, doc.space, "3d")
	testing.expect_value(t, len(doc.parts), 5)
	lid := fart.part_of_3d(&doc, "lid")
	testing.expect(t, lid != nil && lid.parent == "box")
	testing.expect(t, len(lid.shapes) == 1 && lid.shapes[0].kind == "mesh" && len(lid.shapes[0].faces) == 6, "the lid is a box of six faces")
	testing.expect(t, abs(lid.shapes[0].shade - 1.1) < 1e-6, "shade reads")
	// a quarter turn about z of (2,0,0) about the pivot (1,0,0) lands at (1,1,0)
	p := fart.Part3{name = "p", pivot = {1, 0, 0}}
	sp := fart.State_Part3{part = "p", offset = {1, 0, 0}, rotate = {0, 0, math.PI / 2}}
	q := fart.xf3_apply(fart.local_xf_3d(&p, &sp), {2, 0, 0})
	testing.expect(t, abs(q.x - 1) < 1e-4 && abs(q.y - 1) < 1e-4 && abs(q.z) < 1e-4, "a turn about z is the 2D rotate")
	// a quarter turn of the box about y carries the lid's pivot from z=4 to x=4
	poses := [?]fart.State_Part3{{part = "box", rotate = {0, math.PI / 2, 0}}, {part = "lid", offset = {0, -1, 4}}}
	W := fart.world_xf_3d(&doc, poses[:], "lid")
	r := fart.xf3_apply(W, {0, -1, 4})
	testing.expect(t, abs(r.x - 4) < 1e-4 && abs(r.y + 1) < 1e-4 && abs(r.z) < 1e-4, "the lid rides the box")
	// the open clip: halfway through an ease-out the lid has turned more than half
	frame := make([dynamic]fart.State_Part3, context.temp_allocator)
	fart.sample_clip_3d(&doc, fart.clip_of_3d(&doc, "open"), 0.2, &frame)
	for sp in frame do if sp.part == "lid" do testing.expect(t, sp.rotate.x < -1.1 && sp.rotate.x > -2.2, "the lid is on its way")
	// turns round-trip through quaternions
	e := fart.euler_from_quat(fart.quat_from_euler({0.3, -0.7, 1.9}))
	testing.expect(t, abs(e.x - 0.3) < 1e-4 && abs(e.y + 0.7) < 1e-4 && abs(e.z - 1.9) < 1e-4, "euler round trip")
	testing.expect(t, fart.shade_color({100, 200, 50, 128}, 0.5) == {50, 100, 25, 128}, "shade multiplies and keeps alpha")
	testing.expect(t, fart.shade_color({100, 200, 50, 128}, 0) == {100, 200, 50, 128}, "0 means 1")
}

// 1.3: a chain in 3D reaches its target, and a pole picks the swivel.
@(test)
chains_3d :: proc(t: ^testing.T) {
	context.allocator = context.temp_allocator
	data, err := os.read_entire_file(EXAMPLES + "valid/reach3d.fart", context.temp_allocator)
	if !testing.expect(t, err == nil) do return
	doc, ok := fart.load_bytes_3d(data)
	if !testing.expect(t, ok, "reach3d loads") do return
	testing.expect_value(t, len(doc.constraints), 1)
	testing.expect(t, doc.constraints[0].has_pole, "the pole reads")
	poses := make([dynamic]fart.State_Part3, context.temp_allocator)
	append(&poses, ..doc.states[0].parts[:])
	target := fart.V3{8, -9, -6}
	left := fart.solve_chain_3d(&doc, &poses, &doc.constraints[0], target)
	testing.expect(t, left < 0.05, "the hand reaches")
	e, eok := fart.chain_end_world_3d(&doc, poses[:], &doc.constraints[0])
	testing.expect(t, eok && abs(e.x - 8) < 0.05 && abs(e.y + 9) < 0.05 && abs(e.z + 6) < 0.05, "at the target")
	elbow := fart.xf3_apply(fart.world_xf_3d(&doc, poses[:], "fore"), {9, -4, 0})
	testing.expect(t, elbow.z < 0, "the elbow leans toward the pole")
	targets := make([dynamic]fart.Target3, context.temp_allocator)
	fart.sample_targets_3d(&doc, &doc.clips[0], 0.4, &targets)
	testing.expect_value(t, len(targets), 1)
	// flattening: the torso rod is a cylinder of triangles with unit normals
	ms := make([dynamic]fart.Tri_Mesh, context.temp_allocator)
	fart.flatten_part(&doc, fart.part_of_3d(&doc, "torso"), &ms)
	testing.expect(t, len(ms) == 1 && len(ms[0].positions) > 30 && len(ms[0].positions) % 3 == 0, "a rod flattens to triangles")
	testing.expect(t, abs(linalg.length(ms[0].normals[0]) - 1) < 1e-4, "normals are unit")
}

// 1.4: posed collision lands where the part's mesh lands; a box expands
// outward; layers and the engine's own fields ride along.
@(test)
collision_3d :: proc(t: ^testing.T) {
	context.allocator = context.temp_allocator
	data, err := os.read_entire_file(EXAMPLES + "valid/hut.fart", context.temp_allocator)
	if !testing.expect(t, err == nil) do return
	doc, ok := fart.load_bytes_3d(data)
	if !testing.expect(t, ok, "hut loads") do return
	open := fart.state_of_3d(&doc, "open")
	if !testing.expect(t, open != nil) do return
	cs := make([dynamic]fart.Collider3, context.temp_allocator)
	fart.collision_world_3d(&doc, open.parts[:], &cs)
	testing.expect_value(t, len(cs), 8)
	// the flap's box: its far-corner point lands where the flap's map puts it
	flap: ^fart.Collider3
	lamp: ^fart.Collider3
	table: ^fart.Collider3
	for &c in cs {
		switch c.part {
		case "flap":
			flap = &c
		case "lamp":
			lamp = &c
		case "table":
			table = &c
		}
	}
	if !testing.expect(t, flap != nil && flap.kind == "mesh" && len(flap.points) == 8, "the flap's box is a posed mesh") do return
	W := fart.world_xf_3d(&doc, open.parts[:], "flap")
	want := fart.xf3_apply(W, {10.3, -10, -8}) // the box's near top corner, at rest (10.3, -10, -8)
	hit := false
	for p in flap.points do if linalg.length(p - want) < 1e-3 do hit = true
	testing.expect(t, hit, "a posed collider corner lands where world_xf_3d puts it")
	// wound outward: every face's normal points away from the box's centre
	centre := fart.xf3_apply(W, {10, -5, -5})
	for f in flap.points {
		_ = f
	}
	for f in flap.faces {
		n := fart.face_normal(flap.points[:], f[:])
		mid: fart.V3
		for i in f do mid += flap.points[i]
		mid /= f32(len(f))
		testing.expect(t, linalg.dot(n, mid - centre) > 0, "a box face winds outward")
	}
	testing.expect(t, lamp != nil && lamp.layer == "trigger" && lamp.kind == "ball", "the lamp's trigger ball, with its layer")
	testing.expect(t, table != nil && table.layer == "surface", "the table's surface top")
	testing.expect(t, cs[0].layer == "solid" && cs[0].part == "", "a shape without a part or layer is solid, document space")
	// closed: the flap stands where it was authored
	closed := fart.state_of_3d(&doc, "closed")
	cs2 := make([dynamic]fart.Collider3, context.temp_allocator)
	fart.collision_world_3d(&doc, closed.parts[:], &cs2)
	for c in cs2 do if c.part == "flap" {
		hit2 := false
		for p in c.points do if linalg.length(p - fart.V3{10.3, -10, -8}) < 1e-3 do hit2 = true
		testing.expect(t, hit2, "closed, the flap's box is at rest")
	}
}

// 1.5: textures resolve through the resolver; box-mapped and explicit uvs come out of flattening.
@(test)
textures_3d :: proc(t: ^testing.T) {
	context.allocator = context.temp_allocator
	data, err := os.read_entire_file(EXAMPLES + "valid/crate.fart", context.temp_allocator)
	if !testing.expect(t, err == nil) do return
	doc, ok := fart.load_bytes_3d(data)
	if !testing.expect(t, ok, "crate loads") do return
	testing.expect_value(t, len(doc.textures), 1)
	testing.expect_value(t, doc.textures[0].maps["height"].mode, "mask")
	resolver :: proc(path: string, user: rawptr) -> ([]byte, bool) {
		d, e := os.read_entire_file(fmt.tprintf("%svalid/%s", EXAMPLES, path), context.temp_allocator)
		return d, e == nil
	}
	fart.resolve_textures_3d(&doc, resolver, nil)
	planks, has := doc.texture_docs["planks"]
	if !testing.expect(t, has, "the texture resolved") do return
	testing.expect_value(t, len(planks), 3)
	testing.expect_value(t, planks["glow"].state, "knots")
	hm := planks["height"]
	cm := planks["color"]
	testing.expect(t, fart.color_of(&hm.doc, "board") == {230, 230, 230, 255}, "the height palette is laid over the drawing")
	testing.expect(t, fart.color_of(&cm.doc, "board") == {150, 105, 60, 255}, "the colour map keeps the drawing's own")
	ms := make([dynamic]fart.Tri_Mesh, context.temp_allocator)
	fart.flatten_part(&doc, &doc.parts[0], &ms)
	testing.expect_value(t, ms[0].texture, "planks")
	testing.expect_value(t, len(ms[0].uvs), len(ms[0].positions))
	// the front face (z = -8) reads (x, y)
	for p, i in ms[0].positions do if p.z == -8 {
		testing.expect(t, ms[0].uvs[i] == fart.V2{p.x, p.y}, "box mapping on the front face")
		break
	}
	testing.expect_value(t, ms[1].texture, "")
	testing.expect_value(t, len(ms[1].uvs), 0)
	// the lid's explicit uvs: every corner reads one of the four the file gives
	lid_ok := len(ms[2].uvs) == len(ms[2].positions)
	for uv in ms[2].uvs do if !(uv == fart.V2{0, 0} || uv == fart.V2{8, 0} || uv == fart.V2{8, 8} || uv == fart.V2{0, 8}) do lid_ok = false
	testing.expect(t, lid_ok, "the lid's explicit uvs")
}

// A scene flattens: instances placed through their parents and attaches, palettes laid over.
@(test)
scenes :: proc(t: ^testing.T) {
	context.allocator = context.temp_allocator
	resolver :: proc(path: string, user: rawptr) -> ([]byte, bool) {
		d, e := os.read_entire_file(fmt.tprintf("%svalid/%s", EXAMPLES, path), context.temp_allocator)
		return d, e == nil
	}
	data, err := os.read_entire_file(EXAMPLES + "valid/camp.shart", context.temp_allocator)
	if !testing.expect(t, err == nil) do return
	camp, ok := fart.load_scene(data)
	if !testing.expect(t, ok, "camp loads") do return
	testing.expect_value(t, camp.space, "3d")
	testing.expect(t, abs(camp.nodes[1].rotate3.y - 1.2) < 1e-6, "a 3D turn reads from the raw tree")
	cache: fart.Scene_Cache
	placed := make([dynamic]fart.Placed)
	fart.flatten_scene(&camp, resolver, nil, &cache, &placed)
	testing.expect_value(t, len(placed), 8)
	testing.expect_value(t, placed[1].path, "hut/crate")
	testing.expect(t, abs(placed[1].xf3[0, 3] + 4) < 1e-4 && abs(placed[1].xf3[1, 3] + 8) < 1e-4, "the crate rides the hut")
	testing.expect_value(t, placed[7].path, "annex/crate")
	testing.expect(t, abs(placed[7].xf3[0, 3] - 60) < 1e-4, "the nested yard's crate lands at 40 + 20")
	// the arm hangs from the lamp's pan
	hut := &placed[0]
	pan := fart.xf3_apply(fart.world_xf_3d(hut.doc3, hut.poses3[:], "lamp"), {4, -5.4, 4})
	arm := fart.xf3_apply(placed[2].xf3, {0, 0, 0})
	testing.expect(t, linalg.length(arm - pan) < 1e-3, "attached at the socket")
	testing.expect(t, len(placed[3].poses3) == 3, "the guard shows its clip's frame")
	// 2D: the fleet, its palette laid over
	fdata, ferr := os.read_entire_file(EXAMPLES + "valid/fleet.shart", context.temp_allocator)
	if !testing.expect(t, ferr == nil) do return
	fleet, fok := fart.load_scene(fdata)
	if !testing.expect(t, fok, "fleet loads") do return
	placed2 := make([dynamic]fart.Placed)
	fart.flatten_scene(&fleet, resolver, nil, &cache, &placed2)
	testing.expect_value(t, len(placed2), 5)
	testing.expect_value(t, placed2[2].path, "wing/r")
	testing.expect(t, fart.xf_flipped(placed2[2].xf), "mirrored")
	// the scene's palette.fart lays over: its first token joins the instance's
	pdata, perr := os.read_entire_file(EXAMPLES + "valid/palette.fart", context.temp_allocator)
	if !testing.expect(t, perr == nil) do return
	pal, pok := fart.load_bytes(pdata)
	if !testing.expect(t, pok && len(pal.palette) > 0) do return
	want := pal.palette[0].name
	has := false
	for tk in placed2[0].tokens do if tk.name == want do has = true
	testing.expect(t, has, "the scene's palette lays over the instance's tokens")
}

@(test)
morphs_lerp :: proc(t: ^testing.T) {
	context.allocator = context.temp_allocator
	data, err := os.read_entire_file(EXAMPLES + "valid/morph3d.fart", context.temp_allocator)
	if !testing.expect(t, err == nil) do return
	doc, ok := fart.load_bytes_3d(data)
	if !testing.expect(t, ok) do return
	full := fart.state_of_3d(&doc, "full")
	chest := fart.part_of_3d(&doc, "chest")
	if !testing.expect(t, full != nil && chest != nil) do return
	// the state's morph is parsed, and shape_points_3d hands it out for the entry
	testing.expect_value(t, len(full.parts[0].morph), 1)
	testing.expect_value(t, fart.shape_points_3d(&doc, chest, &full.parts[0], 0)[0], fart.V3{-5, -4, 3})
	testing.expect_value(t, fart.shape_points_3d(&doc, chest, nil, 0)[0], fart.V3{-4, -3, 2})
	testing.expect(t, fart.morphs_3d(&doc, &full.parts[0]), "the full state reshapes the chest")
	// halfway through the swell (in-out ease: the eased half is a half)
	frame := make([dynamic]fart.State_Part3)
	fart.sample_clip_3d(&doc, &doc.clips[0], 0.4, &frame)
	for &sp in frame do if sp.part == "chest" {
		testing.expect_value(t, len(sp.morph), 1)
		p := sp.morph[0].points[0]
		testing.expect(t, abs(p.x + 4.5) < 1e-4 && abs(p.y + 3.5) < 1e-4 && abs(p.z - 2.5) < 1e-4, "the corner is halfway out")
		// flattened under the pose: every corner at |x| 4.5
		tms := make([dynamic]fart.Tri_Mesh)
		fart.flatten_part_posed(&doc, chest, &sp, &tms)
		for q in tms[0].positions do testing.expect(t, abs(abs(q.x) - 4.5) < 1e-4, "the mesh flattens with the morph")
	}
	// 2D too: the blob squashes
	data2, err2 := os.read_entire_file(EXAMPLES + "valid/morph.fart", context.temp_allocator)
	if !testing.expect(t, err2 == nil) do return
	d2, ok2 := fart.load_bytes(data2)
	if !testing.expect(t, ok2) do return
	f2 := make([dynamic]fart.State_Part)
	fart.sample_clip(&d2, &d2.clips[0], 0.25, &f2)
	blob := fart.part_of(&d2, "blob")
	for &sp in f2 do if sp.part == "blob" {
		p := fart.shape_points(&d2, blob, &sp, 0)[0]
		testing.expect(t, abs(p.x + 7) < 1e-4 && abs(p.y + 3) < 1e-4, "the poly is halfway squashed")
	}
}

@(test)
curves_and_surfaces :: proc(t: ^testing.T) {
	context.allocator = context.temp_allocator
	// 2D: a path's polygon bends; a morph re-flattens with the handles riding along
	data, err := os.read_entire_file(EXAMPLES + "valid/curve.fart", context.temp_allocator)
	if !testing.expect(t, err == nil) do return
	d2, ok := fart.load_bytes(data)
	if !testing.expect(t, ok) do return
	blob := fart.part_of(&d2, "blob")
	poly := fart.shape_polygon(&d2, blob, nil, 0)
	testing.expect(t, len(poly) > 6, "the closed path flattens into more than its six vertices")
	squash := fart.state_of(&d2, "squash")
	posed := fart.shape_polygon(&d2, blob, &squash.parts[0], 0)
	testing.expect(t, len(posed) > 6 && posed[0].x == -8, "the morphed path re-flattens from the moved vertices")
	// 3D: the smooth cage flattens to many more triangles; the morphed cage follows; the sweep generates
	data3, err3 := os.read_entire_file(EXAMPLES + "valid/smooth.fart", context.temp_allocator)
	if !testing.expect(t, err3 == nil) do return
	d3, ok3 := fart.load_bytes_3d(data3)
	if !testing.expect(t, ok3) do return
	body := fart.part_of_3d(&d3, "body")
	tms := make([dynamic]fart.Tri_Mesh)
	fart.flatten_part(&d3, body, &tms)
	testing.expect(t, len(tms[0].positions) >= 96 * 2 * 3, "two levels of subdivision: 96 faces of the cube")
	xmax: f32 = 0
	for p in tms[0].positions do xmax = max(xmax, p.x)
	full := fart.state_of_3d(&d3, "full")
	tms2 := make([dynamic]fart.Tri_Mesh)
	fart.flatten_part_posed(&d3, body, &full.parts[0], &tms2)
	xmax2: f32 = 0
	for p in tms2[0].positions do xmax2 = max(xmax2, p.x)
	testing.expect(t, xmax2 > xmax + 0.5, "the surface follows the morphed cage")
	// the pyramid is smooth-shaded: its apex corners share a normal straight down the axis
	for i in 0 ..< len(tms[1].positions) do if tms[1].positions[i].y < -6.9 {
		nn := tms[1].normals[i]
		testing.expect(t, abs(nn.x) < 1e-4 && abs(nn.z) < 1e-4 && nn.y < 0, "the apex normal averages the sides")
	}
	datas, errs := os.read_entire_file(EXAMPLES + "valid/sweep.fart", context.temp_allocator)
	if !testing.expect(t, errs == nil) do return
	ds, oks := fart.load_bytes_3d(datas)
	if !testing.expect(t, oks) do return
	jar := fart.part_of_3d(&ds, "jar")
	tms3 := make([dynamic]fart.Tri_Mesh)
	fart.flatten_part(&ds, jar, &tms3)
	testing.expect(t, len(tms3) == 2 && len(tms3[0].positions) > 300 && len(tms3[1].positions) == 36, "the lathe and the extrude generate")
}

// 1.7: a smooth mesh that wears a texture by explicit pattern coordinates
// keeps them: they are subdivided with the faces, within each face.
@(test)
subdivision_carries_pattern_coordinates :: proc(t: ^testing.T) {
	defer free_all(context.temp_allocator)
	SQUARE :: `[[0,0],[4,0],[4,4],[0,4]]`
	data := `{"version":1,"space":"3d","palette":[{"name":"c","rgb":[1,1,1,255]}],"textures":[{"name":"weave","cell":[4,4],"maps":{}}],"parts":[{"name":"a","pivot":[0,0,0],"shapes":[
		{"kind":"mesh","color":"c","smooth":2,"texture":"weave",
		 "points":[[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1],[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1]],
		 "faces":[[0,1,2,3],[5,4,7,6],[4,0,3,7],[1,5,6,2],[4,5,1,0],[3,2,6,7]],
		 "mapping":{"uvs":[` + SQUARE + "," + SQUARE + "," + SQUARE + "," + SQUARE + "," + SQUARE + "," + SQUARE + `]}}]}]}`
	doc, ok := fart.load_bytes_3d(transmute([]byte)string(data))
	if !testing.expect(t, ok, "the textured cube loads") do return
	cage := &doc.parts[0].shapes[0]
	// one level: a child at a corner has that corner's coordinates, the middles of its two edges, the face's middle
	_, faces, _, uvs := fart.subdivide_once(cage.points[:], cage.faces[:], cage.creases[:], context.temp_allocator, cage.mapping.uvs[:])
	testing.expect_value(t, len(faces), 24)
	testing.expect_value(t, len(uvs), 24)
	if len(uvs) == 24 {
		testing.expect(t, uvs[0][0] == fart.V2{0, 0} && uvs[0][1] == fart.V2{2, 0} && uvs[0][2] == fart.V2{2, 2} && uvs[0][3] == fart.V2{0, 2})
		testing.expect(t, uvs[1][0] == fart.V2{4, 0} && uvs[1][1] == fart.V2{4, 2} && uvs[1][2] == fart.V2{2, 2} && uvs[1][3] == fart.V2{2, 0})
	}
	// coordinates that do not fit the faces are not carried
	_, _, _, none := fart.subdivide_once(cage.points[:], cage.faces[:], cage.creases[:], context.temp_allocator, cage.mapping.uvs[1:])
	testing.expect_value(t, len(none), 0)
	// the surface wears them, a list for each of its faces
	surf := fart.surface_of(cage, context.temp_allocator)
	testing.expect_value(t, len(surf.faces), 96)
	testing.expect_value(t, len(surf.mapping.uvs), 96)
	// and so do the triangles: textured, by the cage's own coordinates (box mapping would stay within the cube's size)
	tms := make([dynamic]fart.Tri_Mesh)
	defer fart.destroy_tri_meshes(&tms)
	fart.flatten_part(&doc, &doc.parts[0], &tms)
	testing.expect_value(t, tms[0].texture, "weave")
	testing.expect_value(t, len(tms[0].uvs), len(tms[0].positions))
	hi: f32 = -1e9
	lo: f32 = 1e9
	for uv in tms[0].uvs do hi, lo = max(hi, uv.x, uv.y), min(lo, uv.x, uv.y)
	testing.expectf(t, hi > 3.9 && lo >= 0, "the pattern runs 0 to 4 over each face, got %v to %v", lo, hi)
	fart.destroy_3d(&doc)
}

// 1.10: soften and relief are read; an unwrapped sheet's uvs come out of flattening, through the subdivision.
@(test)
relief_3d :: proc(t: ^testing.T) {
	context.allocator = context.temp_allocator
	data, err := os.read_entire_file(EXAMPLES + "valid/dented.fart", context.temp_allocator)
	if !testing.expect(t, err == nil) do return
	doc, ok := fart.load_bytes_3d(data)
	if !testing.expect(t, ok, "dented loads") do return
	testing.expect(t, abs(doc.textures[0].relief - 0.5) < 1e-6, "relief")
	testing.expect(t, abs(doc.textures[0].maps["height"].soften - 0.4) < 1e-6, "soften")
	testing.expect_value(t, len(doc.parts[0].shapes[0].mapping.uvs), 6)
	ms := make([dynamic]fart.Tri_Mesh, context.temp_allocator)
	fart.flatten_part(&doc, &doc.parts[0], &ms)
	// six cage faces, subdivided once: twenty-four quads, forty-eight triangles, each corner with its uv
	testing.expect_value(t, len(ms[0].positions), 48 * 3)
	testing.expect_value(t, len(ms[0].uvs), 48 * 3)
	lo, hi := fart.V2{16, 16}, fart.V2{0, 0}
	for uv in ms[0].uvs {
		lo = {min(lo.x, uv.x), min(lo.y, uv.y)}
		hi = {max(hi.x, uv.x), max(hi.y, uv.y)}
	}
	// the sheet, not box mapping (which would span -4..4 on an 8-unit block)
	testing.expect(t, lo.x > 0 && lo.y > 0 && hi.x > 8 && hi.x <= 16 && hi.y <= 16, "the uvs are the unwrapped sheet's")
}
