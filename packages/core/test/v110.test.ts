// Format 1.10: relief. Softened maps, a height map baked to a normal map, packed scalars, unwrapped uvs, glTF materials.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { as3d, bakeTexture, box, mapValues, meshUVs, normalRaster, parseDoc, rasterizeMap, resolveTextures, toGlb, toPng, triMesh, unwrapMesh, unwrapMeshes, validate, type Doc, type MeshShape, type Vec2 } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const examples = resolve(here, "../../../spec/examples/valid");
const near = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const read = async (rel: string) => {
	try {
		return await readFile(join(examples, rel), "utf8");
	} catch {
		return null;
	}
};
const load = async (f: string): Promise<Doc> => {
	const { doc, report } = parseDoc(await readFile(join(examples, f), "utf8"));
	assert.ok(doc, JSON.stringify(report.errors));
	return doc;
};
const dented = async () => {
	const doc = await load("dented.fart");
	const res = (await resolveTextures(doc, read, (t) => parseDoc(t).doc)).get("dented")!;
	assert.deepEqual(res.unresolved, []);
	return { doc, res };
};

test("the validator: soften is zero or more, relief is a number", () => {
	const codes = (d: unknown) => validate(d).errors.map((e) => e.code);
	const t = (extra: object, map: object = {}) => ({ version: 1, textures: [{ name: "t", cell: [1, 1], maps: { height: { ref: "x.fart", ...map } }, ...extra }] });
	assert.deepEqual(codes(t({ relief: -0.5 }, { soften: 0 })), []);
	assert.deepEqual(codes(t({}, { soften: -1 })), ["schema"]);
	assert.deepEqual(codes(t({}, { soften: "a lot" })), ["schema"]);
	assert.deepEqual(codes(t({ relief: "deep" })), ["schema"]);
});

test("soften: a hard edge becomes a slope, the sum is kept, and the blur wraps at the cell", async () => {
	const { res } = await dented();
	const tex = res.texture;
	const hard = mapValues(tex, { ...res.maps.height, map: { ...res.maps.height.map, soften: 0 } }, 64);
	const soft = mapValues(tex, res.maps.height, 64);
	// the pit's middle is black either way; its rim (r 1.5 at [8, 11], 4 px per unit) is a step when hard and a ramp when soft
	const at = (v: Float32Array, x: number, y: number) => v[Math.floor(y * 4) * 64 + Math.floor(x * 4)];
	near(at(hard, 8, 11), 0, 0.01);
	assert.ok(at(soft, 8, 11) < 0.1);
	const levels = (v: Float32Array) => new Set(Array.from({ length: 24 }, (_, i) => v[44 * 64 + 20 + i].toFixed(3))).size;
	assert.equal(levels(hard), 2);
	assert.ok(levels(soft) > 8, `levels: ${levels(soft)}`);
	const sum = (v: Float32Array) => v.reduce((s, x) => s + x, 0);
	near(sum(hard), sum(soft), 0.5);
	// one white pixel-wide stripe at the left edge bleeds onto the right edge
	const stripe: Doc = { version: 1, palette: [{ name: "w", rgb: [255, 255, 255, 255] }], parts: [{ name: "a", shapes: [{ kind: "poly", color: "w", points: [[0, 0], [1, 0], [1, 8], [0, 8]] }] }] };
	const v = mapValues({ name: "s", cell: [8, 8], maps: {} }, { map: { ref: "", soften: 1 }, doc: stripe, tokens: stripe.palette!, pose: undefined }, 16);
	assert.ok(v[15] > 0.1 && v[15] > v[8], `${v[15]} vs ${v[8]}`);
});

test("relief: a ramp bakes to a tilted normal, green up the image; flat ground is straight out", () => {
	// height rising to the right at 1 per 8 units, relief 2: slope 0.25, normal (−0.25, 0, 1) normalised
	const px = 16;
	const ramp = new Float32Array(px * px);
	for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) ramp[y * px + x] = x / px;
	const n = normalRaster(ramp, px, px, [8, 8], 2);
	const o = (8 * px + 8) * 4;
	const l = Math.hypot(0.25, 1);
	near(n.data[o], (-0.25 / l) * 127.5 + 127.5, 1);
	near(n.data[o + 1], 127.5, 1);
	near(n.data[o + 2], (1 / l) * 127.5 + 127.5, 1);
	// rising down the image: the normal leans up it, so green is above the middle
	const down = new Float32Array(px * px);
	for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) down[y * px + x] = y / px;
	assert.ok(normalRaster(down, px, px, [8, 8], 2).data[o + 1] > 140);
	const flat = normalRaster(new Float32Array(px * px), px, px, [8, 8], 2);
	assert.deepEqual([...flat.data.slice(0, 4)], [128, 128, 255, 255]);
});

test("the bake: maps as drawn, a normal map from the relief, the scalars packed as occlusion, roughness, metallic", async () => {
	const { res } = await dented();
	const baked = bakeTexture(res, 32);
	assert.deepEqual(Object.keys(baked.maps).sort(), ["height", "rough"]);
	assert.ok(baked.normal && baked.orm);
	// the ground is mid grey: roughness about a half in green, no ao map so red is full, no metal so blue is empty
	const o = (2 * 32 + 30) * 4;
	assert.equal(baked.orm.data[o], 255);
	assert.ok(Math.abs(baked.orm.data[o + 1] - 128) < 12, `${baked.orm.data[o + 1]}`);
	assert.equal(baked.orm.data[o + 2], 0);
	// somewhere the normal leans: the ridge and the pit
	let leaning = 0;
	for (let i = 0; i < 32 * 32; i++) if (Math.abs(baked.normal.data[i * 4] - 128) > 20 || Math.abs(baked.normal.data[i * 4 + 1] - 128) > 20) leaning++;
	assert.ok(leaning > 20, `leaning: ${leaning}`);
	// no relief, no normal map
	assert.equal(bakeTexture({ ...res, texture: { ...res.texture, relief: 0 } }, 8).normal, undefined);
	assert.equal(rasterizeMap(res.texture, res.maps.height, 8).data.length, 8 * 8 * 4);
});

test("unwrap: a box is six islands inside the cell that do not overlap, none mirrored; meshes share a sheet", () => {
	const b = box("c", [0, 0, 0], [8, 6, 4]);
	const uvs = unwrapMesh(b, [16, 16]);
	assert.equal(uvs.length, 6);
	const rects = uvs.map((f) => [Math.min(...f.map((p) => p[0])), Math.min(...f.map((p) => p[1])), Math.max(...f.map((p) => p[0])), Math.max(...f.map((p) => p[1]))]);
	for (const r of rects) assert.ok(r[0] > 0 && r[1] > 0 && r[2] < 16 && r[3] < 16, r.join(","));
	for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) {
		const [a, c] = [rects[i], rects[j]];
		assert.ok(a[2] <= c[0] || c[2] <= a[0] || a[3] <= c[1] || c[3] <= a[1], `islands ${i} and ${j} overlap`);
	}
	// one scale for every island: area in uv over area in space is the same on each face
	const area2 = (f: Vec2[]) => Math.abs(f.reduce((s, p, i) => s + p[0] * f[(i + 1) % f.length][1] - f[(i + 1) % f.length][0] * p[1], 0)) / 2;
	const space = [24, 24, 32, 32, 48, 48].sort((x, y) => x - y);
	const flat = uvs.map(area2).sort((x, y) => x - y);
	const k = flat[0] / space[0];
	flat.forEach((a, i) => near(a / space[i], k, 1e-2));
	// seen from outside nothing is mirrored: a face wound outward in space is wound one way in uv on every island
	const signed = (f: Vec2[]) => Math.sign(f.reduce((s, p, i) => s + p[0] * f[(i + 1) % f.length][1] - f[(i + 1) % f.length][0] * p[1], 0));
	assert.equal(new Set(uvs.map(signed)).size, 1);
	// two meshes, one sheet: twelve islands, still apart
	const two = unwrapMeshes([b, box("c", [20, 0, 0], [4, 4, 4])], [16, 16]);
	const all = two.flat().map((f) => [Math.min(...f.map((p) => p[0])), Math.min(...f.map((p) => p[1])), Math.max(...f.map((p) => p[0])), Math.max(...f.map((p) => p[1]))]);
	for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
		const [a, c] = [all[i], all[j]];
		assert.ok(a[2] <= c[0] || c[2] <= a[0] || a[3] <= c[1] || c[3] <= a[1]);
	}
});

test("an unwrapped sheet on a smooth mesh: the cage's uvs follow the subdivision (1.7) into the triangles", async () => {
	const { doc } = await dented();
	const mesh = as3d(doc)!.parts![0].shapes![0] as MeshShape;
	assert.equal(mesh.mapping!.uvs!.length, 6);
	const uvs = meshUVs(mesh);
	assert.equal(uvs.length, 24);
	// a child quad starts on its cage corner and ends inside the cage face
	assert.deepEqual(uvs[0][0], mesh.mapping!.uvs![0][0]);
	// and the flattened triangles carry them, inside the cell
	const tm = triMesh(mesh);
	assert.equal(tm.uvs!.length, tm.count * 6);
	assert.ok(tm.uvs!.every((v) => v >= 0 && v <= 16));
});

test("glTF: the relief is a normal texture with tangents, the scalars a metallic-roughness texture, filtered", async () => {
	const { doc, res } = await dented();
	const baked = bakeTexture(res, 16);
	const glb = toGlb(as3d(doc)!, { normals: { dented: toPng(baked.normal!) }, orms: { dented: toPng(baked.orm!) } });
	const len = new DataView(glb.buffer).getUint32(12, true);
	const gltf = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + len)));
	const mat = gltf.materials[1];
	assert.equal(mat.name, "dented");
	assert.ok(mat.normalTexture && mat.pbrMetallicRoughness.metallicRoughnessTexture);
	assert.equal(mat.occlusionTexture, undefined);
	assert.equal(gltf.textures[mat.normalTexture.index].sampler, 1);
	const prim = gltf.meshes[0].primitives[0];
	assert.equal(prim.material, 1);
	const acc = gltf.accessors[prim.attributes.TANGENT];
	assert.equal(acc.type, "VEC4");
	assert.equal(acc.count, gltf.accessors[prim.attributes.POSITION].count);
	// every tangent is unit, square to its normal, with a handedness of one or minus one
	const view = (a: number) => {
		const ac = gltf.accessors[a];
		const bv = gltf.bufferViews[ac.bufferView];
		return new Float32Array(glb.buffer.slice(20 + len + 8 + bv.byteOffset, 20 + len + 8 + bv.byteOffset + bv.byteLength));
	};
	const tan = view(prim.attributes.TANGENT);
	const nor = view(prim.attributes.NORMAL);
	for (let i = 0; i < acc.count; i++) {
		near(Math.hypot(tan[i * 4], tan[i * 4 + 1], tan[i * 4 + 2]), 1, 1e-3);
		near(tan[i * 4] * nor[i * 3] + tan[i * 4 + 1] * nor[i * 3 + 1] + tan[i * 4 + 2] * nor[i * 3 + 2], 0, 1e-3);
		assert.equal(Math.abs(tan[i * 4 + 3]), 1);
	}
	// the sheet is unwrapped unmirrored, so one handedness throughout
	assert.equal(new Set(Array.from({ length: acc.count }, (_, i) => tan[i * 4 + 3])).size, 1);
});

test("relief through mods (1.8): a solidified sheet's inner wall has its uvs turned round, so its tangents take the other hand", async () => {
	const { res } = await dented();
	const baked = bakeTexture(res, 8);
	const sheet: MeshShape = { kind: "mesh", color: "card", texture: "dented", points: [[0, 0, 0], [4, 0, 0], [4, 4, 0], [0, 4, 0]], faces: [[0, 1, 2, 3]], mods: [{ op: "solidify", thick: 0.5 }] };
	sheet.mapping = { uvs: unwrapMesh(sheet, [16, 16]) };
	const doc = { version: 1, space: "3d", palette: [{ name: "card", rgb: [200, 160, 110, 255] }], textures: [res.texture], parts: [{ name: "a", shapes: [sheet] }] };
	assert.deepEqual(validate(doc).errors, []);
	const glb = toGlb(doc as never, { normals: { dented: toPng(baked.normal!) } });
	const len = new DataView(glb.buffer).getUint32(12, true);
	const gltf = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + len)));
	const prim = gltf.meshes[0].primitives[0];
	const bv = gltf.bufferViews[gltf.accessors[prim.attributes.TANGENT].bufferView];
	const tan = new Float32Array(glb.buffer.slice(20 + len + 8 + bv.byteOffset, 20 + len + 8 + bv.byteOffset + bv.byteLength));
	// two triangles outside, two inside, then the rim: the first six corners one hand, the next six the other
	const hands = Array.from({ length: 12 }, (_, i) => tan[i * 4 + 3]);
	assert.deepEqual(new Set(hands.slice(0, 6)).size, 1);
	assert.deepEqual(new Set(hands.slice(6, 12)).size, 1);
	assert.notEqual(hands[0], hands[6]);
});
