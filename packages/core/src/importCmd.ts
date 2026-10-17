// fart import: a glTF (.glb, or .gltf with its buffers beside it) as a
// 3D .fart, with what was left out printed. The work is gltfImport.ts;
// this reads the files and writes the result. Textures (1.12): the PNGs
// the glTF holds, or ones named with --map, are written beside the
// document as image maps, and the meshes that wear them carry their uvs.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { GltfError, gltfBufferUris, gltfImages, importGltf, snakeName, type GltfImage, type GltfImportOptions, type GltfMaterialImages } from "./gltfImport.ts";
import { stringifyDoc } from "./parse.ts";
import { validate } from "./validate.ts";
import { fromPng, isPng, pngSize, toPng } from "./png.ts";
import type { Raster } from "./textures.ts";
import type { Texture, TextureMap, Vec2 } from "./types.ts";

export const IMPORT_USAGE = "fart import <model.glb|model.gltf> [-o out.fart] [--map name=file.png]... [--textures dir] [--no-textures] [--scale n] [--height n] [--merge] [--split-materials] [--no-quads] [--no-shades]";

/** A picture to write beside the document, and the map that names it. */
interface Picture {
	map: string;
	bytes: Uint8Array;
}

/** One channel of a picture as a grey PNG: glTF packs roughness, metalness and occlusion into one image; the format reads each map's luminance. */
function channel(img: Raster, c: number): Uint8Array {
	const data = new Uint8ClampedArray(img.data.length);
	for (let i = 0; i < data.length; i += 4) {
		data[i] = data[i + 1] = data[i + 2] = img.data[i + c];
		data[i + 3] = 255;
	}
	return toPng({ width: img.width, height: img.height, data }, { deflate: (raw) => deflateSync(raw, { level: 9 }) });
}

/**
 * The pictures a glTF material wears, as maps: the colour and the normal
 * as they are, the packed metal-roughness split into `rough` and `metal`,
 * occlusion as `ao`, emission as `glow`. Only PNGs: anything else is named
 * in a warning, to be converted and passed with --map.
 */
function embeddedMaps(images: GltfImage[], m: GltfMaterialImages, warn: (w: string) => void): Picture[] {
	const out: Picture[] = [];
	const png = (i: number | undefined, slot: string): Uint8Array | null => {
		if (i === undefined) return null;
		const im = images[i];
		if (!im.bytes) {
			warn(`the ${slot} picture ${im.uri ?? im.name} was not found beside the file`);
			return null;
		}
		if (!isPng(im.bytes)) {
			warn(`the ${slot} picture ${im.name} is ${im.mimeType}, and a map is a PNG: convert it and pass it with --map`);
			return null;
		}
		return im.bytes;
	};
	const color = png(m.color, "base colour");
	if (color) out.push({ map: "color", bytes: color });
	const normal = png(m.normal, "normal");
	if (normal) out.push({ map: "normal", bytes: normal });
	const mr = png(m.metallicRoughness, "metal-roughness");
	if (mr) {
		const img = fromPng(mr);
		out.push({ map: "rough", bytes: channel(img, 1) }, { map: "metal", bytes: channel(img, 2) });
	}
	const occ = m.occlusion === m.metallicRoughness ? mr : png(m.occlusion, "occlusion");
	if (occ) out.push({ map: "ao", bytes: channel(fromPng(occ), 0) });
	const glow = png(m.emissive, "emissive");
	if (glow) out.push({ map: "glow", bytes: glow });
	return out;
}

/** A texture of pictures: its cell the colour picture's size in pixels (else the first's), so pattern coordinates are pixels. */
function textureOf(name: string, pictures: Picture[], dirRel: string): { texture: Texture; files: { file: string; bytes: Uint8Array }[] } {
	const lead = pictures.find((p) => p.map === "color") ?? pictures[0];
	const size = pngSize(lead.bytes)!;
	const cell: Vec2 = [size.width, size.height];
	const maps: Record<string, TextureMap> = {};
	const files: { file: string; bytes: Uint8Array }[] = [];
	for (const p of pictures) {
		const rel = `${dirRel ? `${dirRel}/` : ""}${name}.${p.map}.png`;
		maps[p.map] = { image: rel };
		files.push({ file: rel, bytes: p.bytes });
	}
	return { texture: { name, cell, maps }, files };
}

export async function importCmd(args: string[]): Promise<number> {
	const opts: GltfImportOptions = {};
	let out: string | undefined;
	const files: string[] = [];
	/** --map name=file.png, in order */
	const given: { map: string; file: string }[] = [];
	let texDir = "textures";
	let textures = true;
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		const num = (): number => {
			const v = Number(args[++i]);
			if (!Number.isFinite(v) || v <= 0) throw new Error(`${a} needs a number above 0`);
			return v;
		};
		if (a === "-o" || a === "--out") {
			if (i + 1 >= args.length) throw new Error(`${a} needs a value`);
			out = args[++i];
		} else if (a === "--map") {
			const v = args[++i] ?? "";
			const eq = v.indexOf("=");
			if (eq <= 0 || eq === v.length - 1) throw new Error("--map takes name=file.png (color, normal, rough, metal, ao, height, or any name the game reads)");
			given.push({ map: v.slice(0, eq), file: v.slice(eq + 1) });
		} else if (a === "--textures") {
			if (i + 1 >= args.length) throw new Error(`${a} needs a value`);
			texDir = args[++i];
		} else if (a === "--no-textures") textures = false;
		else if (a === "--scale") opts.scale = num();
		else if (a === "--height") opts.height = num();
		else if (a === "--merge") opts.merge = true;
		else if (a === "--split-materials") opts.splitMaterials = true;
		else if (a === "--no-quads") opts.quads = false;
		else if (a === "--no-shades") opts.shades = false;
		else if (a.startsWith("-")) throw new Error(`unknown flag ${a}`);
		else files.push(a);
	}
	if (files.length !== 1) throw new Error("import takes one .glb or .gltf");
	const file = files[0];
	const target = out ?? file.replace(/\.(glb|gltf)$/i, "") + ".fart";
	const stem = (target.split(/[\\/]/).pop() ?? "model").replace(/\.fart$/, "");
	opts.name = snakeName(stem, "model");
	const bytes = new Uint8Array(await readFile(file));
	try {
		// a .gltf names the files its geometry is in, relative to itself
		const buffers: Record<string, Uint8Array> = {};
		for (const uri of gltfBufferUris(bytes)) {
			let rel = uri;
			try {
				rel = decodeURIComponent(uri);
			} catch {
				// as written
			}
			try {
				buffers[uri] = new Uint8Array(await readFile(resolve(dirname(file), rel)));
			} catch {
				// importGltf says which one is missing
			}
		}
		// 1.12: the pictures, written beside the document as image maps
		const early: string[] = [];
		const writes: { file: string; bytes: Uint8Array }[] = [];
		if (textures) {
			const outDir = dirname(resolve(target));
			const dirRel = relative(outDir, resolve(outDir, texDir)).split("\\").join("/");
			if (given.length) {
				// named on the command line: one texture, worn by every material
				const pictures: Picture[] = [];
				for (const g of given) {
					const pic = new Uint8Array(await readFile(g.file));
					if (!isPng(pic)) throw new Error(`--map ${g.map}: ${g.file} is not a PNG (a map's picture is a PNG)`);
					pictures.push({ map: snakeName(g.map, "map"), bytes: pic });
				}
				const t = textureOf(opts.name, pictures, dirRel);
				opts.textures = [{ texture: t.texture }];
				writes.push(...t.files);
			} else {
				// the glTF's own: a texture per material that wears pictures, external ones read from beside it
				for (const im of gltfImages(bytes, buffers).images) {
					if (im.bytes || !im.uri) continue;
					try {
						buffers[im.uri] = new Uint8Array(await readFile(resolve(dirname(file), decodeURIComponent(im.uri))));
					} catch {
						// embeddedMaps says which one is missing
					}
				}
				const { images, materials } = gltfImages(bytes, buffers);
				opts.textures = [];
				for (const m of materials) {
					const pictures = embeddedMaps(images, m, (w) => early.push(w));
					if (!pictures.length) continue;
					const name = materials.length === 1 ? opts.name : `${opts.name}_${m.name}`;
					const t = textureOf(name, pictures, dirRel);
					opts.textures.push({ texture: t.texture, materials: [m.material] });
					writes.push(...t.files);
				}
			}
		}
		const { doc, warnings, summary } = importGltf(bytes, { ...opts, buffers });
		warnings.unshift(...early);
		const report = validate(doc);
		for (const e of report.errors) console.log(`  error ${e.code} ${e.path || "/"}: ${e.message}`);
		if (!report.ok) {
			console.log(`import ${file}: the result does not validate; nothing written`);
			return 1;
		}
		// only the pictures a shape wears
		const worn = new Set((doc.textures ?? []).flatMap((t) => Object.values(t.maps).map((m) => m.image)));
		for (const w of writes) {
			if (!worn.has(w.file)) continue;
			const full = resolve(dirname(resolve(target)), w.file);
			await mkdir(dirname(full), { recursive: true });
			await writeFile(full, w.bytes);
		}
		await writeFile(target, stringifyDoc(doc));
		const n = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
		console.log(`wrote ${target}  (${n(summary.parts, "part")}, ${n(summary.shapes, "shape")}, ${n(summary.points, "point")}, ${n(summary.faces, "face")} of which ${n(summary.quads, "quad")}, ${n(summary.tokens, "colour")}, ${n(summary.states, "state")}, ${n(summary.clips, "clip")}; ${summary.size.join(" × ")} units at scale ${Math.round(summary.scale * 10000) / 10000})`);
		for (const t of doc.textures ?? []) console.log(`  texture ${t.name} (${t.cell.join(" × ")}): ${Object.entries(t.maps).map(([k, m]) => `${k} ${m.image}`).join(", ")}`);
		for (const w of warnings) console.log(`  warn  ${w}`);
		for (const w of report.warnings) console.log(`  warn  ${w.code} ${w.path || "/"}: ${w.message}`);
		return 0;
	} catch (e) {
		if (e instanceof GltfError) {
			console.log(`import ${file}: ${e.message}`);
			return 1;
		}
		throw e;
	}
}
