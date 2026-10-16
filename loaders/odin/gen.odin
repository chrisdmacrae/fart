package fastart

// Generation (1.8): what turns a shape in the file into the mesh a
// renderer draws. The order is the spec's: the cage (a sweep's generated
// mesh), a morph's points, the `mods` in list order, `smooth`, triangles.
//
//   as_mesh(sh)     the drawn mesh: a bake when the shape has one, else
//                   the cage with its mods applied and subdivided
//   built_mesh(sh)  the cage with its mods applied, before smoothing: what
//                   collision and a hull read
//   sweep_mesh(sh)  a sweep's cage: lathe, extrude, pipe, rail (curves.odin)
//
// Paint (a palette token per face), shades (a factor per point), creases
// and explicit pattern coordinates ride through every step as the spec
// tells. The order of points and faces is the TypeScript reference's
// (packages/core: mods.ts, subdiv.ts, solids.ts), index for index, since
// `paint`, bakes and morph targets count them; and so are the numbers:
// the sums here are done in f64, in the reference's own order, and rounded
// where it rounds (three places for a sweep, four after mods and after
// each level of subdivision), so a mesh made here is the mesh `fart bake`
// and `fart build` make. The file's own numbers arrive as f32 and are
// read back as the short decimals they were written as (to_f64).
//
// Bakes: the loader draws a shape's `bake` whenever it has one and the
// bake holds what the shape needs (`paint` for a painted shape, `shades`
// for a shaded one, `uvs` for explicit pattern coordinates). It does NOT
// check `bake.of`: that hash is over JavaScript's own printing of numbers
// (JSON.stringify), which a loader in another language cannot reproduce
// byte for byte. Keep bakes fresh in the build (`fart bake --smooth`), or
// leave them out and let the loader generate; the compiled sidecar
// (sidecar.odin) is the checked way to skip generation.

import "core:math"

@(private)
D3 :: [3]f64
@(private)
D2 :: [2]f64

// 1.8: one modifier of a mesh or a sweep, applied to the cage in list order.
Mod :: struct {
	op:     string, // "mirror" | "solidify" | "crease"; any other is passed over
	axis:   string, // mirror: "x" | "y" | "z"
	merge:  Maybe(f32), // mirror: a point this near the plane is welded; 0.001 when absent
	thick:  f32, // solidify: the wall's depth
	offset: Maybe(f32), // solidify: -1 (absent) the cage is the outside, 1 the inside, 0 the middle
	inner:  Maybe(int), // solidify: the paint of the inner faces; absent, their source's
	rim:    Maybe(int), // solidify: the paint of the rim; absent, the face's the edge belongs to
	angle:  Maybe(f32), // crease: degrees, 30 when absent
	value:  Maybe(f32), // crease: 0..1, 1 when absent
}

// 1.8: a pipe's spine, a path body with three coordinates; handles are relative to their points.
Path3 :: struct {
	points: [dynamic]V3,
	in_:    [dynamic]V3 `json:"in"`,
	out:    [dynamic]V3,
}

// An f32 from the file as the f64 the file's text meant: the shortest
// decimal (four to seven places) that reads back as the same f32, else
// the f32 widened. 0.3 comes back as 0.3, not 0.30000001192.
@(private)
to_f64 :: proc(x: f32) -> f64 {
	v := f64(x)
	scales := [4]f64{1e4, 1e5, 1e6, 1e7}
	for s in scales {
		r := math.round(v * s) / s
		if f32(r) == x do return r
	}
	return v
}

// JavaScript's Math.round: halves go up.
@(private)
js_round :: proc(x: f64) -> f64 {
	r := math.floor(x)
	return x - r >= 0.5 ? r + 1 : r
}

@(private)
r3 :: proc(x: f64) -> f64 {
	return js_round(x * 1000) / 1000 + 0
}

@(private)
r4 :: proc(x: f64) -> f64 {
	return js_round(x * 10000) / 10000 + 0
}

@(private)
round3 :: proc(p: D3) -> D3 {
	return {r3(p.x), r3(p.y), r3(p.z)}
}

@(private)
dot64 :: proc(a, b: D3) -> f64 {
	return a.x * b.x + a.y * b.y + a.z * b.z
}

@(private)
cross64 :: proc(a, b: D3) -> D3 {
	return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x}
}

@(private)
len64 :: proc(a: D3) -> f64 {
	return math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z)
}

@(private)
norm64 :: proc(a: D3) -> D3 {
	l := len64(a)
	return l > 0 ? a * (1 / l) : D3{}
}

// ---------------------------------------------------------------- the working mesh

@(private)
Crease64 :: struct {
	a, b:   int, // an edge's two points; a corner's point in a
	c:      f64,
	corner: bool,
}

// A mesh while it is being made: f64, on the temp allocator.
@(private)
Mesh64 :: struct {
	points:  [dynamic]D3,
	rest:    [dynamic]D3, // the rest cage under a morph (what the mods decide on); empty when it is `points`
	faces:   [dynamic][dynamic]u16,
	paint:   [dynamic]int, // one per face, always
	shades:  [dynamic]f64, // one per point, or none
	creases: [dynamic]Crease64,
	uvs:     [dynamic][dynamic]D2, // one list per face, or none
}

// Is this `paint` one a reader can use: a number per face, each 0 or a place in `colors`?
paint_fits :: proc(paint: []int, faces: int, colors: int) -> bool {
	if len(paint) == 0 || len(paint) != faces || colors == 0 do return false
	for p in paint do if p < 0 || p > colors do return false
	return true
}

// A mesh shape as a working mesh. False when a face names a point the mesh lacks.
@(private)
mesh64_of :: proc(sh: ^Shape3) -> (m: Mesh64, ok: bool) {
	context.allocator = context.temp_allocator
	n := len(sh.points)
	for f in sh.faces do for i in f do if int(i) >= n do return {}, false
	m.points = make([dynamic]D3, n)
	for p, i in sh.points do m.points[i] = {to_f64(p.x), to_f64(p.y), to_f64(p.z)}
	if len(sh.rest) == n && n > 0 && raw_data(sh.rest) != raw_data(sh.points[:]) {
		m.rest = make([dynamic]D3, n)
		for p, i in sh.rest do m.rest[i] = {to_f64(p.x), to_f64(p.y), to_f64(p.z)}
	}
	m.faces = make([dynamic][dynamic]u16, len(sh.faces))
	for f, i in sh.faces {
		m.faces[i] = make([dynamic]u16, len(f))
		copy(m.faces[i][:], f[:])
	}
	// a paint the reader cannot use draws the shape in `color`
	m.paint = make([dynamic]int, len(sh.faces))
	if paint_fits(sh.paint[:], len(sh.faces), len(sh.colors)) do copy(m.paint[:], sh.paint[:])
	if len(sh.shades) == n && n > 0 {
		m.shades = make([dynamic]f64, n)
		for s, i in sh.shades do m.shades[i] = to_f64(s)
	}
	m.creases = make([dynamic]Crease64, 0, len(sh.creases))
	for c in sh.creases {
		if len(c) >= 3 do append(&m.creases, Crease64{a = int(c[0]), b = int(c[1]), c = to_f64(c[2])})
		else if len(c) == 2 do append(&m.creases, Crease64{a = int(c[0]), c = to_f64(c[1]), corner = true})
	}
	if uvs_fit(sh.mapping.uvs[:], sh.faces[:]) {
		m.uvs = make([dynamic][dynamic]D2, len(sh.faces))
		for f, i in sh.mapping.uvs {
			m.uvs[i] = make([dynamic]D2, len(f))
			for uv, k in f do m.uvs[i][k] = {to_f64(uv.x), to_f64(uv.y)}
		}
	}
	return m, true
}

// The working mesh as a shape wearing `look`'s colour, shade, texture and
// normals: a plain mesh, nothing left to generate. Paint is kept only
// when some face is painted, and an index past `colors` (a solidify's
// `inner` or `rim` the file should not have) reads as the shape's colour.
@(private)
shape_of64 :: proc(m: ^Mesh64, look: ^Shape3, allocator := context.allocator) -> Shape3 {
	out: Shape3
	out.kind = "mesh"
	out.color = look.color
	out.shade = look.shade
	out.texture = look.texture
	out.mapping.scale = look.mapping.scale
	out.normals = look.normals
	out.angle = look.angle
	out.colors = look.colors
	out.points = make([dynamic]V3, len(m.points), allocator)
	for p, i in m.points do out.points[i] = {f32(p.x), f32(p.y), f32(p.z)}
	out.faces = make([dynamic][dynamic]u16, len(m.faces), allocator)
	for f, i in m.faces {
		out.faces[i] = make([dynamic]u16, len(f), allocator)
		copy(out.faces[i][:], f[:])
	}
	painted := false
	for p in m.paint do if p > 0 && p <= len(look.colors) do painted = true
	if painted && len(m.paint) == len(m.faces) {
		out.paint = make([dynamic]int, len(m.paint), allocator)
		for p, i in m.paint do out.paint[i] = p > 0 && p <= len(look.colors) ? p : 0
	}
	if len(m.shades) == len(m.points) && len(m.points) > 0 {
		out.shades = make([dynamic]f32, len(m.shades), allocator)
		for s, i in m.shades do out.shades[i] = f32(s)
	}
	if len(m.creases) > 0 {
		out.creases = make([dynamic][dynamic]f32, len(m.creases), allocator)
		for c, i in m.creases {
			out.creases[i] = make([dynamic]f32, 0, 3, allocator)
			if c.corner do append(&out.creases[i], f32(c.a), f32(c.c))
			else do append(&out.creases[i], f32(c.a), f32(c.b), f32(c.c))
		}
	}
	if len(m.uvs) == len(m.faces) && len(m.faces) > 0 {
		out.mapping.uvs = make([dynamic][dynamic]V2, len(m.uvs), allocator)
		for f, i in m.uvs {
			out.mapping.uvs[i] = make([dynamic]V2, len(f), allocator)
			for uv, k in f do out.mapping.uvs[i][k] = {f32(uv.x), f32(uv.y)}
		}
	}
	return out
}

// ---------------------------------------------------------------- paths, in f64

@(private)
flatten_cubic64 :: proc(p0, p1, p2, p3: D2, tol: f64, out: ^[dynamic]D2, depth := 0) {
	d := p3 - p0
	l := math.sqrt(d.x * d.x + d.y * d.y)
	d1, d2: f64
	if l < 1e-12 {
		d1 = math.sqrt((p1.x - p0.x) * (p1.x - p0.x) + (p1.y - p0.y) * (p1.y - p0.y))
		d2 = math.sqrt((p2.x - p0.x) * (p2.x - p0.x) + (p2.y - p0.y) * (p2.y - p0.y))
	} else {
		d1 = abs((p1.x - p0.x) * d.y - (p1.y - p0.y) * d.x) / l
		d2 = abs((p2.x - p0.x) * d.y - (p2.y - p0.y) * d.x) / l
	}
	if depth >= 16 || max(d1, d2) <= tol {
		append(out, p3)
		return
	}
	p01, p12, p23 := (p0 + p1) / 2, (p1 + p2) / 2, (p2 + p3) / 2
	p012, p123 := (p01 + p12) / 2, (p12 + p23) / 2
	mid := (p012 + p123) / 2
	flatten_cubic64(p0, p01, p012, mid, tol, out, depth + 1)
	flatten_cubic64(mid, p123, p23, p3, tol, out, depth + 1)
}

// A profile as its polygon: the points as they are when nothing bends,
// else flattened within the path tolerance and rounded to three places.
@(private)
profile64 :: proc(pr: ^Profile, closed: bool) -> [dynamic]D2 {
	context.allocator = context.temp_allocator
	n := len(pr.points)
	res := make([dynamic]D2, 0, n * 4)
	if n == 0 do return res
	at :: proc(v: []V2, i: int) -> D2 {
		return i < len(v) ? D2{to_f64(v[i].x), to_f64(v[i].y)} : D2{}
	}
	zero :: proc(v: D2) -> bool {
		return abs(v.x) < 1e-9 && abs(v.y) < 1e-9
	}
	curved := false
	for i in 0 ..< len(pr.in_) do if !zero(at(pr.in_[:], i)) do curved = true
	for i in 0 ..< len(pr.out) do if !zero(at(pr.out[:], i)) do curved = true
	if !curved {
		for i in 0 ..< n do append(&res, at(pr.points[:], i))
		return res
	}
	append(&res, at(pr.points[:], 0))
	segs := closed ? n : n - 1
	for i in 0 ..< segs {
		j := (i + 1) % n
		a, b := at(pr.points[:], i), at(pr.points[:], j)
		o, inn := at(pr.out[:], i), at(pr.in_[:], j)
		if zero(o) && zero(inn) do append(&res, b)
		else do flatten_cubic64(a, a + o, b + inn, b, 0.05, &res)
	}
	if closed do pop(&res)
	for &p in res do p = {r3(p.x), r3(p.y)}
	return res
}

// A pipe's spine as a polyline within the tolerance, and where each of
// its points sits along the path: the segment's index plus the cubic's
// own parameter there.
@(private)
spine64 :: proc(path: ^Path3, closed: bool, points: ^[dynamic]D3, at: ^[dynamic]f64) {
	n := len(path.points)
	if n == 0 do return
	get :: proc(v: []V3, i: int) -> D3 {
		return i < len(v) ? D3{to_f64(v[i].x), to_f64(v[i].y), to_f64(v[i].z)} : D3{}
	}
	zero :: proc(v: D3) -> bool {
		return abs(v.x) < 1e-9 && abs(v.y) < 1e-9 && abs(v.z) < 1e-9
	}
	// how far a control point stands off the chord
	off :: proc(p, a, b: D3) -> f64 {
		d := b - a
		v := p - a
		l := len64(d)
		if l < 1e-12 do return len64(v)
		return len64({v.y * d.z - v.z * d.y, v.z * d.x - v.x * d.z, v.x * d.y - v.y * d.x}) / l
	}
	cubic :: proc(p0, p1, p2, p3: D3, t0, t1: f64, depth: int, points: ^[dynamic]D3, at: ^[dynamic]f64) {
		if depth >= 16 || max(off(p1, p0, p3), off(p2, p0, p3)) <= 0.05 {
			append(points, p3)
			append(at, t1)
			return
		}
		p01, p12, p23 := (p0 + p1) / 2, (p1 + p2) / 2, (p2 + p3) / 2
		p012, p123 := (p01 + p12) / 2, (p12 + p23) / 2
		m := (p012 + p123) / 2
		tm := (t0 + t1) / 2
		cubic(p0, p01, p012, m, t0, tm, depth + 1, points, at)
		cubic(m, p123, p23, p3, tm, t1, depth + 1, points, at)
	}
	append(points, get(path.points[:], 0))
	append(at, 0)
	segs := closed ? n : n - 1
	for i in 0 ..< segs {
		j := (i + 1) % n
		a, b := get(path.points[:], i), get(path.points[:], j)
		o, inn := get(path.out[:], i), get(path.in_[:], j)
		if zero(o) && zero(inn) {
			append(points, b)
			append(at, f64(i + 1))
		} else {
			cubic(a, a + o, b + inn, b, f64(i), f64(i + 1), 0, points, at)
		}
	}
	if closed {
		pop(points)
		pop(at)
	}
}

// ---------------------------------------------------------------- sweeps, in f64

@(private)
lift64 :: proc(axis: string, along: f64, uv: D2) -> D3 {
	switch axis {
	case "x":
		return {along, uv.y, uv.x}
	case "y":
		return {uv.x, along, uv.y}
	}
	return {uv.x, uv.y, along}
}

// Make every face of a closed mesh wind outward: neighbours are made to
// agree across shared edges, then the whole is flipped when its signed
// volume comes out negative. Concave solids are fine.
@(private)
wind_outward64 :: proc(points: []D3, faces: [][dynamic]u16) {
	context.allocator = context.temp_allocator
	n := len(faces)
	if n == 0 do return
	by_edge := make(map[u32][dynamic]int)
	for f, fi in faces {
		for i in 0 ..< len(f) {
			k := edge_key(f[i], f[(i + 1) % len(f)])
			if k not_in by_edge do by_edge[k] = make([dynamic]int)
			append(&by_edge[k], fi)
		}
	}
	seen := make([]bool, n)
	queue := make([dynamic]int, 0, n)
	for start in 0 ..< n {
		if seen[start] do continue
		seen[start] = true
		clear(&queue)
		append(&queue, start)
		for head := 0; head < len(queue); head += 1 {
			fi := queue[head]
			f := faces[fi]
			for i in 0 ..< len(f) {
				a, b := f[i], f[(i + 1) % len(f)]
				for nb in by_edge[edge_key(a, b)] {
					if nb == fi || seen[nb] do continue
					// a consistent neighbour walks the shared edge the other way
					g := faces[nb]
					same := false
					for x, gi in g do if x == a && g[(gi + 1) % len(g)] == b do same = true
					if same do slice_reverse(g[:])
					seen[nb] = true
					append(&queue, nb)
				}
			}
		}
	}
	vol: f64
	for f in faces {
		for i in 1 ..< len(f) - 1 do vol += dot64(points[f[0]], cross64(points[f[i]], points[f[i + 1]]))
	}
	if vol < 0 do for f in faces do slice_reverse(f[:])
}

// A sweep's cage (1.7; the pipe 1.8), on the temp allocator: only points and faces.
@(private)
sweep64 :: proc(sh: ^Shape3) -> Mesh64 {
	context.allocator = context.temp_allocator
	m: Mesh64
	m.points = make([dynamic]D3)
	m.faces = make([dynamic][dynamic]u16)
	face :: proc(m: ^Mesh64, idx: ..u16) {
		f := make([dynamic]u16, len(idx))
		copy(f[:], idx)
		append(&m.faces, f)
	}
	switch sh.op {
	case "pipe":
		if len(sh.path.points) > 0 do pipe64(sh, &m)
	case "rail":
		if len(sh.path.points) > 0 && len(sh.profile.points) > 0 do rail64(sh, &m)
	case "lathe":
		if len(sh.profile.points) == 0 do break
		profile := profile64(&sh.profile, sh.profile.closed)
		axis := sh.axis == "" ? "y" : sh.axis
		segments := sh.segments == 0 ? 12 : max(3, sh.segments)
		rings := make([dynamic][dynamic]u16)
		for p in profile {
			ring := make([dynamic]u16)
			if p.x <= 0 {
				append(&m.points, round3(lift64(axis, p.y, {0, 0})))
				append(&ring, u16(len(m.points) - 1))
			} else {
				for k in 0 ..< segments {
					th := f64(k) / f64(segments) * math.PI * 2
					append(&m.points, round3(lift64(axis, p.y, {p.x * math.cos(th), p.x * math.sin(th)})))
					append(&ring, u16(len(m.points) - 1))
				}
			}
			append(&rings, ring)
		}
		for i in 0 ..< len(rings) - 1 {
			a, b := rings[i], rings[i + 1]
			if len(a) == 1 && len(b) == 1 do continue
			for k in 0 ..< segments {
				k2 := (k + 1) % segments
				if len(a) == 1 do face(&m, a[0], b[k2], b[k])
				else if len(b) == 1 do face(&m, a[k], a[k2], b[0])
				else do face(&m, a[k], a[k2], b[k2], b[k])
			}
		}
		if len(rings) > 0 && len(rings[0]) > 1 do face(&m, ..rings[0][:])
		if len(rings) > 0 && len(rings[len(rings) - 1]) > 1 do face(&m, ..rings[len(rings) - 1][:])
		wind_outward64(m.points[:], m.faces[:])
	case:
		// extrude
		if len(sh.profile.points) == 0 do break
		profile := profile64(&sh.profile, true)
		n := len(profile)
		if n < 3 do break
		axis := sh.axis == "" ? "z" : sh.axis
		for p in profile do append(&m.points, round3(lift64(axis, to_f64(sh.from), p)))
		for p in profile do append(&m.points, round3(lift64(axis, to_f64(sh.to), p)))
		bottom := make([dynamic]u16, n)
		top := make([dynamic]u16, n)
		for i in 0 ..< n do bottom[i], top[i] = u16(i), u16(i + n)
		append(&m.faces, bottom, top)
		for i in 0 ..< n {
			j := (i + 1) % n
			face(&m, u16(i), u16(j), u16(j + n), u16(i + n))
		}
		wind_outward64(m.points[:], m.faces[:])
	}
	return m
}

// 1.8: a section carried along a path in space. One ring of points per
// flattened path point, in section order; the sides ring by ring, then
// the cap at the start (reversed) and the cap at the end. The section
// keeps its bearing by parallel transport; a closed path spreads what
// twist a circuit leaves evenly along itself. A scale of 0 at an open
// end is an apex.
@(private)
pipe64 :: proc(sh: ^Shape3, m: ^Mesh64) {
	closed := sh.closed
	flat := make([dynamic]D3)
	flat_at := make([dynamic]f64)
	spine64(&sh.path, closed, &flat, &flat_at)
	apart :: proc(a, b: D3) -> bool {
		return len64(a - b) > 1e-9
	}
	// a point that sits on the one before it has no direction to offer
	P := make([dynamic]D3, 0, len(flat))
	at := make([dynamic]f64, 0, len(flat))
	for p, i in flat {
		if len(P) > 0 && !apart(p, P[len(P) - 1]) do continue
		append(&P, p)
		append(&at, flat_at[i])
	}
	if closed && len(P) > 1 && !apart(P[0], P[len(P) - 1]) {
		pop(&P)
		pop(&at)
	}
	count := len(P)
	if count < (closed ? 3 : 2) do return
	n := len(sh.path.points)
	radius := f64(1)
	if r, has := sh.radius.?; has do radius = to_f64(r)
	radii: []f32
	if len(sh.radii) == n do radii = sh.radii[:]
	scale_at :: proc(t, radius: f64, radii: []f32, n: int, closed: bool) -> f64 {
		if radii == nil do return radius
		i := clamp(int(math.floor(t)), 0, n - 1)
		if !closed && i >= n - 1 do return radius * to_f64(radii[n - 1])
		u := t - f64(i)
		return radius * (to_f64(radii[i]) * (1 - u) + to_f64(radii[(i + 1) % n]) * u)
	}
	section: [dynamic]D2
	if len(sh.profile.points) > 0 {
		section = profile64(&sh.profile, true)
		if len(section) >= 3 {
			area: f64
			for p, i in section {
				q := section[(i + 1) % len(section)]
				area += p.x * q.y - q.x * p.y
			}
			if area < 0 do for i, j := 0, len(section) - 1; i < j; i, j = i + 1, j - 1 do section[i], section[j] = section[j], section[i]
		}
	}
	if len(section) < 3 {
		sides := sh.segments == 0 ? 8 : max(3, sh.segments)
		section = make([dynamic]D2, sides)
		for k in 0 ..< sides {
			th := f64(k) / f64(sides) * math.PI * 2
			section[k] = {math.cos(th), math.sin(th)}
		}
	}
	// tangents: along the one segment at an open end, between the two segments elsewhere
	dir :: proc(P: []D3, i: int) -> D3 {
		return norm64(P[(i + 1) % len(P)] - P[i])
	}
	T := make([]D3, count)
	for i in 0 ..< count {
		if !closed && i == 0 do T[i] = dir(P[:], 0)
		else if !closed && i == count - 1 do T[i] = dir(P[:], count - 2)
		else {
			a, b := dir(P[:], (i + count - 1) % count), dir(P[:], i)
			sum := a + b
			T[i] = len64(sum) < 1e-9 ? b : norm64(sum)
		}
	}
	square :: proc(nrm, t: D3) -> D3 {
		d := dot64(nrm, t)
		return norm64(nrm - t * d)
	}
	// v turned about the unit axis k
	turn :: proc(v, k: D3, c, sn: f64) -> D3 {
		kxv := cross64(k, v)
		kd := dot64(k, v) * (1 - c)
		return v * c + kxv * sn + k * kd
	}
	// a normal carried from tangent a to tangent b by the shortest turn between them
	carry :: proc(nrm, a, b: D3) -> D3 {
		axis := cross64(a, b)
		sn := len64(axis)
		if sn < 1e-12 do return square(nrm, b)
		return square(turn(nrm, axis / sn, dot64(a, b), sn), b)
	}
	// the first normal: the axis the path leans on least, squared off against the tangent
	t0 := D3{abs(T[0].x), abs(T[0].y), abs(T[0].z)}
	seed := D3{0, 0, 1}
	if t0.x <= t0.y && t0.x <= t0.z do seed = {1, 0, 0}
	else if t0.y <= t0.z do seed = {0, 1, 0}
	N := make([]D3, count)
	N[0] = square(seed, T[0])
	for i in 1 ..< count do N[i] = carry(N[i - 1], T[i - 1], T[i])
	if closed {
		back := carry(N[count - 1], T[count - 1], T[0])
		twist := math.atan2(dot64(cross64(back, N[0]), T[0]), dot64(back, N[0]))
		for i in 1 ..< count {
			a := twist * f64(i) / f64(count)
			N[i] = square(turn(N[i], T[i], math.cos(a), math.sin(a)), T[i])
		}
	}
	rings := make([][dynamic]u16, count)
	for i in 0 ..< count {
		s := scale_at(at[i], radius, radii, n, closed)
		rings[i] = make([dynamic]u16)
		if !closed && (i == 0 || i == count - 1) && s <= 0 {
			append(&m.points, round3(P[i]))
			append(&rings[i], u16(len(m.points) - 1))
			continue
		}
		B := cross64(T[i], N[i])
		for c in section {
			append(&m.points, round3({P[i].x + s * (c.x * N[i].x + c.y * B.x), P[i].y + s * (c.x * N[i].y + c.y * B.y), P[i].z + s * (c.x * N[i].z + c.y * B.z)}))
			append(&rings[i], u16(len(m.points) - 1))
		}
	}
	face :: proc(m: ^Mesh64, idx: ..u16) {
		f := make([dynamic]u16, len(idx))
		copy(f[:], idx)
		append(&m.faces, f)
	}
	K := len(section)
	for i in 0 ..< (closed ? count : count - 1) {
		a, b := rings[i], rings[(i + 1) % count]
		if len(a) == 1 && len(b) == 1 do continue
		for k in 0 ..< K {
			k2 := (k + 1) % K
			if len(a) == 1 do face(m, a[0], b[k2], b[k])
			else if len(b) == 1 do face(m, a[k], a[k2], b[0])
			else do face(m, a[k], a[k2], b[k2], b[k])
		}
	}
	caps := sh.caps.? or_else true
	if !closed && caps {
		if len(rings[0]) > 1 {
			face(m, ..rings[0][:])
			slice_reverse(m.faces[len(m.faces) - 1][:])
		}
		if len(rings[count - 1]) > 1 do face(m, ..rings[count - 1][:])
	}
}

// 1.11: the path a rail runs along, its corners rounded: each cut back
// by `radius` (or by half the shorter of its two segments, where that
// is less) and joined by an arc in the plane of the two, `steps` to a
// quarter turn. A straight run and a path that doubles back keep their
// point. On the temp allocator.
@(private)
round_corners64 :: proc(points: []D3, radius: f64, steps: int, closed: bool) -> [dynamic]D3 {
	n := len(points)
	out := make([dynamic]D3, 0, n * 4, context.temp_allocator)
	if !(radius > 0) || n < 3 {
		append(&out, ..points)
		return out
	}
	for P, i in points {
		if !closed && (i == 0 || i == n - 1) {
			append(&out, P)
			continue
		}
		A, B := points[(i + n - 1) % n] - P, points[(i + 1) % n] - P
		la, lb := len64(A), len64(B)
		if la < 1e-9 || lb < 1e-9 {
			append(&out, P)
			continue
		}
		a, b := A / la, B / lb
		// the angle between the two segments at the corner, and how far the path turns there
		inside := math.acos(clamp(dot64(a, b), -1, 1))
		turn := math.PI - inside
		if turn < 1e-6 || inside < 1e-6 {
			append(&out, P)
			continue
		}
		d := min(radius / math.tan(inside / 2), la / 2, lb / 2)
		r := d * math.tan(inside / 2)
		C := P + norm64(a + b) * (r / math.sin(inside / 2))
		v0, v1 := (P + a * d - C) / r, (P + b * d - C) / r
		count := max(1, int(math.ceil(turn / (math.PI / 2) * f64(steps) - 1e-9)))
		sn := math.sin(turn)
		for j in 0 ..= count {
			t := f64(j) / f64(count)
			w0, w1 := math.sin((1 - t) * turn) / sn, math.sin(t * turn) / sn
			append(&out, C + (v0 * w0 + v1 * w1) * r)
		}
	}
	return out
}

// 1.11: a profile carried upright along a path. The rings of points a
// rail is made of, one per point of `spine` in its order, each in the
// section's order: a section point (x, y) stands y along `axis` from
// the path and x out to its side, level, square to the way the path is
// going (the axis crossed with it); at a corner on the mitre, so a face
// keeps its distance from the path on both sides of it. A point of the
// spine that sits on the one before it is dropped first, so `count`
// says how many rings came of it: none for a path with no way to go.
// On the temp allocator; nothing is rounded.
@(private)
rail_rings64 :: proc(spine: []D3, section: []D2, axis: D3, closed: bool) -> (points: [dynamic]D3, count: int) {
	context.allocator = context.temp_allocator
	P := make([dynamic]D3, 0, len(spine))
	for p in spine {
		if len(P) > 0 && len64(p - P[len(P) - 1]) <= 1e-9 do continue
		append(&P, p)
	}
	if closed && len(P) > 1 && len64(P[0] - P[len(P) - 1]) <= 1e-9 do pop(&P)
	m := len(P)
	if m < (closed ? 3 : 2) do return
	// each segment's way, level: what is left of its direction with the axis taken out. A segment that runs straight
	// along the axis has none, and takes its neighbour's
	segs := closed ? m : m - 1
	H := make([]D3, segs)
	has := make([]bool, segs)
	for i in 0 ..< segs {
		d := P[(i + 1) % m] - P[i]
		h := d - axis * dot64(d, axis)
		if len64(h) >= 1e-9 do H[i], has[i] = norm64(h), true
	}
	for i in 1 ..< segs do if !has[i] && has[i - 1] do H[i], has[i] = H[i - 1], true
	for i := segs - 2; i >= 0; i -= 1 do if !has[i] && has[i + 1] do H[i], has[i] = H[i + 1], true
	for h in has do if !h do return
	// out to the side of each segment: the axis crossed with its way
	O := make([]D3, segs)
	for i in 0 ..< segs do O[i] = cross64(axis, H[i])
	points = make([dynamic]D3, 0, m * len(section))
	for i in 0 ..< m {
		side: D3
		reach := f64(1)
		before, after := -1, -1
		if closed do before, after = (i + segs - 1) % segs, i % segs
		else {
			if i > 0 do before = i - 1
			if i < segs do after = i
		}
		if before >= 0 && after >= 0 {
			sum := O[before] + O[after]
			if len64(sum) < 1e-9 do side = O[after]
			else {
				side = norm64(sum)
				reach = 1 / max(dot64(side, O[after]), 0.25)
			}
		} else do side = O[before >= 0 ? before : after]
		for c in section do append(&points, P[i] + side * (reach * c.x) + axis * c.y)
	}
	return points, m
}

// 1.11: where a rail's profile stands along a path a game has made for
// itself (an outline it traced, not a shape of a file): for each point
// of `spine` that is kept (one that sits on the one before it is
// dropped), the point, and the way a profile point one unit out stands
// from it: its side on the mitre, as long as the mitre makes it. A
// profile point (x, y) is then `at + x side + y axis`, as a rail's is.
// Nothing for a path with no way to go.
rail_frames :: proc(spine: []V3, axis: V3, closed := false, allocator := context.allocator) -> (at: []V3, side: []V3) {
	wide := make([]D3, len(spine), context.temp_allocator)
	for p, i in spine do wide[i] = {f64(p.x), f64(p.y), f64(p.z)}
	points, count := rail_rings64(wide, {{0, 0}, {1, 0}}, {f64(axis.x), f64(axis.y), f64(axis.z)}, closed)
	if count == 0 do return
	at = make([]V3, count, allocator)
	side = make([]V3, count, allocator)
	for i in 0 ..< count {
		p, q := points[i * 2], points[i * 2 + 1]
		at[i] = {f32(p.x), f32(p.y), f32(p.z)}
		side[i] = {f32(q.x - p.x), f32(q.y - p.y), f32(q.z - p.z)}
	}
	return
}

// 1.11: a rail's cage. One ring of points per point of the path (its
// corners rounded, if it has no handles), in profile order; a quad
// `[a k, a k+1, b k+1, b k]` for each edge of the profile between each
// ring and the next. An open profile is a sheet facing the profile's
// left as it is drawn; a closed one a moulding wound outward (taken in
// reverse when its signed area is negative), capped at an open path's
// ends: the first ring reversed, the last as it is.
@(private)
rail64 :: proc(sh: ^Shape3, m: ^Mesh64) {
	closed := sh.closed
	solid := sh.profile.closed
	flat := make([dynamic]D3)
	flat_at := make([dynamic]f64)
	spine64(&sh.path, closed, &flat, &flat_at)
	curved := false
	for v in sh.path.in_ do if abs(v.x) > 1e-9 || abs(v.y) > 1e-9 || abs(v.z) > 1e-9 do curved = true
	for v in sh.path.out do if abs(v.x) > 1e-9 || abs(v.y) > 1e-9 || abs(v.z) > 1e-9 do curved = true
	steps := sh.segments == 0 ? 4 : max(1, sh.segments)
	spine := curved ? flat : round_corners64(flat[:], to_f64(sh.round), steps, closed)
	section := profile64(&sh.profile, solid)
	if len(section) < (solid ? 3 : 2) do return
	if solid {
		area: f64
		for p, i in section {
			q := section[(i + 1) % len(section)]
			area += p.x * q.y - q.x * p.y
		}
		if area < 0 do for i, j := 0, len(section) - 1; i < j; i, j = i + 1, j - 1 do section[i], section[j] = section[j], section[i]
	}
	axis := D3{0, 1, 0}
	switch sh.axis {
	case "x":
		axis = {1, 0, 0}
	case "z":
		axis = {0, 0, 1}
	}
	points, count := rail_rings64(spine[:], section[:], axis, closed)
	if count == 0 do return
	for p in points do append(&m.points, round3(p))
	face :: proc(m: ^Mesh64, idx: ..u16) {
		f := make([dynamic]u16, len(idx))
		copy(f[:], idx)
		append(&m.faces, f)
	}
	K := len(section)
	edges := solid ? K : K - 1
	at :: proc(ring, k, K: int) -> u16 {
		return u16(ring * K + k)
	}
	for i in 0 ..< (closed ? count : count - 1) {
		j := (i + 1) % count
		for k in 0 ..< edges {
			k2 := (k + 1) % K
			face(m, at(i, k, K), at(i, k2, K), at(j, k2, K), at(j, k, K))
		}
	}
	caps := sh.caps.? or_else true
	if solid && !closed && caps {
		first := make([dynamic]u16, K)
		last := make([dynamic]u16, K)
		for k in 0 ..< K do first[k], last[k] = at(0, K - 1 - k, K), at(count - 1, k, K)
		append(&m.faces, first, last)
	}
}

// ---------------------------------------------------------------- modifiers

// A face's unit normal by Newell's method; zero for a degenerate face.
@(private)
unit_normal64 :: proc(points: []D3, f: []u16) -> D3 {
	n: D3
	for i in 0 ..< len(f) {
		a, b := points[f[i]], points[f[(i + 1) % len(f)]]
		n.x += (a.y - b.y) * (a.z + b.z)
		n.y += (a.z - b.z) * (a.x + b.x)
		n.z += (a.x - b.x) * (a.y + b.y)
	}
	l := len64(n)
	return l < 1e-12 ? D3{} : n / l
}

@(private)
axis_index :: proc(axis: string) -> int {
	switch axis {
	case "y":
		return 1
	case "z":
		return 2
	}
	return 0
}

@(private)
mod_mirror :: proc(w: ^Mesh64, mod: ^Mod) {
	ax := axis_index(mod.axis)
	merge := f64(0.001)
	if v, has := mod.merge.?; has && v >= 0 do merge = to_f64(v)
	n := len(w.points)
	posed := len(w.rest) == n && n > 0
	welded := make([]bool, n)
	remap := make([]u16, n)
	next := n
	for i in 0 ..< n {
		p := posed ? w.rest[i] : w.points[i]
		welded[i] = abs(p[ax]) <= merge
		if welded[i] {
			remap[i] = u16(i)
		} else {
			remap[i] = u16(next)
			next += 1
		}
	}
	if next > 65535 do return
	reflect :: proc(list: ^[dynamic]D3, welded: []bool, ax: int) {
		for i in 0 ..< len(welded) {
			if welded[i] {
				list[i][ax] = 0
			} else {
				q := list[i]
				q[ax] = -q[ax] + 0
				append(list, q)
			}
		}
	}
	reflect(&w.points, welded, ax)
	if posed do reflect(&w.rest, welded, ax)
	if len(w.shades) == n do for i in 0 ..< n do if !welded[i] do append(&w.shades, w.shades[i])
	wears := len(w.uvs) == len(w.faces)
	count := len(w.faces)
	for fi in 0 ..< count {
		f := w.faces[fi]
		// a face lying in the plane is its own reflection
		all := true
		for i in f do if !welded[i] do all = false
		if all do continue
		g := make([dynamic]u16, len(f))
		for i, k in f do g[len(f) - 1 - k] = remap[i]
		append(&w.faces, g)
		append(&w.paint, w.paint[fi])
		if wears {
			uv := make([dynamic]D2, len(w.uvs[fi]))
			for v, k in w.uvs[fi] do uv[len(uv) - 1 - k] = v
			append(&w.uvs, uv)
		}
	}
	creases := len(w.creases)
	for ci in 0 ..< creases {
		c := w.creases[ci]
		if c.a < 0 || c.a >= n do continue
		if c.corner {
			if !welded[c.a] do append(&w.creases, Crease64{a = int(remap[c.a]), c = c.c, corner = true})
		} else {
			if c.b < 0 || c.b >= n do continue
			if !(welded[c.a] && welded[c.b]) do append(&w.creases, Crease64{a = int(remap[c.a]), b = int(remap[c.b]), c = c.c})
		}
	}
}

@(private)
mod_solidify :: proc(w: ^Mesh64, mod: ^Mod) {
	thick := to_f64(mod.thick)
	o := f64(-1)
	if v, has := mod.offset.?; has do o = clamp(to_f64(v), -1, 1)
	outer := thick * (1 + o) / 2
	inner := thick * (1 - o) / 2
	n := len(w.points)
	if n * 2 > 65535 do return
	// a normal per point: the unit normals of its faces summed, then made unit
	shells :: proc(pts: ^[dynamic]D3, faces: [][dynamic]u16, outer, inner: f64) {
		n := len(pts)
		nor := make([]D3, n)
		for f in faces {
			fnor := unit_normal64(pts[:], f[:])
			for i in f do nor[i] += fnor
		}
		for &a in nor {
			l := len64(a)
			a = l < 1e-12 ? D3{} : a / l
		}
		resize(pts, n * 2)
		for i in 0 ..< n {
			p := pts[i]
			pts[i] = p + nor[i] * outer
			pts[i + n] = p + nor[i] * -inner
		}
	}
	posed := len(w.rest) == n && n > 0
	shells(&w.points, w.faces[:], outer, inner)
	if posed do shells(&w.rest, w.faces[:], outer, inner)
	if len(w.shades) == n {
		resize(&w.shades, n * 2)
		for i in 0 ..< n do w.shades[i + n] = w.shades[i]
	}
	// how many faces use each edge: one is a boundary
	uses := make(map[u32]int)
	for f in w.faces do for i in 0 ..< len(f) do uses[edge_key(f[i], f[(i + 1) % len(f)])] += 1
	wears := len(w.uvs) == len(w.faces)
	count := len(w.faces)
	inner_paint, has_inner := mod.inner.?
	rim_paint, has_rim := mod.rim.?
	for fi in 0 ..< count {
		f := w.faces[fi]
		g := make([dynamic]u16, len(f))
		for i, k in f do g[len(f) - 1 - k] = i + u16(n)
		append(&w.faces, g)
		append(&w.paint, has_inner ? inner_paint : w.paint[fi])
		if wears {
			uv := make([dynamic]D2, len(w.uvs[fi]))
			for v, k in w.uvs[fi] do uv[len(uv) - 1 - k] = v
			append(&w.uvs, uv)
		}
	}
	for fi in 0 ..< count {
		f := w.faces[fi]
		for i in 0 ..< len(f) {
			a, b := f[i], f[(i + 1) % len(f)]
			if a == b || uses[edge_key(a, b)] != 1 do continue
			g := make([dynamic]u16, 4)
			g[0], g[1], g[2], g[3] = b, a, a + u16(n), b + u16(n)
			append(&w.faces, g)
			append(&w.paint, has_rim ? rim_paint : w.paint[fi])
			if wears {
				ua, ub := w.uvs[fi][i], w.uvs[fi][(i + 1) % len(f)]
				uv := make([dynamic]D2, 4)
				uv[0], uv[1], uv[2], uv[3] = ub, ua, ua, ub
				append(&w.uvs, uv)
			}
		}
	}
	creases := len(w.creases)
	for ci in 0 ..< creases {
		c := w.creases[ci]
		if c.corner do append(&w.creases, Crease64{a = c.a + n, c = c.c, corner = true})
		else do append(&w.creases, Crease64{a = c.a + n, b = c.b + n, c = c.c})
	}
}

@(private)
mod_crease :: proc(w: ^Mesh64, mod: ^Mod) {
	angle := f64(30)
	if v, has := mod.angle.?; has do angle = to_f64(v)
	value := f64(1)
	if v, has := mod.value.?; has do value = to_f64(v)
	limit := math.cos(clamp(angle, 0, 180) * math.PI / 180)
	n := len(w.points)
	pts := len(w.rest) == n && n > 0 ? w.rest[:] : w.points[:]
	normals := make([]D3, len(w.faces))
	for f, fi in w.faces do normals[fi] = unit_normal64(pts, f[:])
	// the edges in the order the faces first walk them, with every face that does
	Edge :: struct {
		a, b:  u16,
		f0:    int,
		f1:    int,
		count: int,
		has:   bool,
	}
	edges := make([dynamic]Edge)
	index := make(map[u32]int)
	for f, fi in w.faces {
		for i in 0 ..< len(f) {
			a, b := f[i], f[(i + 1) % len(f)]
			if a == b do continue
			k := edge_key(a, b)
			ei, known := index[k]
			if !known {
				ei = len(edges)
				index[k] = ei
				append(&edges, Edge{a = min(a, b), b = max(a, b)})
			}
			e := &edges[ei]
			if e.count == 0 do e.f0 = fi
			if e.count == 1 do e.f1 = fi
			e.count += 1
		}
	}
	for c in w.creases {
		if c.corner || c.a < 0 || c.b < 0 || c.a > 65535 || c.b > 65535 do continue
		if ei, known := index[edge_key(u16(c.a), u16(c.b))]; known do edges[ei].has = true
	}
	for e in edges {
		if e.count != 2 || e.has do continue
		if dot64(normals[e.f0], normals[e.f1]) < limit - 1e-9 do append(&w.creases, Crease64{a = int(e.a), b = int(e.b), c = value})
	}
}

// Every mod in order, on the working mesh; points are rounded to four places after.
@(private)
apply_mods64 :: proc(w: ^Mesh64, mods: []Mod) {
	context.allocator = context.temp_allocator
	for &mod in mods {
		switch mod.op {
		case "mirror":
			mod_mirror(w, &mod)
		case "solidify":
			mod_solidify(w, &mod)
		case "crease":
			mod_crease(w, &mod)
		}
	}
	for &p in w.points do p = {r4(p.x), r4(p.y), r4(p.z)}
	clear(&w.rest)
}

// ---------------------------------------------------------------- subdivision

@(private)
sharpness64 :: proc(c: f64) -> f64 {
	return c >= 1 ? math.INF_F64 : max(0, c) * 10
}

// One Catmull-Clark level with semi-sharp creases (OpenSubdiv's rules),
// in place: original points keep their indices, then a point per face,
// then a point per edge in the order the faces first walk the edges. A
// shade is refined as a fourth coordinate (and rounded as one); a face's children wear its
// paint; pattern coordinates stay within their face. False (and nothing
// changed) when the result would not fit 16-bit indices.
@(private)
refine64 :: proc(m: ^Mesh64) -> bool {
	context.allocator = context.temp_allocator
	D4 :: [4]f64
	Edge :: struct {
		a, b:  u16,
		faces: [4]int,
		nf:    int,
		sharp: f64,
	}
	Nb :: struct {
		other: u16,
		edge:  int,
	}
	n := len(m.points)
	nfaces := len(m.faces)
	shaded := len(m.shades) == n && n > 0
	P := make([]D4, n)
	for p, i in m.points do P[i] = {p.x, p.y, p.z, shaded ? m.shades[i] : 0}
	edges := make([dynamic]Edge, 0, nfaces * 2)
	around := make([][dynamic]Nb, n)
	find :: proc(around: [][dynamic]Nb, a, b: u16) -> int {
		if int(a) >= len(around) do return -1
		for nb in around[a] do if nb.other == b do return nb.edge
		return -1
	}
	for f, fi in m.faces {
		for i in 0 ..< len(f) {
			a, b := f[i], f[(i + 1) % len(f)]
			if int(a) >= n || int(b) >= n || a == b do continue
			ei := find(around, a, b)
			if ei < 0 {
				ei = len(edges)
				lo, hi := min(a, b), max(a, b)
				append(&edges, Edge{a = lo, b = hi})
				append(&around[lo], Nb{hi, ei})
				append(&around[hi], Nb{lo, ei})
			}
			e := &edges[ei]
			known := false
			for k in 0 ..< min(e.nf, 4) do if e.faces[k] == fi do known = true
			if !known {
				if e.nf < 4 do e.faces[e.nf] = fi
				e.nf += 1
			}
		}
	}
	if n + nfaces + len(edges) > 65535 do return false
	corner := make([]f64, n)
	for c in m.creases {
		if c.corner {
			if c.a >= 0 && c.a < n do corner[c.a] = max(corner[c.a], sharpness64(c.c))
		} else if c.a >= 0 && c.b >= 0 && c.a < n && c.b < n {
			if ei := find(around, u16(c.a), u16(c.b)); ei >= 0 do edges[ei].sharp = max(edges[ei].sharp, sharpness64(c.c))
		}
	}
	// a boundary edge is infinitely sharp: the surface interpolates the boundary
	for &e in edges do if e.nf < 2 do e.sharp = math.INF_F64
	// face points
	face_pt := make([]D4, nfaces)
	for f, fi in m.faces {
		acc: D4
		for i in f do acc += P[i]
		face_pt[fi] = acc * (1 / f64(len(f)))
	}
	// edge points: smooth (ends and the two face points averaged), sharp (the midpoint), or a blend between
	edge_pt := make([]D4, len(edges))
	for e, ei in edges {
		mid := (P[e.a] + P[e.b]) / 2
		pt := mid
		if e.nf == 2 {
			smooth := ((P[e.a] + P[e.b]) + (face_pt[e.faces[0]] + face_pt[e.faces[1]])) * 0.25
			s := e.sharp
			pt = s >= 1 ? mid : (s <= 0 ? smooth : smooth * (1 - s) + mid * s)
		}
		edge_pt[ei] = pt
	}
	// vertex points
	vert_pt := make([]D4, n)
	seen := make([dynamic]int, 0, 16)
	for v, vi in P {
		nb := around[vi][:]
		nn := len(nb)
		if nn == 0 {
			vert_pt[vi] = v
			continue
		}
		sharp_count := 0
		s1, s2: f64
		o1, o2: u16
		for o in nb {
			e := edges[o.edge]
			if e.sharp >= 1 do sharp_count += 1
			if e.sharp > s1 {
				s2, o2 = s1, o1
				s1, o1 = e.sharp, o.other
			} else if e.sharp > s2 {
				s2, o2 = e.sharp, o.other
			}
		}
		// the corner rule: three or more sharp edges, or a sharp corner, or a two-edge boundary corner
		if sharp_count >= 3 || corner[vi] >= 1 || (nn == 2 && sharp_count == 2) {
			vert_pt[vi] = v
			continue
		}
		// the smooth rule
		clear(&seen)
		Q: D4
		for o in nb {
			e := edges[o.edge]
			for k in 0 ..< min(e.nf, 4) {
				fi := e.faces[k]
				known := false
				for s in seen do if s == fi do known = true
				if known do continue
				append(&seen, fi)
				Q += face_pt[fi]
			}
		}
		Q = Q * (1 / f64(max(1, len(seen))))
		R: D4
		for o in nb do R += (v + P[o.other]) / 2
		R = R * (1 / f64(nn))
		smooth := ((Q + R * 2) + v * f64(nn - 3)) * (1 / f64(nn))
		res := smooth
		// the crease rule along the two sharpest edges, blended in by their sharpness
		if s2 > 0 {
			crease := ((P[o1] + P[o2]) + v * 6) * (f64(1) / 8)
			s := min(1, (min(s1, 1) + min(s2, 1)) / 2)
			res = s >= 1 ? crease : smooth * (1 - s) + crease * s
		}
		// a semi-sharp corner pins the vertex by its sharpness
		cs := min(1, corner[vi])
		if cs > 0 do res = res * (1 - cs) + v * cs
		vert_pt[vi] = res
	}
	// assemble
	total := n + nfaces + len(edges)
	points := make([dynamic]D3, total)
	shades: [dynamic]f64
	if shaded do shades = make([dynamic]f64, total)
	put :: proc(points: ^[dynamic]D3, shades: ^[dynamic]f64, i: int, p: [4]f64) {
		points[i] = {r4(p[0]), r4(p[1]), r4(p[2])}
		if len(shades) > 0 do shades[i] = max(0, r4(p[3]))
	}
	for p, i in vert_pt do put(&points, &shades, i, p)
	for p, i in face_pt do put(&points, &shades, n + i, p)
	for p, i in edge_pt do put(&points, &shades, n + nfaces + i, p)
	wears := len(m.uvs) == nfaces && nfaces > 0
	faces := make([dynamic][dynamic]u16, 0, nfaces * 4)
	paint := make([dynamic]int, 0, nfaces * 4)
	uvs: [dynamic][dynamic]D2
	if wears do uvs = make([dynamic][dynamic]D2, 0, nfaces * 4)
	for f, fi in m.faces {
		fp := u16(n + fi)
		k := len(f)
		centre: D2
		if wears {
			for uv in m.uvs[fi] do centre += uv
			centre /= f64(k)
		}
		for i in 0 ..< k {
			v := f[i]
			e_next := find(around, v, f[(i + 1) % k])
			e_prev := find(around, f[(i + k - 1) % k], v)
			if e_next < 0 || e_prev < 0 do continue
			child := make([dynamic]u16, 4)
			child[0], child[1], child[2], child[3] = v, u16(n + nfaces + e_next), fp, u16(n + nfaces + e_prev)
			append(&faces, child)
			append(&paint, fi < len(m.paint) ? m.paint[fi] : 0)
			if wears {
				here, next, prev := m.uvs[fi][i], m.uvs[fi][(i + 1) % k], m.uvs[fi][(i + k - 1) % k]
				uv := make([dynamic]D2, 4)
				uv[0], uv[1], uv[2], uv[3] = here, (here + next) / 2, centre, (prev + here) / 2
				for &c in uv do c = {r4(c.x), r4(c.y)}
				append(&uvs, uv)
			}
		}
	}
	// child creases: each half of a creased edge, one step softer; corners likewise
	creases := make([dynamic]Crease64)
	for e, ei in edges {
		if e.sharp <= 0 || e.nf < 2 do continue // boundaries are sharp by being boundaries
		child := e.sharp == math.INF_F64 ? f64(1) : max(0, e.sharp - 1) / 10
		if child <= 0 do continue
		at := n + nfaces + ei
		append(&creases, Crease64{a = int(e.a), b = at, c = child}, Crease64{a = int(e.b), b = at, c = child})
	}
	for c, vi in corner {
		if c <= 0 do continue
		child := c == math.INF_F64 ? f64(1) : max(0, c - 1) / 10
		if child > 0 do append(&creases, Crease64{a = vi, c = child, corner = true})
	}
	m.points = points
	m.shades = shades
	m.faces = faces
	m.paint = paint
	m.uvs = uvs
	m.creases = creases
	clear(&m.rest)
	return true
}

// ---------------------------------------------------------------- what a shape draws

// Does the shape want paint from a bake: its own, or a solidify's `inner` or `rim`?
@(private)
wants_paint :: proc(sh: ^Shape3) -> bool {
	if len(sh.paint) > 0 do return true
	for m in sh.mods {
		if _, has := m.inner.?; has do return true
		if _, has := m.rim.?; has do return true
	}
	return false
}

// The shape's bake as the mesh it draws, when the bake has what the
// shape needs: paint for a painted shape, shades for a shaded one,
// pattern coordinates for one that carries its own. `of` is not checked
// (see the top of this file). The points and faces are the bake's own,
// shared, not copied.
baked_surface :: proc(sh: ^Shape3) -> (out: Shape3, ok: bool) {
	b := &sh.bake
	if len(b.points) == 0 || len(b.faces) == 0 do return {}, false
	for f in b.faces do for i in f do if int(i) >= len(b.points) do return {}, false
	wears := sh.kind == "sweep" ? len(sh.mapping.uvs) > 0 : uvs_fit(sh.mapping.uvs[:], sh.faces[:])
	if wears && !uvs_fit(b.uvs[:], b.faces[:]) do return {}, false
	painted := len(b.paint) == len(b.faces)
	if painted do for p in b.paint do if p < 0 || p > len(sh.colors) do painted = false
	shaded := len(b.shades) == len(b.points)
	if (wants_paint(sh) && !painted) || (len(sh.shades) > 0 && !shaded) do return {}, false
	out.kind = "mesh"
	out.color = sh.color
	out.shade = sh.shade
	out.texture = sh.texture
	out.mapping.scale = sh.mapping.scale
	if wears do out.mapping.uvs = b.uvs
	out.normals = sh.normals == "" && smooth_normals(sh) ? "smooth" : sh.normals
	out.angle = sh.angle
	out.colors = sh.colors
	out.points = b.points
	out.faces = b.faces
	out.tris = b.tris
	if painted do out.paint = b.paint
	if shaded do out.shades = b.shades
	return out, true
}

@(private)
generated :: proc(sh: ^Shape3) -> bool {
	return sh.kind == "sweep" || (sh.kind == "mesh" && (sh.smooth > 0 || len(sh.mods) > 0))
}

@(private)
build64 :: proc(sh: ^Shape3, smooth: bool) -> (m: Mesh64, ok: bool) {
	cage := sh
	swept: Shape3
	if sh.kind == "sweep" {
		swept = sweep_cage(sh, context.temp_allocator)
		cage = &swept
	}
	m = mesh64_of(cage) or_return
	if len(sh.mods) > 0 do apply_mods64(&m, sh.mods[:])
	if smooth do for _ in 0 ..< sh.smooth do if !refine64(&m) do break
	return m, true
}

// A shape's cage with its mods applied (1.8), before smoothing: what
// `smooth` refines, what collision and a hull read. `smooth` and the
// creases the mods left are still on it. Anything but a mesh or a sweep
// is returned as it is.
built_mesh :: proc(sh: ^Shape3, allocator := context.allocator) -> Shape3 {
	if sh.kind != "mesh" && sh.kind != "sweep" do return sh^
	m, ok := build64(sh, false)
	if !ok {
		out := sh^
		out.mods = nil
		return out
	}
	out := shape_of64(&m, sh, allocator)
	out.smooth = sh.smooth
	return out
}

// A shape as the mesh a renderer draws (1.8): a sweep generated, a
// morph's points in place (flatten_part_posed sets them), the mods
// applied, `smooth` subdivided; or the shape's bake, when it has one that
// will do. The result is a plain mesh (no mods, no smooth, no bake) with
// `paint` per face of it, `shades` per point of it and explicit pattern
// coordinates per face of it, wherever the shape has those; `normals` is
// "smooth" when the shape is smooth-shaded by default. A plain mesh comes
// back as it is, sharing its arrays; a ball or a rod is returned untouched.
as_mesh :: proc(sh: ^Shape3, allocator := context.allocator) -> Shape3 {
	if !generated(sh) do return sh^
	// (a bake is the rest cage's surface: a morphed cage is made afresh)
	if sh.rest == nil {
		if baked, ok := baked_surface(sh); ok do return baked
	}
	m, ok := build64(sh, true)
	if !ok {
		// a face that names no point: the cage as it is, for whatever a reader makes of it
		out := sh^
		out.mods, out.smooth, out.bake = nil, 0, {}
		return out
	}
	out := shape_of64(&m, sh, allocator)
	if out.normals == "" && smooth_normals(sh) do out.normals = "smooth"
	return out
}
