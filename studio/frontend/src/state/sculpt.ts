// Sculpting, as pure geometry: brushes that push, pull, smooth and pinch
// the points of a mesh like clay, the way Blender's Sculpt Mode does. A
// stroke begins on a mesh (its points in the part's rest space, its
// faces), and each dab of the pointer moves the points under the brush;
// the store writes the stroke's points into the document as one undo
// step. The mask (what a brush may not move) is the studio's, never the
// file's: it rides here as a weight per point, 1 for wholly held.
//
// Everything is in rest space: the brush's middle and the surface's
// normal there, the pointer's movement, the radius. Symmetry is a list
// of orthogonal matrices about the rest origin (the identity first):
// each dab is done once per matrix, mirrored or turned.
//
// No imports: this file runs under node --test as it is.

export type V3 = [number, number, number];
/** A 3×3 matrix, row by row. */
export type M3 = [number, number, number, number, number, number, number, number, number];

export type Brush =
	| "draw"
	| "drawSharp"
	| "clay"
	| "clayStrips"
	| "layer"
	| "inflate"
	| "blob"
	| "crease"
	| "smooth"
	| "flatten"
	| "fill"
	| "scrape"
	| "pinch"
	| "grab"
	| "elastic"
	| "snakeHook"
	| "thumb"
	| "nudge"
	| "rotate"
	| "mask";

export type Falloff = "smooth" | "sphere" | "root" | "sharp" | "linear" | "constant";
export const FALLOFFS: Falloff[] = ["smooth", "sphere", "root", "sharp", "linear", "constant"];

export interface BrushInfo {
	kind: Brush;
	label: string;
	group: "Add / subtract" | "Smooth / flatten" | "Move" | "Mask";
	/** what it does, and what ⌘ (invert) makes it do */
	hint: string;
	falloff: Falloff;
	strength: number;
	/** auto-smooth it starts with */
	smooth?: number;
	/** the pointer's movement is the stroke (grab, snake hook): no dabs spaced along it, one per move */
	drag?: boolean;
}

export const BRUSHES: BrushInfo[] = [
	{ kind: "draw", label: "Draw", group: "Add / subtract", hint: "pushes the surface out along its normal; ⌘ pushes in", falloff: "smooth", strength: 0.5 },
	{ kind: "drawSharp", label: "Draw Sharp", group: "Add / subtract", hint: "cuts crisp lines and creases; ⌘ raises them", falloff: "sharp", strength: 0.5 },
	{ kind: "clay", label: "Clay", group: "Add / subtract", hint: "builds the form up in flattened layers; ⌘ takes them off", falloff: "smooth", strength: 0.5, smooth: 0.1 },
	{ kind: "clayStrips", label: "Clay Strips", group: "Add / subtract", hint: "square strips of clay along the stroke, for blocking out; ⌘ cuts them", falloff: "smooth", strength: 0.6, smooth: 0.1 },
	{ kind: "layer", label: "Layer", group: "Add / subtract", hint: "raises the surface to one height, however often a stroke passes; ⌘ lowers it", falloff: "smooth", strength: 0.5 },
	{ kind: "inflate", label: "Inflate", group: "Add / subtract", hint: "each point along its own normal: the surface puffs up; ⌘ deflates", falloff: "smooth", strength: 0.5 },
	{ kind: "blob", label: "Blob", group: "Add / subtract", hint: "rounded, bulbous volume; ⌘ a rounded dent", falloff: "smooth", strength: 0.5 },
	{ kind: "crease", label: "Crease", group: "Add / subtract", hint: "pinches while it indents: wrinkles, folds, seams; ⌘ a pinched ridge", falloff: "sharp", strength: 0.5 },
	{ kind: "smooth", label: "Smooth", group: "Smooth / flatten", hint: "averages bumps away (⇧ with any brush); ⌘ enhances detail", falloff: "smooth", strength: 0.5 },
	{ kind: "flatten", label: "Flatten", group: "Smooth / flatten", hint: "pulls the surface toward a plane; ⌘ contrast, away from it", falloff: "smooth", strength: 0.5 },
	{ kind: "fill", label: "Fill", group: "Smooth / flatten", hint: "raises what lies below the plane; ⌘ deepens it", falloff: "smooth", strength: 0.5 },
	{ kind: "scrape", label: "Scrape", group: "Smooth / flatten", hint: "shaves down what stands above the plane; ⌘ fills", falloff: "smooth", strength: 0.5 },
	{ kind: "pinch", label: "Pinch", group: "Smooth / flatten", hint: "pulls points toward the middle of the brush; ⌘ magnifies", falloff: "smooth", strength: 0.5 },
	{ kind: "grab", label: "Grab", group: "Move", hint: "drags what was under the brush where the pointer goes", falloff: "smooth", strength: 1, drag: true },
	{ kind: "elastic", label: "Elastic Deform", group: "Move", hint: "grabs with a soft reach past the brush, keeping the volume", falloff: "smooth", strength: 1, drag: true },
	{ kind: "snakeHook", label: "Snake Hook", group: "Move", hint: "pulls the surface out into long tendrils", falloff: "smooth", strength: 1, drag: true },
	{ kind: "thumb", label: "Thumb", group: "Move", hint: "smears the surface along itself", falloff: "smooth", strength: 0.5, drag: true },
	{ kind: "nudge", label: "Nudge", group: "Move", hint: "pushes the surface the way the stroke goes", falloff: "smooth", strength: 0.5, drag: true },
	{ kind: "rotate", label: "Rotate", group: "Move", hint: "twists what was under the brush about its middle as the pointer goes round", falloff: "smooth", strength: 1, drag: true },
	{ kind: "mask", label: "Mask", group: "Mask", hint: "paints a mask that holds the surface still; ⌘ takes it away", falloff: "smooth", strength: 1 },
];
export const brushInfo = (k: Brush): BrushInfo => BRUSHES.find((b) => b.kind === k) ?? BRUSHES[0];

// ------------------------------------------------------------- vectors

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => {
	const l = len(a);
	return l < 1e-12 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
};
/** The part of a vector that lies along a plane of normal n (unit). */
const along = (v: V3, n: V3): V3 => sub(v, mul(n, dot(v, n)));
export const apply = (m: M3, v: V3): V3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const mmul = (a: M3, b: M3): M3 => {
	const o = new Array(9).fill(0) as M3;
	for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
	return o;
};
export const IDENTITY: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
/** A turn of `angle` radians about a unit axis through the origin. */
function turn(axis: V3, angle: number): M3 {
	const [x, y, z] = axis;
	const c = Math.cos(angle);
	const s = Math.sin(angle);
	const t = 1 - c;
	return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
}

// ------------------------------------------------------------- the mesh

/** How much of a brush's force reaches a point `t` of the radius out from its middle (0 to 1). */
export function falloff(kind: Falloff, t: number): number {
	if (t >= 1) return 0;
	const x = Math.max(0, t);
	switch (kind) {
		case "smooth":
			return 1 - x * x * (3 - 2 * x);
		case "sphere":
			return Math.sqrt(1 - x * x);
		case "root":
			return 1 - Math.sqrt(x);
		case "sharp":
			return (1 - x) * (1 - x);
		case "linear":
			return 1 - x;
		case "constant":
			return 1;
	}
}

/** Each point's neighbours along the edges of the faces. */
export function neighbours(count: number, faces: readonly (readonly number[])[]): number[][] {
	const sets: Set<number>[] = Array.from({ length: count }, () => new Set());
	for (const f of faces)
		for (let i = 0; i < f.length; i++) {
			const a = f[i];
			const b = f[(i + 1) % f.length];
			if (a === b || a >= count || b >= count) continue;
			sets[a].add(b);
			sets[b].add(a);
		}
	return sets.map((s) => [...s]);
}

/** Each point's normal: its faces' normals (Newell, so weighted by area) summed, outward for faces wound the format's way. */
export function vertexNormals(points: readonly V3[], faces: readonly (readonly number[])[]): V3[] {
	const acc: V3[] = points.map(() => [0, 0, 0]);
	for (const f of faces) {
		const n: V3 = [0, 0, 0];
		for (let i = 0; i < f.length; i++) {
			const a = points[f[i]];
			const b = points[f[(i + 1) % f.length]];
			if (!a || !b) continue;
			n[0] += (a[1] - b[1]) * (a[2] + b[2]);
			n[1] += (a[2] - b[2]) * (a[0] + b[0]);
			n[2] += (a[0] - b[0]) * (a[1] + b[1]);
		}
		for (const v of f) if (acc[v]) acc[v] = add(acc[v], n);
	}
	return acc.map(unit);
}

/** The matrices a stroke is done under: mirrored across each axis that is on, and turned `radial` times about an axis. */
export function symmetries(mirror: readonly [boolean, boolean, boolean], radial: { axis: 0 | 1 | 2; count: number } = { axis: 1, count: 1 }): M3[] {
	let out: M3[] = [IDENTITY];
	for (let a = 0; a < 3; a++) {
		if (!mirror[a]) continue;
		const m = [...IDENTITY] as M3;
		m[a * 4] = -1;
		out = [...out, ...out.map((x) => mmul(m, x))];
	}
	const n = Math.max(1, Math.floor(radial.count));
	if (n > 1) {
		const ax: V3 = [0, 0, 0];
		ax[radial.axis] = 1;
		const turned: M3[] = [];
		for (let k = 0; k < n; k++) for (const x of out) turned.push(mmul(turn(ax, (2 * Math.PI * k) / n), x));
		out = turned;
	}
	// the same matrix twice would do a dab twice
	const seen = new Set<string>();
	return out.filter((m) => {
		const k = m.map((x) => Math.round(x * 1e6)).join(",");
		if (seen.has(k)) return false;
		seen.add(k);
		return true;
	});
}

// ------------------------------------------------------------- a stroke

export interface StrokeOpts {
	brush: Brush;
	/** in rest-space units */
	radius: number;
	/** 0 to 1 */
	strength: number;
	falloff: Falloff;
	/** ⌘: the brush's other way */
	invert: boolean;
	/** a smoothing pass after each dab, 0 to 1 */
	autoSmooth: number;
	/** only points whose normal looks toward `toViewer` */
	frontOnly: boolean;
	/** the direction to the viewer, unit, in rest space */
	toViewer: V3;
	/** auto-masking: only the geometry joined to the point under the brush */
	topology: boolean;
	/** what the brush may not move: a weight per point, 1 for wholly held */
	mask?: ArrayLike<number> | null;
	/** the symmetry: the identity first */
	sym: M3[];
}

export interface Stroke {
	opts: StrokeOpts;
	faces: readonly (readonly number[])[];
	/** the points as the stroke found them */
	orig: V3[];
	/** the points as the stroke has them now (unrounded) */
	points: V3[];
	nbrs: number[][];
	/** the mask as the stroke has it now */
	mask: Float32Array;
	/** where the stroke began, and the surface's normal there */
	start?: { at: V3; n: V3 };
	/** grab, elastic, rotate: each symmetric copy's points and how much each follows, found when the stroke began */
	held?: { m: M3; w: Map<number, number>; at: V3; n: V3 }[];
	/** snake hook: where the brush's middle is now, having moved with the pointer */
	head?: V3;
	/** layer: how high each point has been raised so far, as a fraction of the layer's height */
	raised?: Map<number, number>;
	origNormals?: V3[];
	/** what the stroke has moved or masked so far */
	touched: Set<number>;
}

export function beginStroke(points: readonly V3[], faces: readonly (readonly number[])[], opts: StrokeOpts): Stroke {
	const mask = new Float32Array(points.length);
	if (opts.mask) for (let i = 0; i < points.length && i < opts.mask.length; i++) mask[i] = Math.max(0, Math.min(1, opts.mask[i]));
	return {
		opts,
		faces,
		orig: points.map((p) => [p[0], p[1], p[2]] as V3),
		points: points.map((p) => [p[0], p[1], p[2]] as V3),
		nbrs: neighbours(points.length, faces),
		mask,
		touched: new Set(),
	};
}

/** The point nearest a place. */
function nearest(points: readonly V3[], at: V3): number {
	let best = -1;
	let bd = Infinity;
	points.forEach((p, i) => {
		const d = (p[0] - at[0]) ** 2 + (p[1] - at[1]) ** 2 + (p[2] - at[2]) ** 2;
		if (d < bd) {
			bd = d;
			best = i;
		}
	});
	return best;
}

/** The points joined to the one nearest `at` without leaving the reach. */
function joined(st: Stroke, pts: readonly V3[], at: V3, reach: number): Set<number> {
	const out = new Set<number>();
	const first = nearest(pts, at);
	if (first < 0) return out;
	const r2 = reach * reach;
	const stack = [first];
	out.add(first);
	while (stack.length) {
		const v = stack.pop()!;
		for (const o of st.nbrs[v]) {
			if (out.has(o)) continue;
			const p = pts[o];
			if ((p[0] - at[0]) ** 2 + (p[1] - at[1]) ** 2 + (p[2] - at[2]) ** 2 > r2) continue;
			out.add(o);
			stack.push(o);
		}
	}
	return out;
}

/**
 * The points under a brush at `at` and how much of its force each takes:
 * the falloff, less what the mask holds, nothing for a point that looks
 * away under Front Faces Only, nothing for one not joined to the middle
 * under Topology. `square` measures the reach as a square aligned with
 * `side` in the plane of `n` (Clay Strips).
 */
function weigh(st: Stroke, pts: readonly V3[], normals: readonly V3[], at: V3, toViewer: V3, opts: { reach?: number; square?: { n: V3; side: V3 }; elastic?: boolean } = {}): Map<number, number> {
	const o = st.opts;
	const r = opts.reach ?? o.radius;
	const out = new Map<number, number>();
	const near = o.topology && !opts.elastic ? joined(st, pts, at, r * (opts.square ? Math.SQRT2 : 1)) : null;
	const sq = opts.square;
	const up = sq ? unit(cross(sq.n, sq.side)) : null;
	for (let i = 0; i < pts.length; i++) {
		const p = pts[i];
		const d = sub(p, at);
		let t: number;
		if (opts.elastic) {
			// a Kelvinlet's reach: soft, and past the radius
			const q = len(d) / r;
			t = Math.pow(1 + q * q, -1.5);
			if (t < 0.01) continue;
		} else if (sq && up) {
			const u = Math.abs(dot(d, sq.side));
			const v = Math.abs(dot(d, up));
			const h = Math.abs(dot(d, sq.n));
			if (h > r) continue;
			t = Math.max(u, v) / r;
			if (t >= 1) continue;
			t = falloff(o.falloff, t);
		} else {
			const l2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
			if (l2 >= r * r) continue;
			t = falloff(o.falloff, Math.sqrt(l2) / r);
		}
		if (near && !near.has(i)) continue;
		if (o.frontOnly && dot(normals[i], toViewer) <= 0) continue;
		const w = t * (1 - st.mask[i]);
		if (w > 1e-6) out.set(i, w);
	}
	return out;
}

/** The plane under the brush: the weighted middle of its points, and their normals' average. */
function areaPlane(pts: readonly V3[], normals: readonly V3[], w: Map<number, number>, fallback: { at: V3; n: V3 }): { c: V3; n: V3 } {
	let c: V3 = [0, 0, 0];
	let n: V3 = [0, 0, 0];
	let sw = 0;
	for (const [i, k] of w) {
		c = add(c, mul(pts[i], k));
		n = add(n, mul(normals[i], k));
		sw += k;
	}
	if (sw < 1e-9 || len(n) < 1e-9) return { c: fallback.at, n: fallback.n };
	return { c: mul(c, 1 / sw), n: unit(n) };
}

function smoothPass(st: Stroke, pts: V3[], w: Map<number, number>, k: number) {
	const next = new Map<number, V3>();
	for (const [i, wi] of w) {
		const nb = st.nbrs[i];
		if (!nb.length) continue;
		let avg: V3 = [0, 0, 0];
		for (const o of nb) avg = add(avg, pts[o]);
		avg = mul(avg, 1 / nb.length);
		next.set(i, add(pts[i], mul(sub(avg, pts[i]), Math.max(-1, Math.min(1, wi * k)))));
	}
	for (const [i, p] of next) pts[i] = p;
}

export interface DabInput {
	/** the point of the surface under the pointer (where it is now), and its normal there */
	at: V3;
	n: V3;
	/** how far the pointer moved since the last dab, in rest space along the view plane */
	motion?: V3;
	/** since the stroke began (grab, elastic) */
	total?: V3;
	/** rotate: radians turned since the stroke began */
	angle?: number;
	/** ⇧: smooth, whatever the brush */
	smooth?: boolean;
}

/**
 * One dab of a stroke: the points under the brush move (or the mask
 * changes), once for each matrix of the symmetry. Returns the points it
 * changed; the stroke's `points` (and `mask`) hold the result.
 */
export function dab(st: Stroke, input: DabInput): number[] {
	const o = st.opts;
	const brush: Brush = input.smooth ? "smooth" : o.brush;
	const pts = st.points;
	const sign = o.invert && !input.smooth ? -1 : 1;
	const r = o.radius;
	const k = Math.max(0, Math.min(1, o.strength));
	const changed = new Set<number>();
	st.start ??= { at: input.at, n: unit(input.n) };

	// the brushes that hold what was under them when the stroke began
	if (brush === "grab" || brush === "elastic" || brush === "rotate") {
		if (!st.held) {
			const normals = vertexNormals(st.orig, st.faces);
			st.held = o.sym.map((m) => {
				const at = apply(m, st.start!.at);
				const n = apply(m, st.start!.n);
				return { m, at, n, w: weigh(st, st.orig, normals, at, apply(m, o.toViewer), { elastic: brush === "elastic" }) };
			});
		}
		// every copy's displacement summed onto where the points were
		const disp = new Map<number, V3>();
		for (const h of st.held) {
			for (const [i, w] of h.w) {
				let d: V3;
				if (brush === "rotate") {
					const R = turn(h.n, (input.angle ?? 0) * w * k * (det(h.m) < 0 ? -1 : 1));
					d = sub(add(h.at, apply(R, sub(st.orig[i], h.at))), st.orig[i]);
				} else d = mul(apply(h.m, input.total ?? [0, 0, 0]), w * k);
				disp.set(i, add(disp.get(i) ?? [0, 0, 0], d));
			}
		}
		for (const [i, d] of disp) {
			pts[i] = add(st.orig[i], d);
			changed.add(i);
		}
		for (const i of changed) st.touched.add(i);
		return [...changed];
	}

	const motion = input.motion ?? [0, 0, 0];
	if (brush === "snakeHook") st.head = add(st.head ?? input.at, motion);
	if (brush === "layer" && !st.raised) {
		st.raised = new Map();
		st.origNormals = vertexNormals(st.orig, st.faces);
	}

	for (const m of o.sym) {
		const normals = vertexNormals(pts, st.faces);
		const at = apply(m, brush === "snakeHook" ? st.head! : input.at);
		const hitN = unit(apply(m, input.n));
		const mv = apply(m, motion);
		const toViewer = apply(m, o.toViewer);
		const square = brush === "clayStrips" && len(along(mv, hitN)) > 1e-9 ? { n: hitN, side: unit(along(mv, hitN)) } : brush === "clayStrips" ? { n: hitN, side: unit(along(Math.abs(hitN[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], hitN)) } : undefined;
		const w = weigh(st, pts, normals, at, toViewer, { square });
		if (!w.size) continue;
		if (brush === "mask") {
			for (const [i, wi] of w) {
				// the mask itself is what changes: the weight is the falloff alone, not less the mask
				const f = wi / Math.max(1e-6, 1 - st.mask[i]);
				st.mask[i] = Math.max(0, Math.min(1, st.mask[i] + sign * f * k));
				changed.add(i);
			}
			continue;
		}
		const { c, n } = areaPlane(pts, normals, w, { at, n: hitN });
		const step = r * 0.1 * k;
		for (const [i, wi] of w) {
			const p = pts[i];
			let q: V3 = p;
			switch (brush) {
				case "draw":
				case "drawSharp":
					q = add(p, mul(n, step * wi * sign));
					break;
				case "inflate":
					q = add(p, mul(normals[i], step * wi * sign));
					break;
				case "blob": {
					// out from a ball sunk under the surface: the bulge comes up round
					const dir = unit(sub(p, sub(c, mul(n, r))));
					q = add(p, mul(dir, step * wi * sign));
					break;
				}
				case "crease": {
					const pinch = along(sub(c, p), n);
					q = add(add(p, mul(n, -step * wi * sign)), mul(pinch, wi * k * 0.25));
					break;
				}
				case "smooth": {
					const nb = st.nbrs[i];
					if (!nb.length) break;
					let avg: V3 = [0, 0, 0];
					for (const x of nb) avg = add(avg, pts[x]);
					avg = mul(avg, 1 / nb.length);
					q = add(p, mul(sub(avg, p), wi * k * (sign > 0 ? 1 : -0.5)));
					break;
				}
				case "flatten": {
					const h = dot(sub(p, c), n);
					q = sub(p, mul(n, h * wi * k * sign));
					break;
				}
				case "fill":
				case "scrape": {
					// fill lifts what is below the plane, scrape cuts what is above; inverted, each is the other's opposite
					const h = dot(sub(p, c), n);
					if (brush === "fill" && h < 0) q = sub(p, mul(n, h * wi * k * sign));
					else if (brush === "scrape" && (sign > 0 ? h > 0 : h < 0)) q = sub(p, mul(n, h * wi * k));
					break;
				}
				case "clay":
				case "clayStrips": {
					// toward a plane lifted off the surface, for what lies on the near side of it
					const lifted = add(c, mul(n, sign * r * (brush === "clayStrips" ? 0.3 : 0.2) * k));
					const h = dot(sub(p, lifted), n);
					if (sign * h < 0) q = sub(p, mul(n, h * wi * Math.min(1, k * 1.5)));
					break;
				}
				case "layer": {
					const was = st.raised!.get(i) ?? 0;
					const now = Math.max(was, wi * k);
					st.raised!.set(i, now);
					if (now > was) q = add(p, mul(st.origNormals![i], (now - was) * r * 0.25 * sign));
					break;
				}
				case "pinch":
					q = add(p, mul(along(sub(c, p), n), wi * k * 0.5 * sign));
					break;
				case "thumb":
					q = add(p, mul(along(mv, n), wi * k));
					break;
				case "nudge":
					q = add(p, mul(along(mv, n), wi * k * 0.5));
					break;
				case "snakeHook":
					q = add(p, mul(mv, Math.min(1, wi * k * 1.2)));
					break;
			}
			if (q !== p) {
				pts[i] = q;
				changed.add(i);
			}
		}
		if (o.autoSmooth > 0 && brush !== "smooth") smoothPass(st, pts, w, o.autoSmooth);
		for (const i of w.keys()) changed.add(i);
	}
	for (const i of changed) st.touched.add(i);
	return [...changed];
}

function det(m: M3): number {
	return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
}

// ------------------------------------------------------------- the whole mesh at once

export type Filter = "inflate" | "smooth" | "scale" | "sharpen" | "random" | "relax";
export const FILTERS: { kind: Filter; label: string; hint: string }[] = [
	{ kind: "inflate", label: "Inflate", hint: "every point out along its normal by the amount (in units)" },
	{ kind: "smooth", label: "Smooth", hint: "every point toward its neighbours' average, by the amount (0 to 1)" },
	{ kind: "scale", label: "Scale", hint: "about the middle of what moves, by 1 + the amount" },
	{ kind: "sharpen", label: "Sharpen", hint: "every point away from its neighbours' average: the detail stands out" },
	{ kind: "random", label: "Random", hint: "every point along its normal by a random share of the amount (in units)" },
	{ kind: "relax", label: "Relax", hint: "slides points along the surface toward even spacing, keeping the shape" },
];

/**
 * A filter over the whole mesh, or what the mask leaves free: the points
 * it gives back are a new list. `seed` keeps Random the same each time.
 */
export function filterMesh(points: readonly V3[], faces: readonly (readonly number[])[], kind: Filter, amount: number, mask?: ArrayLike<number> | null, seed = 1): V3[] {
	const free = (i: number) => 1 - Math.max(0, Math.min(1, mask?.[i] ?? 0));
	const pts = points.map((p) => [p[0], p[1], p[2]] as V3);
	const normals = vertexNormals(points, faces);
	const nbrs = neighbours(points.length, faces);
	const avg = (i: number): V3 => {
		const nb = nbrs[i];
		if (!nb.length) return points[i];
		let a: V3 = [0, 0, 0];
		for (const o of nb) a = add(a, points[o]);
		return mul(a, 1 / nb.length);
	};
	let rand = seed >>> 0 || 1;
	const next = () => {
		rand ^= rand << 13;
		rand ^= rand >>> 17;
		rand ^= rand << 5;
		return ((rand >>> 0) / 4294967296) * 2 - 1;
	};
	let c: V3 = [0, 0, 0];
	let cw = 0;
	if (kind === "scale") {
		points.forEach((p, i) => {
			c = add(c, mul(p, free(i)));
			cw += free(i);
		});
		c = cw > 0 ? mul(c, 1 / cw) : c;
	}
	for (let i = 0; i < pts.length; i++) {
		const w = free(i);
		const p = points[i];
		const r = next();
		if (w <= 0) continue;
		switch (kind) {
			case "inflate":
				pts[i] = add(p, mul(normals[i], amount * w));
				break;
			case "smooth":
				pts[i] = add(p, mul(sub(avg(i), p), Math.max(-1, Math.min(1, amount)) * w));
				break;
			case "scale":
				pts[i] = add(c, mul(sub(p, c), 1 + amount * w));
				break;
			case "sharpen":
				pts[i] = sub(p, mul(sub(avg(i), p), amount * w));
				break;
			case "random":
				pts[i] = add(p, mul(normals[i], amount * w * r));
				break;
			case "relax":
				pts[i] = add(p, mul(along(sub(avg(i), p), normals[i]), Math.max(-1, Math.min(1, amount)) * w));
				break;
		}
	}
	return pts;
}

/** The mask grown, shrunk, sharpened or smoothed by one ring of neighbours. */
export function reshapeMask(mask: ArrayLike<number>, faces: readonly (readonly number[])[], how: "grow" | "shrink" | "smooth" | "sharpen" | "invert" | "clear" | "fill"): Float32Array {
	const n = mask.length;
	const out = new Float32Array(n);
	if (how === "clear") return out;
	if (how === "fill") return out.fill(1);
	if (how === "invert") {
		for (let i = 0; i < n; i++) out[i] = 1 - mask[i];
		return out;
	}
	const nbrs = neighbours(n, faces);
	for (let i = 0; i < n; i++) {
		const nb = nbrs[i];
		const vals = nb.map((o) => mask[o]);
		if (how === "grow") out[i] = Math.max(mask[i], ...vals);
		else if (how === "shrink") out[i] = Math.min(mask[i], ...vals);
		else {
			const a = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : mask[i];
			const v = how === "smooth" ? (mask[i] + a) / 2 : mask[i] + (mask[i] - a);
			out[i] = Math.max(0, Math.min(1, v));
		}
	}
	return out;
}
