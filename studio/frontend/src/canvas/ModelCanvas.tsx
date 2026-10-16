// The model canvas element: sizes itself, routes the pointer into
// model3.ts, and redraws when the store or the view moves. Middle drag
// orbits (⇧ pans, and so does Space), a mouse wheel zooms at the cursor,
// two fingers turn the view (⇧ pans) and a pinch zooms; Alt+drag anywhere
// orbits too. A left drag on nothing is a marquee. The orbit is a turntable
// about what is chosen; ⌘ held tumbles freely.

import { useEffect, useRef } from "preact/hooks";
import { effect } from "@preact/signals";
import type { Vec2 } from "@fastart/core";
import { view, toWorld } from "./view.ts";
import { render3, renderGround, onDown, onMove, onUp, cancelGesture, ix3, orbitDrag, orbitStart } from "./model3.ts";
import { wheelNav } from "./orbit.ts";
import { gizmoCancel, modal3, useGizmo, modelGizmo } from "./gizmo3.ts";
import { viewXf3, type Vec3 } from "@fastart/core";
import { drawLayers, poseParts, type SolidLayer } from "./gl3.ts";
import { meshCancel, meshModal } from "./meshtool3.ts";
import { sculptCancel, sculptAdjust } from "./sculpt3.ts";
import { sculpt, maskRev } from "../state/sculpting.ts";
import { md, frameParts, mannequinPoses } from "../state/model.ts";
import { work, refRev, shading } from "../state/workspace.ts";
import { canvasColors } from "../state/theme.ts";
import { theme } from "../state/theme.ts";
import { openContextMenu } from "../state/menu.ts";
import { run, keysFor } from "../state/commands.ts";

// the canvas's colour as numbers, for washing a mannequin toward it: whatever CSS spells it as, a pixel of it says
let bgSeen = "";
let bgRgb: Vec3 = [1, 1, 1];
function canvasRgb(): Vec3 {
	const css = canvasColors().bg;
	if (css === bgSeen) return bgRgb;
	bgSeen = css;
	const c = document.createElement("canvas");
	c.width = c.height = 1;
	const x = c.getContext("2d");
	if (!x) return bgRgb;
	x.fillStyle = css;
	x.fillRect(0, 0, 1, 1);
	const d = x.getImageData(0, 0, 1, 1).data;
	bgRgb = [d[0] / 255, d[1] / 255, d[2] / 255];
	return bgRgb;
}

export function ModelCanvas() {
	const ref = useRef<HTMLCanvasElement>(null);
	const groundRef = useRef<HTMLCanvasElement>(null);
	const glRef = useRef<HTMLCanvasElement>(null);
	useGizmo(modelGizmo);
	useEffect(() => {
		const canvas = ref.current!;
		const ground = groundRef.current!;
		const glCanvas = glRef.current!;
		const ctx = canvas.getContext("2d")!;
		const gctx = ground.getContext("2d")!;
		let W = 0;
		let H = 0;
		let dpr = window.devicePixelRatio || 1;
		let raf = 0;
		const size = () => {
			dpr = window.devicePixelRatio || 1;
			W = canvas.clientWidth;
			H = canvas.clientHeight;
			canvas.width = Math.round(W * dpr);
			canvas.height = Math.round(H * dpr);
			ground.width = canvas.width;
			ground.height = canvas.height;
			view.size.value = [W, H];
			draw();
		};
		const draw = () => {
			raf = 0;
			if (!W || !H) return;
			renderGround(gctx, W, H, dpr);
			// the mannequin first, dimmed, in the same space and the same depth buffer: the model is fitted to it
			const layers: SolidLayer[] = [];
			const man = md.mannequin.value;
			if (man) layers.push({ fps: poseParts(man.doc, mannequinPoses(), viewXf3(md.turn.value), man.compiled), tokens: man.tokens, dim: 0.6 });
			layers.push({ fps: frameParts(), tokens: md.tokens.value, patterns: md.patterns.value });
			const solid = drawLayers(glCanvas, layers, md.light.value, md.ambient.value, { W, H, dpr, pan: view.pan.value, zoom: view.zoom.value }, { clay: shading.value === "clay", bg: canvasRgb() });
			render3(ctx, W, H, dpr, !solid);
		};
		const request = () => {
			if (!raf) raf = requestAnimationFrame(draw);
		};
		const ro = new ResizeObserver(size);
		ro.observe(canvas);
		size();
		const stop = effect(() => {
			void md.rev.value;
			void md.sel.value;
			void md.also.value;
			void md.vert.value;
			void md.hover.value;
			void md.curPart.value;
			void md.curState.value;
			void md.curClip.value;
			void md.clipTime.value;
			void md.polyPts.value;
			void md.tool.value;
			void md.turn.value;
			void md.light.value;
			void md.ambient.value;
			void md.outline.value;
			void md.collide.value;
			void md.patterns.value;
			void md.pending.value;
			void md.pick.value;
			void md.verts.value;
			void md.edges.value;
			void md.faces.value;
			void md.mannequin.value;
			void md.painting.value;
			void md.sculpting.value;
			void sculpt.value;
			void maskRev.value;
			void sculptAdjust.value;
			void md.paintTok.value;
			void md.pipePts.value;
			void md.pipePt.value;
			void md.onSurface.value;
			void md.lift.value;
			void work.value;
			void refRev.value;
			void shading.value;
			void meshModal.value;
			void view.pan.value;
			void modal3.value;
			void view.zoom.value;
			void view.snapGrid.value;
			void theme.rev.value;
			request();
		});
		let panning = false;
		let panLast: Vec2 = [0, 0];
		let orbiting = false;
		let orbitLast: Vec2 = [0, 0];
		const local = (e: PointerEvent): Vec2 => {
			const r = canvas.getBoundingClientRect();
			return [e.clientX - r.left, e.clientY - r.top];
		};
		const mods = (e: PointerEvent) => ({ shift: e.shiftKey, alt: e.altKey, cmd: e.metaKey || e.ctrlKey, pressure: e.pointerType === "pen" ? e.pressure : undefined });
		const menu = (e: PointerEvent) => {
			e.preventDefault();
			const some = !!md.sel.value;
			openContextMenu(e.clientX, e.clientY, [
				{ label: "Duplicate", keys: keysFor("edit.duplicate"), disabled: some ? false : true, run: () => run("edit.duplicate") },
				{ label: "Mirror across x", disabled: !some, run: () => run("model.mirror") },
				{ label: "Delete", keys: "⌫", disabled: !some, danger: true, sep: true, run: () => run("edit.delete") },
				{ label: "Front", sep: true, run: () => run("view.front") },
				{ label: "Left", run: () => run("view.left") },
				{ label: "Right", run: () => run("view.right") },
				{ label: "Top", run: () => run("view.top") },
				{ label: "Zoom to fit", keys: keysFor("view.fit"), sep: true, run: () => run("view.fit") },
			]);
		};
		const down = (e: PointerEvent) => {
			canvas.setPointerCapture(e.pointerId);
			const s = local(e);
			// a right click puts a transform under way back, before it is a menu
			if (e.button === 2) return meshCancel() || sculptCancel() || gizmoCancel() ? (e.preventDefault(), request()) : menu(e);
			// the middle button orbits, with ⇧ it pans; Space-drag pans as on the 2D canvas
			if ((e.button === 1 && e.shiftKey) || (e.button === 0 && md.space)) {
				panning = true;
				panLast = s;
				canvas.classList.add("grab");
				return;
			}
			if (e.button === 1 || (e.button === 0 && e.altKey)) {
				orbiting = true;
				orbitLast = s;
				orbitStart();
				canvas.classList.add("grab");
				return;
			}
			if (e.button !== 0) return;
			onDown(toWorld(s, W, H), mods(e));
			request();
		};
		const move = (e: PointerEvent) => {
			const s = local(e);
			if (panning) {
				const z = view.zoom.value;
				const [px, py] = view.pan.value;
				view.pan.value = [px - (s[0] - panLast[0]) / z, py - (s[1] - panLast[1]) / z];
				panLast = s;
				return;
			}
			if (orbiting) {
				orbitDrag(s[0] - orbitLast[0], s[1] - orbitLast[1], e.metaKey || e.ctrlKey);
				orbitLast = s;
				return;
			}
			onMove(toWorld(s, W, H), mods(e));
			request();
		};
		const up = (e: PointerEvent) => {
			const s = local(e);
			if (panning) {
				panning = false;
				canvas.classList.remove("grab");
				return;
			}
			if (orbiting) {
				orbiting = false;
				canvas.classList.remove("grab");
				return;
			}
			if (ix3.down) onUp(toWorld(s, W, H), mods(e));
			request();
		};
		const leave = () => {
			ix3.cursor = null;
			if (md.hover.value) md.hover.value = null;
			request();
		};
		const wheel = (e: WheelEvent) => {
			e.preventDefault();
			const r = canvas.getBoundingClientRect();
			const s: Vec2 = [e.clientX - r.left, e.clientY - r.top];
			wheelNav(e, s, W, H, orbitDrag);
		};
		const ctxmenu = (e: Event) => e.preventDefault();
		canvas.addEventListener("pointerdown", down);
		canvas.addEventListener("pointermove", move);
		canvas.addEventListener("pointerup", up);
		canvas.addEventListener("pointercancel", () => cancelGesture());
		canvas.addEventListener("pointerleave", leave);
		canvas.addEventListener("wheel", wheel, { passive: false });
		canvas.addEventListener("contextmenu", ctxmenu);
		return () => {
			ro.disconnect();
			stop();
			if (raf) cancelAnimationFrame(raf);
			canvas.removeEventListener("pointerdown", down);
			canvas.removeEventListener("pointermove", move);
			canvas.removeEventListener("pointerup", up);
			canvas.removeEventListener("pointerleave", leave);
			canvas.removeEventListener("wheel", wheel);
			canvas.removeEventListener("contextmenu", ctxmenu);
		};
	}, []);
	return (
		<>
			<canvas ref={groundRef} class="under" />
			<canvas ref={glRef} class="under" />
			<canvas ref={ref} class={md.tool.value === "select" ? "select" : ""} />
		</>
	);
}
