// Sculpt mode in the model screen: the brush's settings, the mask, and
// laying what a stroke, a filter or a subdivision does into the document.
// The geometry is state/sculpt.ts; the pointer is canvas/sculpt3.ts.
//
// A stroke is one undo step. The points it moves land in the file at
// once (the base mesh, or this state's morph under Deform); the stroke
// keeps its own unrounded copy, so a light brush adds up instead of
// rounding away. The settings are this device's, like the shading; the
// mask is the studio's, per mesh, for the session, and never the file's.

import { signal, batch } from "@preact/signals";
import { subdivideOnce, type Doc3, type Vec3 } from "@fastart/core";
import { md, parts, selShape, selShapePosed, deforming, morphEntry, morphsOf, mutate, endGesture, validNow, meshRefusal, setPick, chooseFaces, chooseVerts, chooseEdges, type Sel3 } from "./model.ts";
import { project } from "./project.ts";
import { MeshError } from "./meshops.ts";
import { BRUSHES, FILTERS, beginStroke, brushInfo, dab, filterMesh, reshapeMask, symmetries, vertexNormals, type Brush, type Falloff, type Filter, type M3, type V3 } from "./sculpt.ts";

export type StrokeMethod = "space" | "dots";

export interface SculptSettings {
	brush: Brush;
	/** the brush's radius on the screen, in pixels: the same whatever the zoom, the way Blender's "view" radius is */
	radius: number;
	/** per brush: how hard, the falloff, the auto-smooth */
	strength: Partial<Record<Brush, number>>;
	falloff: Partial<Record<Brush, Falloff>>;
	autoSmooth: Partial<Record<Brush, number>>;
	/** a dab every `spacing` of the radius along the stroke (space), or one per pointer move (dots) */
	method: StrokeMethod;
	spacing: number;
	/** lazy mouse: the brush trails the pointer by this many pixels, steadying the line */
	stabilize: number;
	frontOnly: boolean;
	/** auto-masking: only the geometry joined to what is under the brush */
	topology: boolean;
	mirror: [boolean, boolean, boolean];
	radialAxis: 0 | 1 | 2;
	radial: number;
	filter: Filter;
	filterAmount: number;
}

const KEY = "fastart.sculpt";
const DEFAULTS: SculptSettings = {
	brush: "draw",
	radius: 50,
	strength: {},
	falloff: {},
	autoSmooth: {},
	method: "space",
	spacing: 0.1,
	stabilize: 0,
	frontOnly: true,
	topology: false,
	mirror: [true, false, false],
	radialAxis: 1,
	radial: 1,
	filter: "smooth",
	filterAmount: 0.5,
};
function saved(): SculptSettings {
	try {
		const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<SculptSettings>;
		const s = { ...DEFAULTS, ...(raw && typeof raw === "object" ? raw : {}) };
		if (!BRUSHES.some((b) => b.kind === s.brush)) s.brush = "draw";
		return s;
	} catch {
		return { ...DEFAULTS };
	}
}

/** The brush and its settings: a preference of this device. */
export const sculpt = signal<SculptSettings>(saved());

export function setSculpt(patch: Partial<SculptSettings>) {
	sculpt.value = { ...sculpt.value, ...patch };
	try {
		localStorage.setItem(KEY, JSON.stringify(sculpt.value));
	} catch {
		// the settings last the session
	}
}
export const strengthOf = (b: Brush = sculpt.value.brush) => sculpt.value.strength[b] ?? brushInfo(b).strength;
export const falloffOf = (b: Brush = sculpt.value.brush) => sculpt.value.falloff[b] ?? brushInfo(b).falloff;
export const autoSmoothOf = (b: Brush = sculpt.value.brush) => sculpt.value.autoSmooth[b] ?? brushInfo(b).smooth ?? 0;
export function setBrushField(key: "strength" | "falloff" | "autoSmooth", v: number | Falloff, b: Brush = sculpt.value.brush) {
	setSculpt({ [key]: { ...sculpt.value[key], [b]: v } } as Partial<SculptSettings>);
}
export function setBrush(b: Brush) {
	setSculpt({ brush: b });
}
export function symOf(): M3[] {
	const s = sculpt.value;
	return symmetries(s.mirror, { axis: s.radialAxis, count: s.radial });
}

// ------------------------------------------------------------- the mode

/** Why the selected shape cannot be sculpted just now, null when it can. */
export function sculptRefusal(): string | null {
	const why = meshRefusal();
	if (why) return why;
	const s = md.sel.value!;
	if (parts()[s.part]?.like) return `This part is drawn like ${parts()[s.part]?.like}: sculpt that one.`;
	return null;
}

/** Sculpt mode on and off: while on, a drag over the selected mesh sculpts it with the brush. */
export function setSculpting(on: boolean): boolean {
	if (on) {
		const why = sculptRefusal();
		if (why) {
			project.error.value = why;
			return false;
		}
	}
	batch(() => {
		md.sculpting.value = on;
		if (on) {
			md.painting.value = false;
			md.tool.value = "select";
			// nothing chosen: the brush is the whole of the hand's work
			chooseVerts([]);
			chooseEdges([]);
			chooseFaces([]);
			setPick("corner");
		}
	});
	return true;
}

// ------------------------------------------------------------- the mask

/** Bumped when a mask changes: the canvas draws it again. */
export const maskRev = signal(0);
const masks = new Map<string, Float32Array>();
const maskKey = (s: Sel3) => `${md.path.value ?? ""}:${parts()[s.part]?.name ?? s.part}/${s.shape}`;

/** The mask of a mesh, when it has one that still fits its points. */
export function maskOf(s: Sel3): Float32Array | null {
	const m = masks.get(maskKey(s));
	const sh = parts()[s.part]?.shapes?.[s.shape];
	if (!m || !sh || sh.kind !== "mesh" || m.length !== sh.points.length) return null;
	return m;
}
export function setMask(s: Sel3, m: Float32Array | null) {
	if (m && m.some((v) => v > 0)) masks.set(maskKey(s), m);
	else masks.delete(maskKey(s));
	maskRev.value++;
}
export type MaskAct = "invert" | "clear" | "fill" | "grow" | "shrink" | "smooth" | "sharpen";
export function maskAct(how: MaskAct) {
	const s = md.sel.value;
	const sh = selShape();
	if (!s || !sh || sh.kind !== "mesh") return;
	const m = maskOf(s) ?? new Float32Array(sh.points.length);
	setMask(s, reshapeMask(m, sh.faces, how));
}

// ------------------------------------------------------------- writing

const r4 = (x: number) => Math.round(x * 1e4) / 1e4 + 0;

/** The points the brush works on: the mesh as this state shows it (its morph under Deform), in the part's rest space. */
export function sculptPoints(): { points: V3[]; faces: number[][] } | null {
	const sh = deforming() ? selShapePosed() : selShape();
	if (!sh || sh.kind !== "mesh") return null;
	return { points: sh.points as V3[], faces: sh.faces };
}

/** Write some points of a stroke into the document: one undo step for the whole stroke. */
export function writePoints(s: Sel3, pts: readonly V3[], idx: Iterable<number>) {
	const morph = deforming();
	mutate((d) => {
		const sh = d.parts![s.part].shapes![s.shape];
		if (sh.kind !== "mesh") return;
		const into = morph ? morphEntry(d, s.part, s.shape) : sh.points;
		if (!into) return;
		for (const i of idx) {
			const p = pts[i];
			if (p && into[i]) into[i] = [r4(p[0]), r4(p[1]), r4(p[2])];
		}
		if (!morph) {
			delete sh.tris;
			delete (sh as { bake?: unknown }).bake;
		}
	}, morph ? "sculpt-morph" : "sculpt");
}

function targetRefusal(s: Sel3): string | null {
	const part = parts()[s.part];
	const sh = part?.shapes?.[s.shape];
	if (!part || !sh) return "There is no such shape.";
	if (sh.kind !== "mesh") return `Sculpting works on a mesh, and this is a ${sh.kind}.`;
	if (part.like) return `This part is drawn like ${part.like}: sculpt that one.`;
	if (md.curClip.value >= 0) return "A clip poses parts, not meshes; pick a state to sculpt.";
	return null;
}
/** A mesh's points as this state shows it (its morph under Deform), and its faces. */
function pointsOf(s: Sel3): { points: V3[]; faces: number[][] } {
	const why = targetRefusal(s);
	if (why) throw new MeshError(why);
	const sel = md.sel.value;
	if (sel && sel.part === s.part && sel.shape === s.shape) return sculptPoints()!;
	const sh = parts()[s.part].shapes![s.shape] as { points: V3[]; faces: number[][] };
	return { points: sh.points, faces: sh.faces };
}
const say = (e: unknown) => {
	project.error.value = e instanceof MeshError ? e.message : String(e);
	return null;
};

/** Run a filter over a mesh, or what its mask leaves free: one undo step. Throws a MeshError when it cannot. */
export function filterShape(s: Sel3, kind: Filter, amount: number): string {
	const m = pointsOf(s);
	const out = filterMesh(m.points, m.faces, kind, amount, maskOf(s), Math.floor(Math.random() * 1e9) + 1);
	endGesture();
	writePoints(s, out, out.keys());
	endGesture();
	return `${FILTERS.find((f) => f.kind === kind)?.label ?? kind} by ${amount}: ${m.points.length} points`;
}
/** The filter of the Sculpt section, on the selected mesh. */
export function runFilter(): string | null {
	try {
		if (!md.sel.value) throw new MeshError("Select a mesh first.");
		return filterShape(md.sel.value, sculpt.value.filter, sculpt.value.filterAmount);
	} catch (e) {
		return say(e);
	}
}

export interface StrokeAlong {
	brush: Brush;
	/** the stroke's path, in the part's rest space: each point is brought onto the surface */
	points: V3[];
	/** in the part's units */
	radius: number;
	strength?: number;
	invert?: boolean;
	falloff?: Falloff;
	autoSmooth?: number;
	mirror?: [boolean, boolean, boolean];
}

/**
 * A stroke laid along a path, in the part's own space, as the hand lays
 * one on the canvas: dabs a tenth of the radius apart, each on the
 * surface nearest the path, the symmetry asked for, the mask kept. For
 * Claude, and for a stroke that must be exact. One undo step.
 */
export function strokeShape(s: Sel3, o: StrokeAlong): string {
	const m = pointsOf(s);
	if (!(o.radius > 0)) throw new MeshError("radius must be more than 0, in the part's units");
	if (o.points.length < 1) throw new MeshError("points must be one or more [x, y, z] along the stroke");
	const info = brushInfo(o.brush);
	const st = beginStroke(m.points, m.faces, {
		brush: o.brush,
		radius: o.radius,
		strength: o.strength ?? info.strength,
		falloff: o.falloff ?? info.falloff,
		invert: !!o.invert,
		autoSmooth: o.autoSmooth ?? info.smooth ?? 0,
		frontOnly: false,
		toViewer: [0, 0, -1],
		topology: false,
		mask: maskOf(s),
		sym: symmetries(o.mirror ?? [false, false, false]),
	});
	// where the path meets the surface: its nearest point, and that point's normal
	const onSurface = (p: V3): { at: V3; n: V3 } => {
		const normals = vertexNormals(st.points, m.faces);
		let best = 0;
		let bd = Infinity;
		st.points.forEach((q, i) => {
			const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2;
			if (d < bd) {
				bd = d;
				best = i;
			}
		});
		return { at: info.drag ? p : st.points[best], n: normals[best] };
	};
	const first = o.points[0];
	const start = onSurface(first);
	dab(st, { at: start.at, n: start.n, motion: [0, 0, 0], total: [0, 0, 0] });
	let prev = first;
	let dabs = 1;
	const step = o.radius * 0.1;
	for (let k = 1; k < o.points.length; k++) {
		const a = o.points[k - 1];
		const b = o.points[k];
		const l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
		const n = info.drag ? 1 : Math.max(1, Math.ceil(l / step));
		for (let j = 1; j <= n; j++) {
			const t = j / n;
			const p: V3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
			const h = onSurface(p);
			dab(st, { at: h.at, n: h.n, motion: [p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]], total: [p[0] - first[0], p[1] - first[1], p[2] - first[2]] });
			prev = p;
			dabs++;
		}
	}
	if (o.brush === "mask") {
		setMask(s, new Float32Array(st.mask));
		return `Masked ${[...st.mask].filter((v) => v > 0.5).length} points`;
	}
	endGesture();
	writePoints(s, st.points, st.touched);
	endGesture();
	return `${info.label}${o.invert ? " (inverted)" : ""}: ${dabs} dabs moved ${st.touched.size} points`;
}

/**
 * Subdivide a mesh once, into the file: one level of Catmull-Clark, the
 * way a Multires level adds detail to sculpt. Every face becomes as many
 * quads as it has corners; creases soften a step, pattern coordinates,
 * painted faces and corner shades follow, and every morph is subdivided
 * alike. A smoothing level the mesh had is one fewer, so it looks the
 * same. One undo step; throws a MeshError when it cannot.
 */
export function subdivideShape(s: Sel3): string {
	const why = targetRefusal(s);
	if (why) throw new MeshError(why);
	const sh = parts()[s.part].shapes![s.shape];
	if (sh.kind !== "mesh") throw new MeshError("not a mesh");
	const after = sh.faces.reduce((n, f) => n + f.length, 0);
	if (after > 100000) throw new MeshError(`That would be ${after} faces: too many to sculpt smoothly here.`);
	const lay = (d: Doc3) => {
		const m = d.parts![s.part].shapes![s.shape];
		if (m.kind !== "mesh") return;
		const ex = m as typeof m & { paint?: number[]; shades?: number[]; bake?: unknown };
		const out = subdivideOnce({ points: m.points, faces: m.faces, creases: m.creases, uvs: m.mapping?.uvs, paint: ex.paint, shades: ex.shades });
		for (const l of morphsOf(d, s)) if (l.points.length === m.points.length) l.points = subdivideOnce({ points: l.points as Vec3[], faces: m.faces, creases: m.creases }).points;
		m.points = out.points;
		m.faces = out.faces;
		if (out.creases?.length) m.creases = out.creases;
		else delete m.creases;
		if (m.mapping?.uvs && out.uvs) m.mapping = { ...m.mapping, uvs: out.uvs };
		if (ex.paint && out.paint) ex.paint = out.paint;
		if (ex.shades && out.shades) ex.shades = out.shades.map(r4);
		if (typeof m.smooth === "number" && m.smooth > 0) {
			if (m.smooth > 1) m.smooth -= 1;
			else delete m.smooth;
		}
		delete m.tris;
		delete ex.bake;
	};
	const copy = JSON.parse(JSON.stringify(md.doc.value)) as Doc3;
	lay(copy);
	const bad = validNow(copy);
	if (bad) throw new MeshError("Refused, the mesh would not be valid:\n" + bad);
	endGesture();
	mutate(lay);
	endGesture();
	setMask(s, null);
	const now = parts()[s.part].shapes![s.shape];
	return `Subdivided: ${now.kind === "mesh" ? `${now.points.length} points, ${now.faces.length} faces` : ""}`;
}
/** Subdivide the selected mesh once. */
export function subdivideSel(): string | null {
	try {
		if (!md.sel.value) throw new MeshError("Select a mesh first.");
		return subdivideShape(md.sel.value);
	} catch (e) {
		return say(e);
	}
}
