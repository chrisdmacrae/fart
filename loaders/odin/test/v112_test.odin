package fastart_test

import "core:fmt"
import "core:os"
import "core:testing"
import fart ".."

// 1.12: image maps resolve to their pixels, whatever the PNG's colour type: RGB filtered by row, one bit through a palette.
@(test)
image_maps :: proc(t: ^testing.T) {
	context.allocator = context.temp_allocator
	data, err := os.read_entire_file(EXAMPLES + "valid/imaged.fart", context.temp_allocator)
	if !testing.expect(t, err == nil) do return
	doc, ok := fart.load_bytes_3d(data)
	if !testing.expect(t, ok, "imaged loads") do return
	testing.expect_value(t, doc.textures[0].maps["color"].image, "textures/imaged.color.png")
	resolver :: proc(path: string, user: rawptr) -> ([]byte, bool) {
		d, e := os.read_entire_file(fmt.tprintf("%svalid/%s", EXAMPLES, path), context.temp_allocator)
		return d, e == nil
	}
	fart.resolve_textures_3d(&doc, resolver, nil)
	maps, has := doc.texture_docs["imaged"]
	if !testing.expect(t, has, "the texture resolved") do return
	testing.expect_value(t, len(maps), 3)
	px :: proc(m: fart.Map_Doc, x, y: int) -> [4]u8 {
		i := (y * m.width + x) * 4
		return {m.pixels[i], m.pixels[i + 1], m.pixels[i + 2], m.pixels[i + 3]}
	}
	color := maps["color"]
	testing.expect_value(t, color.width, 8)
	testing.expect_value(t, px(color, 0, 0), [4]u8{60, 40, 25, 255})
	testing.expect_value(t, px(color, 1, 0), [4]u8{170, 120, 70, 255})
	testing.expect_value(t, px(color, 5, 0), [4]u8{150, 100, 55, 255})
	testing.expect_value(t, px(color, 5, 4), [4]u8{170, 120, 70, 255})
	normal := maps["normal"]
	testing.expect_value(t, normal.width, 4)
	testing.expect_value(t, px(normal, 0, 0), [4]u8{128, 128, 255, 255})
	testing.expect_value(t, px(normal, 1, 2), [4]u8{218, 128, 218, 255})
	testing.expect_value(t, maps["rough"].tmap.mode, "mask")
	// the explicit uvs reach the flattened mesh
	ms := make([dynamic]fart.Tri_Mesh, context.temp_allocator)
	fart.flatten_part(&doc, &doc.parts[0], &ms)
	testing.expect_value(t, ms[0].texture, "imaged")
	testing.expect_value(t, len(ms[0].uvs), len(ms[0].positions))
}
