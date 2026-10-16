package fastart_test

// Format 1.11 against the reference loader: rails. What the loader
// generates for the corpus's rails is held to @fastart/core's by the
// parity test; here, the rules themselves.

import fart ".."
import "core:testing"

@(test)
rails :: proc(t: ^testing.T) {
	context.allocator = context.temp_allocator
	defer free_all(context.temp_allocator)
	HEAD :: `{"version":1,"space":"3d","palette":[{"name":"a","rgb":[1,1,1,255]}],"parts":[{"name":"p","pivot":[0,0,0],"shapes":[`
	data := HEAD + `{"kind":"sweep","color":"a","op":"rail","path":{"points":[[0,0,0],[0,0,4]]},"profile":{"points":[[0,0],[0.5,1],[0.5,3]]}},` + `{"kind":"sweep","color":"a","op":"rail","round":1,"segments":4,"path":{"points":[[0,0,0],[0,0,4],[-4,0,4]]},"profile":{"points":[[0,0],[0,2]]}},` + `{"kind":"sweep","color":"a","op":"rail","axis":"z","closed":true,"path":{"points":[[0,0,0],[4,0,0],[4,4,0],[0,4,0]]},"profile":{"points":[[0,0],[0,1],[1,1],[1,0]],"closed":true}},` + `{"kind":"sweep","color":"a","op":"rail","path":{"points":[[0,0,0],[0,0,4]]},"profile":{"points":[[0,0],[1,0],[1,1],[0,1]],"closed":true}}` + `]}]}`
	doc, ok := fart.load_bytes_3d(transmute([]byte)string(data))
	if !testing.expect(t, ok, "the rails load") do return
	shapes := doc.parts[0].shapes[:]
	// along z, standing along y: out is y cross z, which is x
	m := fart.as_mesh(&shapes[0])
	testing.expect_value(t, len(m.points), 6)
	testing.expect_value(t, len(m.faces), 2)
	if len(m.points) == 6 && len(m.faces) == 2 {
		testing.expect_value(t, m.points[1], fart.V3{0.5, 1, 0})
		testing.expect_value(t, m.points[5], fart.V3{0.5, 3, 4})
		testing.expect(t, m.faces[1][0] == 1 && m.faces[1][1] == 2 && m.faces[1][2] == 5 && m.faces[1][3] == 4, "a side is [a k, a k+1, b k+1, b k]")
		// the stretch that goes straight down faces out: the profile's left as it is drawn
		testing.expect(t, fart.face_normal(m.points[:], m.faces[1][:]).x > 0, "an open profile faces its left")
	}
	// a rounded corner: the two ends, and five points round a quarter turn
	r := fart.as_mesh(&shapes[1])
	testing.expect_value(t, len(r.points), 14)
	testing.expect_value(t, len(r.faces), 6)
	// a moulding round a closed path, its profile given clockwise: four rings, sixteen quads, no caps
	c := fart.as_mesh(&shapes[2])
	testing.expect_value(t, len(c.points), 16)
	testing.expect_value(t, len(c.faces), 16)
	// and along an open path it is capped
	k := fart.as_mesh(&shapes[3])
	testing.expect_value(t, len(k.points), 8)
	testing.expect_value(t, len(k.faces), 6)
	for f in k.faces {
		nrm := fart.face_normal(k.points[:], f[:])
		mid: fart.V3
		for i in f do mid += k.points[i]
		mid /= f32(len(f))
		testing.expect(t, nrm.x * (mid.x - 0.5) + nrm.y * (mid.y - 0.5) + nrm.z * (mid.z - 2) > 0, "a moulding's faces wind outward")
	}
}

// A game's own outline: the sides a profile stands out to, mitred at a corner.
@(test)
rail_frames_of_an_outline :: proc(t: ^testing.T) {
	defer free_all(context.temp_allocator)
	// y up, as a game has it: along x then along z, a point given twice
	at, side := fart.rail_frames({{0, 0, 0}, {4, 0, 0}, {4, 0, 0}, {4, 0, 4}}, {0, 1, 0}, false, context.temp_allocator)
	testing.expect_value(t, len(at), 3)
	if len(at) != 3 do return
	// up cross x is -z; up cross z is x; the corner stands on the mitre, root two long
	testing.expect_value(t, side[0], fart.V3{0, 0, -1})
	testing.expect_value(t, side[2], fart.V3{1, 0, 0})
	testing.expect(t, abs(side[1].x - 1) < 1e-5 && abs(side[1].z + 1) < 1e-5 && side[1].y == 0, "the corner's side is on the mitre")
	none, _ := fart.rail_frames({{0, 0, 0}, {0, 3, 0}}, {0, 1, 0}, false, context.temp_allocator)
	testing.expect_value(t, len(none), 0)
}
