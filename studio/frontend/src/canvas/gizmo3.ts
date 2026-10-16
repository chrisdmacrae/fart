// Moving, turning and sizing along the world's axes, in the model view.
// Two ways in, one engine. The handles: three arrows and three rings on
// what is chosen (a picked part's pose, or a selected shape), each drag
// held to its axis whatever the view. And the keys, Blender's way in the
// studio's words: G moves, T turns, S sizes; then X, Y or Z holds an
// axis, a typed number is the amount, Return (or a click) keeps it and
// Esc (or a right click) puts it back. One undo step either way.

import { signal } from "@preact/signals";
import { quatMul, quatAxis, quatFromEuler, quatToEuler, viewXf3, xf3Apply, xf3ApplyDir, xf3Invert, xf3Det, type Shape3, type StatePart3, type Vec2, type Vec3, type Xf3 } from "@fastart/core";
import { md, parts, curPart, curClip, curState, poseOfCur, framePartOf, setPose, mutate, endGesture, selected, morphEntry, chosenPoints, symmetryOf, symmetrize, type Sel3 } from "../state/model.ts";
import { view } from "./view.ts";
import { canvasColors } from "../state/theme.ts";

export type Op = "move" | "turn" | "size";
type Axis = -1 | 0 | 1 | 2;

/** What the status bar reads while a transform is under way. */
export const modal3 = signal<{ op: Op; axis: Axis; typed: string; value: number; drag: boolean } | null>(null);

const AXES: Vec3[] = [
	[1, 0, 0],
	[0, 1, 0],
	[0, 0, 1],
];
const NAMES = ["X", "Y", "Z"];
const px = (n: number) => n / view.zoom.value;
/** What the engine turns: built afresh for each gesture, laid over the thing as it was then. */
export interface GizmoTarget {
	/** where the handles sit, on the canvas */
	centre: Vec2;
	/** the axes that get a ring (a pose turns; a 2D scene only about the view) */
	rings: number[];
	/** sizing can be held to one axis (shapes can; a pose's scale is one number) */
	axisSize: boolean;
	apply(op: Op, axisView: Vec3 | null, amount: number, dView: Vec3): void;
}
/** A screen that has a gizmo: its view, what is chosen there, and its undo grouping. */
export interface GizmoProvider {
	view(): Xf3;
	target(): GizmoTarget | null;
	endGesture(): void;
	/** why nothing can be transformed just now, when there is a reason worth saying */
	refusal?(): string | null;
}
let provider: GizmoProvider;
/** The canvas on screen says whose gizmo this is. */
export function useGizmo(p: GizmoProvider) {
	if (provider !== p) gizmoCancel();
	provider = p;
}
const V = () => provider.view();
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => {
	const l = Math.hypot(a[0], a[1], a[2]) || 1;
	return [a[0] / l, a[1] / l, a[2] / l];
};
const round3 = (p: Vec3): Vec3 => p.map((x) => Math.round(x * 1000) / 1000) as Vec3;
/** A vector turned about a unit axis (Rodrigues). */
const spin = (p: Vec3, n: Vec3, a: number): Vec3 => add(add(mul(p, Math.cos(a)), mul(cross(n, p), Math.sin(a))), mul(n, dot(n, p) * (1 - Math.cos(a))));

/** A world axis as the view has it: its direction in view space (x, y on the canvas, z toward the viewer). */
const axisInView = (i: number): Vec3 => xf3ApplyDir(V(), AXES[i]);

// ------------------------------------------------------------- what is being transformed

interface PoseTarget {
	kind: "pose";
	sp: StatePart3;
	base: { offset: Vec3; rotate: Vec3; scale: number };
	/** view space to the frame the pose's offset and turn live in (the parent's rest frame) */
	toFrame: Xf3;
	centre: Vec2;
}
interface ShapeTarget {
	kind: "shape";
	/** every chosen shape, as it was, with the way from view space to its part's rest frame (where its points live) */
	items: { s: Sel3; base: Shape3; toFrame: Xf3; centreRest: Vec3; morph: boolean; only?: Set<number>; mirror?: number[] | null }[];
	centre: Vec2;
}
type Target = PoseTarget | ShapeTarget;

function pointsOf(sh: Shape3): Vec3[] | null {
	if (sh.kind === "mesh") return sh.points;
	if (sh.kind === "ball") return [sh.at];
	if (sh.kind === "rod") return [sh.a, sh.b];
	return null; // a sweep is its profile: its fields are in the inspector
}

/** The selected shape if there is one, else the picked part's pose; in a clip only the pose (the key's). */
let refused: string | null = null;
function modelTarget(): Target | null {
	refused = null;
	if (md.tool.value !== "select") return null;
	const chosen = curClip() ? [] : selected();
	if (chosen.length) {
		// one centre for all of them, in view space: they turn and size about it together
		const morphing = md.deform.value && md.curClip.value < 0;
		const found: { s: Sel3; base: Shape3; F: Xf3; morph: boolean; only?: Set<number>; mirror?: number[] | null }[] = [];
		// corners, edges or faces chosen on the one selected mesh: they are what moves, not the whole shape
		const elems = chosen.length === 1 ? chosenPoints() : [];
		let sum: Vec3 = [0, 0, 0];
		let n = 0;
		for (const s of chosen) {
			const fp = framePartOf(s.part);
			const sh = parts()[s.part]?.shapes?.[s.shape];
			const pts = sh ? pointsOf(sh) : null;
			if (!fp || !sh || !pts?.length) continue;
			let base = structuredClone(sh);
			if (morphing) {
				// Deform: the shape as this state has it is what moves, and only this state keeps the change
				if (base.kind !== "mesh" || fp.part.like) {
					refused = "Deform reshapes meshes in this state only: a ball, a rod or a part drawn like another has no morph. Turn Deform off (D) to change it everywhere.";
					continue;
				}
				const posed = curState()?.parts.find((e) => e.part === fp.part.name)?.morph?.find((m) => m.shape === s.shape);
				if (posed && posed.points.length === base.points.length) base = { ...base, points: posed.points.map((p) => [...p] as Vec3) };
			}
			const now = pointsOf(base)!;
			const only = elems.length && base.kind === "mesh" ? new Set(elems) : undefined;
			found.push({ s, base, F: fp.F, morph: morphing, only, mirror: only ? symmetryOf(s) : null });
			now.forEach((p, i) => {
				if (only && !only.has(i)) return;
				sum = add(sum, xf3Apply(fp.F, p));
				n++;
			});
		}
		if (!found.length) return null;
		const c = mul(sum, 1 / n);
		return { kind: "shape", centre: [c[0], c[1]], items: found.map((f) => ({ s: f.s, base: f.base, morph: f.morph, only: f.only, mirror: f.mirror, toFrame: xf3Invert(f.F), centreRest: xf3Apply(xf3Invert(f.F), c) })) };
	}
	if (!md.partPicked.value) return null;
	const sp = poseOfCur();
	const p = curPart();
	const fp = framePartOf(md.curPart.value);
	if (!sp || !p || !fp) return null;
	const parentIdx = p.parent ? parts().findIndex((q) => q.name === p.parent) : -1;
	const P = parentIdx >= 0 ? framePartOf(parentIdx)?.F : undefined;
	return {
		kind: "pose",
		sp,
		base: { offset: [...(sp.offset ?? p.pivot ?? [0, 0, 0])] as Vec3, rotate: [...(sp.rotate ?? [0, 0, 0])] as Vec3, scale: sp.scale ?? 1 },
		toFrame: xf3Invert(P ?? V()),
		centre: fp.pivot,
	};
}

/** Lay a transform over the target as it was when the gesture began. */
function applyModel(t: Target, op: Op, axisView: Vec3 | null, amount: number, dView: Vec3) {
	if (t.kind === "pose") {
		const flip = xf3Det(t.toFrame) < 0 ? -1 : 1;
		const n = axisView ? unit(xf3ApplyDir(t.toFrame, axisView)) : null;
		if (op === "move") setPose(t.sp, { offset: round3(add(t.base.offset, xf3ApplyDir(t.toFrame, dView))) }, "gizmo");
		else if (op === "turn" && n) {
			const q = quatMul(quatAxis(n, amount * flip), quatFromEuler(t.base.rotate));
			setPose(t.sp, { rotate: quatToEuler(q).map((x) => Math.round(x * 1e4) / 1e4) as Vec3 }, "gizmo");
		} else if (op === "size") setPose(t.sp, { scale: Math.max(0.001, Math.round(t.base.scale * amount * 1000) / 1000) }, "gizmo");
		return;
	}
	mutate((doc) => {
		for (const it of t.items) {
			const flip = xf3Det(it.toFrame) < 0 ? -1 : 1;
			const n = axisView ? unit(xf3ApplyDir(it.toFrame, axisView)) : null;
			const c = it.centreRest;
			const d = xf3ApplyDir(it.toFrame, dView);
			const map = (p: Vec3): Vec3 => {
				if (op === "move") return round3(add(p, d));
				const r = sub(p, c);
				if (op === "turn" && n) return round3(add(c, spin(r, n, amount * flip)));
				// along one axis, or all round
				return round3(n ? add(p, mul(n, dot(r, n) * (amount - 1))) : add(c, mul(r, amount)));
			};
			const base = it.base;
			const sh = doc.parts![it.s.part].shapes![it.s.shape];
			// only the chosen corners move, when some are; under symmetry their mirrors follow
			const each = (p: Vec3, i: number): Vec3 => (it.only && !it.only.has(i) ? p : map(p));
			const even = (pts: Vec3[]) => {
				if (it.only && it.mirror) symmetrize(pts, it.only, it.mirror);
			};
			if (it.morph) {
				// into this state's morph, never the base mesh
				const pts = base.kind === "mesh" ? morphEntry(doc, it.s.part, it.s.shape) : null;
				if (pts && base.kind === "mesh") {
					base.points.forEach((p, i) => (pts[i] = each(p, i)));
					even(pts);
				}
			} else if (sh.kind === "mesh" && base.kind === "mesh") {
				sh.points = base.points.map(each);
				even(sh.points);
				delete sh.tris;
			}
			else if (sh.kind === "ball" && base.kind === "ball") {
				sh.at = map(base.at);
				if (op === "size") sh.r = Math.max(0.001, Math.round(base.r * amount * 1000) / 1000);
			} else if (sh.kind === "rod" && base.kind === "rod") {
				sh.a = map(base.a);
				sh.b = map(base.b);
				if (op === "size" && !n) sh.w = Math.max(0.001, Math.round(base.w * amount * 1000) / 1000);
			}
		}
	}, "gizmo");
}

/** The model screen's gizmo: the selected shapes, else the picked part's pose. */
export const modelGizmo: GizmoProvider = {
	view: () => viewXf3(md.turn.value),
	target() {
		const t = modelTarget();
		return t && { centre: t.centre, rings: t.kind === "pose" ? [0, 1, 2] : [], axisSize: t.kind === "shape", apply: (op, axisView, amount, dView) => applyModel(t, op, axisView, amount, dView) };
	},
	endGesture,
	refusal: () => refused,
};
provider = modelGizmo;
const target = () => provider.target();
const apply = (t: GizmoTarget, op: Op, axisView: Vec3 | null, amount: number, dView: Vec3) => t.apply(op, axisView, amount, dView);

// ------------------------------------------------------------- the gesture

interface Live {
	op: Op;
	axis: Axis;
	typed: string;
	drag: boolean;
	target: GizmoTarget;
	start: Vec2;
	cursor: Vec2;
	/** the screen angle about the centre, unwrapped as the pointer goes round */
	lastAng: number;
	swept: number;
	shift: boolean;
}
let live: Live | null = null;
/** a word for the person, when a transform was asked for and could not begin (the screen shows it) */
export const gizmoNote = signal<string | null>(null);

export const gizmoActive = () => live !== null;

function publish(value: number) {
	if (live) modal3.value = { op: live.op, axis: live.axis, typed: live.typed, value, drag: live.drag };
}

function update() {
	const g = live;
	if (!g) return;
	const t = g.target;
	const c = t.centre;
	const m: Vec2 = [g.cursor[0] - g.start[0], g.cursor[1] - g.start[1]];
	const typed = g.typed !== "" && g.typed !== "-" && g.typed !== "." ? Number(g.typed) : NaN;
	const has = Number.isFinite(typed);
	const a = g.axis >= 0 ? axisInView(g.axis) : null;
	if (g.op === "move") {
		if (!a && !has) {
			apply(t, "move", null, 0, [m[0], m[1], 0]);
			return publish(Math.hypot(m[0], m[1]));
		}
		// a typed distance with no axis held goes along X, as it does in Blender
		const ax = a ?? axisInView(0);
		const l2 = ax[0] * ax[0] + ax[1] * ax[1];
		let amt = has ? typed : l2 < 0.02 ? 0 : (m[0] * ax[0] + m[1] * ax[1]) / l2;
		if (!has && (g.shift || view.snapGrid.value)) amt = Math.round(amt * (g.shift ? 1 : 2)) / (g.shift ? 1 : 2);
		apply(t, "move", null, 0, mul(ax, amt));
		return publish(amt);
	}
	if (g.op === "turn") {
		const ax = a ?? ([0, 0, 1] as Vec3);
		let ang: number;
		if (has) ang = (typed * Math.PI) / 180;
		else if (Math.abs(ax[2]) > 0.3) ang = g.swept * Math.sign(ax[2]);
		else {
			// the axis lies across the screen: a drag across it rolls the part
			const l = Math.hypot(ax[0], ax[1]) || 1;
			ang = ((m[0] * -ax[1] + m[1] * ax[0]) / l) * (view.zoom.value / 80);
		}
		if (!has && g.shift) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);
		apply(t, "turn", ax, ang, [0, 0, 0]);
		return publish((ang * 180) / Math.PI);
	}
	const d0 = Math.max(px(4), Math.hypot(g.start[0] - c[0], g.start[1] - c[1]));
	let f = has ? typed : Math.hypot(g.cursor[0] - c[0], g.cursor[1] - c[1]) / d0;
	if (!has && g.shift) f = Math.round(f * 10) / 10;
	f = Math.max(0.01, f);
	apply(t, "size", t.axisSize ? a : null, f, [0, 0, 0]);
	publish(f);
}

function begin(op: Op, at: Vec2, axis: Axis, drag: boolean): boolean {
	const t = target();
	if (!t) return false;
	provider.endGesture();
	live = { op, axis, typed: "", drag, target: t, start: at, cursor: at, lastAng: Math.atan2(at[1] - t.centre[1], at[0] - t.centre[0]), swept: 0, shift: false };
	publish(op === "size" ? 1 : 0);
	return true;
}

function finish(keep: boolean) {
	const g = live;
	if (!g) return;
	if (!keep) {
		// put it back as it was (the same undo step, now a change of nothing)
		g.typed = "";
		g.cursor = g.start;
		g.swept = 0;
		g.shift = false;
		if (modal3.value) apply(g.target, g.op, g.op === "turn" ? [0, 0, 1] : null, g.op === "size" ? 1 : 0, [0, 0, 0]);
	}
	live = null;
	modal3.value = null;
	provider.endGesture();
}

/** The pointer moved while a transform is under way. */
export function gizmoMove(wm: Vec2, shift: boolean) {
	const g = live;
	if (!g) return;
	const c = g.target.centre;
	const ang = Math.atan2(wm[1] - c[1], wm[0] - c[0]);
	let d = ang - g.lastAng;
	if (d > Math.PI) d -= Math.PI * 2;
	if (d < -Math.PI) d += Math.PI * 2;
	g.swept += d;
	g.lastAng = ang;
	g.cursor = wm;
	g.shift = shift;
	update();
}

/** A button went down. True when the gizmo took it: a handle grabbed, or a keyed transform kept. */
export function gizmoDown(wm: Vec2): boolean {
	if (live) {
		finish(true);
		return true;
	}
	const h = hit(wm);
	if (!h) return false;
	return begin(h.op, wm, h.axis, true);
}

/**
 * The button came up: a handle drag is kept. A press that never moved
 * was a click, not a drag: it is put back, and "click" says so, so that
 * what lies under the handle can be picked instead.
 */
export function gizmoUp(): "kept" | "click" | null {
	const g = live;
	if (!g?.drag) return null;
	const still = Math.hypot(g.cursor[0] - g.start[0], g.cursor[1] - g.start[1]) * view.zoom.value < 3;
	finish(!still);
	return still ? "click" : "kept";
}

export function gizmoCancel(): boolean {
	if (!live) return false;
	finish(false);
	return true;
}

/**
 * A key, before the keymap sees it. G T S begin (at the pointer); under
 * way, X Y Z hold an axis (again lets go), digits type the amount,
 * Return keeps, Esc puts back. True when the key was the gizmo's.
 */
export function gizmoKey(e: KeyboardEvent, cursor: Vec2 | null): boolean {
	if (e.metaKey || e.ctrlKey || e.altKey) return false;
	const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
	if (!live) {
		const op: Op | null = k === "g" ? "move" : k === "t" ? "turn" : k === "s" ? "size" : null;
		if (!op) return false;
		const t = target();
		if (!t) {
			// nothing to transform: say why, when there is a why
			const why = provider.refusal?.();
			if (why) gizmoNote.value = why;
			return !!why;
		}
		return begin(op, cursor ?? [t.centre[0] + px(60), t.centre[1]], -1, false);
	}
	const g = live;
	if (k === "Escape") finish(false);
	else if (k === "Enter") finish(true);
	else if (k === "x" || k === "y" || k === "z") {
		const i = "xyz".indexOf(k) as Axis;
		g.axis = g.axis === i ? -1 : i;
		update();
	} else if (/^[0-9]$/.test(k) || (k === "." && !g.typed.includes(".")) || (k === "-" && g.typed === "")) {
		g.typed += k;
		update();
	} else if (k === "Backspace") {
		g.typed = g.typed.slice(0, -1);
		update();
	} else if (k === "Shift") return false;
	// every other key waits until the transform is kept or put back
	return true;
}

/** The status bar's line while a transform is under way. */
export function gizmoStatus(): string | null {
	const m = modal3.value;
	if (!m) return null;
	const verb = m.op === "move" ? "Move" : m.op === "turn" ? "Turn" : "Size";
	const where = m.axis >= 0 ? (m.op === "turn" ? ` about ${NAMES[m.axis]}` : ` along ${NAMES[m.axis]}`) : m.op === "turn" ? " about the view" : "";
	const amount = m.typed !== "" ? m.typed : m.op === "turn" ? m.value.toFixed(1) : m.value.toFixed(m.op === "size" ? 2 : 3).replace(/\.?0+$/, "") || "0";
	const unit = m.op === "turn" ? "°" : m.op === "size" ? "×" : "";
	if (m.drag) return `${verb}${where}: ${amount}${unit} · ⇧ snaps`;
	return `${verb}${where}: ${amount}${unit} · X Y Z hold an axis · type a number · ⇧ snaps · Return keeps · Esc puts back`;
}

// ------------------------------------------------------------- the handles

const ARROW = 62;
const RING = 46;
let hover: { op: Op; axis: Axis } | null = null;

interface Handles {
	centre: Vec2;
	arrows: { axis: Axis; from: Vec2; tip: Vec2 }[];
	rings: { axis: Axis; pts: Vec2[] }[];
}

/** Where the handles are, in the canvas's world (for drawing, hit testing and scripts). */
export function handles(): Handles | null {
	const t = live?.target ?? target();
	if (!t) return null;
	const c = t.centre;
	const out: Handles = { centre: c, arrows: [], rings: [] };
	for (let i = 0; i < 3; i++) {
		const a = axisInView(i);
		// an axis pointing at the viewer has no arrow to draw: its ring is the way to use it
		if (Math.hypot(a[0], a[1]) > 0.25) out.arrows.push({ axis: i as Axis, from: [c[0] + a[0] * px(16), c[1] + a[1] * px(16)], tip: [c[0] + a[0] * px(ARROW), c[1] + a[1] * px(ARROW)] });
		if (!t.rings.includes(i)) continue;
		const u = unit(cross(a, Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
		const v = cross(a, u);
		const pts: Vec2[] = [];
		for (let k = 0; k <= 48; k++) {
			const th = (k / 48) * Math.PI * 2;
			pts.push([c[0] + (u[0] * Math.cos(th) + v[0] * Math.sin(th)) * px(RING), c[1] + (u[1] * Math.cos(th) + v[1] * Math.sin(th)) * px(RING)]);
		}
		out.rings.push({ axis: i as Axis, pts });
	}
	return out;
}

function toSegment(p: Vec2, a: Vec2, b: Vec2): number {
	const ab: Vec2 = [b[0] - a[0], b[1] - a[1]];
	const l2 = ab[0] * ab[0] + ab[1] * ab[1] || 1;
	const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2));
	return Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t);
}

function hit(wm: Vec2): { op: Op; axis: Axis } | null {
	const h = handles();
	if (!h) return null;
	for (const a of h.arrows) if (Math.hypot(wm[0] - a.tip[0], wm[1] - a.tip[1]) < px(9) || toSegment(wm, a.from, a.tip) < px(5)) return { op: "move", axis: a.axis };
	let best: { d: number; axis: Axis } | null = null;
	for (const r of h.rings) {
		for (let k = 1; k < r.pts.length; k++) {
			const d = toSegment(wm, r.pts[k - 1], r.pts[k]);
			if (d < px(5) && (!best || d < best.d)) best = { d, axis: r.axis };
		}
	}
	return best ? { op: "turn", axis: best.axis } : null;
}

/** The pointer is over a handle (with no button down): it lights. True when what is lit changed. */
export function gizmoHover(wm: Vec2 | null): boolean {
	const h = wm && !live ? hit(wm) : null;
	const same = h?.op === hover?.op && h?.axis === hover?.axis;
	hover = h;
	return !same;
}

/** Draw the handles, in screen space. `toS` maps the canvas's world to pixels. */
export function drawGizmo(ctx: CanvasRenderingContext2D, toS: (p: Vec2) => Vec2) {
	const h = handles();
	if (!h) return;
	const C = canvasColors();
	const colour = [C.axisX, C.axisY, C.axisZ];
	const lit = (op: Op, axis: Axis) => (live ? live.op === op && live.axis === axis : hover?.op === op && hover.axis === axis);
	// while one handle is dragged, the others step back
	const quiet = (op: Op, axis: Axis) => !!live && !lit(op, axis);
	ctx.save();
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	for (const r of h.rings) {
		if (quiet("turn", r.axis)) continue;
		ctx.globalAlpha = lit("turn", r.axis) ? 1 : 0.55;
		ctx.strokeStyle = colour[r.axis];
		ctx.lineWidth = (lit("turn", r.axis) ? 2.5 : 1.25) * C.line;
		ctx.beginPath();
		r.pts.forEach((p, k) => {
			const s = toS(p);
			if (k) ctx.lineTo(s[0], s[1]);
			else ctx.moveTo(s[0], s[1]);
		});
		ctx.stroke();
	}
	for (const a of h.arrows) {
		if (quiet("move", a.axis)) continue;
		const on = lit("move", a.axis);
		const f = toS(a.from);
		const t = toS(a.tip);
		const dir = Math.atan2(t[1] - f[1], t[0] - f[0]);
		ctx.globalAlpha = on ? 1 : 0.9;
		ctx.strokeStyle = colour[a.axis];
		ctx.fillStyle = colour[a.axis];
		ctx.lineWidth = (on ? 3 : 2) * C.line;
		ctx.beginPath();
		ctx.moveTo(f[0], f[1]);
		ctx.lineTo(t[0] - Math.cos(dir) * 8, t[1] - Math.sin(dir) * 8);
		ctx.stroke();
		const w = on ? 6 : 5;
		ctx.beginPath();
		ctx.moveTo(t[0], t[1]);
		ctx.lineTo(t[0] - Math.cos(dir) * 11 - Math.sin(dir) * w, t[1] - Math.sin(dir) * 11 + Math.cos(dir) * w);
		ctx.lineTo(t[0] - Math.cos(dir) * 11 + Math.sin(dir) * w, t[1] - Math.sin(dir) * 11 - Math.cos(dir) * w);
		ctx.closePath();
		ctx.fill();
		// always labelled: colour alone never says which axis
		ctx.font = "600 10px system-ui, sans-serif";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(NAMES[a.axis], t[0] + Math.cos(dir) * 9, t[1] + Math.sin(dir) * 9);
	}
	// a held axis shows as a line through the centre, the way a constraint does in Blender
	if (live && !live.drag && live.axis >= 0) {
		const a = axisInView(live.axis);
		const c = toS(h.centre);
		ctx.globalAlpha = 0.6;
		ctx.strokeStyle = colour[live.axis];
		ctx.lineWidth = C.line;
		ctx.beginPath();
		ctx.moveTo(c[0] - a[0] * 4000, c[1] - a[1] * 4000);
		ctx.lineTo(c[0] + a[0] * 4000, c[1] + a[1] * 4000);
		ctx.stroke();
	}
	ctx.restore();
}
