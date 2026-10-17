// glTF import: gltf.ts read backwards. A model exported and read again
// keeps its points and its outside; materials become tokens and paint;
// triangles pair into quads; split vertices weld; nodes become parts with
// pivots and parents; animations become clips; what is left out is said.

import { test } from "node:test";
import assert from "node:assert/strict";
import { box, cornerNormals, fromPng, GltfError, gltfBufferUris, gltfImages, importGltf, toPng, sampleClip3, snakeName, toGlb, validate, worldTransforms3, xf3Apply, type Doc3, type MeshShape, type Vec3 } from "../src/index.ts";

const near = (a: number, b: number, eps = 2e-3) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const nearV = (a: readonly number[], b: readonly number[], eps = 2e-3) => a.forEach((x, i) => near(x, b[i], eps));
const mesh = (doc: Doc3, part: number | string, shape = 0) => (typeof part === "number" ? doc.parts![part] : doc.parts!.find((p) => p.name === part)!).shapes![shape] as MeshShape;
const ok = (doc: Doc3) => {
	const r = validate(doc);
	assert.deepEqual(r.errors, []);
	assert.deepEqual(r.warnings, []);
};
/** Six times the volume a closed mesh encloses: positive when every face looks outward. */
function volume6(m: MeshShape): number {
	let v = 0;
	for (const f of m.faces) for (let i = 1; i + 1 < f.length; i++) {
		const [a, b, c] = [m.points[f[0]], m.points[f[i]], m.points[f[i + 1]]];
		v += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
	}
	return v;
}
const sorted = (pts: readonly Vec3[]) => [...pts].map((p) => p.join(",")).sort();

// ---------------------------------------------------------------- a glTF, by hand

interface Build {
	json: Record<string, any>;
	chunks: Uint8Array[];
	size: number;
}
function builder(): Build & { acc: (data: number[], type: string, componentType?: number) => number; gltf: (uri?: string) => Record<string, any>; glb: () => Uint8Array; bin: () => Uint8Array } {
	const b: Build = { json: { asset: { version: "2.0" }, accessors: [], bufferViews: [] }, chunks: [], size: 0 };
	const acc = (data: number[], type: string, componentType = 5126): number => {
		const arr = componentType === 5126 ? new Float32Array(data) : componentType === 5123 ? new Uint16Array(data) : componentType === 5125 ? new Uint32Array(data) : new Uint8Array(data);
		const bytes = new Uint8Array(arr.buffer);
		const pad = (4 - (bytes.length % 4)) % 4;
		b.json.bufferViews.push({ buffer: 0, byteOffset: b.size, byteLength: bytes.length });
		b.chunks.push(bytes, new Uint8Array(pad));
		b.size += bytes.length + pad;
		const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type]!;
		b.json.accessors.push({ bufferView: b.json.bufferViews.length - 1, componentType, count: data.length / n, type });
		return b.json.accessors.length - 1;
	};
	const bin = () => {
		const out = new Uint8Array(b.size);
		let at = 0;
		for (const c of b.chunks) {
			out.set(c, at);
			at += c.length;
		}
		return out;
	};
	const gltf = (uri?: string) => ({ ...b.json, buffers: [{ byteLength: b.size, uri: uri ?? `data:application/octet-stream;base64,${Buffer.from(bin()).toString("base64")}` }] });
	const glb = () => {
		const json = new TextEncoder().encode(JSON.stringify({ ...b.json, buffers: [{ byteLength: b.size }] }));
		const jp = (4 - (json.length % 4)) % 4;
		const out = new Uint8Array(12 + 8 + json.length + jp + 8 + b.size);
		const dv = new DataView(out.buffer);
		dv.setUint32(0, 0x46546c67, true);
		dv.setUint32(4, 2, true);
		dv.setUint32(8, out.length, true);
		dv.setUint32(12, json.length + jp, true);
		dv.setUint32(16, 0x4e4f534a, true);
		out.set(json, 20);
		out.fill(0x20, 20 + json.length, 20 + json.length + jp);
		dv.setUint32(20 + json.length + jp, b.size, true);
		dv.setUint32(24 + json.length + jp, 0x004e4942, true);
		out.set(bin(), 28 + json.length + jp);
		return out;
	};
	return Object.assign(b, { acc, gltf, glb, bin });
}

/** A cube the way an exporter writes one: four vertices per face (flat normals), two triangles each. Faces: +x −x +y −y +z −z. */
function cubeData(size = 2, at: Vec3 = [0, 0, 0]) {
	const h = size / 2;
	const pos: number[] = [];
	const nor: number[] = [];
	const idx: number[] = [];
	const faces: [Vec3, Vec3, Vec3][] = [
		[[1, 0, 0], [0, 1, 0], [0, 0, 1]],
		[[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
		[[0, 1, 0], [0, 0, 1], [1, 0, 0]],
		[[0, -1, 0], [1, 0, 0], [0, 0, 1]],
		[[0, 0, 1], [1, 0, 0], [0, 1, 0]],
		[[0, 0, -1], [0, 1, 0], [1, 0, 0]],
	];
	faces.forEach(([n, u, v], f) => {
		// corners counter-clockwise seen from outside: u × v = n
		for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
			pos.push(at[0] + h * (n[0] + su * u[0] + sv * v[0]), at[1] + h * (n[1] + su * u[1] + sv * v[1]), at[2] + h * (n[2] + su * u[2] + sv * v[2]));
			nor.push(...n);
		}
		idx.push(f * 4, f * 4 + 1, f * 4 + 2, f * 4, f * 4 + 2, f * 4 + 3);
	});
	return { pos, nor, idx };
}

function cubeScene(extra: (b: ReturnType<typeof builder>) => void = () => {}) {
	const b = builder();
	const c = cubeData();
	b.json.meshes = [{ name: "Cube", primitives: [{ attributes: { POSITION: b.acc(c.pos, "VEC3"), NORMAL: b.acc(c.nor, "VEC3") }, indices: b.acc(c.idx, "SCALAR", 5123) }] }];
	b.json.nodes = [{ name: "Cube", mesh: 0 }];
	b.json.scenes = [{ name: "Scene", nodes: [0] }];
	b.json.scene = 0;
	extra(b);
	return b;
}

// ---------------------------------------------------------------- the round trip

test("a model exported and imported again keeps its points, its pivots, its parents and its outside", () => {
	const src: Doc3 = {
		version: 1,
		space: "3d",
		name: "crane",
		palette: [{ name: "steel", rgb: [120, 130, 140, 255] }, { name: "paint", rgb: [200, 60, 40, 255] }],
		parts: [
			{ name: "base", pivot: [0, 4, 0], shapes: [box("steel", [0, 2, 0], [8, 4, 6])] },
			{ name: "arm", parent: "base", pivot: [0, 0, 1], shapes: [box("paint", [5, -1, 1], [10, 2, 2])] },
			{ name: "hook", parent: "arm", pivot: [10, -1, 1], shapes: [box("steel", [10, 1.5, 1], [1, 3, 1])] },
		],
		clips: [
			{
				name: "lift",
				keys: [
					{ t: 0, parts: [{ part: "base" }, { part: "arm" }, { part: "hook" }] },
					{ t: 1, parts: [{ part: "base", rotate: [0, 0.6, 0] }, { part: "arm", rotate: [0, 0, -0.7], offset: [0, -1, 1] }, { part: "hook", rotate: [0.4, 0, 0.2] }] },
				],
			},
		],
	};
	assert.deepEqual(validate(src).errors, []);
	const { doc, warnings, summary } = importGltf(toGlb(src, { fps: 4 }));
	ok(doc);
	assert.deepEqual(doc.parts!.map((p) => [p.name, p.parent, p.pivot]), src.parts!.map((p) => [p.name, p.parent, p.pivot]));
	for (const part of src.parts!) {
		const a = part.shapes![0] as MeshShape;
		const b = mesh(doc, part.name);
		assert.deepEqual(sorted(b.points), sorted(a.points), part.name);
		// every box is six quads again, and they look outward: the volume is the box's, not its negative
		assert.equal(b.faces.length, 6);
		assert.ok(b.faces.every((f) => f.length === 4));
		assert.ok(volume6(a) > 0);
		near(volume6(b), volume6(a), 1e-6);
	}
	assert.equal(summary.quads, 18);
	assert.equal(summary.points, 24);
	// the clip: a key per exported frame, and the same motion in between
	const clip = doc.clips!.find((c) => c.name === "lift")!;
	assert.deepEqual(clip.keys.map((k) => k.t), [0, 0.25, 0.5, 0.75, 1]);
	for (const t of [0, 0.25, 0.4, 0.75, 1]) {
		const wa = worldTransforms3(src, sampleClip3(src, src.clips![0], t));
		const wb = worldTransforms3(doc, sampleClip3(doc, clip, t));
		for (const part of src.parts!) for (const p of (part.shapes![0] as MeshShape).points) nearV(xf3Apply(wb.get(part.name)!, p), xf3Apply(wa.get(part.name)!, p), 0.02);
	}
	assert.deepEqual(warnings, []);
});

// ---------------------------------------------------------------- colour

test("a cube of three materials is one shape: the first is its colour, the rest are colors, paint says which face wears which", () => {
	const b = builder();
	const c = cubeData();
	const pos = b.acc(c.pos, "VEC3");
	const nor = b.acc(c.nor, "VEC3");
	const prim = (faces: number[], material: number) => ({ attributes: { POSITION: pos, NORMAL: nor }, indices: b.acc(faces.flatMap((f) => c.idx.slice(f * 6, f * 6 + 6)), "SCALAR", 5123), material });
	b.json.materials = [
		{ name: "Red Paint", pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } },
		{ pbrMetallicRoughness: { baseColorFactor: [0.5, 0.5, 0.5, 0.5] } },
		{ name: "Lamp", pbrMetallicRoughness: { baseColorFactor: [0, 0, 0, 1] }, emissiveFactor: [1, 0.5, 0], extensions: { KHR_materials_emissive_strength: { emissiveStrength: 3 } } },
		{ name: "unused" },
	];
	b.json.meshes = [{ primitives: [prim([0, 1], 0), prim([2, 3, 4], 1), prim([5], 2)] }];
	b.json.nodes = [{ name: "Box", mesh: 0 }];
	b.json.scenes = [{ nodes: [0] }];
	const { doc, warnings } = importGltf(b.gltf());
	ok(doc);
	assert.deepEqual(warnings, []);
	// linear 0.5 is sRGB 188; alpha is kept as it is; the glow's colour stands in for a black base
	assert.deepEqual(doc.palette, [
		{ name: "red_paint", rgb: [255, 0, 0, 255] },
		{ name: "material_2", rgb: [188, 188, 188, 128] },
		{ name: "lamp", rgb: [255, 188, 0, 255], emissive: 3 },
	]);
	assert.equal(doc.parts!.length, 1);
	assert.equal(doc.parts![0].shapes!.length, 1);
	const m = mesh(doc, 0);
	assert.equal(m.color, "red_paint");
	assert.deepEqual(m.colors, ["material_2", "lamp"]);
	assert.deepEqual(m.paint, [0, 0, 1, 1, 1, 2]);
	assert.equal(m.points.length, 8);
	// the faces painted 0 are the ones that look along x (y and z are turned over, x is not)
	m.faces.forEach((f, i) => {
		const xs = new Set(f.map((v) => m.points[v][0]));
		assert.equal(xs.size === 1, m.paint![i] === 0);
	});
	near(volume6(m), 48, 1e-6);

	// for a reader older than 1.8: a shape per material
	const split = importGltf(b.gltf(), { splitMaterials: true }).doc;
	ok(split);
	assert.deepEqual(split.parts![0].shapes!.map((s) => [s.color, (s as MeshShape).faces.length, (s as MeshShape).paint]), [["red_paint", 2, undefined], ["material_2", 3, undefined], ["lamp", 1, undefined]]);
});

test("a mesh with no material wears glTF's default; a textured material keeps its factor and says so once", () => {
	const b = cubeScene((b) => {
		b.json.materials = [{ name: "Wood", pbrMetallicRoughness: { baseColorFactor: [0.2, 0.1, 0.05, 1], baseColorTexture: { index: 0 } } }];
		b.json.meshes.push({ primitives: [{ ...b.json.meshes[0].primitives[0], material: 0 }] });
		b.json.nodes.push({ name: "Crate", mesh: 1, translation: [4, 0, 0] }, { name: "Crate", mesh: 1, translation: [8, 0, 0] });
		b.json.scenes[0].nodes = [0, 1, 2];
	});
	const { doc, warnings } = importGltf(b.gltf());
	ok(doc);
	assert.deepEqual(doc.palette!.map((t) => t.name), ["default", "wood"]);
	assert.deepEqual(doc.palette![0].rgb, [255, 255, 255, 255]);
	assert.deepEqual(doc.parts!.map((p) => p.name), ["cube", "crate", "crate_2"]);
	assert.deepEqual(warnings, ['material "Wood" has a base colour texture, which is not imported; its colour factor is used']);
});

test("vertex colours become shades by their luminance, unless asked not to", () => {
	const make = (cols: number[]) =>
		cubeScene((b) => {
			b.json.meshes[0].primitives[0].attributes.COLOR_0 = b.acc(cols, "VEC4");
		}).gltf();
	// the +y face (glTF's top: the document's −y) dark, the rest white
	const cols: number[] = [];
	for (let v = 0; v < 24; v++) cols.push(...(v >= 8 && v < 12 ? [0.2, 0.2, 0.2, 1] : [1, 1, 1, 1]));
	const { doc } = importGltf(make(cols));
	ok(doc);
	const m = mesh(doc, 0);
	assert.equal(m.shades!.length, m.points.length);
	// a corner on the dark face is shared with two white faces: the three average
	const dark = (0.484529 + 1 + 1) / 3;
	m.points.forEach((p, i) => near(m.shades![i], p[1] < 0 ? dark : 1));
	assert.equal(mesh(importGltf(make(cols), { shades: false }).doc, 0).shades, undefined);
	// all white says nothing
	assert.equal(mesh(importGltf(make(new Array(96).fill(1))).doc, 0).shades, undefined);
});

// ---------------------------------------------------------------- geometry

function gridScene(n: number, wobble = 0) {
	const b = builder();
	const pos: number[] = [];
	const idx: number[] = [];
	for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) pos.push(x, wobble * Math.sin(x * 1.3 + y), y);
	for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
		const a = y * (n + 1) + x;
		// counter-clockwise seen from +y
		idx.push(a, a + n + 1, a + n + 2, a, a + n + 2, a + 1);
	}
	b.json.meshes = [{ primitives: [{ attributes: { POSITION: b.acc(pos, "VEC3") }, indices: b.acc(idx, "SCALAR", 5125) }] }];
	b.json.nodes = [{ name: "Grid", mesh: 0 }];
	b.json.scenes = [{ nodes: [0] }];
	return b;
}

test("a triangulated grid comes back as its quads, along the diagonals the exporter cut", () => {
	const b = gridScene(4);
	const { doc, summary } = importGltf(b.glb());
	ok(doc);
	const m = mesh(doc, 0);
	assert.equal(m.points.length, 25);
	assert.equal(m.faces.length, 16);
	assert.ok(m.faces.every((f) => f.length === 4));
	assert.equal(summary.quads, 16);
	// every quad is a unit square, wound so its normal is glTF's +y: the document's −y
	for (const f of m.faces) {
		const p = f.map((i) => m.points[i]);
		const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
		const e2 = [p[3][0] - p[0][0], p[3][1] - p[0][1], p[3][2] - p[0][2]];
		near(e1[2] * e2[0] - e1[0] * e2[2], -1);
		near(Math.hypot(...e1) * Math.hypot(...e2), 1);
	}
	// the baked triangles are the source's own
	assert.equal(m.tris!.length, 96);

	const tris = importGltf(b.glb(), { quads: false }).doc;
	ok(tris);
	assert.equal(mesh(tris, 0).faces.length, 32);
	assert.ok(mesh(tris, 0).faces.every((f) => f.length === 3));

	// a bent sheet stays triangles where it folds: a quad is flat within the tolerance
	const bent = mesh(importGltf(gridScene(4, 0.5).glb()).doc, 0);
	assert.ok(bent.faces.some((f) => f.length === 3));
	assert.equal(mesh(importGltf(gridScene(4, 0.5).glb(), { quadAngle: 90 }).doc, 0).faces.length, 16);
});

// ---------------------------------------------------------------- 1.12: textures

/** A cube whose faces each take a strip of the sheet, a picture in the .glb, and a second material on the last face. */
function texturedCube(seam = false) {
	const b = builder();
	const c = cubeData();
	const uv: number[] = [];
	for (let f = 0; f < 6; f++) for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) uv.push(f / 6 + ((su + 1) / 2) * 0.1, ((sv + 1) / 2) * 0.5);
	const idx = [...c.idx];
	const pos = [...c.pos];
	const nor = [...c.nor];
	if (seam) {
		// the first face's second triangle on corners of its own, mapped elsewhere: a seam along the diagonal
		const base = pos.length / 3;
		for (const k of [0, 2, 3]) {
			pos.push(...c.pos.slice(k * 3, k * 3 + 3));
			nor.push(...c.nor.slice(k * 3, k * 3 + 3));
			uv.push(uv[k * 2], uv[k * 2 + 1] + 0.5);
		}
		idx.splice(3, 3, base, base + 1, base + 2);
	}
	const png = toPng({ width: 4, height: 2, data: new Uint8ClampedArray(32).fill(200) });
	const bytes = Array.from(png);
	const imgView = b.json.bufferViews.length;
	b.acc(bytes, "SCALAR", 5121);
	b.json.accessors.pop();
	b.json.images = [{ name: "Bark", bufferView: imgView, mimeType: "image/png" }];
	b.json.textures = [{ source: 0 }];
	b.json.materials = [{ name: "Wood", pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }, { name: "Paint" }];
	const P = b.acc(pos, "VEC3");
	const N = b.acc(nor, "VEC3");
	const T = b.acc(uv, "VEC2");
	b.json.meshes = [{ name: "Cube", primitives: [
		{ attributes: { POSITION: P, NORMAL: N, TEXCOORD_0: T }, indices: b.acc(idx.slice(0, 30), "SCALAR", 5123), material: 0 },
		{ attributes: { POSITION: P, NORMAL: N, TEXCOORD_0: T }, indices: b.acc(idx.slice(30), "SCALAR", 5123), material: 1 },
	] }];
	b.json.nodes = [{ name: "Cube", mesh: 0 }];
	b.json.scenes = [{ nodes: [0] }];
	return { b, uv };
}

test("textures (1.12): the materials that wear one carry their uvs corner by corner, scaled to the cell; the rest are cut apart", () => {
	const { b } = texturedCube();
	const glb = b.glb();
	// the pictures a glTF holds, by the material that wears them
	const { images, materials } = gltfImages(glb);
	assert.equal(images.length, 1);
	assert.equal(images[0].name, "bark");
	assert.equal(images[0].mimeType, "image/png");
	assert.deepEqual(fromPng(images[0].bytes!).width, 4);
	assert.deepEqual(materials, [{ material: 0, name: "wood", color: 0 }]);

	// without textures: the factor, and a word
	const plain = importGltf(glb);
	assert.ok(plain.warnings.some((w) => w.includes("base colour texture")));
	assert.equal(plain.doc.textures, undefined);

	const texture = { name: "bark", cell: [60, 20] as [number, number], maps: { color: { image: "bark.png" } } };
	const { doc, warnings } = importGltf(glb, { textures: [{ texture, materials: [0] }] });
	assert.ok(!warnings.some((w) => w.includes("base colour texture")));
	ok(doc);
	assert.deepEqual(doc.textures, [texture]);
	const shapes = doc.parts![0].shapes as MeshShape[];
	assert.equal(shapes.length, 2);
	const [wood, paint] = shapes;
	assert.equal(wood.texture, "bark");
	assert.equal(paint.texture, undefined);
	assert.equal(paint.faces.length, 1);
	assert.equal(wood.faces.length, 5);
	assert.ok(wood.faces.every((f) => f.length === 4));
	// each corner's uv is its source corner's: the face's strip, by where the corner sits on the face
	const uvs = wood.mapping!.uvs!;
	wood.faces.forEach((f, fi) => {
		// glTF's frame is the document's turned half about x
		const g = f.map((i) => [wood.points[i][0], -wood.points[i][1], -wood.points[i][2]]);
		const centre = [0, 1, 2].map((k) => g.reduce((t, p) => t + p[k], 0) / 4);
		const axis = centre.map((x) => Math.round(x));
		const faceIndex = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].findIndex((n) => n.every((x, k) => x === axis[k]));
		const frames: [Vec3, Vec3][] = [[[0, 1, 0], [0, 0, 1]], [[0, 0, 1], [0, 1, 0]], [[0, 0, 1], [1, 0, 0]], [[1, 0, 0], [0, 0, 1]], [[1, 0, 0], [0, 1, 0]], [[0, 1, 0], [1, 0, 0]]];
		const [u, v] = frames[faceIndex];
		f.forEach((_, ci) => {
			const su = g[ci][0] * u[0] + g[ci][1] * u[1] + g[ci][2] * u[2];
			const sv = g[ci][0] * v[0] + g[ci][1] * v[1] + g[ci][2] * v[2];
			nearV(uvs[fi][ci], [(faceIndex / 6 + ((su + 1) / 2) * 0.1) * 60, ((sv + 1) / 2) * 0.5 * 20], 1e-3);
		});
	});
	// no list of materials: every material wears it, so one shape again
	const all = importGltf(glb, { textures: [{ texture }] }).doc;
	ok(all);
	assert.equal(all.parts![0].shapes!.length, 1);
	assert.equal((all.parts![0].shapes![0] as MeshShape).mapping!.uvs!.length, 6);
});

test("textures (1.12): a seam along a face's diagonal keeps its two triangles apart", () => {
	const texture = { name: "bark", cell: [1, 1] as [number, number], maps: { color: { image: "bark.png" } } };
	const seamed = importGltf(texturedCube(true).b.glb(), { textures: [{ texture }] }).doc;
	ok(seamed);
	const m = seamed.parts![0].shapes![0] as MeshShape;
	assert.equal(m.faces.filter((f) => f.length === 3).length, 2);
	assert.equal(m.faces.length, 7);
	// without textures the uvs say nothing and the face is a quad
	assert.equal((importGltf(texturedCube(true).b.glb()).doc.parts![0].shapes![0] as MeshShape).faces.length, 6);
});

test("vertices split for normals weld; a tolerance decides how near is the same", () => {
	const { doc } = importGltf(cubeScene().gltf());
	ok(doc);
	const m = mesh(doc, 0);
	assert.equal(m.points.length, 8);
	assert.equal(m.faces.length, 6);
	// flat normals in the source: a flat shape here
	assert.equal(m.normals, undefined);
	near(volume6(m), 48, 1e-6);

	// two cubes a hair apart: one tolerance keeps them apart, a wider one joins them
	const twin = () => {
		const b = builder();
		const a = cubeData(2);
		const c = cubeData(2, [2.004, 0, 0]);
		b.json.meshes = [{ primitives: [{ attributes: { POSITION: b.acc([...a.pos, ...c.pos], "VEC3") }, indices: b.acc([...a.idx, ...c.idx.map((i) => i + 24)], "SCALAR", 5123) }] }];
		b.json.nodes = [{ mesh: 0 }];
		return b.gltf();
	};
	assert.equal(mesh(importGltf(twin()).doc, 0).points.length, 16);
	assert.equal(mesh(importGltf(twin(), { weld: 0.01 }).doc, 0).points.length, 12);
	// coordinates keep three decimals
	assert.ok(mesh(importGltf(twin()).doc, 0).points.every((p) => p.every((x) => Math.abs(x * 1000 - Math.round(x * 1000)) < 1e-6)));
});

test("smooth normals in the source make a smooth shape, with an angle where some edges stay sharp", () => {
	// a capped cylinder: smooth round the side, flat caps, split along the rims
	const b = builder();
	const n = 12;
	const pos: number[] = [];
	const nor: number[] = [];
	const idx: number[] = [];
	for (let i = 0; i < n; i++) {
		const a = (i / n) * Math.PI * 2;
		pos.push(Math.cos(a), -1, Math.sin(a), Math.cos(a), 1, Math.sin(a));
		nor.push(Math.cos(a), 0, Math.sin(a), Math.cos(a), 0, Math.sin(a));
	}
	for (let i = 0; i < n; i++) {
		const j = (i + 1) % n;
		idx.push(i * 2, i * 2 + 1, j * 2 + 1, i * 2, j * 2 + 1, j * 2);
	}
	for (const y of [-1, 1]) {
		const base = pos.length / 3;
		for (let i = 0; i < n; i++) {
			const a = (i / n) * Math.PI * 2;
			pos.push(Math.cos(a), y, Math.sin(a));
			nor.push(0, y, 0);
		}
		for (let i = 1; i + 1 < n; i++) (y > 0 ? idx.push(base, base + i + 1, base + i) : idx.push(base, base + i, base + i + 1));
	}
	b.json.meshes = [{ primitives: [{ attributes: { POSITION: b.acc(pos, "VEC3"), NORMAL: b.acc(nor, "VEC3") }, indices: b.acc(idx, "SCALAR", 5123) }] }];
	b.json.nodes = [{ name: "Can", mesh: 0 }];
	const { doc } = importGltf(b.gltf());
	ok(doc);
	const m = mesh(doc, 0);
	assert.equal(m.normals, "smooth");
	// the side folds 30° a facet, the rims 90°: the angle sits between
	assert.ok(m.angle! > 30 && m.angle! < 90, String(m.angle));
	assert.equal(m.creases, undefined);
	assert.equal(m.points.length, 24);
	assert.ok(volume6(m) > 0);
	// and the reader's normals then agree with the source's: round the side, flat on the caps
	const cn = cornerNormals(m.points, m.faces, { angle: m.angle });
	m.faces.forEach((f, fi) => f.forEach((v, c) => {
		const p = m.points[v];
		const side = Math.abs(cn[fi][c][1]) < 0.5;
		if (side) nearV(cn[fi][c], [p[0], 0, p[2]], 0.02);
		else near(Math.abs(cn[fi][c][1]), 1);
	}));
	// the side's quads came back (the caps' fans pair up too, where two triangles make a convex quad)
	assert.equal(m.faces.filter((f) => f.length === 4 && new Set(f.map((v) => m.points[v][1])).size === 2).length, n);
});

test("a shape holds 65,535 points: a larger mesh is cut into several, and says so", () => {
	const { doc, warnings } = importGltf(gridScene(260).glb());
	ok(doc);
	const shapes = doc.parts![0].shapes as MeshShape[];
	assert.equal(shapes.length, 2);
	assert.ok(shapes.every((s) => s.points.length <= 65535));
	assert.equal(shapes.reduce((n, s) => n + s.faces.length, 0), 260 * 260);
	assert.ok(warnings.some((w) => /68121 points are more than one shape holds/.test(w)), warnings.join("\n"));
});

// ---------------------------------------------------------------- nodes

test("nodes become parts: the node's origin is the pivot, the nearest mesh node above is the parent, the rest pose is in the points", () => {
	const b = cubeScene((b) => {
		// Body at (0, 3, 0); a rig node with no mesh, turned a quarter about y; Arm under it at (2, 0, 0)
		const q = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
		b.json.nodes = [
			{ name: "Body", mesh: 0, translation: [0, 3, 0], children: [1] },
			{ name: "Rig", rotation: q, children: [2] },
			{ name: "Arm.L", mesh: 0, translation: [2, 0, 0], scale: [0.5, 0.5, 0.5] },
			{ name: "Body", mesh: 0, translation: [10, 0, 0] },
		];
		b.json.scenes[0].nodes = [0, 3];
	});
	const { doc, warnings } = importGltf(b.gltf());
	ok(doc);
	assert.deepEqual(warnings, []);
	assert.deepEqual(doc.parts!.map((p) => [p.name, p.parent]), [["body", undefined], ["arm_l", "body"], ["body_2", undefined]]);
	// glTF (0, 3, 0) is the document's (0, −3, 0); the arm's x, turned a quarter about y, points along glTF −z: the document's +z
	assert.deepEqual(doc.parts![0].pivot, [0, -3, 0]);
	assert.deepEqual(doc.parts![1].pivot, [0, -3, 2]);
	assert.deepEqual(doc.parts![2].pivot, [10, 0, 0]);
	const arm = mesh(doc, "arm_l");
	const xs = arm.points.map((p) => p[0]);
	const zs = arm.points.map((p) => p[2]);
	assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)], [-0.5, 0.5, 1.5, 2.5]);
	near(volume6(arm), 6, 1e-6);
	// the first state is the drawing: every part where it stands
	assert.deepEqual(doc.states, [{ name: "default", parts: doc.parts!.map((p) => ({ part: p.name, offset: p.pivot })) }]);

	const merged = importGltf(b.gltf(), { merge: true }).doc;
	ok(merged);
	assert.deepEqual(merged.parts!.map((p) => [p.name, p.pivot, p.shapes!.length]), [["main", [0, 0, 0], 3]]);
	assert.deepEqual(sorted(mesh(merged, 0, 1).points), sorted(arm.points));
});

test("a mirrored node keeps its outside out; a scale and a height set the units", () => {
	const b = cubeScene((b) => {
		b.json.nodes[0].scale = [-1, 1, 1];
	});
	const { doc } = importGltf(b.gltf());
	near(volume6(mesh(doc, 0)), 48, 1e-6);
	const big = importGltf(b.gltf(), { scale: 10 });
	assert.deepEqual(big.summary.size, [20, 20, 20]);
	const tall = importGltf(b.gltf(), { height: 5, scale: 99 });
	assert.deepEqual(tall.summary.size, [5, 5, 5]);
	assert.equal(tall.summary.scale, 2.5);
});

// ---------------------------------------------------------------- animation

test("a node animation is a clip: keys at the sampler's times, the pivot's place and the turn in the file's frame", () => {
	const b = cubeScene((b) => {
		b.json.nodes = [
			{ name: "Base", mesh: 0, children: [1] },
			{ name: "Lid", mesh: 0, translation: [0, 2, 0] },
		];
		const quarterZ = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
		b.json.animations = [
			{
				name: "Open Lid",
				samplers: [
					{ input: b.acc([0, 0.5, 1], "SCALAR"), output: b.acc([0, 2, 0, 0, 3, 0, 0, 3, 0], "VEC3"), interpolation: "LINEAR" },
					{ input: b.acc([0, 1], "SCALAR"), output: b.acc([0, 0, 0, 1, ...quarterZ], "VEC4"), interpolation: "LINEAR" },
				],
				channels: [
					{ sampler: 0, target: { node: 1, path: "translation" } },
					{ sampler: 1, target: { node: 1, path: "rotation" } },
				],
			},
			{
				samplers: [{ input: b.acc([0, 1], "SCALAR"), output: b.acc([0, 0, 0, 5, 0, 0], "VEC3"), interpolation: "STEP" }],
				channels: [{ sampler: 0, target: { node: 0, path: "translation" } }],
			},
		];
	});
	const { doc, warnings } = importGltf(b.gltf());
	ok(doc);
	assert.deepEqual(warnings, []);
	assert.deepEqual(doc.clips!.map((c) => c.name), ["open_lid", "clip_2"]);
	const open = doc.clips![0];
	assert.deepEqual(open.keys.map((k) => k.t), [0, 0.5, 1]);
	// the base does not move: it is named and nothing more
	assert.deepEqual(open.keys[1].parts![0], { part: "base" });
	// glTF +y is the document's −y; a quarter turn about glTF +z is a quarter turn the other way about the document's z
	const lid = open.keys.map((k) => k.parts![1]);
	assert.deepEqual(lid[0], { part: "lid", offset: [0, -2, 0], rotate: [0, 0, 0] });
	assert.deepEqual(lid[1].offset, [0, -3, 0]);
	nearV(lid[1].rotate!, [0, 0, -Math.PI / 4], 1e-4);
	assert.deepEqual(lid[2].offset, [0, -3, 0]);
	nearV(lid[2].rotate!, [0, 0, -Math.PI / 2], 1e-4);
	assert.equal(open.keys[1].ease, undefined);
	// a point of the lid, half way: where glTF would put it
	const W = worldTransforms3(doc, sampleClip3(doc, open, 0.5)).get("lid")!;
	const s = Math.SQRT1_2;
	// glTF: the corner (1, 1, 1) of the cube, turned 45° about z, then lifted to y = 3: (0, 3 + √2, 1); the document turns y and z over
	nearV(xf3Apply(W, [1, -3, -1]), [0, -(3 + 2 * s), -1], 2e-3);

	// a held sampler is a step, and the child rides the parent without a key of its own
	const hop = doc.clips![1];
	assert.deepEqual(hop.keys, [
		{ t: 0, parts: [{ part: "base", offset: [0, 0, 0], rotate: [0, 0, 0] }, { part: "lid" }] },
		{ t: 1, parts: [{ part: "base", offset: [5, 0, 0], rotate: [0, 0, 0] }, { part: "lid" }], ease: "step" },
	]);

	// merged, there is one part and nothing to move
	const merged = importGltf(b.gltf(), { merge: true });
	assert.equal(merged.doc.clips, undefined);
	assert.deepEqual(merged.warnings, ["2 animations left out: a merged model is one part"]);
});

test("a node between two parts that moves, moves the part below it", () => {
	const b = cubeScene((b) => {
		b.json.nodes = [
			{ name: "Root", mesh: 0, children: [1] },
			{ name: "Swing", translation: [0, 4, 0], children: [2] },
			{ name: "Seat", mesh: 0, translation: [0, -3, 0] },
		];
		b.json.animations = [{ name: "swing", samplers: [{ input: b.acc([0, 1], "SCALAR"), output: b.acc([0, 0, 0, 1, Math.SQRT1_2, 0, 0, Math.SQRT1_2], "VEC4") }], channels: [{ sampler: 0, target: { node: 1, path: "rotation" } }] }];
	});
	const { doc } = importGltf(b.gltf());
	ok(doc);
	assert.deepEqual(doc.parts![1].pivot, [0, -1, 0]);
	const end = doc.clips![0].keys[1].parts![1];
	// glTF: the seat hangs 3 below the swing at y = 4; a quarter about x carries it to (0, 4, −3): the document's (0, −4, 3)
	assert.deepEqual(end.offset, [0, -4, 3]);
	nearV(end.rotate!, [Math.PI / 2, 0, 0], 1e-4);
});

test("morph targets are states named for them; animated weights are morphs on the keys", () => {
	const b = cubeScene((b) => {
		const delta = new Array(72).fill(0);
		// lift the four corners of the +y face by 1
		for (let v = 0; v < 24; v++) if (cubeData().pos[v * 3 + 1] > 0) delta[v * 3 + 1] = 1;
		b.json.meshes[0].primitives[0].targets = [{ POSITION: b.acc(delta, "VEC3") }, { POSITION: b.acc(new Array(72).fill(0), "VEC3") }];
		b.json.meshes[0].extras = { targetNames: ["Tall Hat", "Nothing"] };
		b.json.animations = [{ name: "grow", samplers: [{ input: b.acc([0, 2], "SCALAR"), output: b.acc([0, 0, 0.5, 0], "SCALAR") }], channels: [{ sampler: 0, target: { node: 0, path: "weights" } }] }];
	});
	const { doc } = importGltf(b.gltf());
	ok(doc);
	// a target that moves nothing makes no state
	assert.deepEqual(doc.states!.map((s) => s.name), ["default", "tall_hat"]);
	const m = mesh(doc, 0);
	const morph = doc.states![1].parts[0].morph![0];
	assert.equal(morph.shape, 0);
	assert.equal(morph.points.length, m.points.length);
	m.points.forEach((p, i) => assert.deepEqual(morph.points[i], p[1] < 0 ? [p[0], p[1] - 1, p[2]] : p));
	const keys = doc.clips![0].keys;
	assert.equal(keys[0].parts![0].morph, undefined);
	m.points.forEach((p, i) => assert.deepEqual(keys[1].parts![0].morph![0].points[i], p[1] < 0 ? [p[0], p[1] - 0.5, p[2]] : p));
});

test("a skin is kept (1.9), or flattened when asked: each face rides the joint that holds most of it, a part per joint", () => {
	const b = builder();
	// a bar of two cubes end to end along y, the lower on joint 0, the upper on joint 1
	const lo = cubeData(2, [0, 1, 0]);
	const hi = cubeData(2, [0, 3, 0]);
	const joints: number[] = [];
	const weights: number[] = [];
	for (let v = 0; v < 48; v++) {
		joints.push(0, 1, 0, 0);
		weights.push(...(v < 24 ? [0.9, 0.1, 0, 0] : [0.2, 0.8, 0, 0]));
	}
	const ident = (t: Vec3) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -t[0], -t[1], -t[2], 1];
	b.json.meshes = [{ name: "Bar", primitives: [{ attributes: { POSITION: b.acc([...lo.pos, ...hi.pos], "VEC3"), JOINTS_0: b.acc(joints, "VEC4", 5121), WEIGHTS_0: b.acc(weights, "VEC4") }, indices: b.acc([...lo.idx, ...hi.idx.map((i) => i + 24)], "SCALAR", 5123) }] }];
	b.json.skins = [{ joints: [1, 2], inverseBindMatrices: b.acc([...ident([0, 0, 0]), ...ident([0, 2, 0])], "MAT4") }];
	b.json.nodes = [
		{ name: "Bar", mesh: 0, skin: 0 },
		{ name: "Bone", children: [2] },
		{ name: "Bone.001", translation: [0, 2, 0] },
	];
	b.json.scenes = [{ nodes: [0, 1] }];
	b.json.animations = [{ name: "bend", samplers: [{ input: b.acc([0, 1], "SCALAR"), output: b.acc([0, 0, 0, 1, 0, 0, Math.SQRT1_2, Math.SQRT1_2], "VEC4") }], channels: [{ sampler: 0, target: { node: 2, path: "rotation" } }] }];
	// 1.9: kept, the weights are the shapes' skins: each face with the joint that holds most of it, its points following both
	const kept = importGltf(b.gltf());
	ok(kept.doc);
	assert.deepEqual(kept.warnings, []);
	const lower = mesh(kept.doc, "bone");
	assert.deepEqual(lower.skin!.joints, ["bone", "bone_001"]);
	assert.equal(lower.skin!.weights.length, lower.points.length);
	assert.deepEqual(lower.skin!.weights[0], [0, 0.9, 1, 0.1]);
	assert.deepEqual(mesh(kept.doc, "bone_001").skin!.weights[0], [0, 0.8, 1, 0.2]);
	const { doc, warnings } = importGltf(b.gltf(), { skins: false });
	ok(doc);
	assert.deepEqual(doc.parts!.map((p) => [p.name, p.parent, p.pivot]), [["bone", undefined, [0, 0, 0]], ["bone_001", "bone", [0, -2, 0]]]);
	assert.deepEqual(sorted(mesh(doc, "bone").points), sorted(lo.pos.reduce<Vec3[]>((a, _, i) => (i % 3 ? a : [...a, [lo.pos[i], -lo.pos[i + 1], -lo.pos[i + 2]] as Vec3]), []).filter((p, i, all) => all.findIndex((q) => q.join() === p.join()) === i)));
	assert.equal(mesh(doc, "bone_001").points.length, 8);
	assert.equal(mesh(doc, "bone_001").faces.length, 6);
	assert.deepEqual(warnings, ['mesh "Bar" is skinned: smooth skinning is flattened to rigid parts, each face bound to the joint that holds most of it']);
	nearV(doc.clips![0].keys[1].parts![1].rotate!, [0, 0, -Math.PI / 2], 1e-4);
});

// ---------------------------------------------------------------- containers

test("a .glb, a .gltf with its buffer inline, and one with its buffer beside it read alike", () => {
	const b = cubeScene();
	const fromGlb = importGltf(b.glb()).doc;
	const inline = importGltf(JSON.stringify(b.gltf())).doc;
	const asBytes = importGltf(new TextEncoder().encode(JSON.stringify(b.gltf()))).doc;
	const asObject = importGltf(b.gltf()).doc;
	const beside = importGltf(b.gltf("cube%20data.bin"), { buffers: { "cube data.bin": b.bin() } }).doc;
	for (const d of [inline, asBytes, asObject, beside]) assert.deepEqual(d, fromGlb);
	assert.equal(fromGlb.name, "scene");
	assert.equal(importGltf(b.glb(), { name: "crate" }).doc.name, "crate");
	assert.deepEqual(gltfBufferUris(b.gltf("cube.bin")), ["cube.bin"]);
	assert.deepEqual(gltfBufferUris(b.glb()), []);
	assert.deepEqual(gltfBufferUris(b.gltf()), []);
	assert.throws(() => importGltf(b.gltf("cube.bin")), (e: unknown) => e instanceof GltfError && /keeps its geometry in cube\.bin, which was not found/.test(e.message));
	assert.throws(() => importGltf("{ nope"), GltfError);
	assert.throws(() => importGltf({ scenes: [] }), /not a glTF/);
	assert.throws(() => importGltf({ asset: { version: "1.0" } }), /only glTF 2/);
});

test("quantised and interleaved attributes read as the numbers they stand for", () => {
	// positions as normalised int16 with a node scale, the way KHR_mesh_quantization packs them; stride 8
	const c = cubeData();
	const bytes = new Uint8Array(24 * 8);
	const dv = new DataView(bytes.buffer);
	for (let v = 0; v < 24; v++) for (let k = 0; k < 3; k++) dv.setInt16(v * 8 + k * 2, c.pos[v * 3 + k] * 32767, true);
	const idx = new Uint8Array(c.idx);
	const all = new Uint8Array(bytes.length + idx.length);
	all.set(bytes);
	all.set(idx, bytes.length);
	const json = {
		asset: { version: "2.0" },
		extensionsUsed: ["KHR_mesh_quantization"],
		extensionsRequired: ["KHR_mesh_quantization"],
		buffers: [{ byteLength: all.length, uri: `data:application/octet-stream;base64,${Buffer.from(all).toString("base64")}` }],
		bufferViews: [{ buffer: 0, byteLength: bytes.length, byteStride: 8 }, { buffer: 0, byteOffset: bytes.length, byteLength: idx.length }],
		accessors: [{ bufferView: 0, componentType: 5122, normalized: true, count: 24, type: "VEC3" }, { bufferView: 1, componentType: 5121, count: 36, type: "SCALAR" }],
		meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
		nodes: [{ mesh: 0, scale: [3, 3, 3] }],
	};
	const { doc, warnings } = importGltf(json);
	ok(doc);
	assert.deepEqual(warnings, []);
	assert.deepEqual(sorted(mesh(doc, 0).points), sorted([[-3, -3, -3], [3, -3, -3], [3, 3, -3], [-3, 3, -3], [-3, -3, 3], [3, -3, 3], [3, 3, 3], [-3, 3, 3]]));
	assert.equal(doc.parts![0].name, "node_0");
});

// ---------------------------------------------------------------- what is left out

test("everything left out is named: cameras, lights, extensions, splines, lines, a tiny model", () => {
	const b = cubeScene((b) => {
		b.json.cameras = [{ type: "perspective" }];
		b.json.extensions = { KHR_lights_punctual: { lights: [{ type: "point" }, { type: "sun" }] } };
		b.json.extensionsUsed = ["KHR_lights_punctual", "KHR_materials_clearcoat", "KHR_texture_transform"];
		b.json.meshes[0].primitives.push({ attributes: { POSITION: b.json.meshes[0].primitives[0].attributes.POSITION }, mode: 1 });
		b.json.scenes.push({ name: "Other", nodes: [] });
		b.json.nodes[0].scale = [0.1, 0.1, 0.1];
		b.json.animations = [
			{ name: "wave", samplers: [{ input: b.acc([0, 1], "SCALAR"), output: b.acc(new Array(18).fill(0), "VEC3"), interpolation: "CUBICSPLINE" }], channels: [{ sampler: 0, target: { node: 0, path: "translation" } }] },
			{ name: "idle", samplers: [], channels: [] },
			{ name: "squash", samplers: [{ input: b.acc([0, 1], "SCALAR"), output: b.acc([1, 1, 1, 2, 0.5, 2], "VEC3") }], channels: [{ sampler: 0, target: { node: 0, path: "scale" } }] },
		];
	});
	const { doc, warnings } = importGltf(b.gltf());
	ok(doc);
	assert.deepEqual(warnings, [
		"extension KHR_materials_clearcoat is not read",
		"1 camera left out",
		"2 lights left out",
		'the file has 2 scenes; only "Scene" is read',
		'mesh "Cube": lines left out (only triangles are read)',
		'animation "wave": its cubic spline is kept at its keys and runs straight between them',
		'animation "idle" moves nothing that was imported and is left out',
		'animation "squash" stretches or mirrors a part unevenly; the format scales a part by one number, so that part of the motion is lost',
		"the model is 0.2 units across and coordinates keep three decimals: import it larger (a scale, or a height) to keep its detail",
	]);
	assert.deepEqual(doc.clips!.map((c) => c.name), ["wave", "squash"]);
});

test("compressed geometry is refused with a word on what to do", () => {
	const draco = cubeScene((b) => {
		b.json.extensionsUsed = ["KHR_draco_mesh_compression"];
		b.json.meshes[0].primitives[0].extensions = { KHR_draco_mesh_compression: { bufferView: 0, attributes: {} } };
	});
	assert.throws(() => importGltf(draco.gltf()), (e: unknown) => e instanceof GltfError && /compressed \(KHR_draco_mesh_compression\).*export it again without compression/.test(e.message));
	const meshopt = cubeScene((b) => {
		b.json.extensionsRequired = ["EXT_meshopt_compression"];
	});
	assert.throws(() => importGltf(meshopt.gltf()), /compressed \(EXT_meshopt_compression\)/);
});

test("names are the format's: lower snake case, never empty", () => {
	assert.equal(snakeName("Helm Knight.001", "x"), "helm_knight_001");
	assert.equal(snakeName("upperArmL", "x"), "upper_arm_l");
	assert.equal(snakeName("Épée", "x"), "epee");
	assert.equal(snakeName("  ", "part"), "part");
	assert.equal(snakeName(undefined, "part"), "part");
});
