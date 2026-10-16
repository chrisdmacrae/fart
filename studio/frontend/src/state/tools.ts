// The tools Uranus offers Claude, answered by the page: it holds the
// document. Each returns an MCP result: content blocks, and isError when
// something was wrong with the ask.

import { validate, sampleClip, solveTargets, sampleTargets, outlineDoc, leanDoc, partDoc, applyPatch, pose as poseVerb, morph as morphVerb, setClip, make as makeVerb, type Doc, type PatchOp, type Recipe } from "@fastart/core";
import { shell, type ToolCall } from "../shell/shell.ts";
import { ed, doc, curState, curClip, parts, primary, applyExternalDoc, frame, shapesIn } from "./editor.ts";
import { project, openDoc, refreshDirection } from "./project.ts";
import { renderPNG } from "../canvas/draw.ts";
import { chatNote } from "./chat.ts";
import { projectDoc, as3d, type Doc3 } from "@fastart/core";
import * as M from "./model.ts";
import { VIEWS, type Vec3 } from "@fastart/core";
import { turned } from "../canvas/orbit.ts";
import * as G from "./meshops.ts";
import { importTool } from "./importGltf.ts";
import { parseDoc, resolvePalettes, colorOf, viewXf3, worldTransforms3, xf3Mul, type Mod, type Token } from "@fastart/core";
import { buildSidecars, sidecarOf, sidecars } from "./sidecar.ts";
import { paintCompiled, type CompiledIn, type Painter } from "./sidecarRead.ts";
import { dirname, joinRel } from "./paths.ts";

const inModel = () => project.screen.value === "model" && !!M.md.path.value;

type Block = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
interface Result {
	content: Block[];
	isError?: boolean;
}
const text = (t: string): Result => ({ content: [{ type: "text", text: t }] });
const fail = (t: string): Result => ({ content: [{ type: "text", text: t }], isError: true });

const HARD = new Set(["json", "version", "schema", "path"]);

/** The document in the detail asked for: the outline (default), lean (no bakes), full, or one part. */
function view(d: Doc, args: Record<string, unknown>, rel: string | null): unknown {
	if (typeof args.part === "string") {
		const p = partDoc(d, args.part);
		return p ?? { error: `no part named ${args.part}` };
	}
	const detail = typeof args.detail === "string" ? args.detail : "outline";
	if (detail === "full") return d;
	if (detail === "lean") return leanDoc(d);
	return outlineDoc(d, rel ?? undefined);
}

function getDocument(args: Record<string, unknown>): Result {
	if (inModel()) {
		const st = M.curState();
		const clip = M.curClip();
		const sel = M.md.sel.value;
		return text(
			JSON.stringify({
				open: M.md.path.value,
				note: "a 3D model (space 3d) is open in the model screen: mesh, ball, rod and sweep shapes, [x, y, z] turns; render shows it under the current view. detail: outline (this), lean, full; or part: name",
				doc: view(M.doc() as unknown as Doc, args, M.md.path.value),
				selection: { part: M.parts()[M.md.curPart.value]?.name ?? null, shape: sel ? { part: M.parts()[sel.part]?.name, index: sel.shape } : null },
				onCanvas: clip ? { clip: clip.name, t: M.md.clipTime.value } : { state: st?.name ?? null },
				view: M.md.viewName.value || M.md.turn.value,
				sharedTokens: M.md.shared.value.map((t) => t.name),
				files: project.files.value,
			}),
		);
	}
	const rel = ed.path.value;
	if (!rel || ed.isPalette.value) {
		return text(
			JSON.stringify({
				open: rel ?? null,
				note: rel ? "a palette file is open (colours only)" : "no file is open: the shelf is showing",
				files: project.files.value,
				...(rel ? { doc: doc() } : {}),
			}),
		);
	}
	const d = doc();
	const p = primary();
	const sel = ed.sel.value;
	const st = curState();
	const clip = curClip();
	return text(
		JSON.stringify({
			open: rel,
			note: "detail: outline (this), lean (no bakes), full; or part: name for one part",
			doc: view(d, args, rel),
			selection: { part: parts()[ed.curPart.value]?.name ?? null, primaryShape: p ? { part: parts()[p.p]?.name, index: p.s, shape: shapesIn(parts()[p.p])[p.s] } : null, shapes: sel.map((r) => ({ part: parts()[r.p]?.name, index: r.s })) },
			onCanvas: clip ? { clip: clip.name, t: ed.clipTime.value } : { state: st?.name ?? null },
			sharedTokens: ed.shared.value.map((t) => t.name),
			files: project.files.value,
		}),
	);
}

function applyDocument(args: Record<string, unknown>): Result {
	if (inModel()) {
		const d = args.doc;
		if (typeof d !== "object" || d === null || Array.isArray(d)) return fail("doc must be the whole document object");
		const r = validate(d, { refTokens: M.md.unresolved.value.length ? null : M.md.shared.value.map((t) => t.name) });
		if (r.errors.length) return fail("refused, the document has errors:\n" + r.errors.map((e) => `${e.code} ${e.path}: ${e.message}`).join("\n"));
		if (!as3d(d as Doc)) return fail("the open file is a 3D model; the document must say space: \"3d\"");
		const summary = M.applyExternalDoc(d as Doc3);
		const note = typeof args.note === "string" && args.note.trim() ? args.note.trim() : summary;
		chatNote(`Claude changed the model · ${note}`);
		return text(`applied. ${summary}`);
	}
	if (!ed.path.value) return fail("no file is open in the editor; open_file first");
	const d = args.doc;
	if (typeof d !== "object" || d === null || Array.isArray(d)) return fail("doc must be the whole document object");
	const r = validate(d, { refTokens: ed.unresolved.value.length ? null : ed.shared.value.map((t) => t.name) });
	if (r.errors.some((e) => HARD.has(e.code)) || r.errors.length) {
		return fail("refused, the document has errors:\n" + r.errors.map((e) => `${e.code} ${e.path}: ${e.message}`).join("\n"));
	}
	const summary = applyExternalDoc(d as Doc);
	const note = typeof args.note === "string" && args.note.trim() ? args.note.trim() : summary;
	chatNote(`Claude changed the document · ${note}`);
	return text(`applied. ${summary}${r.warnings.length ? `\nwarnings: ${r.warnings.map((w) => `${w.code} ${w.path}`).join(", ")}` : ""}`);
}

/** A copy of the open document, changed by fn, validated and applied as one undo step. */
function change(args: Record<string, unknown>, what: string, fn: (d: Doc) => string[]): Result {
	const model = inModel();
	if (!model && !ed.path.value) return fail("no file is open in the editor; open_file first");
	const d = JSON.parse(JSON.stringify(model ? M.doc() : doc())) as Doc;
	let lines: string[];
	try {
		lines = fn(d);
	} catch (e) {
		return fail(`${what} refused: ${(e as Error).message}`);
	}
	const shared = model ? M.md.shared.value : ed.shared.value;
	const unresolved = model ? M.md.unresolved.value : ed.unresolved.value;
	const r = validate(d, { refTokens: unresolved.length ? null : shared.map((t) => t.name) });
	if (r.errors.length) return fail(`${what} refused, the result has errors:\n` + r.errors.map((e) => `${e.code} ${e.path}: ${e.message}`).join("\n"));
	const summary = model ? M.applyExternalDoc(d as unknown as Doc3) : applyExternalDoc(d);
	const note = typeof args.note === "string" && args.note.trim() ? args.note.trim() : lines.join("; ");
	chatNote(`Claude changed the ${model ? "model" : "document"} · ${note}`);
	return text(`applied: ${lines.join("; ")} (${summary})${r.warnings.length ? `\nwarnings: ${r.warnings.map((w) => `${w.code} ${w.path}`).join(", ")}` : ""}`);
}

function applyPatchTool(args: Record<string, unknown>): Result {
	const ops = args.ops;
	if (!Array.isArray(ops) || !ops.length) return fail("ops is a non-empty list of {op, path, value?, from?}");
	return change(args, "the patch", (d) => applyPatch(d, ops as PatchOp[]));
}

function poseTool(args: Record<string, unknown>): Result {
	if (typeof args.state !== "string" || typeof args.part !== "string") return fail("state and part are required");
	return change(args, "the pose", (d) => [poseVerb(d, args.state as string, args.part as string, args as never)]);
}

function morphTool(args: Record<string, unknown>): Result {
	if (typeof args.state !== "string" || typeof args.part !== "string" || typeof args.shape !== "number") return fail("state, part and shape (index) are required");
	return change(args, "the morph", (d) => [morphVerb(d, args.state as string, args.part as string, args as never)]);
}

function clipTool(args: Record<string, unknown>): Result {
	if (typeof args.name !== "string" || args.keys === undefined) return fail("name and keys are required");
	return change(args, "the clip", (d) => [setClip(d, args.name as string, { keys: args.keys as never, loop: !!args.loop })]);
}

function makeTool(args: Record<string, unknown>): Result {
	if (typeof args.part !== "string" || typeof args.recipe !== "object" || !args.recipe) return fail("part and recipe are required");
	return change(args, "the shape", (d) => [makeVerb(d, args.part as string, args.recipe as Recipe).note]);
}

/** Several renders tiled in one image: every state, or a clip's frames. */
async function sheet(d: Doc, tokens: readonly import("@fastart/core").Token[], args: Record<string, unknown>): Promise<Result> {
	const which = args.sheet === "clip" ? "clip" : "states";
	const cell = typeof args.size === "number" ? Math.max(64, Math.min(512, args.size)) : 256;
	let frames: { label: string; pose: string | readonly import("@fastart/core").StatePart[] }[] = [];
	if (which === "states") frames = (d.states ?? []).map((s) => ({ label: s.name, pose: s.name }));
	else {
		const c = d.clips?.find((k) => k.name === args.clip) ?? d.clips?.[0];
		if (!c) return fail("no clip to sheet");
		const n = typeof args.frames === "number" ? Math.max(2, Math.min(24, args.frames)) : 8;
		const dur = c.keys[c.keys.length - 1]?.t ?? 0;
		for (let i = 0; i < n; i++) {
			const t = (i / (n - 1)) * dur;
			const poses = sampleClip(d, c, t);
			const tg = sampleTargets(d, c, t);
			if (tg.length) solveTargets(d, poses, tg);
			frames.push({ label: `${c.name} ${t.toFixed(2)}s`, pose: poses });
		}
	}
	if (!frames.length) return fail("nothing to sheet");
	const cols = Math.min(frames.length, 4);
	const rows = Math.ceil(frames.length / cols);
	const canvas = document.createElement("canvas");
	canvas.width = cols * cell;
	canvas.height = rows * (cell + 18);
	const ctx = canvas.getContext("2d")!;
	ctx.fillStyle = "#18181b";
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.fillStyle = "#c8c8c4";
	ctx.font = "12px system-ui, sans-serif";
	for (let i = 0; i < frames.length; i++) {
		const png = renderPNG(d, tokens, frames[i].pose, cell);
		const img = new Image();
		await new Promise<void>((res) => {
			img.onload = () => res();
			img.onerror = () => res();
			img.src = `data:image/png;base64,${png}`;
		});
		const x = (i % cols) * cell;
		const y = Math.floor(i / cols) * (cell + 18);
		ctx.drawImage(img, x + (cell - img.width) / 2, y + (cell - img.height) / 2);
		ctx.fillText(frames[i].label, x + 6, y + cell + 13);
	}
	const data = canvas.toDataURL("image/png").split(",")[1];
	return { content: [{ type: "image", data, mimeType: "image/png" }, { type: "text", text: `sheet of ${frames.length} ${which === "states" ? "states" : "frames"}: ${frames.map((f) => f.label).join(", ")}` }] };
}

/** The views render can look from, by name: the six straight-on ones and a three-quarter view from the front, the right and above. */
const THREE_QUARTER: Vec3 = turned(turned([0, 0, 0], -Math.PI / 5, 0), 0, Math.PI / 8);
function viewNamed(name: string): string | Vec3 | null {
	if (name in VIEWS) return name;
	if (name === "three-quarter" || name === "3/4" || name === "threequarter") return THREE_QUARTER;
	return null;
}

function render(args: Record<string, unknown>): Result | Promise<Result> {
	// another file than the one open: from its sidecar
	const other = typeof args.path === "string" && args.path ? args.path : null;
	if (other && other !== (inModel() ? M.md.path.value : ed.path.value)) return renderOther(other, args);
	if (inModel()) {
		// one view, or several in one call: an image each, in the order asked
		const several = Array.isArray(args.views) ? args.views.filter((v): v is string => typeof v === "string") : null;
		const names = several?.length ? several : [typeof args.view === "string" ? args.view : ""];
		const size = typeof args.size === "number" ? Math.max(64, Math.min(1024, args.size)) : names.length > 1 ? 384 : 512;
		const content: Block[] = [];
		const said: string[] = [];
		for (const name of names) {
			const v = name ? viewNamed(name) : M.md.viewName.value || M.md.turn.value;
			if (v === null) return fail(`no view named ${name}; views: ${Object.keys(VIEWS).join(", ")}, three-quarter`);
			const label = name || M.md.viewName.value || "free";
			const flat = projectDoc(M.doc(), { view: v, light: M.md.light.value, ambient: M.md.ambient.value });
			if (typeof args.clip === "string") {
				const c = flat.clips?.find((k) => k.name === args.clip);
				if (!c) return fail(`no clip named ${args.clip}`);
				const t = typeof args.t === "number" ? args.t : 0;
				content.push({ type: "image", data: renderPNG(flat, M.md.tokens.value, sampleClip(flat, c, t), size), mimeType: "image/png" });
				said.push(`clip ${c.name} at ${t}s, view ${label}`);
				continue;
			}
			const pose: string | undefined = typeof args.state === "string" ? args.state : M.curState()?.name;
			if (pose && !flat.states?.some((s) => s.name === pose)) return fail(`no state named ${pose}`);
			content.push({ type: "image", data: renderPNG(flat, M.md.tokens.value, pose, size), mimeType: "image/png" });
			said.push(`state ${pose ?? "?"}, view ${label}`);
		}
		content.push({ type: "text", text: `rendered ${said.join("; ")}` });
		return { content };
	}
	if (!ed.path.value) return fail("no file is open");
	const d = doc();
	const size = typeof args.size === "number" ? Math.max(64, Math.min(1024, args.size)) : 512;
	let pose: string | ReturnType<typeof frame> | undefined;
	let label = "the canvas";
	if (typeof args.clip === "string") {
		const c = d.clips?.find((k) => k.name === args.clip);
		if (!c) return fail(`no clip named ${args.clip}`);
		const t = typeof args.t === "number" ? args.t : 0;
		const poses = sampleClip(d, c, t);
		const targets = sampleTargets(d, c, t);
		if (targets.length) solveTargets(d, poses, targets);
		pose = poses;
		label = `clip ${c.name} at ${t}s`;
	} else if (typeof args.state === "string") {
		if (!d.states?.some((s) => s.name === args.state)) return fail(`no state named ${args.state}`);
		pose = args.state;
		label = `state ${args.state}`;
	} else {
		pose = frame();
		const c = curClip();
		label = c ? `clip ${c.name} at ${ed.clipTime.value}s` : `state ${curState()?.name ?? "?"}`;
	}
	const png = renderPNG(d, ed.tokens.value, pose, size);
	return { content: [{ type: "image", data: png, mimeType: "image/png" }, { type: "text", text: `rendered ${label}` }] };
}

function validateTool(args: Record<string, unknown>): Result {
	const d = typeof args.doc === "object" && args.doc !== null ? args.doc : inModel() ? M.doc() : doc();
	const r = validate(d, { refTokens: (inModel() ? M.md.unresolved.value : ed.unresolved.value).length ? null : (inModel() ? M.md.shared.value : ed.shared.value).map((t) => t.name) });
	return text(JSON.stringify({ ok: r.ok, errors: r.errors, warnings: r.warnings }));
}

// ------------------------------------------------------------- mesh editing

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
function intList(v: unknown, what: string): number[] {
	if (!Array.isArray(v) || !v.length || !v.every(isInt)) throw new G.MeshError(`${what} must be a list of whole numbers, e.g. [0, 3]`);
	return v;
}
function edgeOf(v: unknown, what: string): [number, number] {
	if (!Array.isArray(v) || v.length !== 2 || !v.every(isInt)) throw new G.MeshError(`${what} must be an edge as two corner indices, e.g. [4, 5]`);
	return [v[0], v[1]];
}
function edgeList(v: unknown, what: string): [number, number][] {
	if (!Array.isArray(v) || !v.length) throw new G.MeshError(`${what} must be a list of edges, each two corner indices, e.g. [[4, 5], [5, 6]]`);
	return v.map((e) => edgeOf(e, `each of ${what}`));
}
function num(v: unknown, what: string, fallback?: number): number {
	if (v === undefined && fallback !== undefined) return fallback;
	if (!isNum(v)) throw new G.MeshError(`${what} must be a number`);
	return v;
}

/** The shape a mesh tool names: a part by name (the current one when none is given) and a shape by its index in that part. */
function meshTarget(args: Record<string, unknown>): M.Sel3 {
	const ps = M.parts();
	const part = typeof args.part === "string" ? ps.findIndex((p) => p.name === args.part) : M.md.sel.value?.part ?? M.md.curPart.value;
	if (part < 0 || !ps[part]) throw new G.MeshError(`no part named ${String(args.part)}; parts: ${ps.map((p) => p.name).join(", ")}`);
	if (ps[part].like) throw new G.MeshError(`${ps[part].name} is drawn like ${ps[part].like} and has no shapes of its own; edit ${ps[part].like}`);
	const shapes = ps[part].shapes ?? [];
	const meshes = shapes.map((sh, i) => (sh.kind === "mesh" ? i : -1)).filter((i) => i >= 0);
	let shape: number;
	if (isInt(args.shape)) shape = args.shape;
	else if (M.md.sel.value?.part === part && shapes[M.md.sel.value.shape]?.kind === "mesh") shape = M.md.sel.value.shape;
	else if (meshes.length === 1) shape = meshes[0];
	else throw new G.MeshError(`say which shape of ${ps[part].name} by its index; its meshes are at ${meshes.join(", ") || "(none)"}`);
	const sh = shapes[shape];
	if (!sh) throw new G.MeshError(`${ps[part].name} has no shape ${shape}; it has ${shapes.length}`);
	if (sh.kind !== "mesh") throw new G.MeshError(`shape ${shape} of ${ps[part].name} is a ${sh.kind}, not a mesh; its meshes are at ${meshes.join(", ") || "(none)"}`);
	return { part, shape };
}

const cageOfSel = (s: M.Sel3): G.Cage => {
	const sh = M.parts()[s.part].shapes![s.shape];
	if (sh.kind !== "mesh") throw new G.MeshError("not a mesh");
	return { points: sh.points as G.V3[], faces: sh.faces, creases: sh.creases, uvs: sh.mapping?.uvs };
};
function report(s: M.Sel3): Record<string, unknown> {
	const r = G.inspect(cageOfSel(s));
	return { points: r.points, faces: r.faces, edges: r.edges, manifold: r.manifold, closed: r.closed, openEdges: r.open, windsOutward: r.closed ? r.volume > 0 : null, volume: Math.round(r.volume * 1000) / 1000, rims: r.rims };
}

/** One mesh operation from Claude: validated, one undo step, the canvas follows; the answer says what the mesh is now. */
function meshTool(name: string, args: Record<string, unknown>): Result {
	if (!inModel()) return fail("mesh tools work on a 3D model open in the model screen; open_file one first");
	try {
		const s = meshTarget(args);
		if (name === "mesh_info") return text(JSON.stringify(report(s)));
		const mirror = args.mirror === true;
		const r = M.runMeshOp(
			s,
			(c) => {
				const faces = (key = "faces") => (mirror ? G.withMirrorFaces(c, intList(args[key], key)) : intList(args[key], key));
				const edges = (key = "edges") => (mirror ? G.withMirrorEdges(c, edgeList(args[key], key)) : edgeList(args[key], key));
				switch (name) {
					case "mesh_extrude": {
						if (args.faces !== undefined) return G.extrudeFaces(c, faces(), num(args.amount, "amount"));
						if (args.edges === undefined) throw new G.MeshError("give faces (to extrude along their normal) or edges (open edges, to grow a band)");
						const dir = args.dir;
						if (dir !== undefined && !(Array.isArray(dir) && dir.length === 3 && dir.every(isNum))) throw new G.MeshError("dir must be [x, y, z]");
						return G.extrudeEdges(c, edges(), dir ? { dir: dir as G.V3 } : { amount: num(args.amount, "amount") });
					}
					case "mesh_inset":
						if (args.border !== undefined && !(typeof args.border === "string" && M.md.tokens.value.some((t) => t.name === args.border))) throw new G.MeshError(`border must be the name of a colour of the palette; the colours are ${M.md.tokens.value.map((t) => t.name).join(", ")}`);
						return G.insetFaces(c, faces(), num(args.amount, "amount"), num(args.raise, "raise", 0));
					case "mesh_loop_cut": {
						const e = edgeOf(args.edge, "edge");
						const at = num(args.at, "at", 0.5);
						const a = G.loopCut(c, e[0], e[1], at);
						if (!mirror) return a;
						const m = G.mirrorMap(c.points);
						const [p, q] = [m[e[0]], m[e[1]]];
						if (p < 0 || q < 0 || p === q || (p === e[1] && q === e[0]) || !G.hasEdge(a.cage, p, q)) return a;
						const b = G.loopCut(a.cage, p, q, at);
						return [a, { ...b, edges: [...(a.edges ?? []), ...(b.edges ?? [])] }];
					}
					case "mesh_bridge":
						return G.bridgeRims(c, edgeOf(args.a, "a"), edgeOf(args.b, "b"));
					case "mesh_fill":
						return G.fillRim(c, edgeOf(args.edge, "edge"));
					case "mesh_delete_faces":
						return G.deleteFaces(c, faces());
					case "mesh_merge": {
						const only = args.corners === undefined ? undefined : intList(args.corners, "corners");
						return G.mergeCorners(c, num(args.distance, "distance", 0.001), only && mirror ? G.withMirrorVerts(c, only) : only);
					}
					case "mesh_flip":
						return G.flipFaces(c, faces());
					case "mesh_wind_outward":
						return G.windOutward(c);
					case "mesh_crease":
						return G.setCreases(c, edges(), num(args.value, "value"));
					case "mesh_crease_by_angle":
						return G.creaseByAngle(c, num(args.angle, "angle", 30), num(args.value, "value", 1));
					default:
						throw new G.MeshError(`no tool named ${name}`);
				}
			},
			// an inset's border ring in another colour (1.8): the faces the inset added
			{ check: true, after: name === "mesh_inset" && typeof args.border === "string" ? M.ringPaint(s, args.border) : undefined },
		);
		const part = M.parts()[s.part].name;
		chatNote(`Claude edited the mesh of ${part} · ${r.note}`);
		return text(JSON.stringify({ done: r.note, part, shape: s.shape, chosen: { ...(r.faces ? { faces: r.faces } : {}), ...(r.edges ? { edges: r.edges } : {}) }, mesh: report(s), undo: "one step" }));
	} catch (e) {
		if (e instanceof G.MeshError) return fail(e.message);
		throw e;
	}
}

// ------------------------------------------------------------- paint, modifiers, shades, pipes, sidecars (1.8)

const SURFACE_TOOLS = new Set(["mesh_paint", "mesh_modifiers", "mesh_apply_modifier", "mesh_shade"]);

/** The shape a 1.8 tool names: as meshTarget, but a sweep will do (it is painted and modified as a mesh is). */
function surfaceTarget(args: Record<string, unknown>): M.Sel3 {
	const ps = M.parts();
	const part = typeof args.part === "string" ? ps.findIndex((p) => p.name === args.part) : M.md.sel.value?.part ?? M.md.curPart.value;
	if (part < 0 || !ps[part]) throw new G.MeshError(`no part named ${String(args.part)}; parts: ${ps.map((p) => p.name).join(", ")}`);
	if (ps[part].like) throw new G.MeshError(`${ps[part].name} is drawn like ${ps[part].like} and has no shapes of its own; edit ${ps[part].like}`);
	const shapes = ps[part].shapes ?? [];
	const fit = shapes.map((sh, i) => (sh.kind === "mesh" || sh.kind === "sweep" ? i : -1)).filter((i) => i >= 0);
	let shape: number;
	if (isInt(args.shape)) shape = args.shape;
	else if (M.md.sel.value?.part === part && fit.includes(M.md.sel.value.shape)) shape = M.md.sel.value.shape;
	else if (fit.length === 1) shape = fit[0];
	else throw new G.MeshError(`say which shape of ${ps[part].name} by its index; its meshes and sweeps are at ${fit.join(", ") || "(none)"}`);
	const sh = shapes[shape];
	if (!sh) throw new G.MeshError(`${ps[part].name} has no shape ${shape}; it has ${shapes.length}`);
	if (sh.kind !== "mesh" && sh.kind !== "sweep") throw new G.MeshError(`shape ${shape} of ${ps[part].name} is a ${sh.kind}; this works on a mesh or a sweep (at ${fit.join(", ") || "(none)"})`);
	return { part, shape };
}
function vec3(v: unknown, what: string): Vec3 {
	if (!Array.isArray(v) || v.length !== 3 || !v.every(isNum)) throw new G.MeshError(`${what} must be [x, y, z]`);
	return [v[0], v[1], v[2]];
}
/** What a shape wears and carries now: for the answer of a 1.8 tool. */
function surfaceReport(s: M.Sel3): Record<string, unknown> {
	const sh = M.parts()[s.part].shapes![s.shape];
	if (sh.kind !== "mesh" && sh.kind !== "sweep") return {};
	const paint = sh.paint ?? [];
	const worn: Record<string, number> = {};
	const n = M.faceCount(sh);
	for (let f = 0; f < n; f++) {
		const t = (paint[f] ?? 0) > 0 ? (sh.colors?.[paint[f] - 1] ?? "?") : (sh.color ?? "");
		worn[t] = (worn[t] ?? 0) + 1;
	}
	return { kind: sh.kind, faces: n, color: sh.color, colors: sh.colors ?? [], facesByColour: worn, mods: sh.mods ?? [], shaded: sh.kind === "mesh" && !!sh.shades, ...(sh.kind === "mesh" && sh.shades ? { darkest: Math.min(...sh.shades) } : {}) };
}

/** Paint, modifiers and shades from Claude: the same validation and the one undo step the inspector gives. */
function surfaceTool(name: string, args: Record<string, unknown>): Result {
	if (!inModel()) return fail("this works on a 3D model open in the model screen; open_file one first");
	try {
		const s = surfaceTarget(args);
		const part = M.parts()[s.part].name;
		let done: string;
		if (name === "mesh_paint") {
			if (typeof args.color !== "string" || !args.color) throw new G.MeshError("color must be the name of a colour of the palette");
			const sh = M.parts()[s.part].shapes![s.shape] as Parameters<typeof M.faceCount>[0];
			const faces = args.faces === "all" ? Array.from({ length: M.faceCount(sh) }, (_, i) => i) : intList(args.faces, "faces");
			done = M.paintFacesOf(s, faces, args.color, { mirror: args.mirror === true });
		} else if (name === "mesh_modifiers") {
			if (!Array.isArray(args.mods)) throw new G.MeshError('mods must be the whole list of modifiers, in order ([] clears it), each {op: "mirror" | "solidify" | "crease", …}');
			const sh = M.parts()[s.part].shapes![s.shape] as { color?: string; colors?: string[] };
			// a colour may be given by name: it is written as the paint index the format keeps
			const extra: string[] = [];
			const mods = args.mods.map((m, i): Mod => {
				if (typeof m !== "object" || m === null || Array.isArray(m)) throw new G.MeshError(`mods[${i}] must be an object with an op`);
				const out = { ...(m as Record<string, unknown>) } as Mod;
				for (const key of ["inner", "rim"] as const) {
					const v = out[key] as unknown;
					if (typeof v !== "string") continue;
					if (!M.md.tokens.value.some((t) => t.name === v)) throw new G.MeshError(`mods[${i}].${key}: there is no colour named ${v}; the colours are ${M.md.tokens.value.map((t) => t.name).join(", ")}`);
					if (v === sh.color) out[key] = 0;
					else {
						if (!(sh.colors ?? []).includes(v) && !extra.includes(v)) extra.push(v);
						out[key] = [...(sh.colors ?? []), ...extra].indexOf(v) + 1;
					}
				}
				return out;
			});
			M.setModsWithColors(s, mods, extra);
			done = mods.length ? `Set ${mods.length} modifier${mods.length === 1 ? "" : "s"}: ${mods.map((m) => m.op).join(", ")}` : "Cleared the modifiers";
		} else if (name === "mesh_apply_modifier") {
			const count = M.modsOf(M.parts()[s.part].shapes![s.shape]).length;
			done = M.applyMod(s, isInt(args.index) ? args.index : count - 1);
		} else {
			done = args.clear === true ? M.clearShades(s) : M.shadeCorners(s, { strength: args.strength === undefined ? undefined : num(args.strength, "strength"), reach: args.reach === undefined ? undefined : num(args.reach, "reach") });
		}
		chatNote(`Claude changed ${part} · ${done}`);
		return text(JSON.stringify({ done, part, shape: s.shape, now: surfaceReport(s), undo: "one step" }));
	} catch (e) {
		if (e instanceof G.MeshError) return fail(e.message);
		throw e;
	}
}

/** A pipe from points, from Claude: a sweep along them in a part, landed on a shape's surface when asked. One undo step. */
function pipeTool(args: Record<string, unknown>): Result {
	if (!inModel()) return fail("pipe works on a 3D model open in the model screen; open_file one first");
	try {
		const ps = M.parts();
		const part = typeof args.part === "string" ? ps.findIndex((p) => p.name === args.part) : M.md.sel.value?.part ?? M.md.curPart.value;
		if (part < 0 || !ps[part]) throw new G.MeshError(`no part named ${String(args.part)}; parts: ${ps.map((p) => p.name).join(", ")}`);
		if (!Array.isArray(args.points) || args.points.length < 2) throw new G.MeshError("points must be a list of two or more [x, y, z], in the part's own space");
		let points = args.points.map((p, i) => vec3(p, `points[${i}]`));
		let landed = "";
		if (args.on !== undefined) {
			const on = args.on;
			if (typeof on !== "object" || on === null || Array.isArray(on)) throw new G.MeshError("on must be {part, shape, offset}: the shape whose surface the points land on");
			const o = on as Record<string, unknown>;
			const onPart = typeof o.part === "string" ? ps.findIndex((p) => p.name === o.part) : part;
			if (onPart < 0) throw new G.MeshError(`on.part: no part named ${String(o.part)}; parts: ${ps.map((p) => p.name).join(", ")}`);
			if (!isInt(o.shape) || !ps[onPart].shapes?.[o.shape]) throw new G.MeshError(`on.shape must be the index of a shape of ${ps[onPart].name}; it has ${ps[onPart].shapes?.length ?? 0}`);
			const offset = num(o.offset, "on.offset", 0.1);
			points = M.landOnSurface(part, points, { part: onPart, shape: o.shape }, offset);
			landed = `, landed on ${ps[onPart].name} shape ${o.shape} and lifted ${offset}`;
		}
		const color = typeof args.color === "string" ? args.color : undefined;
		if (color && !M.md.tokens.value.some((t) => t.name === color)) throw new G.MeshError(`there is no colour named ${color}; the colours are ${M.md.tokens.value.map((t) => t.name).join(", ")}`);
		const radii = args.radii === undefined ? undefined : Array.isArray(args.radii) && args.radii.every(isNum) ? (args.radii as number[]) : null;
		if (radii === null) throw new G.MeshError("radii must be one number per point");
		const sel = M.addPipe(part, points, {
			radius: num(args.radius, "radius", 0.3),
			radii,
			segments: args.segments === undefined ? undefined : num(args.segments, "segments"),
			caps: args.caps === undefined ? undefined : args.caps === true,
			closed: args.closed === true,
			round: args.round === undefined ? points.length >= 3 : args.round === true,
			color,
			twin: args.mirror === true,
		});
		const done = `A pipe of ${points.length} points in ${ps[part].name}${landed}${args.mirror === true ? ", with a mirrored twin across x" : ""}`;
		chatNote(`Claude drew a pipe · ${done}`);
		return text(JSON.stringify({ done, part: ps[part].name, shape: sel.shape, ...(args.mirror === true ? { twin: sel.shape + 1 } : {}), points, undo: "one step" }));
	} catch (e) {
		if (e instanceof G.MeshError) return fail(e.message);
		throw e;
	}
}

/** Build compiled sidecars from Claude: of one file, of a folder, or of the whole project. */
async function sidecarTool(args: Record<string, unknown>): Promise<Result> {
	const root = project.root.value;
	if (root === null) return fail("no project is open");
	const path = typeof args.path === "string" ? args.path.replace(/\/+$/, "") : "";
	const all = project.files.value.filter((f) => f.endsWith(".fart"));
	const files = !path ? all : all.includes(path) ? [path] : all.filter((f) => f.startsWith(path + "/"));
	if (!files.length) return fail(`no .fart at or under ${path || "the project"}; files: ${project.files.value.join(", ")}`);
	// the open model is built from what is on disk: its edits land there within a moment
	if (inModel()) await M.flushNow();
	const done = await buildSidecars(root, files, args.force === true);
	const count = (d: string) => done.filter((x) => x.did === d).length;
	chatNote(`Claude built sidecars · ${count("built")} built, ${count("fresh")} already fresh`);
	return { content: [{ type: "text", text: JSON.stringify({ built: count("built"), fresh: count("fresh"), skipped: count("skipped"), failed: count("failed"), files: done }) }], ...(count("failed") ? { isError: true } : {}) };
}

/**
 * A picture of a model that is not the one being edited: drawn from its
 * compiled sidecar (1.8, built first where it is missing or stale), from
 * a named view or several. Nothing of it is generated on the page.
 */
async function renderOther(path: string, args: Record<string, unknown>): Promise<Result> {
	const root = project.root.value ?? "";
	if (!project.files.value.includes(path)) return fail(`no file ${path} in the project; files: ${project.files.value.join(", ")}`);
	const textOf = await shell.readFile(root, path);
	const parsed = textOf === null ? null : parseDoc(textOf).doc;
	const doc = parsed ? as3d(parsed) : null;
	if (textOf === null || !doc) return fail(`${path} is not a 3D model that can be read; render with path looks at 3D models (open_file a 2D one to render it)`);
	const compiled = await sidecarOf(root, path, textOf);
	if (!compiled) return fail(sidecars.on.value ? `the sidecar of ${path} could not be built; open_file it and render there` : "compiled sidecars are switched off in this studio; open_file the model and render there");
	const dir = dirname(path);
	const tokens: Token[] = (await resolvePalettes(doc as unknown as Doc, (ref) => shell.readFile(root, joinRel(dir, ref)))).tokens;
	const several = Array.isArray(args.views) ? args.views.filter((v): v is string => typeof v === "string") : null;
	const names = several?.length ? several : [typeof args.view === "string" && args.view ? args.view : "front"];
	const size = typeof args.size === "number" ? Math.max(64, Math.min(1024, args.size)) : names.length > 1 ? 384 : 512;
	const st = typeof args.state === "string" ? (doc.states ?? []).find((x) => x.name === args.state) : doc.states?.[0];
	if (typeof args.state === "string" && !st) return fail(`no state named ${args.state} in ${path}`);
	const poses = st?.parts;
	const W = worldTransforms3(doc, poses ?? []);
	const content: Block[] = [];
	for (const name of names) {
		const v = viewNamed(name);
		if (v === null) return fail(`no view named ${name}; views: ${Object.keys(VIEWS).join(", ")}, three-quarter`);
		const V = viewXf3(v);
		const list: CompiledIn[] = [];
		(doc.parts ?? []).forEach((part, i) => {
			const c = compiled.parts[i];
			if (!c || (poses && !poses.some((sp) => sp.part === part.name))) return;
			const w = W.get(part.name);
			list.push({ part: c, F: w ? xf3Mul(V, w) : V });
		});
		const canvas = document.createElement("canvas");
		canvas.width = canvas.height = size;
		const ctx = canvas.getContext("2d");
		if (!ctx) return fail("the editor could not paint");
		paintCompiled(ctx as unknown as Painter, list, (t) => colorOf(tokens, t), size, { light: M.md.light.value, ambient: M.md.ambient.value });
		content.push({ type: "image", data: canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, ""), mimeType: "image/png" });
	}
	content.push({ type: "text", text: `rendered ${path} from its compiled sidecar (${compiled.triangles} triangles), state ${st?.name ?? "rest"}, view ${names.join(", ")}` });
	return { content };
}

async function openFile(args: Record<string, unknown>): Promise<Result> {
	const path = typeof args.path === "string" ? args.path : "";
	if (!path) return fail("path is required");
	if (!project.files.value.includes(path)) return fail(`no file ${path} in the project; files: ${project.files.value.join(", ")}`);
	const ok = await openDoc(path);
	return ok ? text(`opened ${path}`) : fail(`could not open ${path}`);
}

/** The project's art direction, merged, with its issues; or a note that there is none. */
async function getDirection(): Promise<Result> {
	await refreshDirection();
	const d = project.direction.value;
	if (!d) return text(JSON.stringify({ direction: null, note: `no style.gas at the project root${project.directionIssues.value.length ? `: ${project.directionIssues.value.join("; ")}` : ""}` }));
	return text(JSON.stringify({ direction: d, issues: project.directionIssues.value, note: "read about first; new assets take palette_refs; references are files to copy from; rules are checked by fart lint" }));
}

/** One call, answered: what handleTool sends back (and what a script can ask for directly). */
export async function callTool(name: string, args: Record<string, unknown> = {}): Promise<Result> {
	let result: Result | null = null;
	await handleTool({ id: "", name, args }, (r) => (result = r));
	return result!;
}

/** Answer a relayed call; every path replies, so Claude never waits on a mistake. */
export async function handleTool(call: ToolCall, direct?: (r: Result) => void) {
	let result: Result;
	try {
		const args = call.args ?? {};
		switch (call.name) {
			case "get_document":
				result = getDocument(args);
				break;
			case "apply_document":
				result = applyDocument(args);
				break;
			case "apply_patch":
				result = applyPatchTool(args);
				break;
			case "pose":
				result = poseTool(args);
				break;
			case "morph":
				result = morphTool(args);
				break;
			case "clip":
				result = clipTool(args);
				break;
			case "make":
				result = makeTool(args);
				break;
			case "render":
				if (args.sheet) {
					if (inModel()) {
						const flat = projectDoc(M.doc(), { view: M.md.viewName.value || M.md.turn.value, light: M.md.light.value, ambient: M.md.ambient.value });
						result = await sheet(flat, M.md.tokens.value, args);
					} else if (!ed.path.value) result = fail("no file is open");
					else result = await sheet(doc(), ed.tokens.value, args);
				} else result = await render(args);
				break;
			case "pipe":
				result = pipeTool(args);
				break;
			case "build_sidecars":
				result = await sidecarTool(args);
				break;
			case "validate":
				result = validateTool(args);
				break;
			case "open_file":
				result = await openFile(args);
				break;
			case "get_direction":
				result = await getDirection();
				break;
			case "import_gltf":
				result = await importTool(args);
				break;
			default:
				result = SURFACE_TOOLS.has(call.name) ? surfaceTool(call.name, args) : call.name.startsWith("mesh_") ? meshTool(call.name, args) : fail(`no tool named ${call.name}`);
		}
	} catch (e) {
		result = fail(`the editor failed: ${String(e)}`);
	}
	if (direct) return direct(result);
	await shell.toolReply(call.id, JSON.stringify(result));
}
