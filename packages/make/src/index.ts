// @fastart/make: what a generator needs and keeps reinventing. A document
// is built from parts and states by name, mirrored parts are one call,
// shapes come from recipes, clips from a line of keys, morphs from moves;
// write() validates, bakes and writes with the canonical layout and stamps
// the generator's path into meta.gen so the studio can rerun it.
//
//   import { doc, part, mirrorOf, state, clip, morph, ellipse, write } from "@fastart/make";
//   const d = doc("bat", { palette_refs: ["../palettes/cave.fart"] });
//   part(d, "body", { pivot: [0, 0], shapes: [ellipse("fur", [0, 0], 6, 4)] });
//   part(d, "wing_l", { parent: "body", pivot: [-5, 0], shapes: [...] });
//   mirrorOf(d, "wing_l", "wing_r");
//   state(d, "fly", { wing_l: { rotate: -0.6 }, wing_r: { rotate: -0.6, mirror: true } });
//   clip(d, "flap", "0:idle 0.15:fly 0.3:idle", { loop: true });
//   write(d, "assets/bat.fart", import.meta.url);

import { bakePaths, bakeTris, bakeTris3, makeShape, morph as morphVerb, pose as poseVerb, setClip, stringifyDoc, validate, type Doc, type Doc3, type MorphSpec, type Part, type Part3, type PoseFields, type Recipe, type Shape, type Shape3, type Vec2, type Vec3 } from "@fastart/core";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type AnyDoc = Doc | Doc3;
export { makeShape };
export type { Recipe, PoseFields, MorphSpec };

/** A new document. `space: "3d"` makes a model. */
export function doc(name: string, opts: { space?: "3d"; palette?: { name: string; rgb: [number, number, number, number]; emissive?: number }[]; palette_refs?: string[]; meta?: Record<string, unknown> } = {}): AnyDoc {
	const d: Record<string, unknown> = { version: 1 };
	if (opts.space === "3d") d.space = "3d";
	d.name = name;
	if (opts.palette_refs) d.palette_refs = [...opts.palette_refs];
	if (opts.palette) d.palette = opts.palette.map((t) => ({ ...t }));
	d.parts = [];
	d.states = [];
	if (opts.meta) d.meta = { ...opts.meta };
	return d as AnyDoc;
}

/** A colour slot; returns its name so it can be used at once. */
export function token(d: AnyDoc, name: string, rgb: [number, number, number, number], emissive?: number): string {
	const pal = ((d as Doc).palette ??= []);
	const i = pal.findIndex((t) => t.name === name);
	const t = { name, rgb, ...(emissive ? { emissive } : {}) };
	if (i >= 0) pal[i] = t;
	else pal.push(t);
	return name;
}

/** A part, appended (or replaced by name). */
export function part(d: AnyDoc, name: string, p: { pivot?: number[]; parent?: string; shapes?: (Shape | Shape3)[]; anchors?: { name: string; at: number[]; angle?: number; dir?: number[] }[]; like?: string; meta?: Record<string, unknown> } = {}): Part | Part3 {
	const parts = (d.parts ??= []) as (Part | Part3)[];
	const out: Record<string, unknown> = { name };
	if (p.parent) out.parent = p.parent;
	out.pivot = p.pivot ?? (d.space === "3d" ? [0, 0, 0] : [0, 0]);
	if (p.like) out.like = p.like;
	else out.shapes = p.shapes ?? [];
	if (p.anchors) out.anchors = p.anchors;
	if (p.meta) out.meta = p.meta;
	const i = parts.findIndex((q) => q.name === name);
	if (i >= 0) parts[i] = out as Part;
	else parts.push(out as Part);
	return out as Part;
}

/** A part drawn like another, with its pivot mirrored across x (and its anchors inherited); pose it with mirror: true. */
export function mirrorOf(d: AnyDoc, source: string, name: string, opts: { parent?: string; pivot?: number[] } = {}): Part | Part3 {
	const src = (d.parts as (Part | Part3)[]).find((q) => q.name === source);
	if (!src) throw new Error(`no part named "${source}" to mirror`);
	const pv = (src.pivot as number[] | undefined) ?? [0, 0];
	const pivot = opts.pivot ?? [-pv[0], ...pv.slice(1)];
	return part(d, name, { like: source, pivot, parent: opts.parent ?? src.parent });
}

/** A state: a map of part name to pose fields; parts named nowhere are drawn at rest; order is paint order. */
export function state(d: AnyDoc, name: string, poses: Record<string, PoseFields & { morph?: { shape: number; points: number[][] }[] }> = {}, opts: { only?: boolean } = {}): void {
	const states = (d.states ??= []) as { name: string; parts: unknown[] }[];
	const i = states.findIndex((s) => s.name === name);
	const st = { name, parts: [] as unknown[] };
	if (i >= 0) states[i] = st;
	else states.push(st);
	const names = (d.parts as Part[]).map((p) => p.name);
	const listed = opts.only ? Object.keys(poses) : names;
	for (const pn of listed) {
		const p = (d.parts as Part[]).find((q) => q.name === pn);
		if (!p) throw new Error(`state ${name} poses an unknown part "${pn}"`);
		const f = poses[pn] ?? {};
		if (f.remove) continue;
		const e: Record<string, unknown> = { part: pn, offset: f.offset ?? [...((p.pivot as number[]) ?? [])] };
		if (f.rotate !== undefined) e.rotate = f.rotate;
		if (f.scale !== undefined && f.scale !== 1) e.scale = f.scale;
		if (f.mirror) e.mirror = true;
		if (f.morph) e.morph = f.morph;
		st.parts.push(e);
	}
}

/** Pose one part in a state (the state is made if missing). */
export function pose(d: AnyDoc, stateName: string, partName: string, f: PoseFields): string {
	if (!(d.states ?? []).some((s) => s.name === stateName)) state(d, stateName);
	return poseVerb(d, stateName, partName, f);
}

/** Reshape a part's shape in a state. */
export function morph(d: AnyDoc, stateName: string, partName: string, m: MorphSpec): string {
	if (!(d.states ?? []).some((s) => s.name === stateName)) state(d, stateName);
	return morphVerb(d, stateName, partName, m);
}

/** A clip from "0:idle 0.3:squash 1:idle" (t:state, !event) or a key list. */
export function clip(d: AnyDoc, name: string, keys: string | { t: number; state: string; ease?: "linear" | "in" | "out" | "in-out" | "step"; events?: string[] }[], opts: { loop?: boolean } = {}): string {
	return setClip(d, name, { keys, loop: opts.loop });
}

// recipes as plain calls
export const ellipse = (color: string, at: Vec2, rx: number, ry: number) => makeShape({ kind: "ellipse", color, at, rx, ry }) as Shape;
export const roundedRect = (color: string, at: Vec2, w: number, h: number, r: number) => makeShape({ kind: "roundedRect", color, at, w, h, r }) as Shape;
export const star = (color: string, at: Vec2, points: number, r1: number, r2: number) => makeShape({ kind: "star", color, at, points, r1, r2 }) as Shape;
export const ngon = (color: string, at: Vec2, sides: number, r: number, turn = 0) => makeShape({ kind: "ngon", color, at, sides, r, turn }) as Shape;
export const circle = (color: string, at: Vec2, r: number): Shape => ({ kind: "circle", color, at, r });
export const line = (color: string, a: Vec2, b: Vec2, w: number): Shape => ({ kind: "line", color, a, b, w });
export const poly = (color: string, points: Vec2[]): Shape => ({ kind: "poly", color, points });
export const path = (color: string, points: Vec2[], opts: { in?: Vec2[]; out?: Vec2[]; closed?: boolean; w?: number } = {}): Shape => ({ kind: "path", color, points, ...(opts.in ? { in: opts.in } : {}), ...(opts.out ? { out: opts.out } : {}), ...(opts.closed ? { closed: true } : { w: opts.w ?? 1 }) }) as Shape;
export const box = (color: string, at: Vec3, size: Vec3) => makeShape({ kind: "box", color, at, size }) as Shape3;
export const ball = (color: string, at: Vec3, r: number) => makeShape({ kind: "ball", color, at, r }) as Shape3;
export const rod = (color: string, a: Vec3, b: Vec3, w: number) => makeShape({ kind: "rod", color, a, b, w }) as Shape3;
export const lathe = (color: string, profile: Vec2[], opts: { axis?: "x" | "y" | "z"; segments?: number; smooth?: number } = {}) => makeShape({ kind: "lathe", color, profile, ...opts }) as Shape3;
export const extrude = (color: string, profile: Vec2[], from: number, to: number, axis: "x" | "y" | "z" = "z") => makeShape({ kind: "extrude", color, profile, axis, from, to }) as Shape3;

/** Mirror a list of 2D points across x (and reverse the winding so faces stay consistent). */
export const mirrorX = (pts: Vec2[]): Vec2[] => pts.map(([x, y]) => [-x, y] as Vec2).reverse();

export interface WriteOptions {
	/** the generator's own URL (import.meta.url): recorded in meta.gen as a path relative to the file, so Uranus can rerun it */
	from?: string;
	/** validate before writing (the default); false writes regardless */
	validate?: boolean;
	/** bake tris and path polygons (the default) */
	bake?: boolean;
}

/** Validate, bake and write a document in the canonical layout. Throws with the errors when invalid. */
export function write(d: AnyDoc, file: string, fromOrOpts: string | WriteOptions = {}): string {
	const opts: WriteOptions = typeof fromOrOpts === "string" ? { from: fromOrOpts } : fromOrOpts;
	const target = resolve(file);
	if (opts.from) {
		const gen = opts.from.startsWith("file:") ? fileURLToPath(opts.from) : resolve(opts.from);
		const meta = ((d as Doc).meta ??= {});
		meta.gen = relative(dirname(target), gen).split("\\").join("/");
	}
	if (opts.bake !== false) {
		if (d.space === "3d") bakeTris3(d as Doc3);
		else {
			bakeTris(d as Doc);
			bakePaths(d as Doc);
		}
	}
	if (opts.validate !== false) {
		const r = validate(d);
		if (r.errors.length) throw new Error(`${file}: ${r.errors.map((e) => `${e.code} ${e.path}: ${e.message}`).join("; ")}`);
	}
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, stringifyDoc(d));
	return target;
}
