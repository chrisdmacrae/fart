// The model canvas: the 3D document projected under the view and drawn
// with the 2D painter, and what the pointer does to it. Everything the
// hand does happens in the view plane: a shape or a corner drags along
// it, a drawn rect, circle, line or poly becomes a box, a ball, a rod or
// a prism as deep as the depth field says, the current part's pivot
// drags to place it and its lever turns it about the view axis, and a
// drag on nothing orbits the model.

import { cssColor, colorOf, collisionWorld3, shadeColor, shapeDistance, viewXf3, xf3Apply, xf3ApplyDir, xf3Invert, xf3Det, dist, type Shape, type Vec2, type Vec3, type FramePart } from "@fastart/core";
import { view } from "./view.ts";
import { gizmoDown, gizmoMove, gizmoUp, gizmoCancel, gizmoActive, gizmoHover, drawGizmo } from "./gizmo3.ts";
import { fillShape, outlineShape, tracePoly } from "./draw.ts";
import { drawGrid } from "./render.ts";
import { canvasColors } from "../state/theme.ts";
import {
	md,
	parts,
	curPart,
	curClip,
	curTokName,
	frame,
	frameParts,
	framePartOf,
	selShapePosed,
	selShape,
	isEdge,
	poseOfCur,
	addShape,
	extrudeView,
	moveSelView,
	moveVertexView,
	workDepth,
	viewToRest,
	setPose,
	turnPose,
	setPivot,
	orbit,
	endGesture,
	type Sel3,
	selected,
	sameSel,
	selectShapes,
	chooseVerts,
	chooseEdges,
	chooseFaces,
	chosenPoints,
	moveChosenView,
	symmetryOf,
	isPipe,
	pipeTwin,
	addPipe,
	setPipePoint,
	movePipePointView,
	brushFace,
	paintToken,
} from "../state/model.ts";
import { surfaceUnder, surfaceBelow } from "./surface3.ts";
import { project as proj } from "../state/project.ts";
import { MeshError } from "../state/meshops.ts";
import { meshActive, meshDown, meshMove, meshCancel } from "./meshtool3.ts";
import { work, refImage, refViewOf } from "../state/workspace.ts";
import { project } from "../state/project.ts";

export interface Mods {
	shift: boolean;
	alt: boolean;
	cmd?: boolean;
}

export const ix3 = {
	down: false,
	cursor: null as Vec2 | null,
	drawing: false,
	drawA: [0, 0] as Vec2,
	dragging: false,
	dragLast: [0, 0] as Vec2,
	vertex: null as number | null,
	/** the chosen edges or faces are what a drag moves */
	elem: false,
	/** the edge or face of the selected mesh a click would choose */
	hoverEdge: null as [number, number] | null,
	hoverFace: null as number | null,
	poseDrag: false,
	poseRot: false,
	poseAng0: 0,
	orbiting: false,
	orbitLast: [0, 0] as Vec2,
	marquee: false,
	marqueeA: [0, 0] as Vec2,
	/** a paint stroke is under way: faces the pointer crosses take the colour */
	brushing: false,
	/** the point of the selected pipe's path a drag is moving */
	pipeDrag: null as number | null,
	mods: { shift: false, alt: false, cmd: false } as Mods,
};

const z = () => view.zoom.value;
const px = (n: number) => n / z();

/** Where a rest point of a part lands on the canvas. */
export function viewPoint(fp: FramePart, p: Vec3): Vec2 {
	const v = xf3Apply(fp.F, p);
	return [v[0], v[1]];
}

/** The corners of the selected mesh, projected. */
export function vertexHandles(): { i: number; at: Vec2 }[] {
	const s = md.sel.value;
	const sh = selShapePosed();
	if (!s || !sh || sh.kind !== "mesh") return [];
	const fp = framePartOf(s.part);
	if (!fp) return [];
	return sh.points.map((p, i) => ({ i, at: viewPoint(fp, p) }));
}

/** The selected mesh as the canvas shows it: its corners in view space (x, y on the canvas, z away). */
function meshView(): { points: Vec3[]; faces: number[][]; flip: boolean } | null {
	const s = md.sel.value;
	const sh = selShapePosed();
	const fp = s ? framePartOf(s.part) : undefined;
	if (!s || !sh || sh.kind !== "mesh" || !fp || fp.part.like) return null;
	return { points: sh.points.map((p) => xf3Apply(fp.F, p)), faces: sh.faces, flip: xf3Det(fp.F) < 0 };
}
function segDist(p: Vec2, a: Vec3, b: Vec3): number {
	const ab: Vec2 = [b[0] - a[0], b[1] - a[1]];
	const l2 = ab[0] * ab[0] + ab[1] * ab[1] || 1;
	const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2));
	return Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t);
}
/** The edge of the selected mesh under a point: the nearest to the viewer of those the pointer is on. */
export function hitEdge(wm: Vec2): [number, number] | null {
	const mv = meshView();
	if (!mv) return null;
	const tol = px(6);
	const found: { e: [number, number]; d: number; z: number }[] = [];
	for (const f of mv.faces) {
		for (let i = 0; i < f.length; i++) {
			const a = f[i];
			const b = f[(i + 1) % f.length];
			const d = segDist(wm, mv.points[a], mv.points[b]);
			if (d <= tol) found.push({ e: [a, b], d, z: (mv.points[a][2] + mv.points[b][2]) / 2 });
		}
	}
	if (!found.length) return null;
	// two edges one behind the other in a straight-on view: of those as close as the closest, the nearer is meant
	const dmin = Math.min(...found.map((c) => c.d));
	return found.filter((c) => c.d <= dmin + px(2)).reduce((p, c) => (c.z < p.z ? c : p)).e;
}
/** The face of the selected mesh under a point: one that faces the viewer before one that faces away, the nearest first. */
export function hitFace(wm: Vec2): number | null {
	const mv = meshView();
	if (!mv) return null;
	let best: { f: number; front: boolean; z: number } | null = null;
	mv.faces.forEach((f, fi) => {
		let inside = false;
		let nz = 0;
		let z = 0;
		for (let i = 0, j = f.length - 1; i < f.length; j = i++) {
			const a = mv.points[f[i]];
			const b = mv.points[f[j]];
			if (a[1] > wm[1] !== b[1] > wm[1] && wm[0] < ((b[0] - a[0]) * (wm[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
			nz += (b[0] - a[0]) * (b[1] + a[1]);
			z += a[2];
		}
		if (!inside) return;
		z /= f.length;
		// the outline's turn on the canvas says which way the face looks (a mirrored part turns it over)
		const front = nz < 0 !== mv.flip;
		if (!best || (front && !best.front) || (front === best.front && z < best.z)) best = { f: fi, front, z };
	});
	return best ? (best as { f: number }).f : null;
}
const sameEdge = (a: readonly [number, number], b: readonly [number, number]) => (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);

/** The topmost shape under a world point: the nearest face that is under it. */
export function pick(wm: Vec2): Sel3 | null {
	const tol = px(4);
	let best: { depth: number; sel: Sel3 } | null = null;
	for (const fp of frameParts()) {
		if (fp.part.like) continue; // a part drawn like another: edit the source
		for (const f of fp.shapes) {
			if (f.outline) continue;
			if (shapeDistance(f.shape, wm) > tol) continue;
			if (!best || f.depth < best.depth) best = { depth: f.depth, sel: { part: fp.index, shape: f.src } };
		}
	}
	return best?.sel ?? null;
}

/** The joint (a drawn part's pivot) under a world point, the current part's first; -1 for none. */
export function jointAt(wm: Vec2): number {
	const fps = [...frameParts()].sort((a, b) => (a.index === md.curPart.value ? -1 : b.index === md.curPart.value ? 1 : 0));
	for (const fp of fps) if (dist(wm, fp.pivot) < px(8)) return fp.index;
	return -1;
}

/** The current part's pivot on the canvas, and its lever (the in-plane turn). */
export function pivotLever(): { at: Vec2; lever: Vec2; angle: number } | null {
	const fp = framePartOf(md.curPart.value);
	if (!fp) return null;
	const at = fp.pivot;
	const angle = Math.atan2(fp.M[3], fp.M[0]);
	const len = px(36);
	return { at, lever: [at[0] + Math.cos(angle - Math.PI / 2) * len, at[1] + Math.sin(angle - Math.PI / 2) * len], angle };
}

function snapPt(p: Vec2): Vec2 {
	if (!view.snapGrid.value || ix3.mods.cmd) return p;
	return [Math.round(p[0] * 2) / 2, Math.round(p[1] * 2) / 2];
}

/** The axis of the view (toward the viewer's z) in the current part's parent frame, for turning about it. */
function viewAxisInParent(): { axis: Vec3; sign: number } | null {
	const p = curPart();
	if (!p) return null;
	const fp = framePartOf(md.curPart.value);
	if (!fp) return null;
	// F(part) = V · W(parent) · L; the parent's frame in view space is F · L⁻¹; a turn about view z in
	// the parent's rest frame is that map's inverse applied to (0, 0, 1)
	const parentIdx = p.parent ? parts().findIndex((q) => q.name === p.parent) : -1;
	const P = parentIdx >= 0 ? framePartOf(parentIdx)?.F : undefined;
	// no parent: the parent frame is the world, whose view map is the view turn alone
	const base = P ?? viewOnly();
	const inv = xf3Invert(base);
	const axis = xf3ApplyDir(inv, [0, 0, 1]);
	void fp;
	return { axis, sign: xf3Det(base) < 0 ? -1 : 1 };
}
/** The view turn as a map: the world's frame on the canvas. */
function viewOnly() {
	return viewXf3(md.turn.value);
}
/** The canvas bounds of what is chosen (a picked part, or the part of the chosen shape); of everything when nothing is. */
export function chosenBounds(): { lo: Vec2; hi: Vec2; depth: number } | null {
	const only = md.sel.value ? md.sel.value.part : md.partPicked.value ? md.curPart.value : -1;
	const of = (index: number) => {
		let lo: Vec2 = [Infinity, Infinity];
		let hi: Vec2 = [-Infinity, -Infinity];
		let depth = 0;
		let n = 0;
		const take = (p: Vec2) => {
			lo = [Math.min(lo[0], p[0]), Math.min(lo[1], p[1])];
			hi = [Math.max(hi[0], p[0]), Math.max(hi[1], p[1])];
		};
		for (const fp of frameParts()) {
			if (index >= 0 && fp.index !== index) continue;
			for (const f of fp.shapes) {
				const sh = f.shape;
				if (sh.kind === "poly") sh.points.forEach(take);
				else if (sh.kind === "circle") {
					take([sh.at[0] - sh.r, sh.at[1] - sh.r]);
					take([sh.at[0] + sh.r, sh.at[1] + sh.r]);
				} else if (sh.kind === "line") {
					take(sh.a);
					take(sh.b);
				}
				depth += f.depth;
				n++;
			}
		}
		return n && Number.isFinite(lo[0]) ? { lo, hi, depth: depth / n } : null;
	};
	return (only >= 0 ? of(only) : null) ?? of(-1);
}

// what the view turns about: the middle of what is chosen, fixed in the
// world for as long as one orbit lasts (a drag, or a run of wheel events)
let pivot: Vec3 | null = null;
let pivotAt = 0;
function orbitPivot(): Vec3 {
	const now = performance.now();
	if (!pivot || now - pivotAt > 350) {
		const b = chosenBounds();
		pivot = b ? xf3Apply(xf3Invert(viewOnly()), [(b.lo[0] + b.hi[0]) / 2, (b.lo[1] + b.hi[1]) / 2, b.depth]) : [0, 0, 0];
	}
	pivotAt = now;
	return pivot;
}
/** A new orbit starts: its pivot is taken afresh. */
export function orbitStart() {
	pivot = null;
}

/**
 * Orbit by a pointer movement in pixels. The view turns about the middle
 * of what is chosen, which stays where it is on the canvas.
 */
export function orbitDrag(dxPx: number, dyPx: number, free = false) {
	const p = orbitPivot();
	const before = xf3Apply(viewOnly(), p);
	orbit(-dxPx * 0.008, dyPx * 0.008, free);
	const after = xf3Apply(viewOnly(), p);
	const [px, py] = view.pan.value;
	view.pan.value = [px + after[0] - before[0], py + after[1] - before[1]];
}

// ------------------------------------------------------------- pipes

/** The points of the selected pipe's path, projected: its handles. */
export function pipeHandles(): { i: number; at: Vec2 }[] {
	const s = md.sel.value;
	const sh = selShape();
	const fp = s ? framePartOf(s.part) : undefined;
	if (!s || !fp || fp.part.like || !isPipe(sh)) return [];
	return (sh.path?.points ?? []).map((p, i) => ({ i, at: viewPoint(fp, p) }));
}

/**
 * Where a click of the pipe tool lands, in the current part's rest
 * space: on the surface under the pointer, lifted along its normal,
 * when "on surface" is on and something is there; else on the view
 * plane through the part's origin (through the last point, once there
 * is one).
 */
export function pipePointAt(wm: Vec2, skip: Sel3[] = [], depth?: number): Vec3 {
	const i = md.sel.value && skip.length ? md.sel.value.part : md.curPart.value;
	if (md.onSurface.value) {
		const hit = surfaceUnder(wm, skip);
		if (hit) {
			const k = md.lift.value;
			return viewToRest(i, [hit.at[0] + hit.n[0] * k, hit.at[1] + hit.n[1] * k, hit.at[2] + hit.n[2] * k]);
		}
	}
	return viewToRest(i, [wm[0], wm[1], depth ?? originDepth(i)]);
}
/** How deep a part's own origin (its pivot) lies under the view: the plane a pipe's first point lands on. */
function originDepth(partIndex: number): number {
	const fp = framePartOf(partIndex);
	return fp ? xf3Apply(fp.F, fp.part.pivot ?? [0, 0, 0])[2] : 0;
}
// the surface's normal (in view space) where each point of the pipe being clicked landed; null for one on the view plane
let pipeNormals: (Vec3 | null)[] = [];

/**
 * Between two clicks on a surface a straight run would cut through a
 * curved one (or float off it). So each run is looked at in its middle:
 * where the surface there is, lifted as the clicks were; a point is put
 * in when the pipe would otherwise miss it by more than a little. Twice
 * over, so a long run over a dome gets up to three.
 */
function hugSurface(pts: Vec3[], normals: (Vec3 | null)[], partIndex: number): Vec3[] {
	const fp = framePartOf(partIndex);
	if (!fp) return pts;
	let P = pts.map((p) => xf3Apply(fp.F, p));
	let N = [...normals];
	const lift = md.lift.value;
	for (let pass = 0; pass < 2 && P.length < 24; pass++) {
		const nextP: Vec3[] = [];
		const nextN: (Vec3 | null)[] = [];
		for (let i = 0; i < P.length; i++) {
			nextP.push(P[i]);
			nextN.push(N[i]);
			const a = P[i];
			const b = P[i + 1];
			const na = N[i];
			const nb = N[i + 1];
			if (!b || !na || !nb) continue;
			const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
			const out = [na[0] + nb[0], na[1] + nb[1], na[2] + nb[2]];
			const l = Math.hypot(out[0], out[1], out[2]);
			const run = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
			if (l < 1e-6 || run < 1e-6) continue;
			const hit = surfaceBelow(mid, [out[0] / l, out[1] / l, out[2] / l], run * 2);
			if (!hit) continue;
			const q: Vec3 = [hit.at[0] + hit.n[0] * lift, hit.at[1] + hit.n[1] * lift, hit.at[2] + hit.n[2] * lift];
			// the run already lies along the surface there: no point is needed
			if (Math.hypot(q[0] - mid[0], q[1] - mid[1], q[2] - mid[2]) < Math.max(0.04, run * 0.05)) continue;
			nextP.push(q);
			nextN.push(hit.n);
		}
		if (nextP.length === P.length) break;
		P = nextP;
		N = nextN;
	}
	return P.map((p) => viewToRest(partIndex, p));
}

/** The depth the pipe being clicked is at: its last point's, on the canvas. */
function pipeDepth(): number | undefined {
	const pts = md.pipePts.value;
	const fp = framePartOf(md.curPart.value);
	return pts.length && fp ? xf3Apply(fp.F, pts[pts.length - 1])[2] : undefined;
}
/** Finish the pipe being clicked: a sweep along its points, as wide as half the depth field (a rod's width). */
export function pipeClose() {
	const clicked = md.pipePts.value;
	md.pipePts.value = [];
	if (clicked.length < 2) return;
	// drawn on a surface, it follows the surface between the clicks too
	const pts = md.onSurface.value && pipeNormals.length === clicked.length ? hugSurface(clicked, pipeNormals, md.curPart.value) : clicked;
	pipeNormals = [];
	try {
		addPipe(md.curPart.value, pts, { radius: Math.max(0.05, md.thick.value / 4), round: pts.length >= 3, twin: md.pipeTwin.value });
		md.tool.value = "select";
	} catch (e) {
		proj.error.value = e instanceof MeshError ? e.message : String(e);
	}
}

// ------------------------------------------------------------- pointer

/**
 * A press on the selected mesh, by what clicks choose: a corner, an edge
 * or a face under the pointer is chosen (Shift adds it, or takes it
 * out), and with `drag` the press goes on to move what is chosen. False
 * when nothing of the mesh is there.
 */
function elementDown(wm: Vec2, mods: Mods, drag: boolean): boolean {
	const mode = md.pick.value;
	ix3.elem = false;
	if (mode === "corner") {
		// of the corners under the pointer, the one nearest the viewer
		const mv = meshView();
		let got: number | null = null;
		for (const h of vertexHandles()) {
			if (dist(wm, h.at) >= px(7)) continue;
			if (got === null || (mv && mv.points[h.i][2] < mv.points[got][2])) got = h.i;
		}
		if (got !== null) {
			const prev = md.vert.value;
			const chosen = md.verts.value;
			if (mods.shift) {
				// Shift adds a corner to what is chosen, or takes it out; a neighbour of the last one chooses the edge between them too (for its crease)
				if (chosen.includes(got)) {
					chooseVerts(chosen.filter((v) => v !== got));
					md.edge.value = null;
				} else {
					chooseVerts([...chosen, got]);
					md.edge.value = prev !== null && md.sel.value && isEdge(selShape()!, prev, got) ? [prev, got] : null;
				}
				return true;
			}
			// a plain click on one of several keeps them all, to drag together
			if (!chosen.includes(got)) {
				md.edge.value = null;
				chooseVerts([got]);
			} else md.vert.value = got;
			if (drag) {
				ix3.vertex = got;
				ix3.dragging = true;
				ix3.dragLast = wm;
			}
			return true;
		}
	}
	if (mode === "edge") {
		const e = hitEdge(wm);
		if (e) {
			const chosen = md.edges.value;
			const member = chosen.some((x) => sameEdge(x, e));
			if (mods.shift) {
				chooseEdges(member ? chosen.filter((x) => !sameEdge(x, e)) : [...chosen, e]);
				return true;
			}
			if (!member) chooseEdges([e]);
			if (drag) {
				ix3.elem = true;
				ix3.dragging = true;
				ix3.vertex = null;
				ix3.dragLast = wm;
			}
			return true;
		}
	}
	if (mode === "face") {
		const f = hitFace(wm);
		if (f !== null) {
			const chosen = md.faces.value;
			const member = chosen.includes(f);
			if (mods.shift) {
				chooseFaces(member ? chosen.filter((x) => x !== f) : [...chosen, f]);
				return true;
			}
			if (!member) chooseFaces([f]);
			if (drag) {
				ix3.elem = true;
				ix3.dragging = true;
				ix3.vertex = null;
				ix3.dragLast = wm;
			}
			return true;
		}
	}
	return false;
}

export function onDown(wm: Vec2, mods: Mods) {
	ix3.down = true;
	ix3.mods = mods;
	ix3.cursor = wm;
	// a mesh operation following the pointer is kept by the click
	if (meshDown()) {
		ix3.down = false;
		return;
	}
	// a handle grabbed, or a keyed transform kept by the click
	// (the handles stand aside for the pipe tool and the brush, which click on the mesh they sit over)
	const busyTool = md.tool.value === "pipe" || md.painting.value;
	if (md.pending.value === "none" && !busyTool && gizmoDown(wm)) return;
	if (md.pending.value === "pivot") {
		const i = md.curPart.value;
		const fp = framePartOf(i);
		if (fp) setPivot(i, viewToRest(i, [wm[0], wm[1], xf3Apply(fp.F, parts()[i].pivot ?? [0, 0, 0])[2]]));
		md.pending.value = "none";
		ix3.down = false;
		return;
	}
	const preview = !!curClip();
	const tool = md.tool.value;
	if (tool === "pipe" && !preview) {
		// a click adds a point to the path; a click on the last one finishes it
		const pts = md.pipePts.value;
		const fp = framePartOf(md.curPart.value);
		if (pts.length >= 2 && fp && dist(wm, viewPoint(fp, pts[pts.length - 1])) < px(9)) return pipeClose();
		if (pipeNormals.length !== pts.length) pipeNormals = pts.map(() => null);
		pipeNormals.push(md.onSurface.value ? (surfaceUnder(wm)?.n ?? null) : null);
		md.pipePts.value = [...pts, pipePointAt(md.onSurface.value ? wm : snapPt(wm), [], pipeDepth())];
		ix3.down = false;
		return;
	}
	if (tool !== "select" && !preview) {
		const p = snapPt(wm);
		if (tool === "poly") {
			const pts = md.polyPts.value;
			if (pts.length >= 3 && dist(p, pts[0]) < px(10)) return polyClose();
			md.polyPts.value = [...pts, p];
			return;
		}
		ix3.drawing = true;
		ix3.drawA = p;
		return;
	}
	// the pivot and its lever, for the current part (in a clip, the key's pose: see editPose)
	const pl = pivotLever();
	if (pl && poseOfCur()) {
		if (dist(wm, pl.lever) < px(8)) {
			ix3.poseRot = true;
			ix3.poseAng0 = Math.atan2(wm[1] - pl.at[1], wm[0] - pl.at[0]);
			return;
		}
		if (dist(wm, pl.at) < px(9)) {
			ix3.poseDrag = true;
			ix3.dragLast = wm;
			return;
		}
	}
	// painting by brush: the face under the pointer takes the colour, and so does every face the drag crosses
	if (!preview && md.painting.value && md.sel.value && selShape()?.kind === "mesh") {
		ix3.brushing = true;
		const f = hitFace(wm);
		if (f !== null) brushFace(md.sel.value, f);
		return;
	}
	// a point of the selected pipe's path: chosen, and dragged
	if (!preview && md.sel.value) {
		const got = pipeHandles().find((h) => dist(wm, h.at) < px(8));
		if (got) {
			md.pipePt.value = got.i;
			ix3.pipeDrag = got.i;
			ix3.dragLast = wm;
			return;
		}
	}
	// a corner, an edge or a face of the selected mesh, by what clicks choose
	if (!preview && elementDown(wm, mods, true)) return;
	// in a clip the rig poses the key under the playhead: a joint drags to move, a part turns about its pivot (a root, or ⌥, moves)
	if (preview) {
		md.playing.value = false;
		const j = jointAt(wm);
		const hit = j < 0 ? pick(wm) : null;
		const i = j >= 0 ? j : (hit?.part ?? -1);
		if (i < 0) {
			md.sel.value = null;
			md.partPicked.value = false;
			return;
		}
		if (hit) selectShapes([hit]);
		else {
			md.sel.value = null;
			md.also.value = [];
		}
		md.curPart.value = i;
		md.partPicked.value = true;
		if (!poseOfCur()) return;
		const pivot = pivotLever();
		if (hit && parts()[i].parent && !mods.alt && pivot) {
			ix3.poseRot = true;
			ix3.poseAng0 = Math.atan2(wm[1] - pivot.at[1], wm[0] - pivot.at[0]);
		} else {
			ix3.poseDrag = true;
			ix3.dragLast = wm;
		}
		return;
	}
	const hit = pick(wm);
	if (hit) {
		const all = selected();
		const member = all.some((t) => sameSel(t, hit));
		// ⇧ adds a shape to what is chosen, or takes it out; a plain click on one of several keeps them all, to drag together
		if (mods.shift && all.length) selectShapes(member ? all.filter((t) => !sameSel(t, hit)) : [hit, ...all]);
		else if (member) selectShapes([hit, ...all.filter((t) => !sameSel(t, hit))]);
		else selectShapes([hit]);
		if (mods.shift && member) return;
		if (!preview) {
			ix3.dragging = true;
			ix3.vertex = null;
			ix3.dragLast = wm;
		}
		return;
	}
	if (!mods.shift) {
		// nothing under the click: the inspector shows the document
		md.sel.value = null;
		md.vert.value = null;
		md.partPicked.value = false;
	}
	// a drag on nothing is a marquee (the middle button, two fingers or Alt-drag orbit)
	ix3.marquee = true;
	ix3.marqueeA = wm;
}

/** Every shape whose outline on the canvas touches a rectangle. */
function shapesIn(lo: Vec2, hi: Vec2): Sel3[] {
	const out: Sel3[] = [];
	for (const fp of frameParts()) {
		if (fp.part.like) continue; // a part drawn like another: edit the source
		for (const f of fp.shapes) {
			if (f.outline || out.some((t) => t.part === fp.index && t.shape === f.src)) continue;
			const sh = f.shape;
			const pts: Vec2[] = sh.kind === "poly" ? sh.points : sh.kind === "circle" ? [[sh.at[0] - sh.r, sh.at[1] - sh.r], [sh.at[0] + sh.r, sh.at[1] + sh.r]] : sh.kind === "line" ? [sh.a, sh.b] : [];
			if (!pts.length) continue;
			const blo: Vec2 = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))];
			const bhi: Vec2 = [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
			if (blo[0] <= hi[0] && bhi[0] >= lo[0] && blo[1] <= hi[1] && bhi[1] >= lo[1]) out.push({ part: fp.index, shape: f.src });
		}
	}
	return out;
}

export function onMove(wm: Vec2, mods: Mods) {
	ix3.mods = mods;
	ix3.cursor = wm;
	if (meshActive()) {
		meshMove(wm, mods.shift);
		return;
	}
	if (gizmoActive()) {
		gizmoMove(wm, mods.shift);
		return;
	}
	if (!ix3.down) {
		gizmoHover(wm);
		// what a click would choose on the selected mesh
		const select = md.tool.value === "select" && !curClip();
		ix3.hoverEdge = select && md.pick.value === "edge" ? hitEdge(wm) : null;
		ix3.hoverFace = select && (md.pick.value === "face" || md.painting.value) ? hitFace(wm) : null;
		const h = md.tool.value === "select" ? pick(wm) : null;
		const cur = md.hover.value;
		if ((h?.part !== cur?.part || h?.shape !== cur?.shape) && !(h === null && cur === null)) md.hover.value = h;
		return;
	}
	if (ix3.brushing) {
		const f = md.sel.value ? hitFace(wm) : null;
		ix3.hoverFace = f;
		if (f !== null && md.sel.value) brushFace(md.sel.value, f);
		return;
	}
	if (ix3.pipeDrag !== null && md.sel.value) {
		const s = md.sel.value;
		if (md.onSurface.value) {
			// it stays on the surface: wherever the pointer is over one (the pipe itself and its twin are not surfaces to land on)
			const twin = pipeTwin(s);
			const hit = surfaceUnder(wm, twin ? [s, twin] : [s]);
			if (hit) {
				const k = md.lift.value;
				setPipePoint(s, ix3.pipeDrag, viewToRest(s.part, [hit.at[0] + hit.n[0] * k, hit.at[1] + hit.n[1] * k, hit.at[2] + hit.n[2] * k]));
				ix3.dragLast = wm;
				return;
			}
		}
		movePipePointView(s, ix3.pipeDrag, [wm[0] - ix3.dragLast[0], wm[1] - ix3.dragLast[1], 0]);
		ix3.dragLast = wm;
		return;
	}
	if (ix3.orbiting) {
		// the pan moves under an orbit that keeps its pivot still: measure on the screen, not in the world
		const pan0 = view.pan.value;
		orbitDrag((wm[0] - ix3.orbitLast[0]) * z(), (wm[1] - ix3.orbitLast[1]) * z(), !!mods.cmd);
		// the pointer has not moved on the screen, but the world slid under it with the pan
		ix3.orbitLast = [wm[0] + view.pan.value[0] - pan0[0], wm[1] + view.pan.value[1] - pan0[1]];
		return;
	}
	if (ix3.poseRot) {
		const pl = pivotLever();
		const sp = poseOfCur();
		const ax = viewAxisInParent();
		if (!pl || !sp || !ax) return;
		const a = Math.atan2(wm[1] - pl.at[1], wm[0] - pl.at[0]);
		let d = a - ix3.poseAng0;
		if (d > Math.PI) d -= Math.PI * 2;
		if (d < -Math.PI) d += Math.PI * 2;
		if (mods.shift) d = Math.round(d / (Math.PI / 12)) * (Math.PI / 12);
		if (d === 0) return;
		turnPose(sp, ax.axis, d * ax.sign, "pose-rot");
		ix3.poseAng0 = a;
		return;
	}
	if (ix3.poseDrag) {
		const sp = poseOfCur();
		const p = curPart();
		if (!sp || !p) return;
		const d: Vec2 = [wm[0] - ix3.dragLast[0], wm[1] - ix3.dragLast[1]];
		if (d[0] === 0 && d[1] === 0) return; // a pointer that has not moved changes nothing
		ix3.dragLast = wm;
		// the offset lives in the parent's rest frame: undo the parent's view map on the displacement
		const parentIdx = p.parent ? parts().findIndex((q) => q.name === p.parent) : -1;
		const P = parentIdx >= 0 ? framePartOf(parentIdx)?.F : undefined;
		const inv = xf3Invert(P ?? viewOnly());
		const dr = xf3ApplyDir(inv, [d[0], d[1], 0]);
		const o = sp.offset ?? p.pivot ?? [0, 0, 0];
		setPose(sp, { offset: [o[0] + dr[0], o[1] + dr[1], o[2] + dr[2]].map((x) => Math.round(x * 1000) / 1000) as Vec3 }, "pose-move");
		return;
	}
	if (ix3.dragging && md.sel.value) {
		const d: Vec3 = [wm[0] - ix3.dragLast[0], wm[1] - ix3.dragLast[1], 0];
		ix3.dragLast = wm;
		if (ix3.vertex !== null) moveVertexView(md.sel.value, ix3.vertex, d);
		else if (ix3.elem) moveChosenView(md.sel.value, d);
		else for (const s of selected()) moveSelView(s, d);
	}
}

export function onUp(wm: Vec2, mods: Mods) {
	ix3.down = false;
	ix3.mods = mods;
	const g = gizmoUp();
	if (g === "click") {
		// a click on a handle, not a drag: what lies under it is what was meant, a corner, an edge or a face of the selected mesh first
		if (!curClip() && md.tool.value === "select" && elementDown(wm, mods, false)) return;
		const hit = pick(wm);
		if (hit) {
			md.sel.value = hit;
			md.vert.value = null;
			md.curPart.value = hit.part;
			md.partPicked.value = true;
		}
	}
	if (g) return;
	if (ix3.brushing || ix3.pipeDrag !== null) {
		ix3.brushing = false;
		ix3.pipeDrag = null;
		endGesture();
		return;
	}
	if (ix3.marquee) {
		ix3.marquee = false;
		const a = ix3.marqueeA;
		// a press that went nowhere was a click on nothing: it has already let go of everything
		if (Math.hypot(wm[0] - a[0], wm[1] - a[1]) * z() < 3) return;
		const found = shapesIn([Math.min(a[0], wm[0]), Math.min(a[1], wm[1])], [Math.max(a[0], wm[0]), Math.max(a[1], wm[1])]);
		selectShapes(mods.shift ? [...selected(), ...found] : found);
		return;
	}
	if (ix3.orbiting) {
		ix3.orbiting = false;
	ix3.marquee = false;
		return;
	}
	if (ix3.drawing) {
		ix3.drawing = false;
		const a = ix3.drawA;
		const b = snapPt(wm);
		finishDraw(a, b, mods);
		return;
	}
	if (ix3.dragging || ix3.poseDrag || ix3.poseRot) {
		ix3.dragging = false;
		ix3.poseDrag = false;
		ix3.poseRot = false;
		ix3.vertex = null;
		ix3.elem = false;
		endGesture();
	}
}

export function cancelGesture() {
	ix3.down = false;
	ix3.marquee = false;
	ix3.drawing = false;
	ix3.dragging = false;
	ix3.poseDrag = false;
	ix3.poseRot = false;
	ix3.orbiting = false;
	ix3.brushing = false;
	ix3.pipeDrag = null;
	endGesture();
}

/** A drag with a drawing tool: a box, a ball or a rod, as deep as the depth field. */
function finishDraw(a: Vec2, b: Vec2, mods: Mods) {
	const tool = md.tool.value;
	const color = curTokName();
	const depth = workDepth();
	const thick = md.thick.value;
	const i = md.curPart.value;
	if (tool === "rect") {
		let [x0, y0, x1, y1] = [a[0], a[1], b[0], b[1]];
		if (mods.shift) {
			const s = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
			x1 = x0 + Math.sign(x1 - x0 || 1) * s;
			y1 = y0 + Math.sign(y1 - y0 || 1) * s;
		}
		if (Math.abs(x1 - x0) < 0.05 || Math.abs(y1 - y0) < 0.05) return;
		const mesh = extrudeView([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], depth, thick, color);
		if (mesh) addShape(mesh);
	} else if (tool === "circle") {
		const r = Math.max(dist(a, b), 0.1);
		addShape({ kind: "ball", color, at: viewToRest(i, [a[0], a[1], depth]), r: Math.round(r * 1000) / 1000 });
	} else if (tool === "line") {
		if (dist(a, b) < 0.05) return;
		let bb = b;
		if (mods.shift) {
			const ang = Math.round(Math.atan2(b[1] - a[1], b[0] - a[0]) / (Math.PI / 4)) * (Math.PI / 4);
			const l = dist(a, b);
			bb = [a[0] + Math.cos(ang) * l, a[1] + Math.sin(ang) * l];
		}
		addShape({ kind: "rod", color, a: viewToRest(i, [a[0], a[1], depth]), b: viewToRest(i, [bb[0], bb[1], depth]), w: Math.max(0.2, thick / 2) });
	}
}

/** Close the polygon being drawn into a prism. */
export function polyClose() {
	const pts = md.polyPts.value;
	if (pts.length < 3) return;
	const mesh = extrudeView(pts, workDepth(), md.thick.value, curTokName());
	md.polyPts.value = [];
	if (mesh) addShape(mesh);
}
export function polyEnter() {
	if (md.tool.value === "pipe") pipeClose();
	else polyClose();
}
export function escape() {
	if (meshCancel()) return;
	if (gizmoCancel()) return;
	if (md.polyPts.value.length) {
		md.polyPts.value = [];
		return;
	}
	if (md.pipePts.value.length) {
		md.pipePts.value = [];
		return;
	}
	if (md.painting.value) {
		md.painting.value = false;
		return;
	}
	if (md.pending.value !== "none") {
		md.pending.value = "none";
		return;
	}
	if (md.tool.value !== "select") {
		md.tool.value = "select";
		return;
	}
	if (md.pipePt.value !== null) {
		md.pipePt.value = null;
		return;
	}
	// the corners, edges and faces chosen on a mesh are let go before the mesh is
	if (md.sel.value && chosenPoints().length) {
		chooseVerts([]);
		chooseEdges([]);
		chooseFaces([]);
		return;
	}
	if (!md.sel.value) md.partPicked.value = false;
	md.sel.value = null;
	md.vert.value = null;
}
export function nudgeView(d: Vec2) {
	const s = md.sel.value;
	if (!s) return;
	if (md.pipePt.value !== null && isPipe(selShape())) movePipePointView(s, md.pipePt.value, [d[0], d[1], 0], "nudge");
	else if (chosenPoints().length) moveChosenView(s, [d[0], d[1], 0], "nudge");
	else for (const t of selected()) moveSelView(t, [d[0], d[1], 0], "nudge");
}

/** The frame's extents on the canvas, for zoom to fit. */
export function frameBounds(): { lo: Vec2; hi: Vec2 } | null {
	let lo: Vec2 = [Infinity, Infinity];
	let hi: Vec2 = [-Infinity, -Infinity];
	const take = (p: Vec2) => {
		lo = [Math.min(lo[0], p[0]), Math.min(lo[1], p[1])];
		hi = [Math.max(hi[0], p[0]), Math.max(hi[1], p[1])];
	};
	for (const fp of frameParts()) {
		for (const f of fp.shapes) {
			const sh = f.shape;
			if (sh.kind === "poly") sh.points.forEach(take);
			else if (sh.kind === "circle") {
				take([sh.at[0] - sh.r, sh.at[1] - sh.r]);
				take([sh.at[0] + sh.r, sh.at[1] + sh.r]);
			} else if (sh.kind === "line") {
				take(sh.a);
				take(sh.b);
			}
		}
		take(fp.pivot);
	}
	return Number.isFinite(lo[0]) ? { lo, hi } : null;
}

// ------------------------------------------------------------- render

/** The ground under the solids: the theme's bg and the grid. */
export function renderGround(ctx: CanvasRenderingContext2D, W: number, H: number, dpr: number) {
	const C = canvasColors();
	const [panx, pany] = view.pan.value;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.fillStyle = C.bg;
	ctx.fillRect(0, 0, W, H);
	drawGrid(ctx, W, H, panx, pany, view.zoom.value, C.grid, C.gridStrong);
	// a reference image pinned to this view: behind the model, over the grid, in the canvas's own units
	const rv = refViewOf(md.viewName.value);
	const ref = rv ? work.value.refs?.[rv] : undefined;
	const img = ref?.path ? refImage(project.root.value ?? "", ref.path) : null;
	if (ref && img && img.naturalWidth > 0) {
		const zoom = view.zoom.value;
		const w = ref.w * zoom;
		const h = (w * img.naturalHeight) / img.naturalWidth;
		ctx.globalAlpha = Math.max(0, Math.min(1, ref.opacity));
		ctx.drawImage(img, (ref.x - panx) * zoom + W / 2 - w / 2, (ref.y - pany) * zoom + H / 2 - h / 2, w, h);
		ctx.globalAlpha = 1;
	}
}

/**
 * The overlay above the solids: outlines, corners, the pivot and lever,
 * the rig, what is being drawn, the axes. With `paint`, the solids too
 * (the painter's fallback when there is no WebGL).
 */
export function render3(ctx: CanvasRenderingContext2D, W: number, H: number, dpr: number, paint = false) {
	const C = canvasColors();
	const ACCENT = C.accent;
	const HOVER = C.hover;
	const TEAL = C.ok;
	const LW = C.line;
	const [panx, pany] = view.pan.value;
	const zoom = view.zoom.value;
	const world = () => ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, (W / 2 - panx * zoom) * dpr, (H / 2 - pany * zoom) * dpr);
	const screen = () => ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	const toS = (p: Vec2): Vec2 => [(p[0] - panx) * zoom + W / 2, (p[1] - pany) * zoom + H / 2];

	screen();
	ctx.clearRect(0, 0, W, H);

	const tokens = md.tokens.value;
	const fps = frameParts();
	const chosen = selected();
	const hov = md.hover.value;
	const preview = !!curClip();

	world();
	let selShapes: Shape[] = [];
	let hovShapes: Shape[] = [];
	// one painter's order for the whole frame: faces of different parts interleave by depth
	const faces = fps.flatMap((fp) => fp.shapes.map((f) => ({ fp, f }))).sort((p, q) => q.f.depth - p.f.depth);
	for (const { fp, f } of faces) {
		const css = f.outline ? C.text2 : cssColor(shadeColor(colorOf(tokens, f.shape.color ?? ""), f.shape.shade));
		if (paint || f.outline) fillShape(ctx, f.shape, css);
		const srcIndex = fp.part.like ? -1 : fp.index;
		// a smooth mesh or a sweep (1.7) has too many faces to outline one by one: its cage wire marks it instead
		const src = fp.solids[f.src];
		// (and so has one with modifiers, 1.8: what is drawn is not the cage the hand edits)
		const quiet = !!src && (src.kind === "sweep" || (src.kind === "mesh" && ((src.smooth ?? 0) > 0 || !!src.mods?.length)));
		if (!f.outline && !quiet && chosen.some((t) => t.part === srcIndex && t.shape === f.src)) selShapes.push(f.shape);
		if (hov && hov.part === srcIndex && hov.shape === f.src && !f.outline && !quiet) hovShapes.push(f.shape);
	}
	// the rig: a bone from each child's pivot to its parent's
	screen();
	ctx.strokeStyle = C.accentSoft;
	ctx.lineWidth = LW;
	ctx.setLineDash([3, 3]);
	for (const fp of fps) {
		if (!fp.part.parent) continue;
		const parent = fps.find((q) => q.part.name === fp.part.parent);
		if (!parent) continue;
		const a = toS(fp.pivot);
		const b = toS(parent.pivot);
		ctx.beginPath();
		ctx.moveTo(a[0], a[1]);
		ctx.lineTo(b[0], b[1]);
		ctx.stroke();
	}
	ctx.setLineDash([]);
	if (preview) {
		// posing a key: every joint is a grip
		ctx.strokeStyle = C.accentSoft;
		ctx.fillStyle = C.handleFill;
		const seen = new Set<number>();
		for (const fp of fps) {
			if (seen.has(fp.index)) continue;
			seen.add(fp.index);
			const s = toS(fp.pivot);
			ctx.beginPath();
			ctx.arc(s[0], s[1], 4, 0, Math.PI * 2);
			ctx.fill();
			ctx.stroke();
		}
	}

	world();
	for (const sh of hovShapes) if (!selShapes.includes(sh)) outlineShape(ctx, sh, HOVER, LW, zoom);
	for (const sh of selShapes) outlineShape(ctx, sh, ACCENT, 1.5 * LW, zoom);

	// the selected mesh, for editing: its wire, what is chosen on it, what a click would choose, its corners
	const mv = preview ? null : meshView();
	const selP = selShapePosed();
	if (mv && selP && selP.kind === "mesh") {
		const mode = md.pick.value;
		// a cage that is not what is drawn: subdivided (1.7), or under modifiers (1.8)
		const smooth = (selP.smooth ?? 0) > 0 || !!selP.mods?.length;
		const at = mv.points.map((p) => toS([p[0], p[1]]));
		const line = (a: number, b: number) => {
			ctx.beginPath();
			ctx.moveTo(at[a][0], at[a][1]);
			ctx.lineTo(at[b][0], at[b][1]);
			ctx.stroke();
		};
		const trace = (f: readonly number[]) => {
			ctx.beginPath();
			f.forEach((i, k) => (k === 0 ? ctx.moveTo(at[i][0], at[i][1]) : ctx.lineTo(at[i][0], at[i][1])));
			ctx.closePath();
		};
		screen();
		ctx.lineJoin = "round";
		// the cage: the control polygon the corners belong to, drawn over a smooth surface (1.7) and whenever edges or faces are being chosen
		if (smooth || mode !== "corner") {
			ctx.strokeStyle = C.accentSoft;
			ctx.lineWidth = LW;
			ctx.setLineDash(smooth ? [3, 3] : []);
			for (const f of mv.faces) {
				trace(f);
				ctx.stroke();
			}
			ctx.setLineDash([]);
		}
		// creased edges read as such while edges are being chosen
		if (mode === "edge") {
			ctx.strokeStyle = TEAL;
			ctx.lineWidth = 2 * LW;
			for (const cr of selP.creases ?? []) if (cr.length === 3 && at[cr[0]] && at[cr[1]]) line(cr[0], cr[1]);
		}
		// under symmetry, the plane the mesh mirrors across: the cage's points that lie on it, joined
		if (md.sel.value && symmetryOf(md.sel.value)) {
			const on = selP.points.map((p, i) => (Math.abs(p[0]) < 1e-3 ? i : -1)).filter((i) => i >= 0);
			ctx.strokeStyle = C.axisX;
			ctx.lineWidth = LW;
			ctx.setLineDash([6, 4]);
			for (const f of mv.faces) {
				f.forEach((a, k) => {
					const b = f[(k + 1) % f.length];
					if (a < b && on.includes(a) && on.includes(b)) line(a, b);
				});
			}
			ctx.setLineDash([]);
		}
		if (mode === "face") {
			const hf = ix3.hoverFace;
			if (hf !== null && mv.faces[hf] && !md.faces.value.includes(hf)) {
				trace(mv.faces[hf]);
				if (md.painting.value) {
					// the brush shows what it would lay down
					ctx.globalAlpha = 0.45;
					ctx.fillStyle = cssColor(colorOf(tokens, paintToken()));
					ctx.fill();
					ctx.globalAlpha = 1;
				}
				ctx.strokeStyle = HOVER;
				ctx.lineWidth = 1.5 * LW;
				ctx.stroke();
			}
			for (const fi of md.faces.value) {
				const f = mv.faces[fi];
				if (!f) continue;
				trace(f);
				ctx.fillStyle = C.marquee;
				ctx.fill();
				ctx.strokeStyle = ACCENT;
				ctx.lineWidth = 2 * LW;
				ctx.stroke();
			}
		}
		// the chosen edges (in corner mode, the one Shift-click chose for its crease)
		const he = ix3.hoverEdge;
		if (mode === "edge" && he && at[he[0]] && at[he[1]]) {
			ctx.strokeStyle = HOVER;
			ctx.lineWidth = 2.5 * LW;
			line(he[0], he[1]);
		}
		ctx.strokeStyle = ACCENT;
		ctx.lineWidth = 3 * LW;
		ctx.lineCap = "round";
		for (const e of md.edges.value) if (at[e[0]] && at[e[1]]) line(e[0], e[1]);
		ctx.lineCap = "butt";
		// the corners: handles to drag, filled when chosen
		const chosenCorners = new Set(mode === "corner" ? md.verts.value : []);
		const quiet = mode !== "corner";
		for (let i = 0; i < at.length; i++) {
			const p = at[i];
			const r = quiet ? 2 : 3.5;
			ctx.fillStyle = chosenCorners.has(i) ? ACCENT : C.handleFill;
			ctx.strokeStyle = ACCENT;
			ctx.lineWidth = LW;
			ctx.beginPath();
			ctx.rect(p[0] - r, p[1] - r, r * 2, r * 2);
			ctx.fill();
			ctx.stroke();
		}
	}

	// the selected pipe (1.8): its path through its points, each a handle to drag
	const ph = preview ? [] : pipeHandles();
	if (ph.length) {
		screen();
		const at = ph.map((h) => toS(h.at));
		ctx.strokeStyle = C.accentSoft;
		ctx.lineWidth = LW;
		ctx.setLineDash([3, 3]);
		ctx.beginPath();
		at.forEach((p, k) => (k === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])));
		if (isPipe(selP) && selP.closed) ctx.closePath();
		ctx.stroke();
		ctx.setLineDash([]);
		for (const h of ph) {
			const p = toS(h.at);
			ctx.fillStyle = md.pipePt.value === h.i ? ACCENT : C.handleFill;
			ctx.strokeStyle = ACCENT;
			ctx.lineWidth = LW;
			ctx.beginPath();
			ctx.rect(p[0] - 4, p[1] - 4, 8, 8);
			ctx.fill();
			ctx.stroke();
		}
	}
	// a pipe being clicked: its points so far, and where the next would land
	const pipePts = md.pipePts.value;
	if (md.tool.value === "pipe" && !preview) {
		const fp = framePartOf(md.curPart.value);
		if (fp) {
			screen();
			const at = pipePts.map((p) => toS(viewPoint(fp, p)));
			const next = ix3.cursor ? toS(viewPoint(fp, pipePointAt(ix3.cursor, [], pipePts.length ? xf3Apply(fp.F, pipePts[pipePts.length - 1])[2] : undefined))) : null;
			const all = next ? [...at, next] : at;
			if (all.length > 1) {
				ctx.strokeStyle = cssColor(colorOf(tokens, curTokName()));
				ctx.lineWidth = Math.max(2, (md.thick.value / 2) * zoom);
				ctx.lineCap = "round";
				ctx.lineJoin = "round";
				ctx.globalAlpha = 0.55;
				ctx.beginPath();
				all.forEach((p, k) => (k === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])));
				ctx.stroke();
				ctx.globalAlpha = 1;
				ctx.lineCap = "butt";
			}
			for (const p of at) {
				ctx.fillStyle = C.handleFill;
				ctx.strokeStyle = ACCENT;
				ctx.lineWidth = LW;
				ctx.beginPath();
				ctx.rect(p[0] - 3.5, p[1] - 3.5, 7, 7);
				ctx.fill();
				ctx.stroke();
			}
			if (next) {
				// on a surface the landing point wears a ring; on the view plane, a plain dot
				ctx.strokeStyle = ACCENT;
				ctx.fillStyle = ACCENT;
				ctx.lineWidth = 1.5 * LW;
				ctx.beginPath();
				ctx.arc(next[0], next[1], md.onSurface.value && ix3.cursor && surfaceUnder(ix3.cursor) ? 6 : 2.5, 0, Math.PI * 2);
				if (md.onSurface.value && ix3.cursor && surfaceUnder(ix3.cursor)) ctx.stroke();
				else ctx.fill();
			}
		}
	}

	// the collision solids, posed with the frame: wireframes coloured by layer (1.4)
	if (md.collide.value) {
		const V = viewOnly();
		const layerColor = (layer: string) => (layer === "solid" ? TEAL : layer === "surface" ? ACCENT : layer === "trigger" ? C.text2 : C.hover);
		screen();
		ctx.lineWidth = LW;
		ctx.font = "10px system-ui, sans-serif";
		for (const c of collisionWorld3(md.doc.value, frame())) {
			const col = layerColor(c.layer);
			ctx.strokeStyle = col;
			ctx.fillStyle = col;
			ctx.setLineDash(c.layer === "trigger" ? [4, 3] : []);
			const vp = (p: Vec3): Vec2 => {
				const v = xf3Apply(V, p);
				return toS([v[0], v[1]]);
			};
			let label: Vec2;
			if (c.kind === "ball") {
				const s = vp(c.at);
				ctx.beginPath();
				ctx.arc(s[0], s[1], c.r * zoom, 0, Math.PI * 2);
				ctx.stroke();
				label = [s[0] + c.r * zoom + 3, s[1]];
			} else if (c.kind === "rod") {
				const a = vp(c.a);
				const b = vp(c.b);
				ctx.lineWidth = Math.max(LW, c.w * zoom);
				ctx.globalAlpha = 0.35;
				ctx.lineCap = "round";
				ctx.beginPath();
				ctx.moveTo(a[0], a[1]);
				ctx.lineTo(b[0], b[1]);
				ctx.stroke();
				ctx.globalAlpha = 1;
				ctx.lineWidth = LW;
				label = [(a[0] + b[0]) / 2 + 4, (a[1] + b[1]) / 2];
			} else {
				const pts = c.points.map(vp);
				const drawn = new Set<string>();
				for (const f of c.faces) {
					for (let i = 0; i < f.length; i++) {
						const a = f[i];
						const b = f[(i + 1) % f.length];
						const k = a < b ? `${a}:${b}` : `${b}:${a}`;
						if (drawn.has(k)) continue;
						drawn.add(k);
						ctx.beginPath();
						ctx.moveTo(pts[a][0], pts[a][1]);
						ctx.lineTo(pts[b][0], pts[b][1]);
						ctx.stroke();
					}
				}
				const top = pts.reduce((m, p) => (p[1] < m[1] ? p : m), pts[0]);
				label = [top[0] + 3, top[1] - 3];
			}
			ctx.setLineDash([]);
			ctx.fillText(`${c.layer}${c.part ? " · " + c.part : ""}`, label[0], label[1]);
		}
	}

	// the marquee: every shape it touches is chosen
	if (ix3.marquee && ix3.cursor) {
		screen();
		const a = toS(ix3.marqueeA);
		const b = toS(ix3.cursor);
		ctx.fillStyle = C.marquee;
		ctx.strokeStyle = ACCENT;
		ctx.lineWidth = LW;
		ctx.beginPath();
		ctx.rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
		ctx.fill();
		ctx.stroke();
	}

	// the axis handles of what is chosen: arrows to move, rings to turn
	if (md.tool.value !== "pipe" && !md.painting.value) {
		screen();
		drawGizmo(ctx, toS);
	}

	// the current part's pivot and lever
	const pl = pivotLever();
	if (pl && (!preview || md.partPicked.value)) {
		screen();
		const a = toS(pl.at);
		const l = toS(pl.lever);
		ctx.strokeStyle = ACCENT;
		ctx.lineWidth = LW;
		ctx.beginPath();
		ctx.moveTo(a[0], a[1]);
		ctx.lineTo(l[0], l[1]);
		ctx.stroke();
		ctx.fillStyle = ACCENT;
		ctx.beginPath();
		ctx.arc(l[0], l[1], 4, 0, Math.PI * 2);
		ctx.fill();
		ctx.beginPath();
		ctx.arc(a[0], a[1], 6, 0, Math.PI * 2);
		ctx.strokeStyle = ACCENT;
		ctx.lineWidth = 1.5 * LW;
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(a[0] - 9, a[1]);
		ctx.lineTo(a[0] + 9, a[1]);
		ctx.moveTo(a[0], a[1] - 9);
		ctx.lineTo(a[0], a[1] + 9);
		ctx.lineWidth = LW;
		ctx.stroke();
	}

	// what is being drawn
	const cur = ix3.cursor;
	const tool = md.tool.value;
	const css = cssColor(colorOf(tokens, curTokName()));
	world();
	if (ix3.drawing && cur) {
		const a = ix3.drawA;
		const b = snapPt(cur);
		ctx.globalAlpha = 0.6;
		if (tool === "rect") fillShape(ctx, { kind: "poly", points: [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]] }, css);
		else if (tool === "circle") fillShape(ctx, { kind: "circle", at: a, r: dist(a, b) }, css);
		else if (tool === "line") fillShape(ctx, { kind: "line", a, b, w: Math.max(0.2, md.thick.value / 2) }, css);
		ctx.globalAlpha = 1;
	}
	const pts = md.polyPts.value;
	if (pts.length) {
		const all = cur ? [...pts, snapPt(cur)] : pts;
		ctx.globalAlpha = 0.5;
		if (all.length >= 3) {
			tracePoly(ctx, all, (p) => p);
			ctx.fillStyle = css;
			ctx.fill();
		}
		ctx.globalAlpha = 1;
		ctx.strokeStyle = ACCENT;
		ctx.lineWidth = LW / zoom;
		tracePoly(ctx, all, (p) => p);
		ctx.stroke();
		screen();
		const first = toS(pts[0]);
		ctx.fillStyle = pts.length >= 3 && cur && dist(cur, pts[0]) < px(10) ? ACCENT : css;
		ctx.beginPath();
		ctx.arc(first[0], first[1], 5, 0, Math.PI * 2);
		ctx.fill();
	}

	// the axes: which way the model is turned
	screen();
	const V = viewOnly();
	const o: Vec2 = [46, H - 46];
	const axes: [Vec3, string, string][] = [
		[[1, 0, 0], "x", "#d9534f"],
		[[0, 1, 0], "y", "#5cb85c"],
		[[0, 0, 1], "z", "#5b9bd5"],
	];
	ctx.font = "10px system-ui, sans-serif";
	for (const [d, name, color] of axes) {
		const v = xf3ApplyDir(V, d);
		const e: Vec2 = [o[0] + v[0] * 26, o[1] + v[1] * 26];
		ctx.strokeStyle = color;
		ctx.globalAlpha = v[2] > 0 ? 0.45 : 1;
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo(o[0], o[1]);
		ctx.lineTo(e[0], e[1]);
		ctx.stroke();
		ctx.fillStyle = color;
		ctx.fillText(name, e[0] + v[0] * 6 - 3, e[1] + v[1] * 6 + 3);
		ctx.globalAlpha = 1;
	}
	void TEAL;
}
