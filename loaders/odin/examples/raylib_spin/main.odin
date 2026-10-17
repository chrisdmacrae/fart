package raylib_spin

// The fifty lines for 3D: load a 3D .fart, flatten each part into a
// raylib mesh with the light baked into its vertex colours, and draw the
// parts through their world maps every frame while a clip plays. A
// textured shape (1.5) gets its texture's colour map rasterised into a
// render texture by drawing the map's 2D .fart with raylib, then
// sampled with the flattened uvs. Run from the repo root:
//
//     odin run loaders/odin/examples/raylib_spin            # the flintlock
//     odin run loaders/odin/examples/raylib_spin -- spec/examples/valid/crate.fart
//
// Space plays the next clip; drag turns the camera.

import "base:runtime"
import "core:fmt"
import "core:math/linalg"
import "core:os"
import rl "vendor:raylib"
import rlgl "vendor:raylib/rlgl"
import fart "../.."

DEFAULT_FILE :: #directory + "/../../../../examples/pistol/flintlock.fart"
TEX_PX :: 64 // pixels per cell unit when a map is rasterised
LIGHT :: fart.V3{-1, -2, -3} // toward the light, rest space of the whole model
AMBIENT :: f32(0.4)

Part_Draw :: struct {
	part:      ^fart.Part3,
	meshes:    [dynamic]rl.Mesh,
	materials: [dynamic]rl.Material, // one per mesh: flat, or the texture's
}

// The fifty lines for 2D, in raylib: draw a 2D .fart's state into the
// current render target, `k` pixels per unit, offset so the cell's
// [0, 0] lands at the top-left.
draw_2d :: proc(doc: ^fart.Doc, state: string, k: f32) {
	st := fart.state_of(doc, state)
	poses: []fart.State_Part = st != nil ? st.parts[:] : nil
	draw_shapes :: proc(doc: ^fart.Doc, part: ^fart.Part, W: fart.Xf, k: f32) {
		for &sh in fart.shapes_of(doc, part) {
			c := fart.color_of(doc, sh.color)
			c = fart.shade_color(c, sh.shade)
			col := rl.Color{c[0], c[1], c[2], c[3]}
			s := fart.xf_scale(W)
			to :: proc(W: fart.Xf, p: fart.V2, k: f32) -> rl.Vector2 {
				q := fart.xf_apply(W, p)
				return {q.x * k, q.y * k}
			}
			switch sh.kind {
			case "circle":
				rl.DrawCircleV(to(W, sh.at, k), sh.r * s * k, col)
			case "line":
				rl.DrawLineEx(to(W, sh.a, k), to(W, sh.b, k), sh.w * s * k, col)
				rl.DrawCircleV(to(W, sh.a, k), sh.w * s * k / 2, col)
				rl.DrawCircleV(to(W, sh.b, k), sh.w * s * k / 2, col)
			case "poly":
				tris := sh.tris
				if len(tris) < 3 {
					fart.triangulate(sh.points[:], &tris)
				}
				for i := 0; i + 2 < len(tris); i += 3 {
					a, b, cc := to(W, sh.points[tris[i]], k), to(W, sh.points[tris[i + 1]], k), to(W, sh.points[tris[i + 2]], k)
					rl.DrawTriangle(a, b, cc, col)
					rl.DrawTriangle(a, cc, b, col) // either winding
				}
			}
		}
	}
	if poses == nil {
		for &p in doc.parts do draw_shapes(doc, &p, fart.XF_ID, k)
		return
	}
	for sp in poses {
		part := fart.part_of(doc, sp.part)
		if part == nil do continue
		draw_shapes(doc, part, fart.world_xf(doc, poses, part.name), k)
	}
}

// A texture's colour map as a GPU texture: one cell, drawn three times
// across so shapes that cross the cell's edge wrap, then cropped; or
// (1.12) the map's picture, uploaded as it is.
rasterize_color_map :: proc(doc: ^fart.Doc3, name: string) -> (rl.Texture2D, bool) {
	tex := fart.texture_of_3d(doc, name)
	maps, has := doc.texture_docs[name]
	if tex == nil || !has do return {}, false
	color, hc := maps["color"]
	if !hc do return {}, false
	// 1.12: a picture is already pixels; it fills the cell whatever its size
	if color.pixels != nil {
		img := rl.Image{data = raw_data(color.pixels), width = i32(color.width), height = i32(color.height), mipmaps = 1, format = .UNCOMPRESSED_R8G8B8A8}
		gpu := rl.LoadTextureFromImage(img)
		rl.SetTextureWrap(gpu, .REPEAT)
		return gpu, true
	}
	w, h := i32(tex.cell.x * TEX_PX), i32(tex.cell.y * TEX_PX)
	rt := rl.LoadRenderTexture(w, h)
	rl.BeginTextureMode(rt)
	rl.ClearBackground(rl.BLANK)
	for oy in -1 ..= 1 do for ox in -1 ..= 1 {
		rlgl.PushMatrix()
		rlgl.Translatef(f32(ox) * tex.cell.x * TEX_PX, f32(oy) * tex.cell.y * TEX_PX, 0)
		draw_2d(&color.doc, color.state, TEX_PX)
		rlgl.PopMatrix()
	}
	rl.EndTextureMode()
	rl.SetTextureWrap(rt.texture, .REPEAT)
	return rt.texture, true
}

main :: proc() {
	file := len(os.args) > 1 ? os.args[1] : DEFAULT_FILE
	data, err := os.read_entire_file(file, context.allocator)
	if err != nil {
		fmt.eprintln("cannot read", file, err)
		return
	}
	doc, dok := fart.load_bytes_3d(data)
	if !dok {
		fmt.eprintln("not a 3D .fart")
		return
	}
	// palette refs and texture maps are relative to the file
	dir := file
	for i := len(file) - 1; i >= 0; i -= 1 do if file[i] == '/' {
		dir = file[:i + 1]
		break
	}
	resolver :: proc(path: string, user: rawptr) -> ([]byte, bool) {
		dir := (cast(^string)user)^
		d, e := os.read_entire_file(fmt.tprintf("%s%s", dir, path), context.allocator)
		return d, e == nil
	}
	fart.resolve_palettes_3d(&doc, resolver, &dir)
	fart.resolve_textures_3d(&doc, resolver, &dir)
	rl.InitWindow(900, 600, "fastart")
	defer rl.CloseWindow()
	rl.SetTargetFPS(60)
	// the textures' colour maps, rasterised once
	textures := make(map[string]rl.Texture2D)
	for &t in doc.textures {
		if tx, ok := rasterize_color_map(&doc, t.name); ok do textures[t.name] = tx
	}
	flat := rl.LoadMaterialDefault()

	// every part's shapes as raylib meshes, once; the light is baked into
	// the colours (a real game lights in a shader and keeps the normals)
	light := linalg.normalize(LIGHT)
	draws := make([dynamic]Part_Draw)
	for &p in doc.parts {
		tms := make([dynamic]fart.Tri_Mesh)
		fart.flatten_part(&doc, &p, &tms)
		pd := Part_Draw{part = &p}
		for &tm in tms {
			n := len(tm.positions)
			m: rl.Mesh
			m.vertexCount = i32(n)
			m.triangleCount = i32(n / 3)
			verts := make([]f32, n * 3)
			norms := make([]f32, n * 3)
			cols := make([]u8, n * 4)
			tex, textured := textures[tm.texture]
			cell := textured ? fart.texture_of_3d(&doc, tm.texture).cell : fart.V2{1, 1}
			uvs := make([]f32, n * 2)
			base := fart.color_of_3d(&doc, tm.color)
			for i in 0 ..< n {
				q := fart.to_y_up(tm.positions[i])
				nn := fart.to_y_up(tm.normals[i])
				verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2] = q.x, q.y, q.z
				norms[i * 3], norms[i * 3 + 1], norms[i * 3 + 2] = nn.x, nn.y, nn.z
				lit := max(0, linalg.dot(tm.normals[i], light))
				shade := (tm.shade == 0 ? 1 : tm.shade) * (AMBIENT + (1 - AMBIENT) * lit)
				// a textured face: the light on white, the map supplies the colour where it paints (the token shows through elsewhere)
				c := fart.shade_color(textured ? {255, 255, 255, 255} : base, shade)
				cols[i * 4], cols[i * 4 + 1], cols[i * 4 + 2], cols[i * 4 + 3] = c[0], c[1], c[2], c[3]
				if textured {
					uvs[i * 2], uvs[i * 2 + 1] = tm.uvs[i].x / cell.x, tm.uvs[i].y / cell.y
				}
			}
			m.vertices = raw_data(verts)
			m.normals = raw_data(norms)
			m.colors = raw_data(cols)
			if textured do m.texcoords = raw_data(uvs)
			rl.UploadMesh(&m, false)
			append(&pd.meshes, m)
			mat := rl.LoadMaterialDefault()
			if textured do rl.SetMaterialTexture(&mat, .ALBEDO, tex)
			append(&pd.materials, mat)
		}
		append(&draws, pd)
	}
	_ = flat

	camera := rl.Camera3D{position = {30, 18, 40}, target = {0, -2, 0}, up = {0, 1, 0}, fovy = 40, projection = .PERSPECTIVE}
	clip_i := 0
	t: f32
	frame := make([dynamic]fart.State_Part3)
	for !rl.WindowShouldClose() {
		dt := rl.GetFrameTime()
		if rl.IsKeyPressed(.SPACE) && len(doc.clips) > 0 {
			clip_i = (clip_i + 1) % len(doc.clips)
			t = 0
		}
		rl.UpdateCamera(&camera, .THIRD_PERSON)
		// the pose: the clip's frame at t, or the first state
		if len(doc.clips) > 0 {
			c := &doc.clips[clip_i]
			t += dt
			if !c.loop && t > fart.clip_duration_3d(c) + 0.5 do t = 0
			// a frame's mixed morphs are allocated with the context allocator: the temp arena, freed below
			context.allocator = context.temp_allocator
			fart.sample_clip_3d(&doc, c, t, &frame)
			context.allocator = runtime.default_allocator()
		} else if len(doc.states) > 0 {
			clear(&frame)
			append(&frame, ..doc.states[0].parts[:])
		}
		rl.BeginDrawing()
		rl.ClearBackground({30, 30, 34, 255})
		rl.BeginMode3D(camera)
		rl.DrawGrid(20, 2)
		for &sp in frame {
			for &pd in draws {
				if pd.part.name != sp.part do continue
				// a morph (1.6): the part's meshes re-flattened under this frame's points, the buffers refreshed in place
				if fart.morphs_3d(&doc, &sp) {
					tms := make([dynamic]fart.Tri_Mesh, context.temp_allocator)
					fart.flatten_part_posed(&doc, pd.part, &sp, &tms)
					for &tm, mi in tms {
						if mi >= len(pd.meshes) do break
						n := len(tm.positions)
						if n != int(pd.meshes[mi].vertexCount) do continue
						verts := make([]f32, n * 3, context.temp_allocator)
						norms := make([]f32, n * 3, context.temp_allocator)
						for i in 0 ..< n {
							q := fart.to_y_up(tm.positions[i])
							nn := fart.to_y_up(tm.normals[i])
							verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2] = q.x, q.y, q.z
							norms[i * 3], norms[i * 3 + 1], norms[i * 3 + 2] = nn.x, nn.y, nn.z
						}
						rl.UpdateMeshBuffer(pd.meshes[mi], 0, raw_data(verts), i32(n * 3 * size_of(f32)), 0)
						rl.UpdateMeshBuffer(pd.meshes[mi], 2, raw_data(norms), i32(n * 3 * size_of(f32)), 0)
					}
				}
				W := fart.Y_UP * fart.world_xf_3d(&doc, frame[:], pd.part.name) // the pose, in engine space
				for m, mi in pd.meshes do rl.DrawMesh(m, pd.materials[mi], rl.Matrix(W))
			}
		}
		free_all(context.temp_allocator)
		rl.EndMode3D()
		name := len(doc.clips) > 0 ? doc.clips[clip_i].name : "rest"
		rl.DrawText(rl.TextFormat("%s  ·  space: next clip  ·  drag: orbit", name), 12, 12, 18, rl.LIGHTGRAY)
		rl.EndDrawing()
	}
}
