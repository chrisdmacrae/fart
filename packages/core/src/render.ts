// Pictures of motion, for an agent to look at: a clip as a strip of
// frames (or one onion-skinned image), every frame in the same world
// box so movement reads as movement, with the overlays that answer
// "which way?": the previous frame as a ghost, the paths the chains'
// ends travel with arrows along them, an axis gizmo (which way +x, +y
// and a positive turn go; in 3D, where the model's front is), and
// optionally the skeleton. A software rasteriser, no dependencies: the
// reference look, not a game's.

import type { Doc, Doc3, Rgba, Shape, StatePart, StatePart3, Token, Vec2, Vec3 } from "./types.ts";
import { as3d } from "./types.ts";
import { distSeg, drawList, pointInPoly, shapeBounds, shapesOfPosed, xfApply, xfInvert, XF_ID, type Xf } from "./geometry.ts";
import { pathBake } from "./curves.ts";
import { colorOf, shadeColor } from "./palette.ts";
import { projectFrame, viewXf3 } from "./project.ts";
import { xf3Apply } from "./space3.ts";
import type { Raster } from "./textures.ts";
import { clipOf, defaultTracks, durationOf, keyAt, measure, parentsOf, posesAt, statePoses, type AnyClip, type Sample } from "./motion.ts";

export interface RenderOptions {
	/** 3D: a named view or a turn [x, y, z] in radians (default front) */
	view?: string | Vec3;
	/** the longer side of a cell's drawing, px (default 200) */
	size?: number;
	/** cells per row in a strip (default: up to 6) */
	cols?: number;
	/** the previous frame as a blue ghost in each cell (default on) */
	onion?: boolean;
	/** the paths of `tracks` with arrows (default on) */
	trails?: boolean;
	/** the axis gizmo in each cell (default on) */
	axes?: boolean;
	/** the skeleton: a line from each part's pivot to its parent's (default off) */
	bones?: boolean;
	/** part names at the joints, with bones (default off) */
	labels?: boolean;
	/** "part/anchor"s to trail (default: the chains' ends, else every anchor, up to 6) */
	tracks?: string[];
	/** 2D: which way the figure faces, drawn as a FRONT arrow in the gizmo */
	facing?: "right" | "left" | "up" | "down";
	/** the first legend line (default: the document and clip) */
	title?: string;
}

// ------------------------------------------------------------- pictures

interface Paint {
	hit: (p: Vec2) => boolean;
	inv: Xf;
	lo: Vec2;
	hi: Vec2;
	rgba: Rgba;
}

/** One frame ready to draw: what paints, in view space (y down), and the sample it came from. */
export interface Picture {
	t: number;
	paints: Paint[];
	sample: Sample;
}

/** A shape's paint test in its own space. */
function hitOf(sh: Shape): (p: Vec2) => boolean {
	switch (sh.kind) {
		case "circle": {
			const r2 = sh.r * sh.r;
			return (p) => (p[0] - sh.at[0]) ** 2 + (p[1] - sh.at[1]) ** 2 <= r2;
		}
		case "line":
			return (p) => distSeg(p, sh.a, sh.b) <= sh.w * 0.5;
		case "poly":
			return (p) => pointInPoly(p, sh.points);
		case "path": {
			const pts = pathBake(sh).points;
			if (sh.closed) return (p) => pointInPoly(p, pts);
			const hw = (sh.w ?? 0) * 0.5;
			return (p) => {
				if (pts.length === 1) return Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) <= hw;
				for (let i = 0; i + 1 < pts.length; i++) if (distSeg(p, pts[i], pts[i + 1]) <= hw) return true;
				return false;
			};
		}
	}
}

function paintOf(sh: Shape, xf: Xf, tokens: readonly Token[]): Paint | null {
	const b = shapeBounds(sh);
	if (!b) return null;
	const cs = [xfApply(xf, b.lo), xfApply(xf, [b.hi[0], b.lo[1]]), xfApply(xf, b.hi), xfApply(xf, [b.lo[0], b.hi[1]])];
	return {
		hit: hitOf(sh),
		inv: xfInvert(xf),
		lo: [Math.min(...cs.map((c) => c[0])), Math.min(...cs.map((c) => c[1]))],
		hi: [Math.max(...cs.map((c) => c[0])), Math.max(...cs.map((c) => c[1]))],
		rgba: shadeColor(colorOf(tokens, sh.color ?? ""), sh.shade),
	};
}

/** A pose list (or the rest pose) as a picture. */
export function pictureOf(doc: Doc | Doc3, tokens: readonly Token[], poses: StatePart[] | StatePart3[] | undefined, t = 0, view?: string | Vec3): Picture {
	const paints: Paint[] = [];
	const d3 = as3d(doc);
	if (d3) {
		for (const fp of projectFrame(d3, poses as StatePart3[] | undefined, { view })) {
			for (const fs of fp.shapes) {
				const p = paintOf(fs.shape, XF_ID, tokens);
				if (p) paints.push(p);
			}
		}
	} else {
		for (const e of drawList(doc as Doc, poses as StatePart[] | undefined)) {
			for (const sh of shapesOfPosed(doc as Doc, e.part, e.sp)) {
				const p = paintOf(sh, e.xf, tokens);
				if (p) paints.push(p);
			}
		}
	}
	return { t, paints, sample: measure(doc, poses, t) };
}

/** World to view space, as the picture draws it (2D: as is). */
export function viewMap(doc: Doc | Doc3, view?: string | Vec3): (p: Vec3) => Vec2 {
	if (!as3d(doc)) return (p) => [p[0], p[1]];
	const V = viewXf3(view);
	return (p) => {
		const q = xf3Apply(V, p);
		return [q[0], q[1]];
	};
}

// ------------------------------------------------------------- the canvas

const BG: Rgba = [246, 246, 242, 255];
const GRID: Rgba = [226, 226, 218, 255];
const ORIGIN: Rgba = [196, 196, 186, 255];
const INK: Rgba = [34, 34, 34, 255];
const HALO: Rgba = [255, 255, 255, 220];
const GHOST: Rgba = [60, 110, 230, 255];
const LATE: Rgba = [230, 70, 50, 255];
const AX_X: Rgba = [210, 50, 50, 255];
const AX_Y: Rgba = [40, 150, 60, 255];
const AX_Z: Rgba = [50, 90, 220, 255];
const FRONT: Rgba = [120, 120, 120, 255];
const TRACK: Rgba[] = [
	[220, 50, 50, 255],
	[30, 130, 220, 255],
	[20, 160, 80, 255],
	[230, 130, 10, 255],
	[150, 70, 200, 255],
	[10, 160, 160, 255],
];

// 3×5 glyphs, rows top to bottom, '1' is ink
const GLYPHS: Record<string, string> = {
	"0": "111101101101111", "1": "010110010010111", "2": "111001111100111", "3": "111001111001111", "4": "101101111001001",
	"5": "111100111001111", "6": "111100111101111", "7": "111001010010010", "8": "111101111101111", "9": "111101111001111",
	A: "010101111101101", B: "110101110101110", C: "011100100100011", D: "110101101101110", E: "111100110100111",
	F: "111100110100100", G: "011100101101011", H: "101101111101101", I: "111010010010111", J: "001001001101010",
	K: "101101110101101", L: "100100100100111", M: "101111111101101", N: "110101101101101", O: "010101101101010",
	P: "110101110100100", Q: "010101101110011", R: "110101110101101", S: "011100010001110", T: "111010010010010",
	U: "101101101101111", V: "101101101101010", W: "101101111111101", X: "101101010101101", Y: "101101010010010",
	Z: "111001010100111", " ": "000000000000000", ".": "000000000000010", ",": "000000000010100", "-": "000000111000000",
	"+": "000010111010000", "=": "000111000111000", ":": "000010000010000", "/": "001001010100100", _: "000000000000111",
	"(": "010100100100010", ")": "010001001001010", ">": "100010001010100", "<": "001010100010001", "#": "101111101111101",
	"%": "101001010100101", "?": "111001010000010", "[": "110100100100110", "]": "011001001001011", "*": "101010101000000",
	"|": "010010010010010", "'": "010010000000000",
};
const TEXT_SCALE = 2;
const CHAR_W = 4 * TEXT_SCALE;
const LINE_H = 7 * TEXT_SCALE;

export function textWidth(s: string): number {
	return s.length * CHAR_W;
}

class Canvas {
	readonly w: number;
	readonly h: number;
	/** premultiplied RGBA, 0..1 */
	readonly d: Float32Array;
	constructor(w: number, h: number, bg: Rgba) {
		this.w = w;
		this.h = h;
		this.d = new Float32Array(w * h * 4);
		const a = bg[3] / 255;
		for (let i = 0; i < w * h; i++) {
			this.d[i * 4] = (bg[0] / 255) * a;
			this.d[i * 4 + 1] = (bg[1] / 255) * a;
			this.d[i * 4 + 2] = (bg[2] / 255) * a;
			this.d[i * 4 + 3] = a;
		}
	}
	/** lay premultiplied colour (pr, pg, pb, pa: 0..1) over a pixel */
	over(x: number, y: number, pr: number, pg: number, pb: number, pa: number) {
		if (x < 0 || y < 0 || x >= this.w || y >= this.h || pa <= 0) return;
		const o = (y * this.w + x) * 4;
		const k = 1 - pa;
		this.d[o] = pr + this.d[o] * k;
		this.d[o + 1] = pg + this.d[o + 1] * k;
		this.d[o + 2] = pb + this.d[o + 2] * k;
		this.d[o + 3] = pa + this.d[o + 3] * k;
	}
	/** a colour with coverage cov (0..1) */
	cover(x: number, y: number, c: Rgba, cov: number) {
		const a = (c[3] / 255) * Math.max(0, Math.min(1, cov));
		if (a > 0) this.over(x, y, (c[0] / 255) * a, (c[1] / 255) * a, (c[2] / 255) * a, a);
	}
	rect(x: number, y: number, w: number, h: number, c: Rgba) {
		for (let j = Math.max(0, Math.floor(y)); j < Math.min(this.h, Math.ceil(y + h)); j++) for (let i = Math.max(0, Math.floor(x)); i < Math.min(this.w, Math.ceil(x + w)); i++) this.cover(i, j, c, 1);
	}
	/** a segment `w` px wide, antialiased */
	seg(a: Vec2, b: Vec2, w: number, c: Rgba) {
		const hw = w / 2;
		const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0]) - hw - 1));
		const x1 = Math.min(this.w - 1, Math.ceil(Math.max(a[0], b[0]) + hw + 1));
		const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1]) - hw - 1));
		const y1 = Math.min(this.h - 1, Math.ceil(Math.max(a[1], b[1]) + hw + 1));
		for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.cover(x, y, c, hw + 0.5 - distSeg([x + 0.5, y + 0.5], a, b));
	}
	disc(at: Vec2, r: number, c: Rgba) {
		for (let y = Math.floor(at[1] - r - 1); y <= Math.ceil(at[1] + r + 1); y++)
			for (let x = Math.floor(at[0] - r - 1); x <= Math.ceil(at[0] + r + 1); x++) this.cover(x, y, c, r + 0.5 - Math.hypot(x + 0.5 - at[0], y + 0.5 - at[1]));
	}
	/** an arrow from a to b with a head `head` px long */
	arrow(a: Vec2, b: Vec2, w: number, c: Rgba, head = 6) {
		this.seg(a, b, w, c);
		this.chevron(b, Math.atan2(b[1] - a[1], b[0] - a[0]), w, c, head);
	}
	/** an arrowhead at p pointing along angle th */
	chevron(p: Vec2, th: number, w: number, c: Rgba, head = 6) {
		for (const s of [-1, 1]) this.seg(p, [p[0] - head * Math.cos(th + s * 0.5), p[1] - head * Math.sin(th + s * 0.5)], w, c);
	}
	text(x: number, y: number, s: string, c: Rgba, halo: Rgba | null = HALO) {
		const str = s.toUpperCase();
		const k = TEXT_SCALE;
		for (const pass of halo ? [0, 1] : [1]) {
			for (let n = 0; n < str.length; n++) {
				const g = GLYPHS[str[n]] ?? GLYPHS["?"];
				for (let r = 0; r < 5; r++)
					for (let col = 0; col < 3; col++) {
						if (g[r * 3 + col] !== "1") continue;
						const px = x + n * CHAR_W + col * k;
						const py = y + r * k;
						if (pass === 0) this.rect(px - 1, py - 1, k + 2, k + 2, halo!);
						else this.rect(px, py, k, k, c);
					}
			}
		}
	}
	toRaster(): Raster {
		const data = new Uint8ClampedArray(this.w * this.h * 4);
		for (let i = 0; i < this.w * this.h; i++) {
			const a = this.d[i * 4 + 3];
			data[i * 4] = a > 0 ? (this.d[i * 4] / a) * 255 : 0;
			data[i * 4 + 1] = a > 0 ? (this.d[i * 4 + 1] / a) * 255 : 0;
			data[i * 4 + 2] = a > 0 ? (this.d[i * 4 + 2] / a) * 255 : 0;
			data[i * 4 + 3] = a * 255;
		}
		return { width: this.w, height: this.h, data };
	}
}

// ------------------------------------------------------------- cells

/** The world box every cell shares, and how a cell maps it to pixels. */
interface Frame {
	lo: Vec2;
	hi: Vec2;
	/** px per world unit */
	k: number;
	cellW: number;
	cellH: number;
	/** where the world box starts inside a cell */
	ox: number;
	oy: number;
}

const PAD = 10;
const HEAD = 18;

function frameFor(points: Vec2[], size: number, minW = 150): Frame {
	let lo: Vec2 = [Infinity, Infinity];
	let hi: Vec2 = [-Infinity, -Infinity];
	for (const p of points) {
		if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
		lo = [Math.min(lo[0], p[0]), Math.min(lo[1], p[1])];
		hi = [Math.max(hi[0], p[0]), Math.max(hi[1], p[1])];
	}
	if (!Number.isFinite(lo[0])) {
		lo = [-1, -1];
		hi = [1, 1];
	}
	const span = Math.max(hi[0] - lo[0], hi[1] - lo[1], 1e-3);
	const m = span * 0.06;
	lo = [lo[0] - m, lo[1] - m];
	hi = [hi[0] + m, hi[1] + m];
	const w = hi[0] - lo[0];
	const h = hi[1] - lo[1];
	const k = size / Math.max(w, h);
	const dw = Math.round(w * k);
	const dh = Math.round(h * k);
	const cellW = Math.max(dw + PAD * 2, minW);
	const cellH = dh + PAD * 2 + HEAD;
	return { lo, hi, k, cellW, cellH, ox: Math.round((cellW - dw) / 2), oy: HEAD + PAD };
}

function niceStep(span: number): number {
	const raw = span / 6;
	const p = 10 ** Math.floor(Math.log10(raw));
	for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p;
	return 10 * p;
}

/** What every cell of one image draws from. */
interface Scene {
	doc: Doc | Doc3;
	opts: RenderOptions;
	frame: Frame;
	to: (p: Vec3) => Vec2;
	tracks: string[];
	/** each track's path, dense, in view space */
	paths: Vec2[][];
	parents: Map<string, string>;
}

function px(sc: Scene, x0: number, y0: number, p: Vec2): Vec2 {
	const f = sc.frame;
	return [x0 + f.ox + (p[0] - f.lo[0]) * f.k, y0 + f.oy + (p[1] - f.lo[1]) * f.k];
}

function background(cv: Canvas, sc: Scene, x0: number, y0: number) {
	const f = sc.frame;
	const step = niceStep(Math.max(f.hi[0] - f.lo[0], f.hi[1] - f.lo[1]));
	const top = y0 + HEAD;
	const bottom = y0 + f.cellH;
	for (let x = Math.ceil(f.lo[0] / step) * step; x <= f.hi[0]; x += step) {
		const X = px(sc, x0, y0, [x, 0])[0];
		cv.seg([X, top], [X, bottom], Math.abs(x) < step * 1e-6 ? 1.5 : 1, Math.abs(x) < step * 1e-6 ? ORIGIN : GRID);
	}
	for (let y = Math.ceil(f.lo[1] / step) * step; y <= f.hi[1]; y += step) {
		const Y = px(sc, x0, y0, [0, y])[1];
		cv.seg([x0, Y], [x0 + f.cellW, Y], Math.abs(y) < step * 1e-6 ? 1.5 : 1, Math.abs(y) < step * 1e-6 ? ORIGIN : GRID);
	}
	// the cell's edge
	cv.seg([x0 + f.cellW - 0.5, y0], [x0 + f.cellW - 0.5, y0 + f.cellH], 1, ORIGIN);
	cv.seg([x0, y0 + f.cellH - 0.5], [x0 + f.cellW, y0 + f.cellH - 0.5], 1, ORIGIN);
}

/** The picture into a cell, 2×2 samples a pixel; a ghost is tinted and faded. */
function paint(cv: Canvas, sc: Scene, x0: number, y0: number, pic: Picture, tint?: Rgba, alpha = 1) {
	const f = sc.frame;
	const toWorld = (X: number, Y: number): Vec2 => [(X - x0 - f.ox) / f.k + f.lo[0], (Y - y0 - f.oy) / f.k + f.lo[1]];
	// each paint's rows, so a row tests only what can reach it
	const items = pic.paints.map((p) => ({ p, y0: Math.floor(px(sc, x0, y0, p.lo)[1]), y1: Math.ceil(px(sc, x0, y0, p.hi)[1]), x0: Math.floor(px(sc, x0, y0, p.lo)[0]), x1: Math.ceil(px(sc, x0, y0, p.hi)[0]) }));
	const ys = Math.max(y0 + HEAD, 0);
	const ye = Math.min(y0 + f.cellH, cv.h);
	const SUB: Vec2[] = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
	for (let Y = ys; Y < ye; Y++) {
		const row = items.filter((it) => it.y0 <= Y && it.y1 >= Y);
		if (!row.length) continue;
		for (let X = x0; X < x0 + f.cellW; X++) {
			const here = row.filter((it) => it.x0 <= X && it.x1 >= X);
			if (!here.length) continue;
			let R = 0, G = 0, B = 0, A = 0;
			for (const [sx, sy] of SUB) {
				const w = toWorld(X + sx, Y + sy);
				let r = 0, g = 0, b = 0, a = 0;
				for (const { p } of here) {
					if (w[0] < p.lo[0] || w[0] > p.hi[0] || w[1] < p.lo[1] || w[1] > p.hi[1]) continue;
					if (!p.hit(xfApply(p.inv, w))) continue;
					const al = p.rgba[3] / 255;
					r = (p.rgba[0] / 255) * al + r * (1 - al);
					g = (p.rgba[1] / 255) * al + g * (1 - al);
					b = (p.rgba[2] / 255) * al + b * (1 - al);
					a = al + a * (1 - al);
				}
				R += r / 4;
				G += g / 4;
				B += b / 4;
				A += a / 4;
			}
			if (A <= 0) continue;
			if (tint) {
				// toward the tint, keeping a little of the light and dark
				const l = (0.3 * R + 0.59 * G + 0.11 * B) / A;
				const m = 0.75;
				R = ((tint[0] / 255) * m + l * (1 - m)) * A;
				G = ((tint[1] / 255) * m + l * (1 - m)) * A;
				B = ((tint[2] / 255) * m + l * (1 - m)) * A;
			}
			cv.over(X, Y, R * alpha, G * alpha, B * alpha, A * alpha);
		}
	}
}

function bones(cv: Canvas, sc: Scene, x0: number, y0: number, s: Sample) {
	const drawn = new Set(s.parts);
	const segs: [Vec2, Vec2][] = [];
	for (const name of drawn) {
		const parent = sc.parents.get(name);
		const a = s.joints.get(name);
		const b = parent && drawn.has(parent) ? s.joints.get(parent) : undefined;
		if (a && b) segs.push([px(sc, x0, y0, sc.to(a)), px(sc, x0, y0, sc.to(b))]);
	}
	for (const [a, b] of segs) cv.seg(a, b, 4, HALO);
	for (const [a, b] of segs) cv.seg(a, b, 2, INK);
	for (const name of drawn) {
		const j = s.joints.get(name);
		if (!j) continue;
		const p = px(sc, x0, y0, sc.to(j));
		cv.disc(p, 3.5, HALO);
		cv.disc(p, 2.2, INK);
		if (sc.opts.labels) cv.text(Math.round(p[0] + 5), Math.round(p[1] - 4), name, INK);
	}
}

/** The paths with arrows along them (no sample), or each track's place at a sample. */
function trails(cv: Canvas, sc: Scene, x0: number, y0: number, s: Sample | null) {
	sc.paths.forEach((path, i) => {
		const c = TRACK[i % TRACK.length];
		if (s) {
			const at = s.anchors.get(sc.tracks[i]);
			if (!at) return;
			const p = px(sc, x0, y0, sc.to(at));
			cv.disc(p, 5, HALO);
			cv.disc(p, 3.5, c);
			return;
		}
		const faint: Rgba = [c[0], c[1], c[2], 110];
		const pts = path.map((p) => px(sc, x0, y0, p));
		for (let j = 0; j + 1 < pts.length; j++) cv.seg(pts[j], pts[j + 1], 2, faint);
		// arrows along the path, so the direction of travel reads
		for (let q = 0; q < 4 && pts.length > 2; q++) {
			const j = Math.min(pts.length - 2, Math.max(1, Math.floor(((q + 0.5) / 4) * (pts.length - 1))));
			const a = pts[j - 1];
			const b = pts[j + 1];
			if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1) continue;
			cv.chevron(pts[j], Math.atan2(b[1] - a[1], b[0] - a[0]), 2, c, 7);
		}
	});
}

const GIZMO_W = 152;
/** narrowest image: the gizmo and a line of legend */
const MIN_W = 360;
const GIZMO_H = 78;

/**
 * Which way +x, +y and a positive turn go, in a box at (bx, by); in 3D the
 * three axes as the view turns them. Beside them, the FRONT arrow: the
 * model's −z in 3D, the --facing in 2D.
 */
function gizmo(cv: Canvas, sc: Scene, bx: number, by: number) {
	const L = 26;
	const d3 = as3d(sc.doc);
	const front = (dir: Vec2 | null, toward: boolean | null) => {
		const c: Vec2 = [bx + 122, by + 22];
		if (dir) {
			cv.arrow([c[0] - dir[0] * 14, c[1] - dir[1] * 14], [c[0] + dir[0] * 14, c[1] + dir[1] * 14], 2, FRONT);
			cv.text(c[0] - 20, by + 42, "FRONT", FRONT, null);
		} else if (toward !== null) {
			cv.text(c[0] - 20, by + 14, "FRONT", FRONT, null);
			cv.text(c[0] - 24, by + 30, toward ? "AT YOU" : "AWAY", FRONT, null);
		}
	};
	if (!d3) {
		const o: Vec2 = [bx + 12, by + 12];
		cv.arrow(o, [o[0] + L, o[1]], 2, AX_X);
		cv.text(o[0] + L + 4, o[1] - 5, "+X", AX_X, null);
		cv.arrow(o, [o[0], o[1] + L], 2, AX_Y);
		cv.text(o[0] - 4, o[1] + L + 4, "+Y", AX_Y, null);
		// a positive turn: +x toward +y, clockwise on screen
		const r = 15;
		let prev: Vec2 = [o[0] + r, o[1]];
		const end = (Math.PI / 2) * 0.85;
		for (let i = 1; i <= 10; i++) {
			const th = (i / 10) * end;
			const p: Vec2 = [o[0] + r * Math.cos(th), o[1] + r * Math.sin(th)];
			cv.seg(prev, p, 1.5, INK);
			prev = p;
		}
		cv.chevron(prev, end + Math.PI / 2, 1.5, INK, 5);
		cv.text(o[0] + 16, o[1] + 16, "R+", INK, null);
		const face = sc.opts.facing;
		if (face) front(face === "right" ? [1, 0] : face === "left" ? [-1, 0] : face === "up" ? [0, -1] : [0, 1], null);
		return;
	}
	const o: Vec2 = [bx + 34, by + 30];
	const L3 = 22;
	const V = viewXf3(sc.opts.view);
	const axis = (v: Vec3, c: Rgba, name: string) => {
		const q = xf3Apply(V, v);
		const len = Math.hypot(q[0], q[1]);
		if (len < 0.25) {
			// along the line of sight: a dot toward the viewer, a cross away
			const p: Vec2 = [bx + 10, by + 72];
			if (q[2] < 0) cv.disc(p, 3, c);
			else {
				cv.seg([p[0] - 3, p[1] - 3], [p[0] + 3, p[1] + 3], 1.5, c);
				cv.seg([p[0] - 3, p[1] + 3], [p[0] + 3, p[1] - 3], 1.5, c);
			}
			cv.text(p[0] + 7, p[1] - 5, `${name}${q[2] < 0 ? " AT YOU" : " AWAY"}`, c, null);
			return;
		}
		const e: Vec2 = [o[0] + q[0] * L3, o[1] + q[1] * L3];
		cv.arrow(o, e, 2, c);
		cv.text(Math.round(e[0] + (q[0] >= 0 ? 3 : -18)), Math.round(e[1] + (q[1] >= 0 ? 1 : -10)), name, c, null);
	};
	axis([1, 0, 0], AX_X, "+X");
	axis([0, 1, 0], AX_Y, "+Y");
	axis([0, 0, 1], AX_Z, "+Z");
	// the model's front is −z (it faces the viewer in the front view)
	const fz = xf3Apply(V, [0, 0, -1]);
	const fl = Math.hypot(fz[0], fz[1]);
	if (fl < 0.25) front(null, fz[2] < 0);
	else front([fz[0] / fl, fz[1] / fl], null);
}

function label(cv: Canvas, x0: number, y0: number, s: string) {
	cv.text(x0 + 4, y0 + 3, s, INK, null);
}

function cellOf(cv: Canvas, sc: Scene, x0: number, y0: number, pic: Picture, ghosts: { pic: Picture; tint: Rgba; alpha: number }[], head: string) {
	background(cv, sc, x0, y0);
	if (sc.opts.trails !== false) trails(cv, sc, x0, y0, null);
	for (const g of ghosts) paint(cv, sc, x0, y0, g.pic, g.tint, g.alpha);
	paint(cv, sc, x0, y0, pic);
	if (sc.opts.bones) bones(cv, sc, x0, y0, pic.sample);
	if (sc.opts.trails !== false) trails(cv, sc, x0, y0, pic.sample);
	label(cv, x0, y0, head);
}

// ------------------------------------------------------------- legend

function wrapWords(words: string[], width: number): string[] {
	const lines: string[] = [];
	let cur = "";
	for (const w of words) {
		const next = cur ? `${cur}  ${w}` : w;
		if (textWidth(next) > width - 8 && cur) {
			lines.push(cur);
			cur = w;
		} else cur = next;
	}
	if (cur) lines.push(cur);
	return lines;
}

interface Legend {
	lines: string[];
	tracks: string[];
	/** the gizmo's box on the left, or not */
	gizmo: boolean;
	height: number;
}

function legendFor(sc: Scene, width: number, title: string, extra: string[]): Legend {
	const f = sc.frame;
	const step = niceStep(Math.max(f.hi[0] - f.lo[0], f.hi[1] - f.lo[1]));
	const d3 = as3d(sc.doc);
	const giz = sc.opts.axes !== false;
	const textW = width - (giz ? GIZMO_W : 0);
	const view = typeof sc.opts.view === "string" ? sc.opts.view : sc.opts.view ? sc.opts.view.map((x) => Math.round((x * 180) / Math.PI)).join(",") : "front";
	const axes = d3 ? [`VIEW ${view}`, "+Y IS DOWN", "FRONT = THE MODEL'S -Z", `GRID ${step}`] : ["+X RIGHT", "+Y DOWN", "R+ TURNS CLOCKWISE", `GRID ${step}`];
	const lines = [...wrapWords(title.split(/\s{2,}/), textW), ...wrapWords([...axes, ...extra], textW)];
	const tracks = sc.opts.trails !== false ? sc.tracks : [];
	const trackLines = tracks.length ? wrapWords(tracks.map((t) => `## ${t}`), textW).length : 0;
	const textH = (lines.length + trackLines) * (LINE_H + 4) + 8;
	return { lines, tracks, gizmo: giz, height: Math.max(textH, giz ? GIZMO_H + 4 : 0) };
}

function drawLegend(cv: Canvas, sc: Scene, y: number, lg: Legend) {
	const x0 = lg.gizmo ? GIZMO_W : 6;
	if (lg.gizmo) {
		gizmo(cv, sc, 0, y + 2);
		cv.seg([GIZMO_W - 6, y + 4], [GIZMO_W - 6, y + lg.height - 4], 1, ORIGIN);
	}
	let yy = y + 6;
	for (const l of lg.lines) {
		cv.text(x0, yy, l, INK, null);
		yy += LINE_H + 4;
	}
	let x = x0;
	lg.tracks.forEach((t, i) => {
		const wTxt = textWidth(t) + 24;
		if (x + wTxt > cv.w - 4 && x > x0) {
			x = x0;
			yy += LINE_H + 4;
		}
		cv.rect(x, yy, 12, 10, TRACK[i % TRACK.length]);
		cv.text(x + 16, yy, t, INK, null);
		x += wTxt + 8;
	});
}

// ------------------------------------------------------------- entry points

function sceneFor(doc: Doc | Doc3, pics: Picture[], paths: Vec2[][], tracks: string[], opts: RenderOptions, heads: string[] = []): Scene {
	const to = viewMap(doc, opts.view);
	const pts: Vec2[] = [];
	for (const pic of pics) {
		for (const p of pic.paints) pts.push(p.lo, p.hi);
		for (const j of pic.sample.joints.values()) pts.push(to(j));
	}
	for (const path of paths) pts.push(...path);
	return { doc, opts, frame: frameFor(pts, opts.size ?? 200, Math.max(150, ...heads.map((h) => textWidth(h) + 16))), to, tracks, paths, parents: parentsOf(doc) };
}

/** Each track's path over the whole clip, in view space. */
function pathsOf(doc: Doc | Doc3, clip: AnyClip, tracks: string[], view: string | Vec3 | undefined): Vec2[][] {
	const to = viewMap(doc, view);
	const dur = durationOf(doc, clip);
	const n = dur > 0 ? 64 : 1;
	const paths: Vec2[][] = tracks.map(() => []);
	for (let i = 0; i <= n; i++) {
		const t = dur > 0 ? (dur * i) / n : 0;
		const s = measure(doc, posesAt(doc, clip, t), t);
		tracks.forEach((name, k) => {
			const p = s.anchors.get(name);
			if (p) paths[k].push(to(p));
		});
	}
	return paths;
}

function headFor(clip: AnyClip, t: number, i: number, n: number): string {
	const k = keyAt(clip, t);
	const key = k >= 0 ? `  KEY ${clip.keys[k].state ?? k}` : "";
	return `T ${t.toFixed(2)}  ${i + 1}/${n}${key}`;
}

export interface ClipRender {
	raster: Raster;
	/** the times drawn */
	times: number[];
	tracks: string[];
	/** px per world unit */
	scale: number;
}

function clipSetup(doc: Doc | Doc3, tokens: readonly Token[], clipName: string, times: number[], opts: RenderOptions) {
	const clip = clipOf(doc, clipName);
	if (!clip) throw new Error(`no clip "${clipName}" (clips: ${(doc.clips ?? []).map((c) => c.name).join(", ") || "none"})`);
	const tracks = opts.trails === false ? [] : (opts.tracks ?? defaultTracks(doc));
	const pics = times.map((t) => pictureOf(doc, tokens, posesAt(doc, clip, t), t, opts.view));
	for (const name of tracks) if (!pics[0]?.sample.anchors.has(name)) throw new Error(`no anchor "${name}" to trail (part/anchor)`);
	const paths = pathsOf(doc, clip, tracks, opts.view);
	const heads = times.map((t, i) => headFor(clip, t, i, times.length));
	const sc = sceneFor(doc, pics, paths, tracks, opts, heads);
	return { clip, tracks, pics, sc, heads };
}

/**
 * A clip as a strip of cells (`layout: "strip"`), left to right then
 * down, each with the previous frame as a ghost; or every frame laid
 * over one cell (`"onion"`), blue early to red late, the last solid.
 */
export function renderClip(doc: Doc | Doc3, tokens: readonly Token[], clipName: string, times: number[], layout: "strip" | "onion", opts: RenderOptions = {}): ClipRender {
	const { clip, tracks, pics, sc, heads } = clipSetup(doc, tokens, clipName, times, opts);
	const f = sc.frame;
	const dur = durationOf(doc, clip);
	const title = opts.title ?? `${doc.name ?? "untitled"}  CLIP ${clip.name}  ${dur}S${clip.loop ? " LOOP" : ""}  ${times.length} FRAMES`;
	if (layout === "onion") {
		const width = Math.max(f.cellW, MIN_W);
		const lg = legendFor(sc, width, title, ["BLUE EARLY > RED LATE, LAST SOLID"]);
		const cv = new Canvas(width, f.cellH + lg.height, BG);
		const n = pics.length;
		const ghosts = pics.slice(0, -1).map((pic, i) => {
			const u = n > 1 ? i / (n - 1) : 0;
			const tint: Rgba = [GHOST[0] + (LATE[0] - GHOST[0]) * u, GHOST[1] + (LATE[1] - GHOST[1]) * u, GHOST[2] + (LATE[2] - GHOST[2]) * u, 255];
			return { pic, tint, alpha: 0.32 };
		});
		const x0 = Math.floor((width - f.cellW) / 2);
		cellOf(cv, sc, x0, 0, pics[n - 1], ghosts, `ONION T ${times[0].toFixed(2)}-${times[n - 1].toFixed(2)}`);
		drawLegend(cv, sc, f.cellH, lg);
		return { raster: cv.toRaster(), times, tracks, scale: f.k };
	}
	const n = pics.length;
	const cols = Math.max(1, Math.min(opts.cols ?? Math.min(n, 6), n));
	const rows = Math.ceil(n / cols);
	const width = Math.max(cols * f.cellW, MIN_W);
	const onion = opts.onion !== false;
	const lg = legendFor(sc, width, title, onion ? ["BLUE GHOST = THE FRAME BEFORE"] : []);
	const cv = new Canvas(width, rows * f.cellH + lg.height, BG);
	pics.forEach((pic, i) => {
		const prev = i > 0 ? pics[i - 1] : clip.loop && n > 1 ? pics[n - 1] : null;
		const ghosts = onion && prev ? [{ pic: prev, tint: GHOST, alpha: 0.35 }] : [];
		cellOf(cv, sc, (i % cols) * f.cellW, Math.floor(i / cols) * f.cellH, pic, ghosts, heads[i]);
	});
	drawLegend(cv, sc, rows * f.cellH, lg);
	return { raster: cv.toRaster(), times, tracks, scale: f.k };
}

/** One image per time, all the same size, each a single cell with the overlays (frames for a video). */
export function renderClipFrames(doc: Doc | Doc3, tokens: readonly Token[], clipName: string, times: number[], opts: RenderOptions = {}): Raster[] {
	const { clip, pics, sc, heads } = clipSetup(doc, tokens, clipName, times, opts);
	const f = sc.frame;
	const onion = opts.onion !== false;
	const width = Math.max(f.cellW, MIN_W);
	const lg = legendFor(sc, width, opts.title ?? `${doc.name ?? "untitled"}  CLIP ${clip.name}`, onion ? ["BLUE GHOST = THE FRAME BEFORE"] : []);
	const x0 = Math.floor((width - f.cellW) / 2);
	return pics.map((pic, i) => {
		const cv = new Canvas(width, f.cellH + lg.height, BG);
		const prev = i > 0 ? pics[i - 1] : null;
		cellOf(cv, sc, x0, 0, pic, onion && prev ? [{ pic: prev, tint: GHOST, alpha: 0.35 }] : [], heads[i]);
		drawLegend(cv, sc, f.cellH, lg);
		return cv.toRaster();
	});
}

/** States side by side (every state when `names` is empty), with the skeleton when asked. */
export function renderStates(doc: Doc | Doc3, tokens: readonly Token[], names: string[], opts: RenderOptions = {}): Raster {
	const list = names.length ? names : ((doc.states ?? []) as { name: string }[]).map((s) => s.name);
	const pics: Picture[] = [];
	const heads: string[] = [];
	if (!list.length) {
		pics.push(pictureOf(doc, tokens, undefined, 0, opts.view));
		heads.push("REST");
	}
	for (const name of list) {
		const poses = statePoses(doc, name);
		if (!poses) throw new Error(`no state "${name}"`);
		pics.push(pictureOf(doc, tokens, poses, 0, opts.view));
		heads.push(name);
	}
	const sc = sceneFor(doc, pics, [], [], { ...opts, trails: false }, heads);
	const f = sc.frame;
	const n = pics.length;
	const cols = Math.max(1, Math.min(opts.cols ?? Math.min(n, 6), n));
	const rows = Math.ceil(n / cols);
	const width = Math.max(cols * f.cellW, MIN_W);
	const lg = legendFor(sc, width, opts.title ?? `${doc.name ?? "untitled"}  STATES`, []);
	const cv = new Canvas(width, rows * f.cellH + lg.height, BG);
	pics.forEach((pic, i) => cellOf(cv, sc, (i % cols) * f.cellW, Math.floor(i / cols) * f.cellH, pic, [], heads[i]));
	drawLegend(cv, sc, rows * f.cellH, lg);
	return cv.toRaster();
}
