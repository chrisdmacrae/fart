// Sculpting on the model canvas: a press on the selected mesh begins a
// stroke and the drag lays dabs along it, spaced by the radius (or one
// per move), the brush trailing the pointer when Stabilize is on. ⌘
// held turns the brush the other way, ⇧ smooths, a pen's pressure is the
// strength. F sizes the brush and ⇧F sets its strength, the pointer
// saying how much (a click or Return keeps, Esc puts back); the brushes
// are on their letters, as in Blender. The geometry is state/sculpt.ts.

import { signal } from "@preact/signals";
import { xf3Apply, xf3ApplyDir, xf3Invert, xf3Det, type Vec2, type Vec3, type Xf3 } from "@fastart/core";
import { view } from "./view.ts";
import { md, framePartOf, endGesture, type Sel3 } from "../state/model.ts";
import { castRay, soupOf, soupTris, triNormal, type V3 } from "../state/surfaceops.ts";
import { beginStroke, dab, brushInfo, type Brush, type Stroke } from "../state/sculpt.ts";
import { sculpt, setSculpt, setBrush, strengthOf, falloffOf, autoSmoothOf, setBrushField, symOf, maskOf, setMask, maskRev, maskAct, sculptPoints, writePoints, setSculpting } from "../state/sculpting.ts";

export interface SculptMods {
	shift: boolean;
	cmd?: boolean;
	/** a pen's pressure, 0 to 1; absent for a mouse */
	pressure?: number;
}

interface Live {
	s: Sel3;
	stroke: Stroke;
	F: Xf3;
	inv: Xf3;
	/** rest units per view unit */
	scale: number;
	/** where the stroke began, where the brush is (trailing the pointer), where the last dab went: view space */
	start: Vec2;
	brush: Vec2;
	last: Vec2;
	/** the last surface point hit, view space, and its normal */
	hit: { at: Vec3; n: Vec3 };
	/** rotate: the pointer's bearing from the start when it first moved off, and the turn since */
	a0?: number;
	aPrev?: number;
	angle: number;
}
let live: Live | null = null;

/** F or ⇧F under way: the ring's middle stays put and the pointer's distance from it is the amount. */
interface Adjust {
	what: "radius" | "strength";
	centre: Vec2;
	was: number;
}
export const sculptAdjust = signal<Adjust | null>(null);

export const sculptActive = () => live !== null || waiting !== null;
const zoom = () => view.zoom.value;

/**
 * The selected mesh's surface under a canvas point (view space), from
 * the points given (rest space): the nearest face, its normal turned
 * toward the viewer, `back` saying it was wound the other way (a mesh
 * inside out, an open sheet seen from behind).
 */
function hitOn(points: readonly V3[], faces: readonly (readonly number[])[], F: Xf3, wm: Vec2): { at: Vec3; n: Vec3; back: boolean } | null {
	const pts = points.map((p) => xf3Apply(F, p) as V3);
	const flip = xf3Det(F) < 0;
	const soup = soupOf(new Float64Array(soupTris(pts, flip ? faces.map((f) => [...f].reverse()) : faces)));
	const o: V3 = [wm[0], wm[1], -1e5];
	// the nearest surface is what shows, whichever way it is wound
	const hit = castRay(soup, o, [0, 0, 1], Infinity, false);
	if (!hit) return null;
	const n = triNormal(soup, hit.tri);
	// (z runs away from the viewer: a face looks toward the viewer when its normal's z is negative)
	const back = n[2] > 0;
	return { at: [wm[0], wm[1], -1e5 + hit.t], n: back ? [-n[0], -n[1], -n[2]] : n, back };
}

/** The radius in the view's units, from the pixels it is set in. */
const viewRadius = () => sculpt.value.radius / zoom();

/** A press that has not reached the mesh yet: the stroke begins where the drag first crosses it. */
let waiting: SculptMods | null = null;

/**
 * A press with sculpt mode on and a mesh selected is always a stroke
 * (true), as in Blender: over the mesh it begins at once, off it it
 * begins where the drag first reaches the mesh. The view orbits by the
 * middle button, ⌥-drag or two fingers, never by a plain press, so a
 * trackpad's click sculpts. False when there is nothing to sculpt.
 */
export function sculptDown(wm: Vec2, mods: SculptMods): boolean {
	if (sculptAdjust.value) {
		sculptAdjust.value = null;
		return true;
	}
	if (!md.sel.value || !sculptPoints()) return false;
	waiting = null;
	if (!begin(wm, mods)) waiting = mods;
	return true;
}

/** Begin a stroke at a canvas point, when the selected mesh is under it. */
function begin(wm: Vec2, mods: SculptMods): boolean {
	const s = md.sel.value;
	const fp = s ? framePartOf(s.part) : undefined;
	const m = sculptPoints();
	if (!s || !fp || !m) return false;
	const hit = hitOn(m.points, m.faces, fp.F, wm);
	if (!hit) return false;
	const inv = xf3Invert(fp.F);
	const scale = Math.cbrt(Math.abs(xf3Det(inv))) || 1;
	const set = sculpt.value;
	const kind = set.brush;
	const toViewer = xf3ApplyDir(inv, [0, 0, -1]);
	const l = Math.hypot(toViewer[0], toViewer[1], toViewer[2]) || 1;
	// a mesh wound inside out where the stroke begins: its faces are taken turned over, so "out" is toward the viewer
	const faces = hit.back ? m.faces.map((f) => [...f].reverse()) : m.faces;
	const stroke = beginStroke(m.points, faces, {
		brush: kind,
		radius: viewRadius() * scale,
		strength: strengthOf(kind) * (mods.pressure ?? 1),
		falloff: falloffOf(kind),
		invert: !!mods.cmd,
		autoSmooth: autoSmoothOf(kind),
		frontOnly: set.frontOnly,
		toViewer: [toViewer[0] / l, toViewer[1] / l, toViewer[2] / l],
		topology: set.topology,
		mask: maskOf(s),
		sym: symOf(),
	});
	endGesture();
	live = { s, stroke, F: fp.F, inv, scale, start: wm, brush: wm, last: wm, hit, angle: 0 };
	dabAt(live, wm, [0, 0], mods);
	return true;
}

/** One dab where the brush is, `moved` being how far it went since the last (view space). */
function dabAt(g: Live, at: Vec2, moved: Vec2, mods: SculptMods, hit?: { at: Vec3; n: Vec3 } | null): number[] {
	const st = g.stroke;
	st.opts.invert = !!mods.cmd;
	if (mods.pressure !== undefined) st.opts.strength = strengthOf(st.opts.brush) * mods.pressure;
	const h = hit === undefined ? hitOn(st.points, st.faces, g.F, at) : hit;
	if (h) g.hit = h;
	const rest = (v: Vec3) => xf3ApplyDir(g.inv, v) as V3;
	return dab(st, {
		at: xf3Apply(g.inv, g.hit.at) as V3,
		n: rest(g.hit.n),
		motion: rest([moved[0], moved[1], 0]),
		total: rest([at[0] - g.start[0], at[1] - g.start[1], 0]),
		angle: g.angle,
		smooth: mods.shift,
	});
}

export function sculptMove(wm: Vec2, mods: SculptMods): boolean {
	const adj = sculptAdjust.value;
	if (adj) {
		const d = Math.hypot(wm[0] - adj.centre[0], wm[1] - adj.centre[1]) * zoom();
		if (adj.what === "radius") setSculpt({ radius: Math.max(2, Math.round(d)) });
		else setBrushField("strength", Math.round(Math.max(0, Math.min(1, d / 200)) * 100) / 100);
		return true;
	}
	if (waiting) {
		// the press began off the mesh: the stroke begins where the drag reaches it
		if (begin(wm, mods)) waiting = null;
		return true;
	}
	const g = live;
	if (!g) return false;
	const set = sculpt.value;
	// the brush trails the pointer on a string as long as Stabilize
	const lazy = set.stabilize / zoom();
	const dx = wm[0] - g.brush[0];
	const dy = wm[1] - g.brush[1];
	const dl = Math.hypot(dx, dy);
	if (lazy > 0) {
		if (dl <= lazy) return true;
		g.brush = [g.brush[0] + (dx * (dl - lazy)) / dl, g.brush[1] + (dy * (dl - lazy)) / dl];
	} else g.brush = wm;
	const kind = g.stroke.opts.brush;
	const changed = new Set<number>();
	const take = (l: number[]) => l.forEach((i) => changed.add(i));
	if (kind === "rotate") {
		const v: Vec2 = [g.brush[0] - g.start[0], g.brush[1] - g.start[1]];
		if (Math.hypot(v[0], v[1]) * zoom() > 6) {
			const a = Math.atan2(v[1], v[0]);
			if (g.a0 === undefined) g.a0 = g.aPrev = a;
			let d = a - g.aPrev!;
			if (d > Math.PI) d -= 2 * Math.PI;
			if (d < -Math.PI) d += 2 * Math.PI;
			g.angle += d;
			g.aPrev = a;
		}
	}
	if (brushInfo(kind).drag || set.method === "dots") {
		take(dabAt(g, g.brush, [g.brush[0] - g.last[0], g.brush[1] - g.last[1]], mods, kind === "grab" || kind === "elastic" || kind === "rotate" || kind === "snakeHook" ? null : undefined));
		g.last = g.brush;
	} else {
		// dabs spaced along the way the brush went, a share of the radius apart
		const step = Math.max(viewRadius() * set.spacing, 1 / zoom());
		let n = 0;
		while (n < 64) {
			const vx = g.brush[0] - g.last[0];
			const vy = g.brush[1] - g.last[1];
			const l = Math.hypot(vx, vy);
			if (l < step) break;
			const p: Vec2 = [g.last[0] + (vx / l) * step, g.last[1] + (vy / l) * step];
			take(dabAt(g, p, [p[0] - g.last[0], p[1] - g.last[1]], mods));
			g.last = p;
			n++;
		}
	}
	if (kind === "mask" && !mods.shift) setMask(g.s, new Float32Array(g.stroke.mask));
	else if (changed.size) writePoints(g.s, g.stroke.points, changed);
	return true;
}

export function sculptUp(): boolean {
	const was = waiting;
	waiting = null;
	if (!live) return !!was;
	live = null;
	endGesture();
	return true;
}
export function sculptCancel(): boolean {
	const adj = sculptAdjust.value;
	if (adj) {
		if (adj.what === "radius") setSculpt({ radius: adj.was });
		else setBrushField("strength", adj.was);
		sculptAdjust.value = null;
		return true;
	}
	return false;
}

const LETTERS: Record<string, Brush> = {
	x: "draw",
	c: "clayStrips",
	"shift+c": "crease",
	l: "layer",
	i: "inflate",
	s: "smooth",
	"shift+t": "flatten",
	p: "pinch",
	g: "grab",
	k: "snakeHook",
	m: "mask",
};

/** A key while sculpting: the brushes' letters, F and ⇧F, [ and ], the mask's keys. True when it was taken. */
export function sculptKey(e: KeyboardEvent, cursor: Vec2 | null): boolean {
	if (!md.sculpting.value) return false;
	const adj = sculptAdjust.value;
	if (adj) {
		if (e.key === "Escape") sculptCancel();
		else if (e.key === "Enter") sculptAdjust.value = null;
		return true;
	}
	if (live) return e.key !== "Shift" && e.key !== "Meta" && e.key !== "Control";
	const code = e.code.startsWith("Key") ? e.code.slice(3).toLowerCase() : e.key;
	const cmd = e.metaKey || e.ctrlKey;
	if (cmd && !e.altKey && !e.shiftKey && code === "i") {
		maskAct("invert");
		return true;
	}
	if (cmd) return false;
	if (e.altKey) {
		if (code === "m") {
			maskAct("clear");
			return true;
		}
		return false;
	}
	const k = (e.shiftKey ? "shift+" : "") + code;
	if (e.key === "Escape") {
		setSculpting(false);
		return true;
	}
	if (code === "f" && cursor) {
		const set = sculpt.value;
		const what = e.shiftKey ? "strength" : "radius";
		const was = what === "radius" ? set.radius : strengthOf();
		const reach = (what === "radius" ? was : was * 200) / zoom();
		sculptAdjust.value = { what, centre: [cursor[0] - reach, cursor[1]], was };
		return true;
	}
	if (e.code === "BracketLeft" || e.code === "BracketRight") {
		const r = sculpt.value.radius;
		setSculpt({ radius: Math.max(2, Math.round(e.code === "BracketLeft" ? r / 1.15 : r * 1.15)) });
		return true;
	}
	const b = LETTERS[k];
	if (b) {
		setBrush(b);
		return true;
	}
	return false;
}

/** The status bar's line while sculpting. */
export function sculptStatus(): string | null {
	if (!md.sculpting.value) return null;
	const adj = sculptAdjust.value;
	if (adj) return adj.what === "radius" ? `Radius: ${sculpt.value.radius}px · move the pointer · a click or Return keeps · Esc puts back` : `Strength: ${strengthOf()} · move the pointer · a click or Return keeps · Esc puts back`;
	const set = sculpt.value;
	const b = brushInfo(set.brush);
	const sym = ["X", "Y", "Z"].filter((_, i) => set.mirror[i]).join("") || "";
	return `Sculpt · ${b.label}: ${b.hint} · radius ${set.radius}px, strength ${strengthOf()}${sym ? ` · symmetry ${sym}` : ""}${set.radial > 1 ? ` · radial ×${set.radial}` : ""} · ⇧ smooths · F radius, ⇧F strength · two fingers or ⌥-drag orbit · Esc leaves`;
}

/**
 * What sculpt mode draws over the canvas, in screen space: the mask
 * darkening the faces it holds, and the brush's ring under the pointer.
 */
export function drawSculpt(ctx: CanvasRenderingContext2D, toS: (p: Vec2) => Vec2, cursor: Vec2 | null, accent: string, ink: string) {
	if (!md.sculpting.value) return;
	void maskRev.value;
	const s = md.sel.value;
	const fp = s ? framePartOf(s.part) : undefined;
	const m = sculptPoints();
	const mask = s ? maskOf(s) : null;
	if (s && fp && m && mask) {
		const pts = (live ? live.stroke.points : m.points).map((p) => xf3Apply(fp.F, p));
		const flip = xf3Det(fp.F) < 0;
		ctx.fillStyle = ink;
		for (const f of m.faces) {
			let w = 0;
			for (const v of f) w += mask[v] ?? 0;
			w /= f.length;
			if (w < 0.02) continue;
			// the faces that look toward the viewer only
			let nz = 0;
			for (let i = 0, j = f.length - 1; i < f.length; j = i++) nz += (pts[f[i]][0] - pts[f[j]][0]) * (pts[f[i]][1] + pts[f[j]][1]);
			if (nz > 0 === flip) continue;
			ctx.globalAlpha = 0.55 * w;
			ctx.beginPath();
			f.forEach((v, i) => {
				const p = toS([pts[v][0], pts[v][1]]);
				if (i) ctx.lineTo(p[0], p[1]);
				else ctx.moveTo(p[0], p[1]);
			});
			ctx.closePath();
			ctx.fill();
		}
		ctx.globalAlpha = 1;
	}
	const adj = sculptAdjust.value;
	const at = adj ? adj.centre : live ? live.brush : cursor;
	if (!at) return;
	const c = toS(at);
	const r = sculpt.value.radius;
	ctx.strokeStyle = accent;
	ctx.lineWidth = 1.5;
	ctx.beginPath();
	ctx.arc(c[0], c[1], r, 0, Math.PI * 2);
	ctx.stroke();
	// the strength as an inner ring
	ctx.globalAlpha = 0.5;
	ctx.beginPath();
	ctx.arc(c[0], c[1], Math.max(1, r * strengthOf()), 0, Math.PI * 2);
	ctx.stroke();
	ctx.globalAlpha = 1;
	if (live && sculpt.value.stabilize > 0 && cursor) {
		const p = toS(cursor);
		ctx.setLineDash([3, 3]);
		ctx.beginPath();
		ctx.moveTo(c[0], c[1]);
		ctx.lineTo(p[0], p[1]);
		ctx.stroke();
		ctx.setLineDash([]);
	}
}
