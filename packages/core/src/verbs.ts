// Verbs (see spec/TOOLING.md): the few edits an agent makes most, as
// one call each, so a pose is "pose(open, lid, {rotate: 2.6})" and not a
// patch into a key list it has to find. Each works on a document in
// place and returns a line for the record. Recipes make whole shapes
// from a word and a few numbers.

import type { Doc, Doc3, Shape, Shape3, StatePart, StatePart3, Vec2, Vec3, ClipKey, ClipKey3, Ease } from "./types.ts";
import { box, extrude, lathe } from "./solids.ts";
import { pathPoints } from "./curves.ts";

type AnyDoc = Doc | Doc3;
const r3 = (x: number) => Math.round(x * 1000) / 1000 + 0;

function partOf(doc: AnyDoc, name: string) {
	const p = (doc.parts as { name: string }[] | undefined)?.find((x) => x.name === name);
	if (!p) throw new Error(`no part named "${name}"`);
	return p as Record<string, unknown> & { name: string; pivot?: number[]; shapes?: unknown[]; like?: string };
}
function stateOf(doc: AnyDoc, name: string) {
	const s = (doc.states as { name: string; parts: (StatePart | StatePart3)[] }[] | undefined)?.find((x) => x.name === name);
	if (!s) throw new Error(`no state named "${name}"`);
	return s;
}

/** The entry a part has in a state, made (at rest) when it has none. */
function entryOf(doc: AnyDoc, state: string, part: string): StatePart & StatePart3 {
	const st = stateOf(doc, state);
	const p = partOf(doc, part);
	let e = st.parts.find((x) => x.part === part) as (StatePart & StatePart3) | undefined;
	if (!e) {
		e = { part, offset: [...(p.pivot ?? (doc.space === "3d" ? [0, 0, 0] : [0, 0]))] as never };
		st.parts.push(e as never);
	}
	return e;
}

export interface PoseFields {
	offset?: number[];
	/** radians; a number in 2D, [x, y, z] in 3D */
	rotate?: number | number[];
	scale?: number;
	mirror?: boolean;
	/** drop the part from the state */
	remove?: boolean;
}

/** Pose a part in a state: the fields given change, the rest stay. */
export function pose(doc: AnyDoc, state: string, part: string, f: PoseFields): string {
	const st = stateOf(doc, state);
	if (f.remove) {
		const n = st.parts.length;
		st.parts = st.parts.filter((x) => x.part !== part) as never;
		return n === st.parts.length ? `${part} was not in ${state}` : `removed ${part} from ${state}`;
	}
	const e = entryOf(doc, state, part) as Record<string, unknown>;
	const changed: string[] = [];
	if (f.offset) {
		e.offset = f.offset.map(r3);
		changed.push(`offset ${e.offset as number[]}`);
	}
	if (f.rotate !== undefined) {
		e.rotate = Array.isArray(f.rotate) ? f.rotate.map(r3) : r3(f.rotate);
		changed.push(`rotate ${JSON.stringify(e.rotate)}`);
	}
	if (f.scale !== undefined) {
		if (f.scale === 1) delete e.scale;
		else e.scale = r3(f.scale);
		changed.push(`scale ${f.scale}`);
	}
	if (f.mirror !== undefined) {
		if (f.mirror) e.mirror = true;
		else delete e.mirror;
		changed.push(`mirror ${f.mirror}`);
	}
	return `${part} in ${state}: ${changed.join(", ") || "nothing"}`;
}

export interface MorphSpec {
	/** the shape's index in the part */
	shape: number;
	/** every point, replacing the base */
	points?: number[][];
	/** or deltas for some points, by index: {"3": [0, -1], "4": [0.5, -1]} */
	moves?: Record<string, number[]>;
	/** or a uniform scale of the shape's points about its centre (1.1 is ten percent bigger), with an optional [sx, sy(, sz)] */
	scale?: number | number[];
	/** forget the morph */
	reset?: boolean;
}

/** Reshape a part's poly, path or mesh in a state: the morph the clips lerp. */
export function morph(doc: AnyDoc, state: string, part: string, m: MorphSpec): string {
	const p = partOf(doc, part);
	if (p.like) throw new Error(`${part} is drawn like ${p.like}: it has no points of its own to morph`);
	const sh = (p.shapes ?? [])[m.shape] as { kind: string; points?: number[][] } | undefined;
	if (!sh) throw new Error(`${part} has no shape ${m.shape}`);
	if (!Array.isArray(sh.points)) throw new Error(`shape ${m.shape} of ${part} is a ${sh.kind}: only a poly, path or mesh morphs`);
	const e = entryOf(doc, state, part) as { morph?: { shape: number; points: number[][] }[] };
	if (m.reset) {
		e.morph = (e.morph ?? []).filter((x) => x.shape !== m.shape);
		if (!e.morph.length) delete e.morph;
		return `${part} shape ${m.shape} in ${state}: morph reset`;
	}
	const base = sh.points;
	let have = e.morph?.find((x) => x.shape === m.shape)?.points;
	let pts: number[][] = have && have.length === base.length ? have.map((q) => [...q]) : base.map((q) => [...q]);
	if (m.points) {
		if (m.points.length !== base.length) throw new Error(`${m.points.length} points for a shape with ${base.length}: a morph moves every corner`);
		pts = m.points.map((q) => q.map(r3));
	}
	if (m.moves) {
		for (const [k, d] of Object.entries(m.moves)) {
			const i = Number(k);
			if (!pts[i]) throw new Error(`no point ${k} in shape ${m.shape}`);
			pts[i] = pts[i].map((x, ax) => r3(x + (d[ax] ?? 0)));
		}
	}
	if (m.scale !== undefined) {
		const dims = base[0].length;
		const c = base[0].map((_, ax) => pts.reduce((a, q) => a + q[ax], 0) / pts.length);
		const s = Array.isArray(m.scale) ? m.scale : base[0].map(() => m.scale as number);
		pts = pts.map((q) => q.map((x, ax) => r3(c[ax] + (x - c[ax]) * (s[ax] ?? 1))));
		void dims;
	}
	e.morph ??= [];
	e.morph = [...e.morph.filter((x) => x.shape !== m.shape), { shape: m.shape, points: pts }];
	return `${part} shape ${m.shape} in ${state}: ${pts.length} points morphed`;
}

export interface ClipSpec {
	loop?: boolean;
	/** "0:idle 0.3:squash 0.6:stretch 1:idle" or a list */
	keys: string | { t: number; state: string; ease?: Ease; events?: string[] }[];
}

/** Make or replace a clip from a list of times and state names. */
export function setClip(doc: AnyDoc, name: string, spec: ClipSpec): string {
	const keys = (typeof spec.keys === "string" ? spec.keys.trim().split(/\s+/).map((w) => {
		const m = /^([\d.]+):([^!]+)(?:!(.+))?$/.exec(w);
		if (!m) throw new Error(`a key reads t:state (optionally !event): "${w}"`);
		return { t: Number(m[1]), state: m[2], ...(m[3] ? { events: m[3].split("!") } : {}) };
	}) : spec.keys) as (ClipKey & ClipKey3)[];
	const states = new Set(((doc.states ?? []) as { name: string }[]).map((s) => s.name));
	for (const k of keys) if (k.state !== undefined && !states.has(k.state)) throw new Error(`no state named "${k.state}"`);
	keys.sort((a, b) => a.t - b.t);
	const clips = (doc.clips ??= []) as { name: string; loop?: boolean; keys: unknown[] }[];
	const i = clips.findIndex((c) => c.name === name);
	const clip = { name, ...(spec.loop ? { loop: true } : {}), keys };
	if (i >= 0) clips[i] = clip;
	else clips.push(clip);
	return `clip ${name}: ${keys.length} keys, ${keys[keys.length - 1]?.t ?? 0}s${spec.loop ? ", loop" : ""}`;
}

export type Recipe =
	| { kind: "ellipse"; color: string; at: Vec2; rx: number; ry: number }
	| { kind: "roundedRect"; color: string; at: Vec2; w: number; h: number; r: number }
	| { kind: "star"; color: string; at: Vec2; points: number; r1: number; r2: number }
	| { kind: "ngon"; color: string; at: Vec2; sides: number; r: number; turn?: number }
	| { kind: "box"; color: string; at: Vec3; size: Vec3 }
	| { kind: "lathe"; color: string; profile: Vec2[]; axis?: "x" | "y" | "z"; segments?: number; smooth?: number }
	| { kind: "extrude"; color: string; profile: Vec2[]; axis?: "x" | "y" | "z"; from: number; to: number }
	| { kind: "ball"; color: string; at: Vec3; r: number }
	| { kind: "rod"; color: string; a: Vec3; b: Vec3; w: number };

const K = 0.5523;

/** A shape from a recipe: the curved ones as paths (2D) or sweeps (3D) so they stay editable. */
export function makeShape(r: Recipe): Shape | Shape3 {
	switch (r.kind) {
		case "ellipse": {
			const [cx, cy] = r.at;
			return { kind: "path", color: r.color, closed: true, points: [[cx, cy - r.ry], [cx + r.rx, cy], [cx, cy + r.ry], [cx - r.rx, cy]].map((p) => p.map(r3) as Vec2), out: [[r.rx * K, 0], [0, r.ry * K], [-r.rx * K, 0], [0, -r.ry * K]].map((p) => p.map(r3) as Vec2), in: [[-r.rx * K, 0], [0, -r.ry * K], [r.rx * K, 0], [0, r.ry * K]].map((p) => p.map(r3) as Vec2) };
		}
		case "roundedRect": {
			const [cx, cy] = r.at;
			const hw = r.w / 2;
			const hh = r.h / 2;
			const rr = Math.min(r.r, hw, hh);
			if (rr <= 0) return { kind: "poly", color: r.color, points: [[cx - hw, cy - hh], [cx + hw, cy - hh], [cx + hw, cy + hh], [cx - hw, cy + hh]].map((p) => p.map(r3) as Vec2) };
			// eight vertices, a quarter circle at each corner
			const pts: Vec2[] = [[cx - hw + rr, cy - hh], [cx + hw - rr, cy - hh], [cx + hw, cy - hh + rr], [cx + hw, cy + hh - rr], [cx + hw - rr, cy + hh], [cx - hw + rr, cy + hh], [cx - hw, cy + hh - rr], [cx - hw, cy - hh + rr]];
			const k = rr * K;
			const out: Vec2[] = [[0, 0], [k, 0], [0, 0], [0, k], [0, 0], [-k, 0], [0, 0], [0, -k]];
			const inn: Vec2[] = [[0, -k], [0, 0], [k, 0], [0, 0], [0, k], [0, 0], [-k, 0], [0, 0]];
			return { kind: "path", color: r.color, closed: true, points: pts.map((p) => p.map(r3) as Vec2), out, in: inn };
		}
		case "star":
		case "ngon": {
			const n = r.kind === "star" ? r.points * 2 : r.sides;
			const pts: Vec2[] = [];
			for (let i = 0; i < n; i++) {
				const rad = r.kind === "star" ? (i % 2 ? r.r2 : r.r1) : r.r;
				const a = (i / n) * Math.PI * 2 - Math.PI / 2 + (r.kind === "ngon" ? (r.turn ?? 0) : 0);
				pts.push([r3(r.at[0] + Math.cos(a) * rad), r3(r.at[1] + Math.sin(a) * rad)]);
			}
			return { kind: "poly", color: r.color, points: pts };
		}
		case "box":
			return box(r.color, r.at, r.size);
		case "lathe": {
			const sh: Shape3 = { kind: "sweep", color: r.color, op: "lathe", axis: r.axis ?? "y", profile: { points: r.profile }, ...(r.segments ? { segments: r.segments } : {}) };
			if (r.smooth) (sh as { smooth?: number }).smooth = r.smooth;
			return sh;
		}
		case "extrude":
			return { kind: "sweep", color: r.color, op: "extrude", axis: r.axis ?? "z", from: r.from, to: r.to, profile: { points: r.profile, closed: true } };
		case "ball":
			return { kind: "ball", color: r.color, at: r.at, r: r.r };
		case "rod":
			return { kind: "rod", color: r.color, a: r.a, b: r.b, w: r.w };
	}
}

/** Make a shape from a recipe into a part (appended), returning its index. */
export function make(doc: AnyDoc, part: string, r: Recipe): { index: number; note: string } {
	const p = partOf(doc, part);
	if (p.like) throw new Error(`${part} is drawn like ${p.like}: give the shape to ${p.like}`);
	const sh = makeShape(r);
	const is3 = doc.space === "3d";
	const kind3 = ["mesh", "ball", "rod", "sweep"].includes(sh.kind);
	if (is3 !== kind3) throw new Error(`a ${r.kind} is a ${is3 ? "2D" : "3D"} shape; this document is ${is3 ? "3D" : "2D"}`);
	p.shapes ??= [];
	p.shapes.push(sh);
	return { index: p.shapes.length - 1, note: `${r.kind} into ${part} as shape ${p.shapes.length - 1}` };
}
void extrude;
void lathe;
void pathPoints;
