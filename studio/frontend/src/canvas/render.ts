// The canvas frame: grid, the art (at rest or posed, dimmed under the
// collision lens), then the overlays that only the editor sees: hover and
// selection outlines, handles, the selection box and its grips, pivots
// and anchors, the pose lever, the marquee, and whatever is being drawn.

import { cssColor, colorOf, xfApply, xfScale, pivotOf, type Shape, type Vec2 } from "@fastart/core";
import { view } from "./view.ts";
import { drawDoc, fillShape, outlineShape, tracePoly, ident } from "./draw.ts";
import { ix, handlesOf, worldHandles, tangentHandles, scaleGrips, poseLever, frameW, partXf, worldPivot, chainGrabs, drawCursor } from "./interact.ts";
import { ed, curPart, curClip, curTokName, selShape, selShapePosed, shapeAt, colShape, poseOfCur, frame, parts, shapesIn, anchorsIn } from "../state/editor.ts";
import { pathPoints } from "@fastart/core";
import { canvasColors } from "../state/theme.ts";
import type { TexturePattern } from "../state/textures.ts";
import type { PatternSource } from "./draw.ts";

/** The store's rendered maps as the painter wants them. */
export function patternsOf(ps: Map<string, TexturePattern>): Map<string, PatternSource> {
	const out = new Map<string, PatternSource>();
	// the pattern itself, not a copy of its fields: reading `canvas` renders it, and only a shape that wears it should
	for (const [name, p] of ps) out.set(name, p);
	return out;
}

export function render(ctx: CanvasRenderingContext2D, W: number, H: number, dpr: number) {
	const C = canvasColors();
	const ACCENT = C.accent;
	const HOVER = C.hover;
	const TEAL = C.ok;
	const LW = C.line;
	const [px, py] = view.pan.value;
	const zoom = view.zoom.value;
	const world = () => ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, (W / 2 - px * zoom) * dpr, (H / 2 - py * zoom) * dpr);
	const screen = () => ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	const toS = (p: Vec2): Vec2 => [(p[0] - px) * zoom + W / 2, (p[1] - py) * zoom + H / 2];

	screen();
	ctx.fillStyle = C.bg;
	ctx.fillRect(0, 0, W, H);
	drawGrid(ctx, W, H, px, py, zoom, C.grid, C.gridStrong);

	const doc = ed.doc.value;
	const tokens = ed.tokens.value;
	const clip = curClip();
	const collide = ed.collide.value;
	const fr = frame();

	world();
	drawDoc(ctx, doc, tokens, { pose: fr, alpha: collide ? 0.22 : 1, patterns: patternsOf(ed.patterns.value) });

	if (collide) {
		// the lens: solids the game may honour, never drawn by it
		const sel = ed.colSel.value;
		(doc.collision ?? []).forEach((sh, i) => {
			ctx.globalAlpha = i === sel ? 0.5 : 0.3;
			fillShape(ctx, sh, TEAL);
			ctx.globalAlpha = 1;
			outlineShape(ctx, sh, i === sel ? ACCENT : TEAL, (i === sel ? 1.5 : 1) * LW, zoom);
		});
		const cs = colShape();
		if (cs) drawHandles(ctx, handlesOf(cs).map(toS), screen, world, C.handleFill, ACCENT, LW);
	} else {
		const W = frameW();
		// the rig: a bone from each child's pivot to its parent's
		screen();
		ctx.strokeStyle = C.accentSoft;
		ctx.lineWidth = LW;
		ctx.setLineDash([3, 3]);
		for (const p of parts()) {
			if (!p.parent) continue;
			const a = worldPivot(p.name, W);
			const b = worldPivot(p.parent, W);
			if (!a || !b) continue;
			const sa = toS(a);
			const sb = toS(b);
			ctx.beginPath();
			ctx.moveTo(sa[0], sa[1]);
			ctx.lineTo(sb[0], sb[1]);
			ctx.stroke();
		}
		ctx.setLineDash([]);
		world();
		{
			// hover and selection, through each part's pose
			const hov = ed.hover.value;
			const hs = shapeAt(hov);
			const ps = parts();
			if (clip) {
				// posing a key: what a grab would take is a whole part, and the part being posed is drawn round
				const outlinePart = (p: number, css: string, w: number) => {
					const xf = partXf(p, W);
					for (const sh of ps[p] ? shapesIn(ps[p]) : []) outlineShape(ctx, sh, css, w, zoom, (q) => xfApply(xf, q), xfScale(xf));
				};
				if (hov && hov.p !== ed.curPart.value) outlinePart(hov.p, HOVER, LW);
				if (ed.partPicked.value) outlinePart(ed.curPart.value, ACCENT, 1.5 * LW);
				// the joints: every drawn part's pivot, each one a grip
				screen();
				ctx.strokeStyle = C.accentSoft;
				ctx.fillStyle = C.handleFill;
				ctx.lineWidth = LW;
				for (const sp of fr ?? []) {
					const o = worldPivot(sp.part, W);
					if (!o) continue;
					const s = toS(o);
					ctx.beginPath();
					ctx.arc(s[0], s[1], 4, 0, Math.PI * 2);
					ctx.fill();
					ctx.stroke();
				}
				world();
			} else if (hov && hs && !ed.sel.value.some((r) => r.p === hov.p && r.s === hov.s)) {
				const xf = partXf(hov.p, W);
				outlineShape(ctx, hs, HOVER, LW, zoom, (q) => xfApply(xf, q), xfScale(xf));
			}
			for (const r of ed.sel.value) {
				const sh = ps[r.p] ? shapesIn(ps[r.p])[r.s] : undefined;
				if (!sh) continue;
				const xf = partXf(r.p, W);
				outlineShape(ctx, sh, ACCENT, 1.5 * LW, zoom, (q) => xfApply(xf, q), xfScale(xf));
			}
			if (selShape() && !clip) {
				const hs = worldHandles();
				const posed = selShapePosed() ?? selShape();
				// a path's tangents (1.7): a line from the vertex to each handle, the handle a small ring
				const tangents = posed ? tangentHandles(posed) : [];
				if (tangents.length) {
					screen();
					ctx.strokeStyle = C.accentSoft;
					ctx.lineWidth = LW;
					for (const t of tangents) {
						const a = toS(hs[t.v]);
						const b = toS(hs[t.h]);
						if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1) continue;
						ctx.beginPath();
						ctx.moveTo(a[0], a[1]);
						ctx.lineTo(b[0], b[1]);
						ctx.stroke();
						ctx.beginPath();
						ctx.arc(b[0], b[1], 3.5, 0, Math.PI * 2);
						ctx.fillStyle = C.handleFill;
						ctx.fill();
						ctx.stroke();
					}
					world();
					drawHandles(ctx, hs.slice(0, posed!.kind === "path" ? posed!.points.length : hs.length).map(toS), screen, world, C.handleFill, ACCENT, LW);
				} else drawHandles(ctx, hs.map(toS), screen, world, C.handleFill, ACCENT, LW);
			}
			const grips = scaleGrips();
			if (grips.length && ed.sel.value.length && !clip) {
				screen();
				const a = toS(grips[0].at);
				const c = toS(grips[2].at);
				ctx.strokeStyle = C.accentSoft;
				ctx.lineWidth = LW;
				ctx.setLineDash([4, 4]);
				ctx.strokeRect(a[0], a[1], c[0] - a[0], c[1] - a[1]);
				ctx.setLineDash([]);
				for (const g of grips) {
					const s = toS(g.at);
					ctx.fillStyle = C.handleFill;
					ctx.strokeStyle = ACCENT;
					ctx.beginPath();
					ctx.rect(s[0] - 4, s[1] - 4, 8, 8);
					ctx.fill();
					ctx.stroke();
				}
				world();
			}
			// the current part: its pivot (a grip that moves it), its lever, its anchors
			const part = curPart();
			const sp = poseOfCur();
			if (part) {
				const xf = partXf(ed.curPart.value, W);
				screen();
				const o = toS(xfApply(xf, pivotOf(part)));
				if (sp) {
					ctx.fillStyle = C.handleFill;
					ctx.strokeStyle = ACCENT;
					ctx.lineWidth = 1.5 * LW;
					ctx.beginPath();
					ctx.arc(o[0], o[1], 7, 0, Math.PI * 2);
					ctx.fill();
					ctx.stroke();
					crosshair(ctx, o, ACCENT, 5);
					const lever = poseLever();
					if (lever) {
						const l = toS(lever);
						ctx.strokeStyle = ACCENT;
						ctx.lineWidth = 1.5 * LW;
						ctx.beginPath();
						ctx.moveTo(o[0], o[1]);
						ctx.lineTo(l[0], l[1]);
						ctx.stroke();
						ctx.fillStyle = ACCENT;
						ctx.beginPath();
						ctx.arc(l[0], l[1], 5, 0, Math.PI * 2);
						ctx.fill();
					}
				} else crosshair(ctx, o, C.text3);
				for (const a of anchorsIn(part)) {
					const s = toS(xfApply(xf, a.at));
					if (a.angle !== undefined) {
						// the direction an attached thing points
						const tip = toS(xfApply(xf, [a.at[0] + Math.cos(a.angle) * (14 / zoom), a.at[1] + Math.sin(a.angle) * (14 / zoom)]));
						ctx.strokeStyle = TEAL;
						ctx.lineWidth = 1.5 * LW;
						ctx.beginPath();
						ctx.moveTo(s[0], s[1]);
						ctx.lineTo(tip[0], tip[1]);
						ctx.stroke();
						ctx.fillStyle = TEAL;
						ctx.beginPath();
						ctx.arc(tip[0], tip[1], 2.5, 0, Math.PI * 2);
						ctx.fill();
					}
					diamond(ctx, s, TEAL);
					ctx.fillStyle = TEAL;
					ctx.font = "11px system-ui, sans-serif";
					ctx.fillText(a.name, s[0] + 8, s[1] - 6);
				}
				world();
			}
			// chain reach points: rings you can drag
			screen();
			for (const g of chainGrabs()) {
				const s = toS(g.at);
				ctx.strokeStyle = TEAL;
				ctx.lineWidth = 2 * LW;
				ctx.beginPath();
				ctx.arc(s[0], s[1], 7, 0, Math.PI * 2);
				ctx.stroke();
				if (g.pinned) {
					// pinned: the chain keeps reaching here while the pose changes
					ctx.fillStyle = TEAL;
					ctx.beginPath();
					ctx.arc(s[0], s[1], 3, 0, Math.PI * 2);
					ctx.fill();
				}
				ctx.fillStyle = TEAL;
				ctx.font = "11px system-ui, sans-serif";
				ctx.fillText(g.c.name, s[0] + 10, s[1] + 14);
			}
			world();
		}
	}

	// in progress: a rubber band, a shape being drawn, a polygon's path
	const cur = ix.cursor;
	if (ix.marquee && cur) {
		screen();
		const a = toS(ix.mqA);
		const b = toS(cur);
		ctx.fillStyle = C.marquee;
		ctx.strokeStyle = C.accentSoft;
		ctx.lineWidth = LW;
		ctx.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
		ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
		world();
	}
	if (ix.drawing && cur) {
		const tool = ed.tool.value;
		const b = (collide ? cur : drawCursor()) ?? cur;
		const css = collide ? TEAL : cssColor(colorOf(tokens, curTokName()));
		ctx.globalAlpha = 0.6;
		let sh: Shape | null = null;
		if (tool === "circle") sh = { kind: "circle", at: ix.drawA, r: Math.hypot(b[0] - ix.drawA[0], b[1] - ix.drawA[1]) };
		else if (tool === "line") sh = { kind: "line", a: ix.drawA, b, w: collide ? 6 : 1.4 };
		else if (tool === "rect") {
			const lo: Vec2 = [Math.min(ix.drawA[0], b[0]), Math.min(ix.drawA[1], b[1])];
			const hi: Vec2 = [Math.max(ix.drawA[0], b[0]), Math.max(ix.drawA[1], b[1])];
			sh = { kind: "poly", points: [lo, [hi[0], lo[1]], hi, [lo[0], hi[1]]] };
		}
		if (sh) fillShape(ctx, sh, css);
		ctx.globalAlpha = 1;
	}
	// the snap marker: where a point pulled to
	if (ix.snapAt && (ix.down || ix.drawing)) {
		screen();
		const s = toS(ix.snapAt);
		ctx.strokeStyle = TEAL;
		ctx.lineWidth = LW;
		ctx.beginPath();
		ctx.moveTo(s[0] - 6, s[1] - 6);
		ctx.lineTo(s[0] + 6, s[1] + 6);
		ctx.moveTo(s[0] + 6, s[1] - 6);
		ctx.lineTo(s[0] - 6, s[1] + 6);
		ctx.stroke();
		world();
	}
	const pts = ed.polyPts.value;
	if (pts.length) {
		const css = collide ? TEAL : cssColor(colorOf(tokens, curTokName()));
		const curSnapped = collide ? cur : cur ? snapForPreview() : null;
		const outs = ed.polyOut.value;
		const curved = outs.some((o) => o && (Math.abs(o[0]) > 1e-9 || Math.abs(o[1]) > 1e-9));
		if (pts.length >= 3) {
			ctx.globalAlpha = 0.35;
			// the pen's curve so far (1.7), or the polygon
			tracePoly(ctx, curved ? pathPoints({ points: pts, out: pts.map((_, i) => outs[i] ?? [0, 0]), in: pts.map((_, i) => (outs[i] ? [-outs[i][0], -outs[i][1]] : [0, 0])), closed: true }) : pts, ident);
			ctx.fillStyle = css;
			ctx.fill();
			ctx.globalAlpha = 1;
		}
		if (curved) {
			// the handles pulled so far
			screen();
			ctx.strokeStyle = C.accentSoft;
			ctx.lineWidth = LW;
			pts.forEach((q, i) => {
				const o = outs[i];
				if (!o || (Math.abs(o[0]) < 1e-9 && Math.abs(o[1]) < 1e-9)) return;
				const a = toS([q[0] - o[0], q[1] - o[1]]);
				const b = toS([q[0] + o[0], q[1] + o[1]]);
				ctx.beginPath();
				ctx.moveTo(a[0], a[1]);
				ctx.lineTo(b[0], b[1]);
				ctx.stroke();
			});
			world();
		}
		screen();
		ctx.strokeStyle = css;
		ctx.lineWidth = 1.5 * LW;
		ctx.beginPath();
		pts.forEach((q, i) => {
			const s = toS(q);
			if (i === 0) ctx.moveTo(s[0], s[1]);
			else ctx.lineTo(s[0], s[1]);
		});
		if (curSnapped) {
			const s = toS(curSnapped);
			ctx.lineTo(s[0], s[1]);
		}
		ctx.stroke();
		const first = toS(pts[0]);
		ctx.fillStyle = pts.length >= 3 && cur && Math.hypot(toS(cur)[0] - first[0], toS(cur)[1] - first[1]) < 10 ? ACCENT : css;
		ctx.beginPath();
		ctx.arc(first[0], first[1], 5, 0, Math.PI * 2);
		ctx.fill();
		world();
	}
	if (ed.pending.value !== "none" && cur) {
		screen();
		crosshair(ctx, toS(cur), ACCENT, 14);
		world();
	}
	screen();
}

function snapForPreview(): Vec2 | null {
	// the poly's rubber line ends where a click would land
	return ix.cursor ? (ix.mods.cmd ? ix.cursor : (drawCursorSnapOnly() ?? ix.cursor)) : null;
}

function drawCursorSnapOnly(): Vec2 | null {
	const c = ix.cursor;
	if (!c) return null;
	const saved = ix.drawA;
	ix.drawA = c;
	const r = drawCursor();
	ix.drawA = saved;
	return r;
}

function drawHandles(ctx: CanvasRenderingContext2D, pts: Vec2[], screen: () => void, world: () => void, fill: string, stroke: string, lw: number) {
	screen();
	for (const s of pts) {
		ctx.fillStyle = fill;
		ctx.strokeStyle = stroke;
		ctx.lineWidth = 1.5 * lw;
		ctx.beginPath();
		ctx.arc(s[0], s[1], 4.5, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
	}
	world();
}

function crosshair(ctx: CanvasRenderingContext2D, s: Vec2, css: string, r = 8) {
	ctx.strokeStyle = css;
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(s[0] - r, s[1]);
	ctx.lineTo(s[0] + r, s[1]);
	ctx.moveTo(s[0], s[1] - r);
	ctx.lineTo(s[0], s[1] + r);
	ctx.stroke();
	ctx.beginPath();
	ctx.arc(s[0], s[1], 3, 0, Math.PI * 2);
	ctx.stroke();
}

function diamond(ctx: CanvasRenderingContext2D, s: Vec2, css: string) {
	ctx.fillStyle = css;
	ctx.beginPath();
	ctx.moveTo(s[0], s[1] - 5);
	ctx.lineTo(s[0] + 5, s[1]);
	ctx.lineTo(s[0], s[1] + 5);
	ctx.lineTo(s[0] - 5, s[1]);
	ctx.closePath();
	ctx.fill();
}

export function drawGrid(ctx: CanvasRenderingContext2D, W: number, H: number, px: number, py: number, zoom: number, minor: string, major: string) {
	// a step that stays between 24 and 120 pixels
	let step = 1;
	while (step * zoom < 24) step *= step === 1 ? 5 : 2;
	while (step * zoom > 120 && step > 1) step /= step % 5 === 0 ? 5 : 2;
	const x0 = px - W / 2 / zoom;
	const y0 = py - H / 2 / zoom;
	const x1 = px + W / 2 / zoom;
	const y1 = py + H / 2 / zoom;
	ctx.lineWidth = 1;
	ctx.strokeStyle = minor;
	ctx.beginPath();
	for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) {
		const sx = Math.round((x - px) * zoom + W / 2) + 0.5;
		ctx.moveTo(sx, 0);
		ctx.lineTo(sx, H);
	}
	for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) {
		const sy = Math.round((y - py) * zoom + H / 2) + 0.5;
		ctx.moveTo(0, sy);
		ctx.lineTo(W, sy);
	}
	ctx.stroke();
	// the axes
	ctx.strokeStyle = major;
	ctx.beginPath();
	const ax = Math.round(-px * zoom + W / 2) + 0.5;
	const ay = Math.round(-py * zoom + H / 2) + 0.5;
	ctx.moveTo(ax, 0);
	ctx.lineTo(ax, H);
	ctx.moveTo(0, ay);
	ctx.lineTo(W, ay);
	ctx.stroke();
}

