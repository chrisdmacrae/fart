// Format 1.12: image maps. A PNG read by core's own inflate, stretched over the cell, read as a drawing is; the `normal` map baked as given.

import { test } from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { as3d, bakeTexture, fromPng, imagePx, inflate, mapValues, parseDoc, pngSize, rasterizeMap, resolveTextures, toGlb, toPng, validate, type Raster } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const examples = resolve(here, "../../../spec/examples/valid");
const read = async (rel: string) => {
	try {
		return await readFile(join(examples, rel), "utf8");
	} catch {
		return null;
	}
};
const bytes = async (rel: string) => {
	try {
		return new Uint8Array(await readFile(join(examples, rel)));
	} catch {
		return null;
	}
};
const px = (r: Raster, x: number, y: number) => Array.from(r.data.slice((y * r.width + x) * 4, (y * r.width + x) * 4 + 4));
const imaged = async () => {
	const { doc } = parseDoc(await readFile(join(examples, "imaged.fart"), "utf8"));
	assert.ok(doc);
	const res = (await resolveTextures(doc, read, (t) => parseDoc(t).doc, bytes)).get("imaged")!;
	assert.deepEqual(res.unresolved, []);
	return { doc, res };
};

test("inflate agrees with zlib: stored, fixed and dynamic blocks, long matches", () => {
	let seed = 7;
	const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
	const noise = Uint8Array.from({ length: 5000 }, () => Math.floor(rand() * 256));
	const runs = Uint8Array.from({ length: 100000 }, (_, i) => (i % 300 < 200 ? 65 : Math.floor(rand() * 4)));
	for (const src of [new Uint8Array(0), Uint8Array.from([1, 2, 3]), noise, runs]) {
		for (const level of [0, 1, 9]) assert.deepEqual(inflate(deflateRawSync(src, { level })), src);
	}
});

test("PNGs of other colour types: RGB filtered by row, one bit through a palette", async () => {
	const color = fromPng((await bytes("textures/imaged.color.png"))!);
	assert.equal(color.width, 8);
	assert.deepEqual(px(color, 0, 0), [60, 40, 25, 255]); // the seam
	assert.deepEqual(px(color, 1, 0), [170, 120, 70, 255]);
	assert.deepEqual(px(color, 5, 0), [150, 100, 55, 255]);
	assert.deepEqual(px(color, 5, 4), [170, 120, 70, 255]);
	const normal = fromPng((await bytes("textures/imaged.normal.png"))!);
	assert.deepEqual(pngSize((await bytes("textures/imaged.normal.png"))!), { width: 4, height: 4 });
	assert.deepEqual(px(normal, 0, 0), [128, 128, 255, 255]);
	assert.deepEqual(px(normal, 1, 2), [218, 128, 218, 255]);
	// and our own writer reads back exactly
	assert.deepEqual(fromPng(toPng(color)).data, color.data);
	assert.throws(() => fromPng(new Uint8Array([1, 2, 3])), /not a PNG/);
});

test("a picture fills the cell whatever its size, and reads as a drawing does", async () => {
	const { res } = await imaged();
	assert.equal(imagePx(res), 8);
	// 16 pixels over an 8-pixel picture: each picture pixel twice
	const r = rasterizeMap(res.texture, res.maps.color, 16);
	assert.deepEqual(px(r, 2, 0), [170, 120, 70, 255]);
	assert.deepEqual(px(r, 0, 0), [60, 40, 25, 255]);
	assert.deepEqual(px(r, 1, 0), [60, 40, 25, 255]);
	// a scalar is luminance times alpha
	const v = mapValues(res.texture, res.maps.color, 8);
	assert.ok(Math.abs(v[1] - (0.2126 * 170 + 0.7152 * 120 + 0.0722 * 70) / 255) < 1e-6);
	// softened, the seam bleeds into the board
	const soft = mapValues(res.texture, res.maps.rough, 8);
	assert.ok(soft[0] > v[0] && soft[1] < v[1]);
});

test("the bake: a normal map as given, not among the maps; the rest as pictures", async () => {
	const { res } = await imaged();
	const baked = bakeTexture(res, imagePx(res));
	assert.deepEqual(Object.keys(baked.maps).sort(), ["color", "rough"]);
	assert.ok(baked.normal && baked.orm);
	assert.deepEqual(px(baked.normal!, 0, 0), [128, 128, 255, 255]);
	assert.deepEqual(px(baked.normal!, 2, 0), [218, 128, 218, 255]); // picture pixel 1 of 4, at 8 wide
});

test("glTF: the pictures become the material's colour and normal textures", async () => {
	const { doc, res } = await imaged();
	const baked = bakeTexture(res, 8);
	const glb = toGlb(as3d(doc)!, { images: { imaged: toPng(baked.maps.color) }, normals: { imaged: toPng(baked.normal!) } });
	const len = new DataView(glb.buffer).getUint32(12, true);
	const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + len)));
	const m = json.materials.find((x: { name: string }) => x.name === "imaged");
	assert.ok(m.pbrMetallicRoughness.baseColorTexture);
	assert.ok(m.normalTexture);
	assert.ok(json.meshes[0].primitives[0].attributes.TANGENT);
});

test("validation: one of ref and image, an image relative, no palette or state on a picture", () => {
	const codes = (m: object) => validate({ version: 1, textures: [{ name: "t", cell: [1, 1], maps: { color: m } }] }).errors.map((e) => e.code);
	assert.deepEqual(codes({ image: "a.png" }), []);
	assert.deepEqual(codes({ image: "a.png", mode: "mask", soften: 1 }), []);
	assert.deepEqual(codes({ image: "/a.png" }), ["path"]);
	assert.deepEqual(codes({ image: "a.png", ref: "a.fart" }), ["schema"]);
	assert.deepEqual(codes({ image: "a.png", state: "s" }), ["schema"]);
	assert.deepEqual(codes({}), ["schema"]);
});

test("a picture that cannot be read is unresolved, and without a bytes reader too", async () => {
	const doc = { version: 1 as const, textures: [{ name: "t", cell: [1, 1] as [number, number], maps: { color: { image: "missing.png" }, normal: { image: "imaged.fart" } } }] };
	const res = (await resolveTextures(doc, read, (t) => parseDoc(t).doc, bytes)).get("t")!;
	assert.deepEqual(res.unresolved.sort(), ["imaged.fart", "missing.png"]);
	const none = (await resolveTextures({ ...doc, textures: [{ ...doc.textures[0], maps: { color: { image: "textures/imaged.color.png" } } }] }, read, (t) => parseDoc(t).doc)).get("t")!;
	assert.deepEqual(none.unresolved, ["textures/imaged.color.png"]);
});

test("fart gltf then fart import: the pictures come home as image maps, pixel for pixel; --map names them by hand", async () => {
	const dir = await mkdtemp(join(tmpdir(), "fart-images-"));
	const cli = resolve(here, "../src/cli.ts");
	const run = (...args: string[]) => new Promise<{ code: number; out: string }>((done) => execFile(process.execPath, [cli, ...args], (err, stdout) => done({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, out: stdout })));
	try {
		await mkdir(join(dir, "textures"));
		await writeFile(join(dir, "crate.fart"), await readFile(join(examples, "imaged.fart")));
		for (const f of ["imaged.color.png", "imaged.normal.png"]) await writeFile(join(dir, "textures", f), await readFile(join(examples, "textures", f)));
		let r = await run("gltf", join(dir, "crate.fart"), "-o", join(dir, "crate.glb"));
		assert.equal(r.code, 0, r.out);
		r = await run("import", join(dir, "crate.glb"), "-o", join(dir, "back", "box.fart"));
		assert.equal(r.code, 0, r.out);
		assert.match(r.out, /texture box \(8 × 8\): color textures\/box\.color\.png, normal textures\/box\.normal\.png, rough textures\/box\.rough\.png, metal textures\/box\.metal\.png/);
		const back = parseDoc(await readFile(join(dir, "back", "box.fart"), "utf8")).doc!;
		const mesh = back.parts![0].shapes![0] as { texture?: string; mapping?: { uvs?: unknown[] } };
		assert.equal(mesh.texture, "box");
		assert.equal(mesh.mapping!.uvs!.length, 6);
		const was = fromPng(new Uint8Array(await readFile(join(examples, "textures/imaged.color.png"))));
		const now = fromPng(new Uint8Array(await readFile(join(dir, "back", "textures", "box.color.png"))));
		assert.deepEqual(now.data, was.data);
		assert.equal((await run("validate", join(dir, "back", "box.fart"))).code, 0);
		// by hand: any name, any PNG; not a PNG is refused
		r = await run("import", join(dir, "crate.glb"), "-o", join(dir, "hand.fart"), "--textures", "maps", "--map", "color=" + join(dir, "textures", "imaged.color.png"), "--map", "mask=" + join(dir, "textures", "imaged.normal.png"));
		assert.equal(r.code, 0, r.out);
		assert.match(r.out, /texture hand \(8 × 8\): color maps\/hand\.color\.png, mask maps\/hand\.mask\.png/);
		await access(join(dir, "maps", "hand.mask.png"));
		r = await run("import", join(dir, "crate.glb"), "--map", "color=" + join(dir, "crate.fart"));
		assert.notEqual(r.code, 0);
		// --no-textures: the old import
		r = await run("import", join(dir, "crate.glb"), "-o", join(dir, "flat.fart"), "--no-textures");
		assert.equal(r.code, 0, r.out);
		assert.equal(parseDoc(await readFile(join(dir, "flat.fart"), "utf8")).doc!.textures, undefined);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
