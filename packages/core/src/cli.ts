#!/usr/bin/env node
// fart: the command line.
//
//   fart validate <file|dir>...   check documents (exit 1 if any fail)
//   fart bake <file>...           write tris into every poly (or mesh) and bakes into every path, in place
//   fart bake --smooth <file>...  also the mesh every generated shape draws (smooth meshes 1.7; mods and sweeps 1.8), for readers that do not generate
//   fart project <3d.fart> [--view v]... [-o out]   a 2D view of a 3D document (1.3)
//   fart gltf <3d.fart> [-o out.glb] [--fps n]      the model as a binary glTF (1.3)
//   fart build <file|dir>... [--force] [--check] [--clean]   the compiled sidecar name.fart.glb of every 3D document (1.8)
//   fart hull <3d.fart> [--part name]...           convex hulls of parts, into collision (1.4)
//   fart bake --textures <dir> [--px n] <file>     every texture map as a PNG, for a build (1.5); a normal map and packed scalars too (1.10)
//   fart unwrap <3d.fart> [--part name]... [--texture name]   uvs for every textured mesh: box-projected islands packed into the cell (1.10)
//   fart flatten <scene.shart> [--t s]             a scene's instances with their world maps (shart 1.0)
//   fart import <model.glb|.gltf> [-o out.fart]    a glTF as a 3D .fart (see importCmd.ts for the flags)
//
// validate takes .shart files too: a scene is checked with its files in hand.
//
// Directories are walked for .fart files; palette_refs are read relative
// to each file so shared tokens get checked too.

import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { parseDoc } from "./parse.ts";
import { resolvePalettes, tokenNames } from "./palette.ts";
import { bakeTris } from "./geometry.ts";
import { stringifyDoc } from "./parse.ts";
import { as3d, type Doc, type Vec3 } from "./types.ts";
import { bakeTris3 } from "./space3.ts";
import { bakeSurfaces } from "./solids.ts";
import { DEFAULT_AMBIENT, DEFAULT_FPS, DEFAULT_LIGHT, VIEWS, projectDoc } from "./project.ts";
import { buildSidecar, sidecarFresh, sidecarPath, toGlb } from "./gltf.ts";
import { setHull } from "./collision.ts";
import { bakeTexture, resolveTextures, type Raster, type ResolvedTexture } from "./textures.ts";
import { flattenScene, loadScene, parseScene, refInfo, sceneFiles } from "./scene.ts";
import { toPng } from "./png.ts";
import { unwrapDoc } from "./unwrap.ts";
import { IMPORT_USAGE, importCmd } from "./importCmd.ts";

async function collect(paths: string[]): Promise<string[]> {
	const out: string[] = [];
	const walk = async (p: string) => {
		const s = await stat(p);
		if (s.isDirectory()) {
			for (const name of (await readdir(p)).sort()) {
				if (name.startsWith(".") || name === "node_modules") continue;
				await walk(join(p, name));
			}
		} else if (p.endsWith(".fart") || p.endsWith(".shart")) out.push(p);
	};
	for (const p of paths) await walk(p);
	return out;
}

async function readRef(base: string, rel: string): Promise<string | null> {
	try {
		return await readFile(resolve(dirname(base), rel), "utf8");
	} catch {
		return null;
	}
}

/** A document's textures, read relative to its file (1.5). */
async function texturesOf(file: string, doc: Doc): Promise<Map<string, ResolvedTexture>> {
	return resolveTextures(doc, (rel) => readRef(file, rel), (t) => parseDoc(t).doc);
}

/** A scene, checked with everything it names read from beside it. */
async function checkScene(file: string): Promise<{ ok: boolean; lines: string[] }> {
	const text = await readFile(file, "utf8");
	const first = parseScene(text);
	const lines: string[] = [];
	let refs: Map<string, import("./scene.ts").RefInfo> | undefined;
	if (first.raw) {
		const loaded = await loadScene(first.raw, (rel) => readRef(file, rel), "", [], basename(file));
		refs = refInfo(loaded);
	}
	const { report } = parseScene(text, { refs });
	for (const e of report.errors) lines.push(`  error ${e.code} ${e.path || "/"}: ${e.message}`);
	for (const w of report.warnings) lines.push(`  warn  ${w.code} ${w.path || "/"}: ${w.message}`);
	return { ok: report.ok, lines };
}

async function check(file: string): Promise<{ ok: boolean; doc: Doc | null; lines: string[] }> {
	if (file.endsWith(".shart")) {
		const r = await checkScene(file);
		return { ok: r.ok, doc: null, lines: r.lines };
	}
	const text = await readFile(file, "utf8");
	// a first pass finds the refs; a second checks tokens against them
	const first = parseDoc(text);
	let refTokens: Iterable<string> | null | undefined;
	if (first.doc && first.doc.palette_refs?.length) {
		const resolved = await resolvePalettes(first.doc, (rel) => readRef(file, rel));
		refTokens = resolved.unresolved.length ? null : tokenNames(resolved);
	}
	const unresolvedRefs: string[] = [];
	if (first.doc?.textures?.length) for (const t of (await texturesOf(file, first.doc)).values()) unresolvedRefs.push(...t.unresolved);
	const { doc, report } = parseDoc(text, { refTokens, unresolvedRefs });
	const lines: string[] = [];
	for (const e of report.errors) lines.push(`  error ${e.code} ${e.path || "/"}: ${e.message}`);
	for (const w of report.warnings) lines.push(`  warn  ${w.code} ${w.path || "/"}: ${w.message}`);
	return { ok: report.ok, doc, lines };
}

async function validateCmd(paths: string[]): Promise<number> {
	const files = await collect(paths.length ? paths : ["."]);
	let bad = 0;
	for (const file of files) {
		const { ok, lines } = await check(file);
		const warns = lines.filter((l) => l.startsWith("  warn")).length;
		const tag = ok ? (warns ? `ok (${warns} warning${warns === 1 ? "" : "s"})` : "ok") : "FAIL";
		console.log(`${tag.padEnd(16)} ${file}`);
		for (const l of lines) console.log(l);
		if (!ok) bad++;
	}
	console.log(`${files.length} file${files.length === 1 ? "" : "s"}, ${bad} failing`);
	return bad ? 1 : 0;
}

/** fart flatten: what a renderer would draw, one line per instance. */
async function flattenCmd(args: string[]): Promise<number> {
	let time = 0;
	const files: string[] = [];
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--t") time = Number(args[++i]) || 0;
		else files.push(args[i]);
	}
	if (files.length !== 1) throw new Error("flatten takes one .shart");
	const file = files[0];
	const text = await readFile(file, "utf8");
	const { scene, report } = parseScene(text);
	if (!scene) {
		for (const e of report.errors) console.log(`  error ${e.code} ${e.path || "/"}: ${e.message}`);
		return 1;
	}
	const loaded = await loadScene(scene, (rel) => readRef(file, rel));
	const placed = flattenScene(loaded, { time });
	for (const p of placed) {
		const t = p.space === "3d" ? (p.xf as number[]).slice(9).map((x) => x.toFixed(2)).join(",") : (p.xf as number[]).slice(4).map((x) => x.toFixed(2)).join(",");
		const what = p.node.clip ? `clip ${p.node.clip} @${((p.node.t ?? 0) + time).toFixed(2)}` : `state ${p.node.state ?? (p.doc.states?.[0]?.name ?? "rest")}`;
		console.log(`${p.path.padEnd(24)} ${(p.node.ref ?? "").padEnd(20)} at ${t}  ${what}  ${p.tokens.length} tokens`);
	}
	console.log(`${placed.length} instance${placed.length === 1 ? "" : "s"} from ${sceneFiles(loaded).length} file${sceneFiles(loaded).length === 1 ? "" : "s"}${loaded.unresolved.length ? `; unresolved: ${loaded.unresolved.join(", ")}` : ""}`);
	return 0;
}

async function bakeCmd(args: string[]): Promise<number> {
	// --textures <dir>: the maps as PNGs instead of tris into the file
	let texDir: string | undefined;
	let px = 64;
	let smooth = false;
	const paths: string[] = [];
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--textures") texDir = args[++i];
		else if (args[i] === "--px") px = Math.max(1, Number(args[++i]) || 64);
		else if (args[i] === "--smooth") smooth = true;
		else paths.push(args[i]);
	}
	if (texDir !== undefined) return bakeTextures(paths, texDir, px);
	const files = await collect(paths);
	let bad = 0;
	for (const file of files) {
		const { ok, doc, lines } = await check(file);
		if (!ok || !doc) {
			console.log(`skip ${file}: not valid`);
			for (const l of lines) console.log(l);
			bad++;
			continue;
		}
		const d3 = as3d(doc);
		if (d3) {
			bakeTris3(d3);
			if (smooth) bakeSurfaces(d3);
		} else bakeTris(doc);
		await writeFile(file, stringifyDoc(doc));
		console.log(`baked ${file}`);
	}
	return bad ? 1 : 0;
}

const USAGE = `usage: fart validate <file|dir>...
       fart bake [--smooth] <file>...             tris into every poly or mesh and bakes into every path; --smooth: the surfaces of smooth, modified and swept shapes too
       fart bake --textures <dir> [--px n] <file>...   every texture map as a PNG, plus .normal.png (a relief) and .orm.png (ao, rough, metal)
       fart gltf <3d.fart> [-o out.glb] [--fps n] [--px n]   --px: the width of each texture's images (64)
       fart build <file|dir>... [--force] [--check] [--clean] [--fps n]
         the compiled sidecar name.fart.glb beside every 3D document; one whose source has not changed is left alone (--force: rebuilt);
         --check: write nothing, exit 1 if any is missing or stale; --clean: remove them
       fart hull <3d.fart> [--part name]...     (no --part: every part) hulls into collision, in place
       fart unwrap <3d.fart> [--part name]... [--texture name] [--margin m]   uvs for textured meshes: box-projected islands packed into the cell, in place
       fart flatten <scene.shart> [--t s]       a scene's instances, placed
       ${IMPORT_USAGE}
       fart project <3d.fart> [--view name|x,y,z(deg)]... [--light x,y,z] [--ambient a] [--fps n] [--outline token[:w]] [-o out.fart]
         views: ${Object.keys(VIEWS).join(", ")}; several --view flags write several files (out gets -<view>)`;

/**
 * fart bake --textures: every map of every texture as <dir>/<texture>.<map>.png, one cell, px wide;
 * with a relief (1.10), <texture>.normal.png; with ao, rough or metal maps, <texture>.orm.png.
 */
async function bakeTextures(paths: string[], dir: string, px: number): Promise<number> {
	const files = await collect(paths);
	let bad = 0;
	await mkdir(dir, { recursive: true });
	for (const file of files) {
		const { ok, doc, lines } = await check(file);
		if (!ok || !doc) {
			console.log(`skip ${file}: not valid`);
			for (const l of lines) console.log(l);
			bad++;
			continue;
		}
		for (const res of (await texturesOf(file, doc)).values()) {
			const baked = bakeTexture(res, px);
			// the maps as drawn, then what 1.10 derives: the relief's normal map and the packed scalars
			const out: [string, Raster][] = Object.entries(baked.maps);
			if (baked.normal) out.push(["normal", baked.normal]);
			if (baked.orm) out.push(["orm", baked.orm]);
			for (const [name, raster] of out) {
				const target = join(dir, `${res.texture.name}.${name}.png`);
				await writeFile(target, toPng(raster));
				console.log(`wrote ${target}  (${baked.width}×${baked.height})`);
			}
			for (const u of res.unresolved) console.log(`  unresolved ${u}`);
		}
	}
	return bad ? 1 : 0;
}

/** fart project: a 2D document per view, beside the source unless -o says where. */
async function projectCmd(args: string[]): Promise<number> {
	const views: (string | Vec3)[] = [];
	let light: Vec3 | undefined;
	let ambient: number | undefined;
	let fps: number | undefined;
	let outline: { color: string; w: number } | undefined;
	let out: string | undefined;
	const files: string[] = [];
	const nums = (s: string, n: number, what: string): number[] => {
		const v = s.split(",").map(Number);
		if (v.length !== n || v.some((x) => !Number.isFinite(x))) throw new Error(`${what}: expected ${n} numbers, got "${s}"`);
		return v;
	};
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		const next = () => {
			if (i + 1 >= args.length) throw new Error(`${a} needs a value`);
			return args[++i];
		};
		if (a === "--view") {
			const v = next();
			if (v in VIEWS) views.push(v);
			else views.push(nums(v, 3, "--view").map((d) => (d * Math.PI) / 180) as Vec3);
		} else if (a === "--light") light = nums(next(), 3, "--light") as Vec3;
		else if (a === "--ambient") ambient = Number(next());
		else if (a === "--fps") fps = Number(next());
		else if (a === "--outline") {
			const [color, w] = next().split(":");
			outline = { color, w: w === undefined ? 0.4 : Number(w) };
		} else if (a === "-o" || a === "--out") out = next();
		else if (a.startsWith("-")) throw new Error(`unknown flag ${a}`);
		else files.push(a);
	}
	if (files.length !== 1) throw new Error("project takes one 3D source file");
	if (!views.length) views.push("front");
	const file = files[0];
	const { ok, doc, lines } = await check(file);
	if (!ok || !doc) {
		console.log(`skip ${file}: not valid`);
		for (const l of lines) console.log(l);
		return 1;
	}
	const src = as3d(doc);
	if (!src) throw new Error(`${file} is not a 3D document (space: "3d")`);
	const stem = basename(file).replace(/\.fart$/, "");
	for (const view of views) {
		const label = typeof view === "string" ? view : view.map((r) => Math.round((r * 180) / Math.PI)).join("_");
		let target: string;
		if (out === undefined) target = join(dirname(file), `${stem}-${label}.fart`);
		else if (views.length === 1) target = out;
		else target = out.replace(/\.fart$/, "") + `-${label}.fart`;
		const from = relative(dirname(resolve(target)), resolve(file)).split("\\").join("/");
		const projected = projectDoc(src, { view, light, ambient, fps, outline, from });
		// palette_refs were relative to the source; make them relative to the output
		const rebase = (ref: string) => relative(dirname(resolve(target)), resolve(dirname(file), ref)).split("\\").join("/");
		if (projected.palette_refs) projected.palette_refs = projected.palette_refs.map(rebase);
		for (const t of projected.textures ?? []) for (const m of Object.values(t.maps)) {
			m.ref = rebase(m.ref);
			if (m.palette) m.palette = rebase(m.palette);
		}
		if (outline && !(projected.palette ?? []).some((t) => t.name === outline.color)) {
			projected.palette = [...(projected.palette ?? []), { name: outline.color, rgb: [25, 22, 30, 255] }];
		}
		await writeFile(target, stringifyDoc(projected));
		const variants = (projected.parts ?? []).filter((p) => p.name.includes("@")).length;
		console.log(`wrote ${target}  (${(projected.parts ?? []).length - variants} parts, ${variants} variants, light ${(light ?? DEFAULT_LIGHT).join(",")}, ambient ${ambient ?? DEFAULT_AMBIENT}, ${fps ?? DEFAULT_FPS} fps)`);
	}
	return 0;
}

/** fart gltf: the model as a .glb beside it, palette refs resolved. */
async function gltfCmd(args: string[]): Promise<number> {
	let out: string | undefined;
	let fps: number | undefined;
	let px = 64;
	const files: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === "-o" || a === "--out") out = args[++i];
		else if (a === "--fps") fps = Number(args[++i]);
		else if (a === "--px") px = Math.max(1, Number(args[++i]) || 64);
		else if (a.startsWith("-")) throw new Error(`unknown flag ${a}`);
		else files.push(a);
	}
	if (files.length !== 1) throw new Error("gltf takes one 3D source file");
	const file = files[0];
	const { ok, doc, lines } = await check(file);
	if (!ok || !doc) {
		console.log(`skip ${file}: not valid`);
		for (const l of lines) console.log(l);
		return 1;
	}
	const src = as3d(doc);
	if (!src) throw new Error(`${file} is not a 3D document (space: "3d")`);
	const { tokens } = await resolvePalettes(doc, (rel) => readRef(file, rel));
	const images: Record<string, Uint8Array> = {};
	const normals: Record<string, Uint8Array> = {};
	const orms: Record<string, Uint8Array> = {};
	for (const res of (await texturesOf(file, doc)).values()) {
		const baked = bakeTexture(res, px);
		if (baked.maps.color) images[res.texture.name] = toPng(baked.maps.color);
		if (baked.normal) normals[res.texture.name] = toPng(baked.normal);
		if (baked.orm) orms[res.texture.name] = toPng(baked.orm);
	}
	const glb = toGlb(src, { tokens, fps, images, normals, orms });
	const target = out ?? file.replace(/\.fart$/, "") + ".glb";
	await writeFile(target, glb);
	console.log(`wrote ${target}  (${(glb.length / 1024).toFixed(1)} KB, ${(src.parts ?? []).length} nodes, ${(src.clips ?? []).length} animations)`);
	return 0;
}

/**
 * fart build: the compiled sidecar (1.8) of every 3D document given, or
 * found under a directory given: `name.fart.glb` beside `name.fart`. A
 * sidecar that already holds its source's hash is left alone. A 2D
 * document, a palette file and a scene have none.
 */
async function buildCmd(args: string[]): Promise<number> {
	let force = false;
	let checkOnly = false;
	let clean = false;
	let fps: number | undefined;
	const paths: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === "--force") force = true;
		else if (a === "--check") checkOnly = true;
		else if (a === "--clean") clean = true;
		else if (a === "--fps") fps = Number(args[++i]);
		else if (a.startsWith("-")) throw new Error(`unknown flag ${a}`);
		else paths.push(a);
	}
	if (!paths.length) throw new Error("build takes files or directories");
	if (clean) {
		// every sidecar under the directories given, with or without its source, and the one beside each file given
		const found: string[] = [];
		const walk = async (p: string) => {
			const s = await stat(p);
			if (s.isDirectory()) {
				for (const name of (await readdir(p)).sort()) {
					if (name.startsWith(".") || name === "node_modules") continue;
					await walk(join(p, name));
				}
			} else if (p.endsWith(".fart.glb")) found.push(p);
			else if (p.endsWith(".fart") && paths.includes(p)) found.push(sidecarPath(p));
		};
		for (const p of paths) await walk(p);
		let removed = 0;
		for (const target of new Set(found)) {
			try {
				await rm(target);
				console.log(`removed ${target}`);
				removed++;
			} catch {
				// not there: nothing to remove
			}
		}
		console.log(`${removed} sidecar${removed === 1 ? "" : "s"} removed`);
		return 0;
	}
	const files = (await collect(paths)).filter((p) => p.endsWith(".fart"));
	let bad = 0;
	let wrote = 0;
	let kept = 0;
	let stale = 0;
	for (const file of files) {
		const { ok, doc, lines } = await check(file);
		if (!ok || !doc) {
			console.log(`skip ${file}: not valid`);
			for (const l of lines) console.log(l);
			bad++;
			continue;
		}
		const src = as3d(doc);
		if (!src) continue;
		const source = new Uint8Array(await readFile(file));
		const target = sidecarPath(file);
		let existing: Uint8Array | null = null;
		try {
			existing = new Uint8Array(await readFile(target));
		} catch {
			existing = null;
		}
		const fresh = sidecarFresh(existing, source);
		if (checkOnly) {
			if (!fresh) {
				console.log(`${existing ? "stale  " : "missing"} ${target}`);
				stale++;
			} else kept++;
			continue;
		}
		if (fresh && !force) {
			kept++;
			continue;
		}
		const { tokens } = await resolvePalettes(doc, (rel) => readRef(file, rel));
		const glb = buildSidecar(src, source, { tokens, fps });
		await writeFile(target, glb);
		console.log(`built ${target}  (${(glb.length / 1024).toFixed(1)} KB)`);
		wrote++;
	}
	if (checkOnly) console.log(`${kept} up to date, ${stale} missing or stale${bad ? `, ${bad} not valid` : ""}`);
	else console.log(`${wrote} built, ${kept} up to date${bad ? `, ${bad} not valid` : ""}`);
	return bad || stale ? 1 : 0;
}

/** fart hull: a convex hull per part (every part, or the named ones) into the file's collision, in place. */
async function hullCmd(args: string[]): Promise<number> {
	const names: string[] = [];
	const files: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === "--part") names.push(args[++i]);
		else if (a.startsWith("-")) throw new Error(`unknown flag ${a}`);
		else files.push(a);
	}
	if (files.length !== 1) throw new Error("hull takes one 3D source file");
	const file = files[0];
	const { ok, doc, lines } = await check(file);
	if (!ok || !doc) {
		console.log(`skip ${file}: not valid`);
		for (const l of lines) console.log(l);
		return 1;
	}
	const src = as3d(doc);
	if (!src) throw new Error(`${file} is not a 3D document (space: "3d")`);
	const parts = names.length ? names : (src.parts ?? []).filter((p) => !p.like).map((p) => p.name);
	let n = 0;
	for (const name of parts) {
		if (!(src.parts ?? []).some((p) => p.name === name)) throw new Error(`no part named ${name}`);
		const h = setHull(src, name);
		if (h) {
			n++;
			console.log(`hull ${name}: ${h.points.length} points, ${h.faces.length} faces`);
		} else console.log(`hull ${name}: no volume, skipped`);
	}
	await writeFile(file, stringifyDoc(src));
	console.log(`wrote ${file}  (${n} hull${n === 1 ? "" : "s"})`);
	return 0;
}

/** fart unwrap: uvs for every textured mesh (of the named parts, of the named texture), in place. */
async function unwrapCmd(args: string[]): Promise<number> {
	const names: string[] = [];
	const files: string[] = [];
	let texture: string | undefined;
	let margin: number | undefined;
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === "--part") names.push(args[++i]);
		else if (a === "--texture") texture = args[++i];
		else if (a === "--margin") margin = Number(args[++i]);
		else if (a.startsWith("-")) throw new Error(`unknown flag ${a}`);
		else files.push(a);
	}
	if (files.length !== 1) throw new Error("unwrap takes one 3D source file");
	const file = files[0];
	const { ok, doc, lines } = await check(file);
	if (!ok || !doc) {
		console.log(`skip ${file}: not valid`);
		for (const l of lines) console.log(l);
		return 1;
	}
	const src = as3d(doc);
	if (!src) throw new Error(`${file} is not a 3D document (space: "3d")`);
	const n = unwrapDoc(src, { parts: names, texture, margin });
	await writeFile(file, stringifyDoc(src));
	console.log(`wrote ${file}  (${n} mesh${n === 1 ? "" : "es"} unwrapped)`);
	return 0;
}

const [cmd, ...rest] = process.argv.slice(2);
let code = 2;
try {
	switch (cmd) {
		case "validate":
			code = await validateCmd(rest);
			break;
		case "bake":
			code = await bakeCmd(rest);
			break;
		case "project":
			code = await projectCmd(rest);
			break;
		case "gltf":
			code = await gltfCmd(rest);
			break;
		case "build":
			code = await buildCmd(rest);
			break;
		case "hull":
			code = await hullCmd(rest);
			break;
		case "unwrap":
			code = await unwrapCmd(rest);
			break;
		case "flatten":
			code = await flattenCmd(rest);
			break;
		case "import":
			code = await importCmd(rest);
			break;
		default:
			console.log(USAGE);
	}
} catch (e) {
	console.error(`fart ${cmd}: ${e instanceof Error ? e.message : String(e)}`);
	code = 2;
}
process.exit(code);
