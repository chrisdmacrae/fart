// The model store: a 3D file (space: "3d") open in the model screen. The
// same shape as the editor store, with a third coordinate: the document,
// which part, state and clip are current, the selection, the tool, and
// the view (a turn laid on the model; the camera's pan and zoom are the
// 2D view's). Edits land on disk within a moment; ⌘S is the checkpoint.

import { signal, batch } from "@preact/signals";
import {
	parseDoc,
	validate,
	stringifyDoc,
	resolvePalettes,
	bakeTris3,
	sampleClip3,
	keyPoses3,
	keyTargets3,
	sampleTargets3,
	type ClipKey3,
	type Target3,
	projectDoc,
	projectFrame,
	pivotOf3,
	shapesOf3Posed,
	setHull,
	unwrapDoc,
	quatAxis,
	quatFromEuler,
	quatMul,
	quatToEuler,
	stringifyDoc as text3,
	applyMods,
	posedMesh,
	builtOf,
	cageOf,
	asMesh,
	worldTransforms3,
	xf3Mul,
	type Mod,
	type MeshShape,
	type SweepShape,
	xf3Invert,
	xf3Apply,
	xf3ApplyDir,
	xf3Det,
	VIEWS,
	DEFAULT_LIGHT,
	DEFAULT_AMBIENT,
	type Doc3,
	type Part3,
	type Shape3,
	type State3,
	type StatePart3,
	type Clip3,
	type Token,
	type Vec2,
	type Vec3,
	type Ease,
	type FramePart,
	type Issue,
	type Rgba,
	type Texture,
	type TextureMap,
} from "@fastart/core";
import { shell } from "../shell/shell.ts";
import { turned, opposite } from "../canvas/orbit.ts";
import { project, refreshFiles } from "./project.ts";
import { dirname, joinRel } from "./paths.ts";
import { clearLocal } from "./local.ts";
import { loadPatterns, unresolvedOf, type TexturePattern } from "./textures.ts";
import { work, loadWork, leaveWork, mirrorOn, setMannequin, twinOf, setTwin, type Mannequin } from "./workspace.ts";
import { cornerShades, nearestOnTris, paintFaces as paintFacesIn, paintIndex, pointNormals, roundHandles, soupOf, soupTris, tidyPaint, tokenOfFace } from "./surfaceops.ts";
import { afterCheckpoint, sidecarOf, type Compiled } from "./sidecar.ts";
import {
	MeshError,
	bridgeRims,
	carryPoints,
	creaseByAngle,
	deleteFaces,
	extrudeEdges,
	extrudeFaces,
	fillRim,
	flipFaces,
	hasEdge,
	insetFaces,
	loopCut,
	mergeCorners,
	mirrorMap,
	rimThrough,
	setCreases,
	windOutward,
	withMirrorEdges,
	withMirrorFaces,
	withMirrorVerts,
	type Cage,
	type OpResult,
	type V3,
} from "./meshops.ts";

export type Tool3 = "select" | "rect" | "circle" | "line" | "poly" | "pipe";
/** What a click on the selected mesh chooses: its corners, its edges or its faces. */
export type Pick3 = "corner" | "edge" | "face";
/** The mesh operations that keep a number to adjust after they are done. */
export type OpKind = "extrude" | "inset" | "loopcut" | "merge" | "creaseAngle";
/** An operation just done, still open to its numbers: changing one runs it again in the same undo step. */
export interface LiveOp {
	kind: OpKind;
	sel: Sel3;
	params: Record<string, number>;
	/** what was chosen when it began, in the mesh as it was then */
	pick: { mode: Pick3; faces: number[]; edges: [number, number][]; verts: number[] };
	/** the document as it was before */
	base: string;
	rev: number;
	depth: number;
	/** what it did, or why it could not with these numbers */
	note: string;
	failed: boolean;
	/** an inset's border ring wears this colour (a palette token); absent, its faces' own */
	border?: string;
}
/** A shape of a part. */
export interface Sel3 {
	part: number;
	shape: number;
}

export const md = {
	doc: signal<Doc3>({ version: 1, space: "3d" }),
	path: signal<string | null>(null),
	rev: signal(0),
	tool: signal<Tool3>("select"),
	/** the view: a turn laid on the model, [x, y, z] radians */
	turn: signal<Vec3>([0, 0, 0]),
	/** the named view the turn is, "" once orbited */
	viewName: signal("front"),
	light: signal<Vec3>(DEFAULT_LIGHT),
	ambient: signal(DEFAULT_AMBIENT),
	/** draw silhouettes in the viewport */
	outline: signal(false),
	/** show the collision solids as wireframes, posed with the frame (1.4) */
	collide: signal(false),
	/** how deep a new box, prism, ball or rod is, along the view axis */
	thick: signal(2),
	curPart: signal(0),
	/** the part was chosen on purpose; an empty click clears it and the inspector shows the document */
	partPicked: signal(false),
	curState: signal(0),
	curClip: signal(-1),
	curKey: signal(-1),
	clipTime: signal(0),
	playing: signal(false),
	sel: signal<Sel3 | null>(null),
	/** the other shapes chosen with it (a marquee, ⇧-clicks): they move, turn, size and go together */
	also: signal<Sel3[]>([]),
	/** a corner of the selected mesh */
	vert: signal<number | null>(null),
	hover: signal<Sel3 | null>(null),
	/** a polygon being drawn, in view space */
	polyPts: signal<Vec2[]>([]),
	pending: signal<"none" | "pivot">("none"),
	/** 1.6: corner drags reshape the part in the current state (a morph) instead of the base mesh */
	deform: signal(false),
	/** 1.7: a chosen edge of the selected mesh (two corner indices), for its crease */
	edge: signal<[number, number] | null>(null),
	/** what a click on the selected mesh chooses */
	pick: signal<Pick3>("corner"),
	/** every chosen corner of the selected mesh (`vert` is the last of them) */
	verts: signal<number[]>([]),
	/** every chosen edge (`edge` is the last of them) */
	edges: signal<[number, number][]>([]),
	/** the chosen faces of the selected mesh, by index */
	faces: signal<number[]>([]),
	/** the mesh operation just done, while its numbers can still be changed */
	op: signal<LiveOp | null>(null),
	/** the mannequin: another model of the project shown under this one (never saved in the file); `compiled` is its sidecar, drawn in place of generating */
	mannequin: signal<{ path: string; doc: Doc3; tokens: Token[]; compiled?: Compiled | null } | null>(null),
	/** 1.8: clicks and drags over the selected mesh's faces paint them with `paintTok` */
	painting: signal(false),
	/** the colour faces are painted with: a palette token ("" until one is picked: the last of the palette) */
	paintTok: signal(""),
	/** a pipe's path being clicked, in the current part's rest space */
	pipePts: signal<Vec3[]>([]),
	/** the chosen point of the selected pipe's path */
	pipePt: signal<number | null>(null),
	/** pipe points land on the surface under the pointer, lifted along its normal by `lift` */
	onSurface: signal(false),
	lift: signal(0.1),
	/** a new pipe gets a mirrored twin across x */
	pipeTwin: signal(false),
	/** how dark Shade corners makes a wholly hidden corner */
	shadeStrength: signal(0.6),
	tokens: signal<Token[]>([]),
	/** 1.5: the file's textures, resolved and rendered, by name */
	patterns: signal<Map<string, TexturePattern>>(new Map()),
	shared: signal<Token[]>([]),
	unresolved: signal<string[]>([]),
	issues: signal<Issue[]>([]),
	dirty: signal(false),
	written: signal(0),
	checkpointAt: signal(0),
	canUndo: signal(false),
	canRedo: signal(false),
	space: false,
};

// ------------------------------------------------------------- access

export function doc(): Doc3 {
	void md.rev.value;
	return md.doc.value;
}
export function parts(): Part3[] {
	return doc().parts ?? [];
}
export function states(): State3[] {
	return doc().states ?? [];
}
export function clips(): Clip3[] {
	return doc().clips ?? [];
}
export function palette(): Token[] {
	return doc().palette ?? [];
}
export function curPart(): Part3 | undefined {
	return parts()[md.curPart.value];
}
export function curState(): State3 | undefined {
	return states()[md.curState.value];
}
export function curClip(): Clip3 | undefined {
	return md.curClip.value >= 0 ? clips()[md.curClip.value] : undefined;
}
/** What the canvas shows: the clip's frame, else the state's parts. */
export function frame(): StatePart3[] | undefined {
	const c = curClip();
	if (c) return sampleClip3(doc(), c, md.clipTime.value);
	return curState()?.parts;
}
/** What a pose gesture works on: a state, or a clip key (its own parts, inline). */
export interface Pose3 {
	parts: StatePart3[];
	targets?: Target3[];
}
/** The key the playhead sits on in the clip on the canvas; -1 between keys (or no clip). */
export function keyHere(): number {
	const c = curClip();
	if (!c) return -1;
	const t = md.clipTime.value;
	const k = md.curKey.value;
	if (c.keys[k] && Math.abs(c.keys[k].t - t) < 1e-6) return k;
	return c.keys.findIndex((key) => Math.abs(key.t - t) < 1e-6);
}
/**
 * The pose the canvas poses, for reading: the current state; in a clip the
 * key under the playhead (its own parts, or the state it names); between
 * keys, the frame (a gesture there makes a key).
 */
export function pose(): Pose3 | undefined {
	const c = curClip();
	if (!c) return curState();
	const k = keyHere();
	if (k >= 0) return { parts: keyPoses3(doc(), c.keys[k]), targets: keyTargets3(doc(), c.keys[k]) };
	return { parts: frame() ?? [] };
}
/**
 * The pose a gesture changes, called inside a mutate. In a clip it is the
 * key under the playhead, made its own: a key naming a state takes a copy
 * of it inline (the state, and every other key naming it, stay as they
 * are), and between keys a key is made at the playhead from the frame.
 */
export function editPose(d: Doc3): Pose3 | undefined {
	const c = d.clips?.[md.curClip.value];
	if (!c) return d.states?.[md.curState.value];
	let k = keyHere();
	const t = Math.round(md.clipTime.value * 1000) / 1000;
	// a playhead a hair from a key (the time rounds onto it) poses that key
	if (k < 0) k = c.keys.findIndex((key) => Math.abs(key.t - t) < 1e-6);
	if (k < 0) {
		const key: ClipKey3 = { t, parts: sampleClip3(d, c, md.clipTime.value) };
		const tg = sampleTargets3(d, c, md.clipTime.value);
		if (tg.length) key.targets = tg;
		k = c.keys.findIndex((x) => x.t > t);
		if (k < 0) k = c.keys.length;
		c.keys.splice(k, 0, key);
	}
	if (Math.abs(c.keys[k].t - md.clipTime.value) > 1e-6) md.clipTime.value = c.keys[k].t;
	md.curKey.value = k;
	const key = c.keys[k];
	if (!key.parts) {
		key.parts = structuredClone(keyPoses3(d, key));
		const tg = keyTargets3(d, key);
		if (tg.length && !key.targets) key.targets = structuredClone(tg);
		delete key.state;
	}
	return key as Pose3;
}
/** The current part's entry in the pose being posed (see pose()); to change it, setPose. */
export function poseOfCur(): StatePart3 | undefined {
	const p = curPart();
	const pz = pose();
	if (!p || !pz) return undefined;
	return pz.parts.find((sp) => sp.part === p.name);
}
export function selShape(): Shape3 | undefined {
	const s = md.sel.value;
	if (!s) return undefined;
	return parts()[s.part]?.shapes?.[s.shape];
}
/** The selected shape as the current state has it: its morph applied (1.6). */
export function selShapePosed(): Shape3 | undefined {
	const s = md.sel.value;
	const part = s ? parts()[s.part] : undefined;
	if (!s || !part) return undefined;
	return shapesOf3Posed(doc(), part, curState()?.parts.find((sp) => sp.part === part.name))[s.shape];
}
/** Can corner drags land in a morph: deform on, a state (not a clip) on the canvas, a mesh of a part with points of its own. */
export function deforming(): boolean {
	const s = md.sel.value;
	const part = s ? parts()[s.part] : undefined;
	const sh = part?.shapes?.[s!.shape];
	return md.deform.value && md.curClip.value < 0 && !!part && !part.like && sh?.kind === "mesh";
}
/** The current state's morph entry for a shape of a part, made from the base when there is none. */
export function morphEntry(d: Doc3, partIndex: number, shape: number): Vec3[] | null {
	const part = d.parts?.[partIndex];
	const st = d.states?.[md.curState.value];
	const sh = part?.shapes?.[shape];
	if (!part || !st || !sh || sh.kind !== "mesh" || part.like) return null;
	let sp = st.parts.find((e) => e.part === part.name);
	if (!sp) {
		sp = { part: part.name, offset: [...pivotOf3(part)] as Vec3 };
		st.parts.push(sp);
	}
	sp.morph ??= [];
	let m = sp.morph.find((x) => x.shape === shape);
	if (!m || m.points.length !== sh.points.length) {
		m = { shape, points: sh.points.map((p) => [...p] as Vec3) };
		sp.morph = [...sp.morph.filter((x) => x.shape !== shape), m];
	}
	return m.points;
}
/** 1.7: a mesh's (or sweep's) smoothing and lighting fields. */
export function setSmoothField(s: Sel3, key: "normals" | "angle" | "smooth", v: string | number | undefined) {
	mutate((d) => {
		const sh = d.parts![s.part].shapes![s.shape] as Record<string, unknown>;
		if (sh.kind !== "mesh" && sh.kind !== "sweep") return;
		if (v === undefined || v === "" || (key === "smooth" && v === 0) || (key === "angle" && v === 0)) delete sh[key];
		else sh[key] = v;
		if (key === "smooth" && sh.bake) delete sh.bake; // a bake is of one cage at one level
	}, `smooth-${key}`);
}
/** 1.7: a sweep's generator fields. */
export function setSweepField(s: Sel3, key: "op" | "axis" | "segments" | "from" | "to", v: string | number) {
	mutate((d) => {
		const sh = d.parts![s.part].shapes![s.shape] as Record<string, unknown>;
		if (sh.kind !== "sweep") return;
		sh[key] = v;
		delete sh.bake;
	}, `sweep-${key}`);
}
/** 1.7: the crease of an edge (a, b) of the selected mesh, 0 removing it. */
export function setCrease(s: Sel3, a: number, b: number, c: number) {
	mutate((d) => {
		const sh = d.parts![s.part].shapes![s.shape];
		if (sh.kind !== "mesh") return;
		const lo = Math.min(a, b);
		const hi = Math.max(a, b);
		const rest = (sh.creases ?? []).filter((e) => !(e.length === 3 && Math.min(e[0], e[1]) === lo && Math.max(e[0], e[1]) === hi));
		if (c > 0) rest.push([lo, hi, Math.min(1, c)]);
		if (rest.length) sh.creases = rest;
		else delete sh.creases;
		delete sh.bake;
	}, `crease-${a}-${b}`);
}
/** The crease an edge of the selected mesh has, 0 for none. */
export function creaseOf(sh: Shape3, a: number, b: number): number {
	if (sh.kind !== "mesh") return 0;
	const lo = Math.min(a, b);
	const hi = Math.max(a, b);
	const e = (sh.creases ?? []).find((x) => x.length === 3 && Math.min(x[0], x[1]) === lo && Math.max(x[0], x[1]) === hi);
	return e ? e[2] : 0;
}
/** Is (a, b) an edge of the mesh's faces? */
export function isEdge(sh: Shape3, a: number, b: number): boolean {
	if (sh.kind !== "mesh") return false;
	return sh.faces.some((f) => f.some((v, i) => (v === a && f[(i + 1) % f.length] === b) || (v === b && f[(i + 1) % f.length] === a)));
}

/** Forget the current state's morphs on a part: it draws the base mesh again. */
export function resetMorph(partIndex: number) {
	mutate((d) => {
		const part = d.parts?.[partIndex];
		const sp = part && d.states?.[md.curState.value]?.parts.find((e) => e.part === part.name);
		if (sp) delete sp.morph;
	});
}
/** How many shapes the current state reshapes on a part. */
export function morphCount(partIndex: number): number {
	const part = parts()[partIndex];
	const sp = part && curState()?.parts.find((e) => e.part === part.name);
	return sp?.morph?.length ?? 0;
}
export function freshName(base: string, taken: Iterable<string>): string {
	const set = new Set(taken);
	if (!set.has(base)) return base;
	for (let i = 2; ; i++) if (!set.has(`${base}_${i}`)) return `${base}_${i}`;
}

/** The frame projected under the view: what is drawn and picked, far first. */
let frameCache: { key: string; parts: FramePart[] } | null = null;
export function frameParts(): FramePart[] {
	const fr = frame();
	const key = [md.rev.value, md.turn.value.join(","), md.light.value.join(","), md.ambient.value, md.outline.value, md.curClip.value, md.clipTime.value, md.curState.value, JSON.stringify(fr ?? null)].join("|");
	if (frameCache && frameCache.key === key) return frameCache.parts;
	const out = projectFrame(md.doc.value, fr, { view: md.turn.value, light: md.light.value, ambient: md.ambient.value, outline: md.outline.value ? { color: "", w: 0 } : undefined });
	frameCache = { key, parts: out };
	return out;
}
export function framePartOf(i: number): FramePart | undefined {
	return frameParts().find((f) => f.index === i);
}

// ------------------------------------------------------------- undo, disk

interface Snap {
	doc: string;
	state: number;
	clip: number;
}
let undoStack: Snap[] = [];
let redoStack: Snap[] = [];
let checkpoint = "";
let lastFlush = "";
let writes: Promise<void> = Promise.resolve();
let flushTimer: number | undefined;
let mergeKey: string | null = null;
const FLUSH_MS = 350;
const UNDO_MAX = 200;

function docText(): string {
	return JSON.stringify(md.doc.value);
}
function snapshot(): Snap {
	return { doc: docText(), state: md.curState.value, clip: md.curClip.value };
}
function root(): string {
	return project.root.value ?? "";
}
function touch() {
	batch(() => {
		md.rev.value++;
		md.dirty.value = docText() !== checkpoint;
		md.tokens.value = [...md.shared.value, ...palette()];
		md.canUndo.value = undoStack.length > 0;
		md.canRedo.value = redoStack.length > 0;
	});
	scheduleFlush();
}
export function pushUndo() {
	undoStack.push(snapshot());
	if (undoStack.length > UNDO_MAX) undoStack.shift();
	redoStack = [];
}
/** Apply a change; `merge` names a gesture so a drag is one undo step. */
export function mutate(fn: (d: Doc3) => void, merge?: string) {
	if (!merge || mergeKey !== merge) {
		pushUndo();
		mergeKey = merge ?? null;
	}
	const texBefore = JSON.stringify(md.doc.value.textures ?? []);
	fn(md.doc.value);
	touch();
	if (JSON.stringify(md.doc.value.textures ?? []) !== texBefore) void reloadPatterns();
}
export function endGesture() {
	mergeKey = null;
}
function restore(snap: Snap) {
	batch(() => {
		// the selected shape stays selected when the document it goes back to has one of its kind there
		const was = md.sel.value;
		const kind = was ? md.doc.value.parts?.[was.part]?.shapes?.[was.shape]?.kind : undefined;
		md.doc.value = JSON.parse(snap.doc) as Doc3;
		md.curState.value = Math.min(snap.state, Math.max(0, states().length - 1));
		md.curClip.value = snap.clip < clips().length ? snap.clip : -1;
		const keep = was && !md.also.value.length && kind !== undefined && md.doc.value.parts?.[was.part]?.shapes?.[was.shape]?.kind === kind;
		if (!keep) md.sel.value = null;
		// its corners, edges and faces are not the same ones any more
		md.verts.value = [];
		md.edges.value = [];
		md.edge.value = null;
		md.faces.value = [];
		md.vert.value = null;
		md.hover.value = null;
		md.polyPts.value = [];
		md.pipePts.value = [];
		// the chosen point of a pipe's path stays chosen while the path still has it
		const pipe = keep && was ? md.doc.value.parts?.[was.part]?.shapes?.[was.shape] : undefined;
		const pt = md.pipePt.value;
		if (pt !== null && !(isPipe(pipe) && pt < (pipe.path?.points.length ?? 0))) md.pipePt.value = null;
		md.op.value = null;
	});
	clampCursors();
	touch();
}
export function undo() {
	const s = undoStack.pop();
	if (!s) return;
	redoStack.push(snapshot());
	mergeKey = null;
	restore(s);
}
export function redo() {
	const s = redoStack.pop();
	if (!s) return;
	undoStack.push(snapshot());
	mergeKey = null;
	restore(s);
}
function clampCursors() {
	md.curPart.value = Math.min(md.curPart.value, Math.max(0, parts().length - 1));
	md.curState.value = Math.min(md.curState.value, Math.max(0, states().length - 1));
	if (md.curClip.value >= clips().length) md.curClip.value = -1;
	const s = md.sel.value;
	if (s && !parts()[s.part]?.shapes?.[s.shape]) md.sel.value = null;
}

function writeDoc(rel: string, text: string): Promise<void> {
	const job = writes.then(async () => {
		try {
			await shell.writeFile(root(), rel, text);
		} catch (e) {
			project.error.value = `could not write ${rel}: ${String(e)}`;
			throw e;
		}
	});
	writes = job.catch(() => {});
	return job;
}
function scheduleFlush() {
	if (flushTimer !== undefined) clearTimeout(flushTimer);
	flushTimer = window.setTimeout(() => void flushNow(), FLUSH_MS);
}
export async function flushNow() {
	flushTimer = undefined;
	const rel = md.path.value;
	if (!rel) return;
	const snap = docText();
	if (snap === lastFlush) return;
	lastFlush = snap;
	try {
		await writeDoc(rel, text3(md.doc.value));
		md.written.value = Date.now();
	} catch {
		lastFlush = "";
	}
}
/** ⌘S: bake the meshes' tris, write, and keep the checkpoint. */
export async function save() {
	const rel = md.path.value;
	if (!rel) return;
	if (flushTimer !== undefined) clearTimeout(flushTimer);
	flushTimer = undefined;
	bakeTris3(md.doc.value);
	md.rev.value++;
	lastFlush = "";
	await flushNow();
	checkpoint = docText();
	const written = text3(md.doc.value);
	await writeDoc(`${rel}~`, written);
	batch(() => {
		md.dirty.value = false;
		md.checkpointAt.value = Date.now();
	});
	// the compiled sidecar of what was just kept, made off the page's thread (1.8): other screens draw this model from it
	afterCheckpoint(root(), rel, written);
}
export async function revertToCheckpoint() {
	const rel = md.path.value;
	if (!rel || !checkpoint) return;
	pushUndo();
	mergeKey = null;
	restore({ doc: checkpoint, state: md.curState.value, clip: md.curClip.value });
}

function ensureDefaults(d: Doc3) {
	if (!d.parts?.length) d.parts = [{ name: "body", pivot: [0, 0, 0], shapes: [] }];
	if (!d.palette?.length) d.palette = [{ name: "ink", rgb: [200, 195, 185, 255] }];
	for (const p of d.parts) {
		if (!p.like) p.shapes ??= [];
		p.pivot ??= [0, 0, 0];
	}
	d.states ??= [];
	if (!d.states.length) d.states.push({ name: "default", parts: d.parts.map((p) => ({ part: p.name, offset: p.pivot ?? [0, 0, 0] })) });
}

async function resolveShared(d: Doc3, rel: string): Promise<{ shared: Token[]; unresolved: string[] }> {
	const dir = dirname(rel);
	const resolved = await resolvePalettes(d as unknown as Parameters<typeof resolvePalettes>[0], (ref) => shell.readFile(root(), joinRel(dir, ref)));
	return { shared: resolved.tokens.slice(0, resolved.tokens.length - (d.palette?.length ?? 0)), unresolved: resolved.unresolved };
}

function check(d: Doc3) {
	const r = validate(d, { refTokens: md.unresolved.value.length ? null : md.shared.value.map((t) => t.name), unresolvedRefs: unresolvedOf(md.patterns.value) });
	md.issues.value = [...r.errors, ...r.warnings];
}

/** The textures changed: read and render them again. */
export async function reloadPatterns() {
	const rel = md.path.value;
	if (!rel) return;
	const p = await loadPatterns(md.doc.value, rel);
	if (md.path.value !== rel) return;
	md.patterns.value = p;
	check(md.doc.value);
	md.rev.value++;
}

/** Open a 3D file in the model screen. The text was read by the caller. */
export async function openModel(rel: string, text: string): Promise<boolean> {
	if (md.path.value) await leaveModel();
	const { doc: parsed, report } = parseDoc(text);
	if (!parsed || parsed.space !== "3d") {
		project.error.value = `${rel}: ${report.errors[0]?.code ?? "?"} — ${report.errors[0]?.message ?? "not a 3D file"}`;
		return false;
	}
	const d = parsed as unknown as Doc3;
	ensureDefaults(d);
	delete d.resolved;
	const { shared, unresolved } = await resolveShared(d, rel);
	undoStack = [];
	redoStack = [];
	mergeKey = null;
	clearLocal();
	batch(() => {
		md.doc.value = d;
		md.path.value = rel;
		md.shared.value = shared;
		md.unresolved.value = unresolved;
		md.tokens.value = [...shared, ...(d.palette ?? [])];
		md.curPart.value = 0;
		md.curState.value = 0;
		md.curClip.value = -1;
		md.curKey.value = -1;
		md.clipTime.value = 0;
		md.playing.value = false;
		md.sel.value = null;
		md.vert.value = null;
		md.hover.value = null;
		md.polyPts.value = [];
		md.op.value = null;
		md.mannequin.value = null;
		md.pick.value = "corner";
		md.painting.value = false;
		md.pipePts.value = [];
		md.pipePt.value = null;
		md.pending.value = "none";
		md.tool.value = "select";
		md.dirty.value = false;
		md.canUndo.value = false;
		md.canRedo.value = false;
		md.rev.value++;
	});
	check(d);
	void reloadPatterns();
	loadWork(root(), rel);
	void loadMannequin();
	lastFlush = docText();
	// the checkpoint beside it, or one made now
	const ck = await shell.readFile(root(), `${rel}~`);
	const ckParsed = ck === null ? null : parseDoc(ck).doc;
	if (ckParsed && ckParsed.space === "3d") {
		const c = ckParsed as unknown as Doc3;
		ensureDefaults(c);
		delete c.resolved;
		checkpoint = JSON.stringify(c);
	} else {
		checkpoint = docText();
		await writeDoc(`${rel}~`, text3(d));
	}
	md.dirty.value = docText() !== checkpoint;
	return true;
}

export async function leaveModel() {
	const rel = md.path.value;
	if (!rel) return;
	if (flushTimer !== undefined) clearTimeout(flushTimer);
	flushTimer = undefined;
	await flushNow();
	await writes.catch(() => {});
	leaveWork();
	batch(() => {
		md.path.value = null;
		md.mannequin.value = null;
		md.op.value = null;
		md.dirty.value = false;
		md.written.value = 0;
		md.checkpointAt.value = 0;
		md.playing.value = false;
	});
}

/** A whole document from outside (Claude): one undo step. */
export function applyExternalDoc(next: Doc3): string {
	const before = md.doc.value;
	const d = JSON.parse(JSON.stringify(next)) as Doc3;
	delete d.resolved;
	ensureDefaults(d);
	pushUndo();
	mergeKey = null;
	batch(() => {
		md.doc.value = d;
		clampCursors();
		md.sel.value = null;
		md.vert.value = null;
		md.hover.value = null;
		md.polyPts.value = [];
	});
	touch();
	check(d);
	const a = new Set((before.parts ?? []).map((p) => p.name));
	const b = (d.parts ?? []).map((p) => p.name);
	const added = b.filter((n) => !a.has(n));
	const removed = [...a].filter((n) => !b.includes(n));
	const bits = [];
	if (added.length) bits.push(`added ${added.join(", ")}`);
	if (removed.length) bits.push(`removed ${removed.join(", ")}`);
	return bits.join("; ") || "changed the document";
}

// ------------------------------------------------------------- the view

export function setView(name: string) {
	const t = VIEWS[name];
	if (!t) return;
	batch(() => {
		md.turn.value = [...t] as Vec3;
		md.viewName.value = name;
	});
}
/** Orbit: a turntable about the world's up axis (or, free, a tumble in view space). */
export function orbit(yaw: number, pitch: number, free = false) {
	const t = turned(md.turn.value, yaw, pitch, free);
	batch(() => {
		md.turn.value = t;
		md.viewName.value = "";
	});
}
/** The view from the other side. */
export function flipView() {
	const o = opposite(md.turn.value, md.viewName.value);
	batch(() => {
		md.turn.value = o.turn;
		md.viewName.value = o.name;
	});
}
export function setTurn(t: Vec3) {
	batch(() => {
		md.turn.value = t;
		md.viewName.value = Object.entries(VIEWS).find(([, v]) => v.every((x, i) => Math.abs(x - t[i]) < 1e-6))?.[0] ?? "";
	});
}

// ------------------------------------------------------------- parts

export function addPart(name: string): number {
	mutate((d) => {
		d.parts!.push({ name, pivot: [0, 0, 0], shapes: [] });
		for (const s of d.states ?? []) s.parts.push({ part: name, offset: [0, 0, 0] });
	});
	md.curPart.value = parts().length - 1;
	return md.curPart.value;
}
export function deletePart(i: number) {
	const p = parts()[i];
	if (!p || parts().length <= 1) return;
	mutate((d) => {
		d.parts!.splice(i, 1);
		for (const q of d.parts!) {
			if (q.parent === p.name) delete q.parent;
			if (q.like === p.name) {
				delete q.like;
				q.shapes = [];
			}
		}
		for (const s of d.states ?? []) s.parts = s.parts.filter((sp) => sp.part !== p.name);
		for (const c of d.clips ?? []) for (const k of c.keys) if (k.parts) k.parts = k.parts.filter((sp) => sp.part !== p.name);
	});
	batch(() => {
		md.sel.value = null;
		clampCursors();
	});
}
export function renamePart(i: number, name: string) {
	const p = parts()[i];
	if (!p || !name || parts().some((q) => q !== p && q.name === name)) return;
	const old = p.name;
	mutate((d) => {
		d.parts![i].name = name;
		for (const q of d.parts!) {
			if (q.parent === old) q.parent = name;
			if (q.like === old) q.like = name;
		}
		for (const s of d.states ?? []) for (const sp of s.parts) if (sp.part === old) sp.part = name;
		for (const c of d.clips ?? []) for (const k of c.keys) for (const sp of k.parts ?? []) if (sp.part === old) sp.part = name;
	});
}
export function parentCandidates(i: number): string[] {
	const ps = parts();
	const me = ps[i];
	if (!me) return [];
	const descends = (name: string): boolean => {
		let cur: Part3 | undefined = ps.find((p) => p.name === name);
		let guard = 0;
		while (cur && guard++ < 64) {
			if (cur.name === me.name) return true;
			cur = cur.parent ? ps.find((p) => p.name === cur!.parent) : undefined;
		}
		return false;
	};
	return ps.filter((p) => p !== me && !descends(p.name)).map((p) => p.name);
}
export function setParent(i: number, parent: string) {
	mutate((d) => {
		const p = d.parts![i];
		if (parent) p.parent = parent;
		else delete p.parent;
	});
}
export function setLike(i: number, like: string) {
	mutate((d) => {
		const p = d.parts![i];
		if (like) {
			p.like = like;
			delete p.shapes;
			delete p.anchors;
		} else {
			delete p.like;
			p.shapes = [];
		}
	});
	md.sel.value = null;
}
export function setPivot(i: number, v: Vec3) {
	mutate((d) => (d.parts![i].pivot = v), `pivot-${i}`);
}
export function setPivotAxis(i: number, axis: 0 | 1 | 2, v: number) {
	const pv = [...(parts()[i]?.pivot ?? [0, 0, 0])] as Vec3;
	pv[axis] = v;
	setPivot(i, pv);
}

// ------------------------------------------------------------- states and poses

export function selectState(k: number) {
	batch(() => {
		md.curState.value = k;
		md.curClip.value = -1;
		md.playing.value = false;
	});
}
export function selectClip(k: number) {
	batch(() => {
		md.curClip.value = k;
		md.curKey.value = -1;
		md.clipTime.value = 0;
		md.sel.value = null;
		md.vert.value = null;
		md.polyPts.value = [];
	});
}
export function addState(name: string, from?: number) {
	const src = states()[from ?? md.curState.value];
	mutate((d) => {
		d.states!.push({ name, parts: src ? JSON.parse(JSON.stringify(src.parts)) : d.parts!.map((p) => ({ part: p.name, offset: p.pivot })) });
	});
	selectState(states().length - 1);
}
export function deleteState(k: number) {
	if (states().length <= 1) return;
	const name = states()[k]?.name;
	mutate((d) => {
		d.states!.splice(k, 1);
		for (const c of d.clips ?? []) c.keys = c.keys.filter((key) => key.state !== name);
		d.clips = (d.clips ?? []).filter((c) => c.keys.length > 0);
	});
	clampCursors();
}
export function renameState(k: number, name: string) {
	const s = states()[k];
	if (!s || !name || states().some((q) => q !== s && q.name === name)) return;
	const old = s.name;
	mutate((d) => {
		d.states![k].name = name;
		for (const c of d.clips ?? []) for (const key of c.keys) if (key.state === old) key.state = name;
	});
}
export function toggleMembership(k: number, part: string) {
	mutate((d) => {
		const s = d.states![k];
		const i = s.parts.findIndex((sp) => sp.part === part);
		if (i >= 0) s.parts.splice(i, 1);
		else {
			const p = d.parts!.find((q) => q.name === part);
			s.parts.push({ part, offset: p?.pivot ?? [0, 0, 0] });
		}
	});
}
export function movePartInState(part: string, later: boolean) {
	mutate((d) => {
		const s = d.states![md.curState.value];
		if (!s) return;
		const i = s.parts.findIndex((sp) => sp.part === part);
		const j = later ? i + 1 : i - 1;
		if (i < 0 || j < 0 || j >= s.parts.length) return;
		[s.parts[i], s.parts[j]] = [s.parts[j], s.parts[i]];
	});
}
/**
 * Change a part's entry in the pose being posed (see editPose): the
 * current state's, or the clip key's under the playhead. `sp` names the
 * part; the entry changed is the pose's own, found by that name.
 */
export function setPose(sp: StatePart3, patch: Partial<StatePart3>, merge?: string) {
	mutate((d) => {
		const e = editPose(d)?.parts.find((x) => x.part === sp.part);
		if (!e) return;
		Object.assign(e, patch);
		if (patch.mirror === false) delete e.mirror;
	}, merge);
}
export function resetPose(sp: StatePart3) {
	const p = parts().find((q) => q.name === sp.part);
	mutate((d) => {
		const e = editPose(d)?.parts.find((x) => x.part === sp.part);
		if (!e) return;
		e.offset = p?.pivot ? ([...p.pivot] as Vec3) : [0, 0, 0];
		delete e.rotate;
		delete e.scale;
		delete e.mirror;
	});
}
/** A turn about an axis given in the parent's rest frame, laid over the pose's turn. */
export function turnPose(sp: StatePart3, axis: Vec3, angle: number, merge?: string) {
	const q = quatMul(quatAxis(axis, angle), quatFromEuler(sp.rotate ?? [0, 0, 0]));
	setPose(sp, { rotate: quatToEuler(q).map((x) => Math.round(x * 1e4) / 1e4) as Vec3 }, merge);
}

// ------------------------------------------------------------- clips

export function addClip(name: string): boolean {
	const st = curState();
	if (!st) return false;
	mutate((d) => (d.clips ??= []).push({ name, keys: [{ t: 0, state: st.name }] }));
	selectClip(clips().length - 1);
	return true;
}
export function deleteClip(k: number) {
	mutate((d) => d.clips!.splice(k, 1));
	batch(() => {
		md.curClip.value = -1;
		clampCursors();
	});
}
export function renameClip(k: number, name: string) {
	if (!name || clips().some((c, i) => i !== k && c.name === name)) return;
	mutate((d) => (d.clips![k].name = name));
}
export function setClipLoop(k: number, loop: boolean) {
	mutate((d) => {
		if (loop) d.clips![k].loop = true;
		else delete d.clips![k].loop;
	});
}
export function seek(t: number) {
	md.clipTime.value = t;
}
export function addKey() {
	const c = curClip();
	const st = states()[md.curState.value];
	if (!c || !st) return;
	const t = Math.round(md.clipTime.value * 1000) / 1000;
	mutate((d) => {
		const clip = d.clips![md.curClip.value];
		let i = clip.keys.findIndex((k) => k.t >= t);
		if (i >= 0 && clip.keys[i].t === t) {
			// a key posed on its own keeps that pose: + Key only goes to it
			if (clip.keys[i].parts) return void (md.curKey.value = i);
			clip.keys[i].state = st.name;
		} else {
			if (i < 0) i = clip.keys.length;
			clip.keys.splice(i, 0, { t, state: st.name });
		}
		md.curKey.value = i;
	});
}
export function deleteKey(i: number) {
	const c = curClip();
	if (!c || c.keys.length <= 1) return;
	mutate((d) => d.clips![md.curClip.value].keys.splice(i, 1));
	md.curKey.value = -1;
}
export function setKeyTime(i: number, t: number) {
	mutate((d) => {
		const keys = d.clips![md.curClip.value].keys;
		keys[i].t = Math.max(0, t);
		const k = keys[i];
		keys.sort((a, b) => a.t - b.t);
		md.curKey.value = keys.indexOf(k);
	}, `key-time-${i}`);
}
export function setKeyState(i: number, state: string) {
	mutate((d) => {
		const k = d.clips![md.curClip.value].keys[i];
		k.state = state;
		delete k.parts;
	});
}
/** A new state holding a key's pose; the key then names it. */
export function keyToState(i: number, name: string) {
	const key = curClip()?.keys[i];
	if (!key || !name || states().some((s) => s.name === name)) return;
	mutate((d) => {
		const k = d.clips![md.curClip.value].keys[i];
		const st: State3 = { name, parts: structuredClone(keyPoses3(d, k)) };
		const tg = keyTargets3(d, k);
		if (tg.length) st.targets = structuredClone(tg);
		(d.states ??= []).push(st);
		k.state = name;
		delete k.parts;
		delete k.targets;
	});
}
export function setKeyEase(i: number, e: Ease | undefined) {
	mutate((d) => {
		const k = d.clips![md.curClip.value].keys[i];
		if (e && e !== "linear") k.ease = e;
		else delete k.ease;
	});
}

// ------------------------------------------------------------- shapes

/** Add a shape to the current part and select it. */
export function addShape(sh: Shape3): Sel3 | null {
	const i = md.curPart.value;
	const p = parts()[i];
	if (!p || p.like) return null;
	mutate((d) => (d.parts![i].shapes ??= []).push(sh));
	const sel = { part: i, shape: (p.shapes?.length ?? 1) - 1 };
	batch(() => {
		md.sel.value = sel;
		md.vert.value = null;
	});
	return sel;
}
// no shape chosen: none of the others either
md.sel.subscribe((s) => {
	if (!s && md.also.peek().length) md.also.value = [];
});

/** Every chosen shape: the one the inspector shows first, then the others. */
export function selected(): Sel3[] {
	const s = md.sel.value;
	return s ? [s, ...md.also.value] : [];
}
export const sameSel = (a: Sel3, b: Sel3) => a.part === b.part && a.shape === b.shape;

/** Choose these shapes; the first is the one the inspector shows. */
export function selectShapes(list: Sel3[]) {
	const uniq = list.filter((s, i) => list.findIndex((t) => sameSel(s, t)) === i);
	batch(() => {
		md.sel.value = uniq[0] ?? null;
		md.also.value = uniq.slice(1);
		md.vert.value = null;
		md.edge.value = null;
		if (uniq[0]) {
			md.curPart.value = uniq[0].part;
			md.partPicked.value = true;
		}
	});
}

export function deleteSel() {
	const s = md.sel.value;
	if (!s) return;
	const v = md.vert.value;
	if (md.also.value.length) {
		// several shapes: from the last of each part back, so the indices hold
		const all = selected().sort((a, b) => b.part - a.part || b.shape - a.shape);
		mutate((d) => {
			for (const t of all) d.parts![t.part].shapes?.splice(t.shape, 1);
		});
		selectShapes([]);
		return;
	}
	const sh = parts()[s.part]?.shapes?.[s.shape];
	if (isPipe(sh) && md.pipePt.value !== null) {
		// the chosen point of the path goes, the pipe stays
		deletePipePoint(s, md.pipePt.value);
		return;
	}
	if (sh && sh.kind === "mesh" && md.pick.value === "face" && md.faces.value.length) {
		// the chosen faces go, the shape stays
		meshAct("delete");
		return;
	}
	if (sh && sh.kind === "mesh" && md.pick.value === "edge" && md.edges.value.length) {
		// an edge has nothing of its own to delete, and the whole shape is not what was meant
		project.error.value = "Delete takes faces or a corner: choose the faces beside these edges to delete them (Esc lets go of the edges, and Delete then removes the shape).";
		return;
	}
	if (sh && sh.kind === "mesh" && v !== null && sh.points.length > 4) {
		// drop a corner: faces lose it, faces left with two points go
		mutate((d) => {
			const m = d.parts![s.part].shapes![s.shape];
			if (m.kind !== "mesh") return;
			m.points.splice(v, 1);
			m.faces = m.faces.map((f) => f.filter((i) => i !== v).map((i) => (i > v ? i - 1 : i))).filter((f) => f.length >= 3);
			delete m.tris;
		});
		md.vert.value = null;
		return;
	}
	mutate((d) => d.parts![s.part].shapes!.splice(s.shape, 1));
	batch(() => {
		md.sel.value = null;
		md.vert.value = null;
	});
}
export function dupSel() {
	const s = md.sel.value;
	const sh = selShape();
	if (!s || !sh) return;
	if (md.also.value.length) {
		// several shapes: each copy lands at the end of its part, and the copies are what is chosen
		const all = selected();
		const made: Sel3[] = [];
		mutate((d) => {
			for (const t of all) {
				const list = d.parts![t.part].shapes!;
				list.push(JSON.parse(JSON.stringify(list[t.shape])));
				made.push({ part: t.part, shape: list.length - 1 });
			}
		});
		selectShapes(made);
		return;
	}
	mutate((d) => d.parts![s.part].shapes!.splice(s.shape + 1, 0, JSON.parse(JSON.stringify(sh))));
	md.sel.value = { part: s.part, shape: s.shape + 1 };
}
/** A copy of the selected shape reflected across x = 0 of the model, faces turned to stay outward. */
export function mirrorSel() {
	const s = md.sel.value;
	const sh = selShape();
	if (!s || !sh) return;
	const mx = (p: Vec3): Vec3 => [-p[0], p[1], p[2]];
	let copy: Shape3;
	if (sh.kind === "mesh") copy = { ...sh, points: sh.points.map(mx), faces: sh.faces.map((f) => [...f].reverse()), tris: undefined };
	else if (sh.kind === "ball") copy = { ...sh, at: mx(sh.at) };
	else if (sh.kind === "rod") copy = { ...sh, a: mx(sh.a), b: mx(sh.b) };
	else copy = { ...sh }; // a sweep: its profile is its own; mirror the part instead
	if (copy.kind === "mesh") delete copy.tris;
	mutate((d) => d.parts![s.part].shapes!.splice(s.shape + 1, 0, copy));
	md.sel.value = { part: s.part, shape: s.shape + 1 };
}
export function paintSel(token: string) {
	const s = md.sel.value;
	if (!s) return;
	mutate((d) => {
		const sh = d.parts![s.part].shapes![s.shape];
		sh.color = token;
		// faces painted the colour the fill now is are simply the fill (1.8): their paint goes
		if (sh.kind === "mesh" || sh.kind === "sweep") tidyPaint(sh, faceCount(sh));
	});
}
export function setShapeNumber(s: Sel3, key: "shade" | "r" | "w", v: number) {
	mutate((d) => ((d.parts![s.part].shapes![s.shape] as unknown as Record<string, unknown>)[key] = v), `shape-${key}`);
}
export function setShapeCoord(s: Sel3, key: "at" | "a" | "b", axis: 0 | 1 | 2, v: number) {
	mutate((d) => {
		const sh = d.parts![s.part].shapes![s.shape] as unknown as Record<string, Vec3>;
		const p = [...sh[key]] as Vec3;
		p[axis] = v;
		sh[key] = p;
	}, `shape-${key}-${axis}`);
}
export function setVertexAxis(s: Sel3, vi: number, axis: 0 | 1 | 2, v: number) {
	const sh = selShapePosed();
	const now = sh && sh.kind === "mesh" ? sh.points[vi] : undefined;
	if (!now) return;
	const d: Vec3 = [0, 0, 0];
	d[axis] = v - now[axis];
	movePoints(s, [vi], d, `vert-${vi}-${axis}`);
}

const r3 = (x: number) => Math.round(x * 1000) / 1000 + 0;
const round3 = (p: Vec3): Vec3 => [r3(p[0]), r3(p[1]), r3(p[2])];

/** Move the selected shape by a view-space displacement (the part's map undone). */
export function moveSelView(s: Sel3, dView: Vec3, merge = "move") {
	const fp = framePartOf(s.part);
	if (!fp) return;
	const inv = xf3Invert(fp.F);
	const d = xf3ApplyDir(inv, dView);
	// Deform: a mesh moves in this state's morph, and nothing else moves at all (only a mesh has one)
	const morph = md.deform.value && md.curClip.value < 0;
	mutate((doc) => {
		const sh = doc.parts![s.part].shapes![s.shape];
		if (morph) {
			const pts = sh.kind === "mesh" ? morphEntry(doc, s.part, s.shape) : null;
			if (pts) pts.forEach((p, k) => (pts[k] = round3([p[0] + d[0], p[1] + d[1], p[2] + d[2]])));
			return;
		}
		const add = (p: Vec3): Vec3 => round3([p[0] + d[0], p[1] + d[1], p[2] + d[2]]);
		if (sh.kind === "mesh") sh.points = sh.points.map(add);
		else if (sh.kind === "ball") sh.at = add(sh.at);
		else if (sh.kind === "rod") {
			sh.a = add(sh.a);
			sh.b = add(sh.b);
		} else if (isPipe(sh) && sh.path) {
			// a pipe moves by its path (1.8); its twin, when it has one that is not moving with it, goes the mirrored way
			sh.path.points = sh.path.points.map(add);
			delete sh.bake;
			const twin = pipeTwin(s);
			const other = twin && !selected().some((t) => sameSel(t, twin)) ? doc.parts![twin.part].shapes![twin.shape] : undefined;
			if (isPipe(other) && other.path) {
				other.path.points = other.path.points.map((p): Vec3 => round3([p[0] - d[0], p[1] + d[1], p[2] + d[2]]));
				delete other.bake;
			}
		}
	}, merge);
}
/** Move a corner of the selected mesh (and the others chosen with it) by a view-space displacement. */
export function moveVertexView(s: Sel3, vi: number, dView: Vec3, merge = "vertex") {
	const fp = framePartOf(s.part);
	if (!fp) return;
	const d = xf3ApplyDir(xf3Invert(fp.F), dView);
	const chosen = chosenPoints();
	movePoints(s, chosen.includes(vi) ? chosen : [vi], d, merge);
}
/** Move the chosen corners, edges or faces of the selected mesh by a view-space displacement. */
export function moveChosenView(s: Sel3, dView: Vec3, merge = "vertex") {
	const fp = framePartOf(s.part);
	const chosen = chosenPoints();
	if (!fp || !chosen.length) return;
	movePoints(s, chosen, xf3ApplyDir(xf3Invert(fp.F), dView), merge);
}

/**
 * Keep a mesh symmetric across x after some of its points moved: each
 * moved point's mirror takes its place reflected, and a point on the
 * plane stays on it. `mm` is the mirror map of the base mesh.
 */
export function symmetrize(pts: Vec3[], moved: Iterable<number>, mm: readonly number[]) {
	const set = new Set(moved);
	for (const i of set) {
		const j = mm[i];
		if (j === i) pts[i] = [0, pts[i][1], pts[i][2]];
		else if (j >= 0 && !(set.has(j) && j < i)) pts[j] = [-pts[i][0] + 0, pts[i][1], pts[i][2]];
	}
}
/** The mirror map of a shape edited in symmetry, null when it is not. */
export function symmetryOf(s: Sel3): number[] | null {
	const part = parts()[s.part];
	const sh = part?.shapes?.[s.shape];
	if (!part || !sh || sh.kind !== "mesh" || !mirrorOn(part.name, s.shape) || mirrorModOn(sh)) return null;
	return mirrorMap(sh.points as V3[]);
}

/** Move points of a mesh by a displacement in its part's rest space: into this state's morph under Deform, mirrored under symmetry. */
export function movePoints(s: Sel3, idx: readonly number[], d: Vec3, merge = "vertex") {
	const morph = deforming();
	const mm = symmetryOf(s);
	const set = new Set(idx);
	mutate((doc) => {
		const sh = doc.parts![s.part].shapes![s.shape];
		if (sh.kind !== "mesh") return;
		const pts = morph ? morphEntry(doc, s.part, s.shape) : sh.points;
		if (!pts) return;
		for (const i of set) {
			const p = pts[i];
			if (!p) continue;
			const j = mm ? mm[i] : -1;
			// both of a mirrored pair chosen: one leads, the other follows it
			if (mm && j >= 0 && j !== i && set.has(j) && j < i) continue;
			pts[i] = round3([p[0] + (mm && j === i ? 0 : d[0]), p[1] + d[1], p[2] + d[2]]);
		}
		if (mm) symmetrize(pts, set, mm);
		if (!morph) delete sh.tris;
	}, morph ? `${merge}-morph` : merge);
}

/** The depth (view z) new shapes go at: the selection's centre, else the current part's pivot. */
export function workDepth(): number {
	const s = md.sel.value;
	const fp = framePartOf(s ? s.part : md.curPart.value);
	if (!fp) return 0;
	const sh = s ? parts()[s.part]?.shapes?.[s.shape] : undefined;
	if (sh) {
		const pts = sh.kind === "mesh" ? sh.points : sh.kind === "ball" ? [sh.at] : sh.kind === "rod" ? [sh.a, sh.b] : [];
		if (pts.length) return pts.reduce((acc, p) => acc + xf3Apply(fp.F, p)[2], 0) / pts.length;
	}
	return xf3Apply(fp.F, fp.part.pivot ?? [0, 0, 0])[2];
}

/** A view-space point (x, y at depth z) into the current part's rest space. */
export function viewToRest(partIndex: number, p: Vec3): Vec3 {
	const fp = framePartOf(partIndex);
	return round3(fp ? xf3Apply(xf3Invert(fp.F), p) : p);
}

/**
 * Extrude a polygon drawn in the view plane (view-space x, y) into a
 * mesh of the current part, `thick` deep about `depth`, faces wound
 * outward whichever way the part is turned.
 */
export function extrudeView(pts: Vec2[], depth: number, thick: number, color: string): Shape3 | null {
	const i = md.curPart.value;
	const fp = framePartOf(i);
	if (!fp || pts.length < 3) return null;
	const n = pts.length;
	const z0 = depth - thick / 2;
	const z1 = depth + thick / 2;
	const viewPts: Vec3[] = [...pts.map((q) => [q[0], q[1], z0] as Vec3), ...pts.map((q) => [q[0], q[1], z1] as Vec3)];
	// the profile's winding in view space decides which way the sides face
	let area = 0;
	for (let k = 0; k < n; k++) {
		const a = pts[k];
		const b = pts[(k + 1) % n];
		area += a[0] * b[1] - b[0] * a[1];
	}
	const ccw = area > 0; // y-down: a positive area is clockwise on screen, but it is the sign that matters
	const near = pts.map((_, k) => k); // z0 cap faces the viewer (−z)
	const far = pts.map((_, k) => k + n);
	// with y-down, x-right, z-away (right-handed), a loop with positive signed area has its normal along +z
	const faces: number[][] = [];
	faces.push(ccw ? [...near].reverse() : near); // normal −z
	faces.push(ccw ? far : [...far].reverse()); // normal +z
	for (let k = 0; k < n; k++) {
		const j = (k + 1) % n;
		const quad = [k, j, j + n, k + n];
		faces.push(ccw ? quad : [...quad].reverse());
	}
	const inv = xf3Invert(fp.F);
	const points = viewPts.map((p) => round3(xf3Apply(inv, p)));
	const flipped = xf3Det(inv) < 0;
	return { kind: "mesh", color, points, faces: flipped ? faces.map((f) => [...f].reverse()) : faces };
}

// ------------------------------------------------------------- textures (1.5)

export function textures(): Texture[] {
	return doc().textures ?? [];
}
export function addTexture(name: string, ref: string): number {
	mutate((d) => (d.textures ??= []).push({ name, cell: [8, 8], maps: { color: { ref } } }));
	return textures().length - 1;
}
export function deleteTexture(i: number) {
	const t = textures()[i];
	if (!t) return;
	mutate((d) => {
		d.textures!.splice(i, 1);
		for (const p of d.parts ?? []) for (const sh of p.shapes ?? []) if (sh.texture === t.name) {
			delete sh.texture;
			delete sh.mapping;
		}
	});
}
export function renameTexture(i: number, name: string) {
	const t = textures()[i];
	if (!t || !name || textures().some((q) => q !== t && q.name === name)) return;
	const old = t.name;
	mutate((d) => {
		d.textures![i].name = name;
		for (const p of d.parts ?? []) for (const sh of p.shapes ?? []) if (sh.texture === old) sh.texture = name;
	});
}
export function setTextureCell(i: number, axis: 0 | 1, v: number) {
	mutate((d) => {
		const c = [...d.textures![i].cell] as Vec2;
		c[axis] = Math.max(0.01, v);
		d.textures![i].cell = c;
	}, `tex-cell-${i}-${axis}`);
}
/** 1.8: how far the height map stands proud, in pattern units; 0 for none. */
export function setTextureRelief(i: number, v: number) {
	mutate((d) => {
		if (v) d.textures![i].relief = v;
		else delete d.textures![i].relief;
	}, `tex-relief-${i}`);
}
export function setMap(i: number, map: string, patch: Partial<TextureMap>) {
	mutate((d) => {
		const m = d.textures![i].maps[map];
		if (!m) return;
		for (const [k, v] of Object.entries(patch)) {
			if (v === undefined || v === "" || (k === "mode" && v === "paint") || (k === "soften" && !((v as number) > 0))) delete (m as Record<string, unknown>)[k];
			else (m as Record<string, unknown>)[k] = v;
		}
	});
}
export function addMap(i: number, map: string) {
	const t = textures()[i];
	if (!t || !map || t.maps[map]) return;
	const ref = t.maps.color?.ref ?? Object.values(t.maps)[0]?.ref ?? "";
	mutate((d) => (d.textures![i].maps[map] = { ref }));
}
export function deleteMap(i: number, map: string) {
	const t = textures()[i];
	if (!t || Object.keys(t.maps).length <= 1) return;
	mutate((d) => delete d.textures![i].maps[map]);
}
/** The selected shape takes a texture ("" for none), box mapped at scale 1. */
export function setSelTexture(name: string) {
	const s = md.sel.value;
	if (!s) return;
	mutate((d) => {
		const sh = d.parts![s.part].shapes![s.shape];
		if (name) sh.texture = name;
		else {
			delete sh.texture;
			delete sh.mapping;
		}
	});
}
/**
 * Unwrap (1.10): the selected mesh's texture becomes a sheet. Every mesh that wears it gets explicit uvs,
 * its faces box-projected into islands and packed into the cell together.
 */
export function unwrapSel() {
	const s = md.sel.value;
	if (!s) return;
	const name = doc().parts?.[s.part]?.shapes?.[s.shape]?.texture;
	if (!name) return;
	mutate((d) => void unwrapDoc(d, { texture: name }));
}
/** Back to box mapping: the selected shape drops its explicit uvs. */
export function boxMapSel() {
	const s = md.sel.value;
	if (!s) return;
	mutate((d) => {
		const sh = d.parts![s.part].shapes![s.shape];
		if (!sh.mapping?.uvs) return;
		const { uvs: _uvs, ...rest } = sh.mapping;
		void _uvs;
		if (Object.keys(rest).length) sh.mapping = rest;
		else delete sh.mapping;
	});
}
export function setSelMappingScale(v: number) {
	const s = md.sel.value;
	if (!s) return;
	mutate((d) => {
		const sh = d.parts![s.part].shapes![s.shape];
		if (!sh.texture) return;
		sh.mapping = { ...(sh.mapping ?? {}), scale: Math.max(0.01, v) };
	}, "map-scale");
}

// ------------------------------------------------------------- tokens, document

export function addToken(name: string) {
	mutate((d) => (d.palette ??= []).push({ name, rgb: [200, 195, 185, 255] }));
}
export function deleteToken(i: number) {
	mutate((d) => d.palette!.splice(i, 1));
}
export function renameToken(i: number, name: string) {
	const t = palette()[i];
	if (!t || !name || palette().some((q) => q !== t && q.name === name)) return;
	const old = t.name;
	mutate((d) => {
		d.palette![i].name = name;
		for (const p of d.parts!) for (const sh of p.shapes ?? []) {
			if (sh.color === old) sh.color = name;
			// the further colours its faces are painted with (1.8)
			if ((sh.kind === "mesh" || sh.kind === "sweep") && sh.colors) sh.colors = sh.colors.map((c) => (c === old ? name : c));
		}
	});
	if (md.paintTok.value === old) md.paintTok.value = name;
}
export function setTokenColor(i: number, rgb: Rgba) {
	mutate((d) => (d.palette![i].rgb = rgb), `token-${i}`);
}
export function setDocName(name: string) {
	mutate((d) => (d.name = name), "doc-name");
}
export function curTokName(): string {
	return md.tokens.value[md.tokens.value.length - 1]?.name ?? "ink";
}

/** A convex hull of the part's visible shapes into the document's collision, replacing the one it had (1.4). */
export function hullOfPart(i: number): boolean {
	const p = parts()[i];
	if (!p) return false;
	let ok = false;
	mutate((d) => {
		ok = setHull(d, p.name) !== null;
	});
	return ok;
}

/** Write the 2D views beside the model. Resolves with the files written. */
export async function projectViews(views: string[], outline: { color: string; w: number } | undefined): Promise<string[]> {
	const rel = md.path.value;
	if (!rel) return [];
	await flushNow();
	const stem = rel.replace(/\.fart$/, "");
	const out: string[] = [];
	for (const view of views) {
		const d = projectDoc(md.doc.value, { view, light: md.light.value, ambient: md.ambient.value, outline, from: rel.replace(/^.*\//, "") });
		if (outline && !(d.palette ?? []).some((t) => t.name === outline.color)) d.palette = [...(d.palette ?? []), { name: outline.color, rgb: [25, 22, 30, 255] }];
		const target = `${stem}-${view}.fart`;
		await writeDoc(target, stringifyDoc(d));
		out.push(target);
	}
	await refreshFiles();
	return out;
}

// ------------------------------------------------------------- mesh editing

const sameEdge = (a: readonly [number, number], b: readonly [number, number]) => (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);

// `vert` and `edge` are the last of what is chosen: clearing one lets go of all, setting one alone chooses only it
md.vert.subscribe((v) => {
	const l = md.verts.peek();
	if (v === null) {
		if (l.length) md.verts.value = [];
	} else if (!l.includes(v)) md.verts.value = [v];
});
md.edge.subscribe((e) => {
	const l = md.edges.peek();
	if (!e) {
		if (l.length) md.edges.value = [];
	} else if (!l.some((x) => sameEdge(x, e))) md.edges.value = [e];
});
// another shape chosen: its corners, edges and faces are not this one's
let selKey = "";
md.sel.subscribe((s) => {
	const k = s ? `${s.part}/${s.shape}` : "";
	if (k === selKey) return;
	selKey = k;
	batch(() => {
		md.verts.value = [];
		md.vert.value = null;
		md.edges.value = [];
		md.edge.value = null;
		md.faces.value = [];
		md.pipePt.value = null;
		if (!s) md.painting.value = false;
	});
});

export function chooseVerts(list: readonly number[]) {
	const u = [...new Set(list)];
	batch(() => {
		md.verts.value = u;
		md.vert.value = u.length ? u[u.length - 1] : null;
	});
}
export function chooseEdges(list: readonly (readonly [number, number])[]) {
	const u: [number, number][] = [];
	for (const e of list) if (!u.some((x) => sameEdge(x, e))) u.push([e[0], e[1]]);
	batch(() => {
		md.edges.value = u;
		md.edge.value = u.length ? u[u.length - 1] : null;
	});
}
export function chooseFaces(list: readonly number[]) {
	md.faces.value = [...new Set(list)];
}
/** What a click on the selected mesh chooses from now on; what was chosen the other way is let go. */
export function setPick(mode: Pick3) {
	batch(() => {
		md.pick.value = mode;
		if (mode !== "corner") chooseVerts([]);
		if (mode !== "edge") chooseEdges([]);
		if (mode !== "face") chooseFaces([]);
		if (mode !== "face") md.painting.value = false;
	});
}
/** Everything of the selected mesh that the pick mode can choose. */
export function chooseAll() {
	const sh = selShape();
	if (!sh || sh.kind !== "mesh") return;
	const mode = md.pick.value;
	if (mode === "corner") chooseVerts(sh.points.map((_, i) => i));
	else if (mode === "face") chooseFaces(sh.faces.map((_, i) => i));
	else {
		const out: [number, number][] = [];
		for (const f of sh.faces) f.forEach((a, i) => out.push([a, f[(i + 1) % f.length]]));
		chooseEdges(out);
	}
}
/** The corners of what is chosen on the selected mesh: the chosen corners, the ends of the chosen edges, the corners of the chosen faces. */
export function chosenPoints(): number[] {
	const sh = selShape();
	if (!sh || sh.kind !== "mesh") return [];
	const mode = md.pick.value;
	const out = new Set<number>();
	if (mode === "corner") for (const v of md.verts.value) out.add(v);
	else if (mode === "edge") for (const e of md.edges.value) e.forEach((v) => out.add(v));
	else for (const f of md.faces.value) for (const v of sh.faces[f] ?? []) out.add(v);
	return [...out].filter((v) => v < sh.points.length);
}

const cageFrom = (sh: Extract<Shape3, { kind: "mesh" }>): Cage => ({ points: sh.points as V3[], faces: sh.faces, creases: sh.creases, uvs: sh.mapping?.uvs });

/** Lay an operation's result into a document: the mesh, its creases and pattern coordinates, and every morph of it carried through. */
function layCage(d: Doc3, s: Sel3, steps: OpResult[]) {
	const part = d.parts?.[s.part];
	const sh = part?.shapes?.[s.shape];
	if (!part || !sh || sh.kind !== "mesh") return;
	// the morphs of this mesh: in states and in keys, on the part and on any part drawn like it
	const names = new Set([part.name, ...(d.parts ?? []).filter((q) => q.like === part.name).map((q) => q.name)]);
	const lists: { points: Vec3[] }[] = [];
	const take = (sp: StatePart3) => {
		if (names.has(sp.part)) for (const m of sp.morph ?? []) if (m.shape === s.shape) lists.push(m);
	};
	for (const st of d.states ?? []) st.parts.forEach(take);
	for (const c of d.clips ?? []) for (const k of c.keys) (k.parts ?? []).forEach(take);
	// lists a file may keep beside the cage, one entry per face or per point: they follow the faces and points they belong to
	const extra = sh as Record<string, unknown>;
	const whole = (v: unknown, n: number): number[] | null => (Array.isArray(v) && v.length === n && v.every((x) => typeof x === "number") ? (v as number[]) : null);
	let perFace = whole(extra.paint, sh.faces.length);
	let perPoint = whole(extra.shades, sh.points.length);
	let base = sh.points as V3[];
	for (const r of steps) {
		for (const m of lists) if (m.points.length === base.length) m.points = carryPoints(base, r.cage.points, r.src, m.points as V3[]);
		if (perFace) perFace = r.faceFrom.map((f) => (f >= 0 ? perFace![f] : 0));
		if (perPoint) perPoint = r.src.map(([a, b, t]) => Math.round((perPoint![a] + (perPoint![b] - perPoint![a]) * t) * 1000) / 1000);
		base = r.cage.points;
	}
	if (perFace) extra.paint = perFace;
	if (perPoint) extra.shades = perPoint;
	// (faces that went took their colours with them: the list of colours stays minimal)
	if (perFace) tidyPaint(sh, steps[steps.length - 1].cage.faces.length);
	const last = steps[steps.length - 1].cage;
	sh.points = last.points;
	sh.faces = last.faces;
	if (last.creases?.length) sh.creases = last.creases;
	else delete sh.creases;
	if (last.uvs && sh.mapping?.uvs) sh.mapping = { ...sh.mapping, uvs: last.uvs };
	delete sh.tris;
	delete sh.bake;
}

/**
 * Run a mesh operation on a shape as one undo step. `fn` gets the cage
 * and answers with the result (or the results of several steps in a
 * row). Throws a MeshError, with the reason, when it cannot be done;
 * with `check`, also when the document that would result is not valid.
 */
export function runMeshOp(s: Sel3, fn: (c: Cage) => OpResult | OpResult[], opts: { merge?: string; check?: boolean; amend?: boolean; after?: (d: Doc3, was: { faces: number }) => void } = {}): OpResult {
	const part = parts()[s.part];
	const sh = part?.shapes?.[s.shape];
	if (!part || !sh) throw new MeshError("There is no such shape.");
	if (sh.kind !== "mesh") throw new MeshError(`Mesh editing works on a mesh, and this is a ${sh.kind}${sh.kind === "sweep" ? ": a sweep is kept as its profile" : ""}.`);
	const out = fn(cageFrom(sh));
	const steps = Array.isArray(out) ? out : [out];
	const was = { faces: sh.faces.length };
	const lay = (d: Doc3) => {
		layCage(d, s, steps);
		opts.after?.(d, was);
	};
	if (opts.check) {
		const copy = JSON.parse(JSON.stringify(md.doc.value)) as Doc3;
		lay(copy);
		const r = validate(copy, { refTokens: md.unresolved.value.length ? null : md.shared.value.map((t) => t.name), unresolvedRefs: unresolvedOf(md.patterns.value) });
		if (r.errors.length) throw new MeshError("Refused, the mesh would not be valid:\n" + r.errors.map((e) => `${e.code} ${e.path}: ${e.message}`).join("\n"));
	}
	if (opts.amend) {
		lay(md.doc.value);
		touch();
	} else mutate(lay, opts.merge);
	return steps[steps.length - 1];
}

/** The steps of an adjustable operation, on a cage, for what was chosen. */
function opSteps(c: Cage, kind: OpKind, pick: LiveOp["pick"], p: Record<string, number>, sym: boolean): OpResult[] {
	const faces = sym ? withMirrorFaces(c, pick.faces) : pick.faces;
	const edges = sym ? withMirrorEdges(c, pick.edges) : pick.edges;
	const verts = sym ? withMirrorVerts(c, pick.verts) : pick.verts;
	switch (kind) {
		case "extrude":
			return [pick.mode === "edge" ? extrudeEdges(c, edges, { amount: p.amount }) : extrudeFaces(c, faces, p.amount)];
		case "inset":
			return [insetFaces(c, faces, p.amount, p.raise ?? 0)];
		case "loopcut": {
			const e = pick.edges[pick.edges.length - 1];
			if (!e) throw new MeshError("Choose an edge first: the cut runs across the ring of faces it belongs to.");
			const a = loopCut(c, e[0], e[1], p.at);
			if (sym) {
				// the mirrored edge, when the first cut did not pass through it already
				const m = mirrorMap(c.points);
				const [ma, mb] = [m[e[0]], m[e[1]]];
				if (ma >= 0 && mb >= 0 && ma !== mb && !sameEdge([ma, mb], e) && hasEdge(a.cage, ma, mb)) {
					try {
						const b = loopCut(a.cage, ma, mb, p.at);
						return [a, { ...b, edges: [...(a.edges ?? []), ...(b.edges ?? [])] }];
					} catch {
						// no ring on the other side: one cut it is
					}
				}
			}
			return [a];
		}
		case "merge":
			return [mergeCorners(c, p.distance, verts.length > 1 ? verts : undefined)];
		case "creaseAngle":
			return [creaseByAngle(c, p.angle, p.value)];
	}
}

/** Why the selected shape cannot be mesh-edited just now, null when it can. */
export function meshRefusal(): string | null {
	const s = md.sel.value;
	const part = s ? parts()[s.part] : undefined;
	const sh = selShape();
	if (!s || !part || !sh) return "Select a mesh first.";
	if (sh.kind !== "mesh") return `Mesh editing works on a mesh, and this is a ${sh.kind}.`;
	if (curClip()) return "A clip poses parts, not meshes; pick a state to edit.";
	if (md.also.value.length) return "Mesh editing works on one mesh at a time.";
	return null;
}
/** Is the working symmetry in force for a shape: its note is on, and no Mirror modifier across x already does the mirroring. */
export const symOn = (s: Sel3) => {
	const part = parts()[s.part];
	const sh = part?.shapes?.[s.shape];
	return !!part && mirrorOn(part.name, s.shape) && !(sh && mirrorModOn(sh));
};

function takeSelection(r: OpResult) {
	batch(() => {
		if (r.faces) {
			md.pick.value = "face";
			chooseVerts([]);
			chooseEdges([]);
			chooseFaces(r.faces);
		} else if (r.edges) {
			md.pick.value = "edge";
			chooseVerts([]);
			chooseFaces([]);
			chooseEdges(r.edges);
		} else {
			chooseVerts(r.verts ?? []);
			chooseEdges([]);
			chooseFaces([]);
		}
	});
}
function restoreInPlace(text: string) {
	const d = md.doc.value as Record<string, unknown>;
	for (const k of Object.keys(d)) delete d[k];
	Object.assign(d, JSON.parse(text));
}

/** The operation just done, while nothing else has changed the document since. */
export function liveOp(): LiveOp | null {
	const op = md.op.value;
	return op && op.rev === md.rev.value && op.depth === undoStack.length && md.path.value !== null ? op : null;
}

/**
 * Begin an operation that keeps its numbers open: it is done at once
 * with those given, and adjustOp runs it again with others, all in one
 * undo step. Throws a MeshError when it cannot begin.
 */
export function startOp(kind: OpKind, params: Record<string, number>, border?: string): LiveOp {
	const why = meshRefusal();
	if (why) throw new MeshError(why);
	const s = md.sel.value!;
	const pick: LiveOp["pick"] = { mode: md.pick.value, faces: [...md.faces.value], edges: md.edges.value.map((e) => [...e] as [number, number]), verts: [...md.verts.value] };
	const base = docText();
	pushUndo();
	mergeKey = null;
	let r: OpResult;
	try {
		r = runMeshOp(s, (c) => opSteps(c, kind, pick, params, symOn(s)), { amend: true, after: borderPaint(s, kind, border) });
	} catch (e) {
		undoStack.pop();
		touch();
		throw e;
	}
	const op: LiveOp = { kind, sel: s, params: { ...params }, pick, base, rev: md.rev.value, depth: undoStack.length, note: r.note, failed: false, ...(border ? { border } : {}) };
	takeSelection(r);
	md.op.value = op;
	return op;
}
/** Run the live operation again with some of its numbers changed. */
export function adjustOp(patch: Record<string, number>, look?: { border: string | null }) {
	const was = liveOp();
	if (!was) return;
	const params = { ...was.params, ...patch };
	const border = look ? (look.border ?? undefined) : was.border;
	restoreInPlace(was.base);
	let note = was.note;
	let failed = false;
	try {
		const r = runMeshOp(was.sel, (c) => opSteps(c, was.kind, was.pick, params, symOn(was.sel)), { amend: true, after: borderPaint(was.sel, was.kind, border) });
		note = r.note;
		takeSelection(r);
	} catch (e) {
		// these numbers cannot be done: the mesh shows as it was, and the panel says why
		touch();
		note = e instanceof MeshError ? e.message : String(e);
		failed = true;
	}
	const next: LiveOp = { ...was, params, note, failed, rev: md.rev.value };
	if (border) next.border = border;
	else delete next.border;
	md.op.value = next;
}
/** An inset's border ring in another colour: the faces the operation added (the ring of quads), painted with a palette token. */
function borderPaint(s: Sel3, kind: OpKind, border: string | undefined): ((d: Doc3, was: { faces: number }) => void) | undefined {
	return kind === "inset" && border ? ringPaint(s, border) : undefined;
}
/** What paints the faces an operation added to a mesh (an inset's ring of quads) with a palette token, as part of the same step. */
export function ringPaint(s: Sel3, border: string): (d: Doc3, was: { faces: number }) => void {
	return (d, was) => {
		const sh = d.parts?.[s.part]?.shapes?.[s.shape];
		if (!sh || sh.kind !== "mesh") return;
		const ring: number[] = [];
		for (let f = was.faces; f < sh.faces.length; f++) ring.push(f);
		paintFacesIn(sh, sh.faces.length, ring, border);
	};
}
/** Put the live operation back: the document as it was, and no undo step left behind. */
export function cancelOp() {
	const was = liveOp();
	if (!was) return;
	restoreInPlace(was.base);
	undoStack.pop();
	batch(() => {
		md.pick.value = was.pick.mode;
		chooseFaces(was.pick.faces);
		chooseEdges(was.pick.edges);
		chooseVerts(was.pick.verts);
		md.op.value = null;
	});
	touch();
}

export type MeshAct = "delete" | "flip" | "bridge" | "fill" | "wind" | "rim";
/** A mesh operation with nothing to adjust, on what is chosen. Answers with what it did; says why in the error line when it cannot. */
export function meshAct(act: MeshAct): string | null {
	try {
		const why = meshRefusal();
		if (why) throw new MeshError(why);
		const s = md.sel.value!;
		const sh = selShape() as Extract<Shape3, { kind: "mesh" }>;
		const sym = symOn(s);
		const cage = cageFrom(sh);
		const faces = sym ? withMirrorFaces(cage, md.faces.value) : md.faces.value;
		const edges = sym ? withMirrorEdges(cage, md.edges.value) : md.edges.value;
		if (act === "rim") {
			// the whole rim through each chosen edge (or corner)
			const out: [number, number][] = [];
			const seeds: (readonly [number, number] | number)[] = md.pick.value === "corner" ? md.verts.value : edges;
			for (const e of seeds) {
				const loop = typeof e === "number" ? rimThrough(cage, e) : rimThrough(cage, e[0], e[1]);
				if (!loop) throw new MeshError("That is not on a rim: a rim is a loop of open edges, around a hole in the mesh.");
				loop.forEach((v, i) => out.push([v, loop[(i + 1) % loop.length]]));
			}
			if (!out.length) throw new MeshError("Choose an open edge first; the whole rim it is on is then chosen.");
			batch(() => {
				md.pick.value = "edge";
				chooseVerts([]);
				chooseFaces([]);
				chooseEdges(out);
			});
			return `Chose a rim of ${out.length} edges`;
		}
		const r = runMeshOp(s, (c) => {
			if (act === "delete") return deleteFaces(c, faces);
			if (act === "flip") return flipFaces(c, faces);
			if (act === "wind") return windOutward(c);
			// the rims the chosen edges are on, each once
			const loops: number[][] = [];
			for (const e of edges) {
				const loop = rimThrough(c, e[0], e[1]);
				if (!loop) throw new MeshError(`Edge ${e[0]}–${e[1]} is not on a rim: a rim is a loop of open edges, around a hole in the mesh.`);
				if (!loops.some((l) => l.includes(loop[0]) && l.length === loop.length)) loops.push(loop);
			}
			if (act === "fill") {
				if (!loops.length) throw new MeshError("Choose an edge of the rim to fill.");
				const steps: OpResult[] = [];
				let cur = c;
				for (const loop of loops) {
					const step = fillRim(cur, [loop[0], loop[1]]);
					steps.push({ ...step, faces: [...(steps[steps.length - 1]?.faces ?? []), ...(step.faces ?? [])] });
					cur = step.cage;
				}
				return steps;
			}
			// bridge: two rims, or under symmetry two and their two mirrors
			if (loops.length !== 2 && !(sym && loops.length === 4)) throw new MeshError(loops.length < 2 ? "Choose an edge on each of two rims to bridge them." : "Choose edges on just two rims to bridge.");
			if (loops.length === 2) return bridgeRims(c, [loops[0][0], loops[0][1]], [loops[1][0], loops[1][1]]);
			// pair each rim with the nearest that is not its mirror
			const m = mirrorMap(c.points);
			const isMirror = (a: number[], b: number[]) => a.every((v) => b.includes(m[v]));
			const first = loops[0];
			const partner = loops.slice(1).find((l) => !isMirror(first, l))!;
			const rest = loops.filter((l) => l !== first && l !== partner);
			const a = bridgeRims(c, [first[0], first[1]], [partner[0], partner[1]]);
			const b = bridgeRims(a.cage, [rest[0][0], rest[0][1]], [rest[1][0], rest[1][1]]);
			return [a, { ...b, faces: [...(a.faces ?? []), ...(b.faces ?? [])] }];
		});
		md.op.value = null;
		if (act === "delete") chooseFaces([]);
		else if (act !== "wind") takeSelection(r);
		return r.note;
	} catch (e) {
		project.error.value = e instanceof MeshError ? e.message : String(e);
		return null;
	}
}

/** The crease of every chosen edge of the selected mesh (and their mirrors under symmetry), 0 removing it. */
export function setCreaseSel(s: Sel3, value: number) {
	try {
		runMeshOp(s, (c) => setCreases(c, symOn(s) ? withMirrorEdges(c, md.edges.value) : md.edges.value, Math.max(0, Math.min(1, value))), { merge: "crease-sel" });
	} catch (e) {
		project.error.value = e instanceof MeshError ? e.message : String(e);
	}
}

// ------------------------------------------------------------- paint (1.8)

type Surface = MeshShape | SweepShape;
const isSurface = (sh: Shape3 | undefined): sh is Surface => !!sh && (sh.kind === "mesh" || sh.kind === "sweep");
/** How many faces a shape's cage has: a mesh's own, a sweep's of the mesh it generates. */
export function faceCount(sh: Surface): number {
	return sh.kind === "mesh" ? sh.faces.length : cageOf(sh).faces.length;
}
/** Does the shape mirror itself across x in the file (a Mirror modifier)? The working symmetry then stands down. */
export function mirrorModOn(sh: Shape3): boolean {
	return isSurface(sh) && (sh.mods ?? []).some((m) => m.op === "mirror" && (m.axis ?? "x") === "x");
}
/** The colour faces are painted with: the one picked, else the last of the palette. */
export function paintToken(): string {
	const t = md.paintTok.value;
	return t && md.tokens.value.some((k) => k.name === t) ? t : curTokName();
}
function validNow(copy: Doc3): string | null {
	const r = validate(copy, { refTokens: md.unresolved.value.length ? null : md.shared.value.map((t) => t.name), unresolvedRefs: unresolvedOf(md.patterns.value) });
	return r.errors.length ? r.errors.map((e) => `${e.code} ${e.path}: ${e.message}`).join("\n") : null;
}
/**
 * Change one mesh or sweep as one undo step, after trying the change on
 * a copy: a change the validator would refuse is not made, and the
 * reason is thrown as a MeshError.
 */
function changeSurface(s: Sel3, fn: (sh: Surface, d: Doc3) => void, merge?: string): void {
	const sh = parts()[s.part]?.shapes?.[s.shape];
	if (!isSurface(sh)) throw new MeshError(sh ? `This works on a mesh or a sweep, and this is a ${sh.kind}.` : "There is no such shape.");
	const copy = JSON.parse(JSON.stringify(md.doc.value)) as Doc3;
	fn(copy.parts![s.part].shapes![s.shape] as Surface, copy);
	const why = validNow(copy);
	if (why) throw new MeshError("Refused, the shape would not be valid:\n" + why);
	mutate((d) => {
		const live = d.parts![s.part].shapes![s.shape] as Surface;
		fn(live, d);
		delete live.bake;
	}, merge);
}
const say = (e: unknown) => {
	project.error.value = e instanceof MeshError ? e.message : String(e);
};

/**
 * Paint faces of a mesh or a sweep with a palette token: `colors` and
 * `paint` are written and kept minimal. Under the working symmetry the
 * mirrored faces are painted too. Returns what it did; throws a
 * MeshError when it cannot.
 */
export function paintFacesOf(s: Sel3, faces: readonly number[], token: string, opts: { merge?: string; mirror?: boolean } = {}): string {
	const sh = parts()[s.part]?.shapes?.[s.shape];
	if (!isSurface(sh)) throw new MeshError(sh ? `Faces are painted on a mesh or a sweep, and this is a ${sh.kind}.` : "There is no such shape.");
	if (!md.tokens.value.some((t) => t.name === token)) throw new MeshError(`There is no colour named ${token}; the colours are ${md.tokens.value.map((t) => t.name).join(", ") || "(none)"}.`);
	const n = faceCount(sh);
	const bad = faces.find((f) => !Number.isInteger(f) || f < 0 || f >= n);
	if (bad !== undefined) throw new MeshError(`There is no face ${bad}: the shape has ${n} faces (0 to ${n - 1}).`);
	if (!faces.length) throw new MeshError("Choose the faces to paint first.");
	const sym = (opts.mirror ?? symOn(s)) && sh.kind === "mesh";
	const list = sym ? withMirrorFaces(cageFrom(sh as MeshShape), faces) : [...faces];
	changeSurface(s, (m) => void paintFacesIn(m, n, list, token), opts.merge);
	return `Painted ${list.length} face${list.length === 1 ? "" : "s"} ${token}`;
}
/** The chosen faces of the selected mesh, painted with the current colour. */
export function paintChosen(token = paintToken()): string | null {
	const s = md.sel.value;
	try {
		if (!s) throw new MeshError("Select a mesh first.");
		const note = paintFacesOf(s, md.faces.value, token);
		md.paintTok.value = token;
		md.op.value = null;
		return note;
	} catch (e) {
		say(e);
		return null;
	}
}
/** Paint by brush on and off: while on, a click or a drag over the selected mesh's faces paints them. */
export function setPainting(on: boolean) {
	batch(() => {
		md.painting.value = on;
		if (on) {
			setPick("face");
			chooseFaces([]);
			if (!md.paintTok.value) md.paintTok.value = paintToken();
		}
	});
}
/** One face under the brush: a stroke is one undo step. Quiet when the face wears the colour already. */
export function brushFace(s: Sel3, face: number) {
	const sh = parts()[s.part]?.shapes?.[s.shape];
	if (!isSurface(sh) || tokenOfFace(sh, face) === paintToken()) return;
	try {
		paintFacesOf(s, [face], paintToken(), { merge: "paint-stroke" });
	} catch (e) {
		say(e);
	}
}
/** The colour a face of the selected shape wears. */
export function faceToken(sh: Shape3, face: number): string | undefined {
	return isSurface(sh) ? tokenOfFace(sh, face) : sh.color;
}

// ------------------------------------------------------------- modifiers (1.8)

export type ModOp = "mirror" | "solidify" | "crease";
const MOD_DEFAULTS: Record<ModOp, Mod> = {
	mirror: { op: "mirror", axis: "x" },
	solidify: { op: "solidify", thick: 0.3 },
	crease: { op: "crease", angle: 30 },
};
/** The modifiers of a shape, in the order they are applied. */
export function modsOf(sh: Shape3 | undefined): Mod[] {
	return isSurface(sh) ? (sh.mods ?? []) : [];
}
function writeMods(sh: Surface, mods: Mod[]) {
	if (mods.length) sh.mods = mods;
	else delete sh.mods;
	tidyPaint(sh, faceCount(sh));
}
/** Replace a shape's whole list of modifiers (an empty list clears it): one undo step, refused when it would not be valid. */
export function setMods(s: Sel3, mods: Mod[], merge?: string): void {
	changeSurface(s, (sh) => writeMods(sh, JSON.parse(JSON.stringify(mods)) as Mod[]), merge);
}
/** The same, with palette tokens the modifiers name by index added to the shape's colours first (in order, after the ones it has). */
export function setModsWithColors(s: Sel3, mods: Mod[], tokens: readonly string[]): void {
	changeSurface(s, (sh) => {
		if (tokens.length) sh.colors = [...(sh.colors ?? []), ...tokens.filter((t) => !(sh.colors ?? []).includes(t))];
		writeMods(sh, JSON.parse(JSON.stringify(mods)) as Mod[]);
	});
}
export function addMod(s: Sel3, op: ModOp): boolean {
	try {
		setMods(s, [...modsOf(parts()[s.part]?.shapes?.[s.shape]), { ...MOD_DEFAULTS[op] }]);
		return true;
	} catch (e) {
		say(e);
		return false;
	}
}
export function removeMod(s: Sel3, i: number) {
	try {
		setMods(s, modsOf(parts()[s.part]?.shapes?.[s.shape]).filter((_, k) => k !== i));
	} catch (e) {
		say(e);
	}
}
/** Move a modifier one place earlier or later: the order is the order of work. */
export function moveMod(s: Sel3, i: number, later: boolean) {
	const list = [...modsOf(parts()[s.part]?.shapes?.[s.shape])];
	const j = later ? i + 1 : i - 1;
	if (i < 0 || j < 0 || i >= list.length || j >= list.length) return;
	[list[i], list[j]] = [list[j], list[i]];
	try {
		setMods(s, list);
	} catch (e) {
		say(e);
	}
}
/** One field of a modifier; undefined takes it away (the format's default then stands). A colour is a palette token, written as a paint index. */
export function setModField(s: Sel3, i: number, key: string, v: string | number | undefined) {
	try {
		changeSurface(
			s,
			(sh) => {
				const mods = (sh.mods ?? []).map((m) => ({ ...m }));
				const m = mods[i];
				if (!m) return;
				if (v === undefined || v === "") delete m[key];
				else if ((key === "inner" || key === "rim") && typeof v === "string") m[key] = paintIndex(sh, v);
				else m[key] = v;
				writeMods(sh, mods);
			},
			`mod-${i}-${key}`,
		);
	} catch (e) {
		say(e);
	}
}
/** The palette token a modifier's inner or rim index names; undefined when it has none (the faces keep their source's paint). */
export function modToken(sh: Shape3, m: Mod, key: "inner" | "rim"): string | undefined {
	const p = m[key];
	if (typeof p !== "number" || !isSurface(sh)) return undefined;
	return p === 0 ? sh.color : sh.colors?.[p - 1];
}

/**
 * Bake a shape's modifiers into plain geometry, through the one at
 * `index` (the ones before it are applied on the way: the order is the
 * order of work). Paint, shades, creases and pattern coordinates ride
 * through as the format says, every morph of the mesh is carried, and a
 * sweep becomes the mesh it made. One undo step. Returns what it did.
 */
export function applyMod(s: Sel3, index: number): string {
	const sh = parts()[s.part]?.shapes?.[s.shape];
	if (!isSurface(sh)) throw new MeshError(sh ? `Only a mesh or a sweep has modifiers, and this is a ${sh.kind}.` : "There is no such shape.");
	const mods = sh.mods ?? [];
	if (!mods[index]) throw new MeshError(mods.length ? `There is no modifier ${index}: this shape has ${mods.length} (0 to ${mods.length - 1}).` : "This shape has no modifiers to apply.");
	const part = parts()[s.part];
	const names = new Set([part.name, ...parts().filter((q) => q.like === part.name).map((q) => q.name)]);
	const count = index + 1;
	const was = sh.kind;
	changeSurface(s, (live, d) => {
		const upto = (live.mods ?? []).slice(0, count);
		const rest = (live.mods ?? []).slice(count);
		const cage = { ...(live.kind === "mesh" ? live : cageOf(live)), mods: upto } as MeshShape;
		delete cage.bake;
		const out = JSON.parse(JSON.stringify(applyMods(cage))) as MeshShape;
		// every morph of the cage, through the same modifiers (what they decide, they decide on the rest cage)
		if (live.kind === "mesh") {
			const take = (sp: StatePart3) => {
				if (!names.has(sp.part)) return;
				for (const m of sp.morph ?? []) if (m.shape === s.shape && m.points.length === live.points.length) m.points = JSON.parse(JSON.stringify(applyMods(posedMesh(cage, m.points)).points)) as Vec3[];
			};
			for (const st of d.states ?? []) st.parts.forEach(take);
			for (const c of d.clips ?? []) for (const k of c.keys) (k.parts ?? []).forEach(take);
		}
		const next = live as unknown as Record<string, unknown>;
		if (live.kind === "sweep") {
			// the sweep is the mesh it made from here on: its generator's fields go
			for (const k of ["op", "axis", "profile", "segments", "from", "to", "path", "radius", "radii", "caps", "closed"]) delete next[k];
			next.kind = "mesh";
		}
		next.points = out.points;
		next.faces = out.faces;
		for (const k of ["paint", "shades", "creases"] as const) {
			if (out[k]) next[k] = out[k];
			else delete next[k];
		}
		if (out.mapping?.uvs && live.mapping) live.mapping = { ...live.mapping, uvs: out.mapping.uvs };
		delete next.tris;
		if (rest.length) next.mods = rest;
		else delete next.mods;
		tidyPaint(live, out.faces.length);
	});
	batch(() => {
		chooseVerts([]);
		chooseEdges([]);
		chooseFaces([]);
		md.pipePt.value = null;
		md.op.value = null;
	});
	const what = mods.slice(0, count).map((m) => m.op).join(", ");
	return `Applied ${what}${was === "sweep" ? "; the sweep is a mesh now" : ""}`;
}

// ------------------------------------------------------------- shades (1.8)

/** The model's own geometry as one soup of triangles in a part's rest space, as the current state poses it: what casts the shade. */
function occluders(partIndex: number): { tris: number[]; lo: Vec3; hi: Vec3 } {
	const d = md.doc.value;
	const poses = curState()?.parts ?? [];
	const W = worldTransforms3(d, poses);
	const home = parts()[partIndex];
	const inv = xf3Invert(W.get(home.name) ?? ([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] as Parameters<typeof xf3Invert>[0]));
	const tris: number[] = [];
	const lo: Vec3 = [Infinity, Infinity, Infinity];
	const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
	for (const part of parts()) {
		const sp = poses.find((x) => x.part === part.name);
		// a part the state leaves out casts nothing
		if (poses.length && !sp) continue;
		const w = W.get(part.name);
		const F = w ? xf3Mul(inv, w) : inv;
		for (const sh of shapesOf3Posed(d, part, sp)) {
			// the cage with its modifiers, before smoothing: both halves, with their thickness
			const m = builtOf(sh);
			const pts = m.points.map((p) => xf3Apply(F, p));
			for (const p of pts) for (let k = 0; k < 3; k++) {
				if (p[k] < lo[k]) lo[k] = p[k];
				if (p[k] > hi[k]) hi[k] = p[k];
			}
			soupTris(pts, m.faces, tris);
		}
	}
	return { tris, lo, hi };
}

/**
 * Shade a mesh's corners: each gets a number for how much of the sky it
 * sees past the model's own geometry (see `cornerShades`), written as
 * `shades`. One undo step. Returns what it did.
 */
export function shadeCorners(s: Sel3, opts: { strength?: number; reach?: number } = {}): string {
	const part = parts()[s.part];
	const sh = part?.shapes?.[s.shape];
	if (!part || !sh) throw new MeshError("There is no such shape.");
	if (sh.kind !== "mesh") throw new MeshError(`Only a mesh has corners to shade, and this is a ${sh.kind}${sh.kind === "sweep" ? ": apply a modifier to it, or shade the meshes around it" : ""}.`);
	const strength = Math.max(0, Math.min(1, opts.strength ?? md.shadeStrength.value));
	const occ = occluders(s.part);
	const diag = Math.hypot(occ.hi[0] - occ.lo[0], occ.hi[1] - occ.lo[1], occ.hi[2] - occ.lo[2]);
	const reach = opts.reach && opts.reach > 0 ? opts.reach : Math.max(0.01, diag * 0.35);
	// the corners where the modifiers leave them (a mirror welds the seam, a wall may grow outward), with the normals of the built faces
	const posed = shapesOf3Posed(md.doc.value, part, curState()?.parts.find((x) => x.part === part.name))[s.shape];
	const built = builtOf(posed ?? sh);
	const n = sh.points.length;
	const normals = pointNormals(built.points as V3[], built.faces).slice(0, n);
	const shades = cornerShades(built.points.slice(0, n) as V3[], normals as V3[], soupOf(new Float64Array(occ.tris)), { strength, reach });
	const dark = shades.filter((x) => x < 0.995).length;
	mutate((d) => {
		const m = d.parts![s.part].shapes![s.shape];
		if (m.kind !== "mesh") return;
		if (dark) m.shades = shades;
		else delete m.shades;
		delete m.bake;
	});
	md.op.value = null;
	const least = Math.min(...shades);
	return dark ? `Shaded ${dark} of ${n} corners, the darkest ${least}` : "No corner is hidden from the sky: nothing to shade";
}
/** Take a mesh's shades away. */
export function clearShades(s: Sel3): string {
	const sh = parts()[s.part]?.shapes?.[s.shape];
	if (!sh || sh.kind !== "mesh") throw new MeshError("Only a mesh has shades.");
	if (!sh.shades) return "It has no shades";
	mutate((d) => {
		const m = d.parts![s.part].shapes![s.shape] as MeshShape;
		delete m.shades;
		delete m.bake;
	});
	return "Cleared the shades";
}
/** The two as the inspector's buttons run them: the reason goes to the error line. */
export function shadeAct(act: "shade" | "clear"): string | null {
	const s = md.sel.value;
	try {
		if (!s) throw new MeshError("Select a mesh first.");
		return act === "shade" ? shadeCorners(s) : clearShades(s);
	} catch (e) {
		say(e);
		return null;
	}
}

// ------------------------------------------------------------- pipes (1.8)

export const isPipe = (sh: Shape3 | undefined): sh is SweepShape => !!sh && sh.kind === "sweep" && sh.op === "pipe";
const mirrorX = (p: Vec3): Vec3 => [-p[0] + 0, p[1], p[2]];

export interface PipeOptions {
	radius?: number;
	radii?: number[];
	segments?: number;
	caps?: boolean;
	closed?: boolean;
	/** round the path through its points (handles written as the format keeps them) */
	round?: boolean;
	color?: string;
	/** a mirrored twin across x beside it, the two kept alike while they are edited */
	twin?: boolean;
}
function pipeShape(points: Vec3[], o: PipeOptions): SweepShape {
	const sh: SweepShape = { kind: "sweep", color: o.color ?? curTokName(), op: "pipe", segments: Math.max(3, Math.round(o.segments ?? 8)), path: { points: points.map(round3) }, radius: r3(o.radius ?? 0.3) };
	if (o.radii) sh.radii = o.radii.map(r3);
	if (o.caps === false) sh.caps = false;
	if (o.closed) sh.closed = true;
	if (o.round && points.length >= 3) Object.assign(sh.path!, roundHandles(sh.path!.points as V3[], !!o.closed));
	return sh;
}
/**
 * A pipe along points of a part's rest space, added to that part and
 * selected; with `twin`, a second one mirrored across x. One undo step.
 * Throws a MeshError when the pipe would not be valid.
 */
export function addPipe(partIndex: number, points: Vec3[], o: PipeOptions = {}): Sel3 {
	const p = parts()[partIndex];
	if (!p) throw new MeshError("There is no such part.");
	if (p.like) throw new MeshError(`${p.name} is drawn like ${p.like} and has no shapes of its own; add the pipe to ${p.like}.`);
	if (points.length < 2) throw new MeshError("A pipe needs two points or more.");
	if (o.closed && points.length < 3) throw new MeshError("A closed pipe needs three points or more.");
	if (o.radii && o.radii.length !== points.length) throw new MeshError(`radii must have one number per point: ${points.length}, not ${o.radii.length}.`);
	const one = pipeShape(points, o);
	const two = o.twin ? pipeShape(points.map(mirrorX), o) : null;
	const copy = JSON.parse(JSON.stringify(md.doc.value)) as Doc3;
	(copy.parts![partIndex].shapes ??= []).push(one, ...(two ? [two] : []));
	const why = validNow(copy);
	if (why) throw new MeshError("Refused, the pipe would not be valid:\n" + why);
	const at = p.shapes?.length ?? 0;
	mutate((d) => (d.parts![partIndex].shapes ??= []).push(JSON.parse(JSON.stringify(one)), ...(two ? [JSON.parse(JSON.stringify(two))] : [])));
	if (two) setTwin(p.name, at, at + 1);
	const sel = { part: partIndex, shape: at };
	batch(() => {
		md.curPart.value = partIndex;
		md.sel.value = sel;
		md.pipePt.value = null;
	});
	return sel;
}
/**
 * Land points on a shape's drawn surface: each goes to the nearest
 * point of it and is lifted `offset` along the surface's normal there.
 * The points are in `partIndex`'s rest space, and so is what comes
 * back; the shape may belong to another part (as the current state
 * poses the two).
 */
export function landOnSurface(partIndex: number, points: readonly Vec3[], on: Sel3, offset: number): Vec3[] {
	const home = parts()[partIndex];
	const part = parts()[on.part];
	const sh = part?.shapes?.[on.shape];
	if (!home || !part || !sh) throw new MeshError("There is no such shape to land on.");
	const poses = curState()?.parts ?? [];
	const W = worldTransforms3(md.doc.value, poses);
	const ident = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] as Parameters<typeof xf3Invert>[0];
	const F = xf3Mul(xf3Invert(W.get(home.name) ?? ident), W.get(part.name) ?? ident);
	const m = sh.kind === "mesh" || sh.kind === "sweep" ? asMesh(sh) : cageOf(sh);
	const tris = soupTris(m.points.map((p) => xf3Apply(F, p)) as V3[], m.faces);
	if (!tris.length) throw new MeshError("That shape has no surface to land on.");
	return points.map((p) => {
		const hit = nearestOnTris(tris, p as V3)!;
		return round3([hit.at[0] + hit.n[0] * offset, hit.at[1] + hit.n[1] * offset, hit.at[2] + hit.n[2] * offset]);
	});
}

/** The twin of a pipe, when the notes pair it with one that is still its mirror in kind and count. */
export function pipeTwin(s: Sel3): Sel3 | null {
	const part = parts()[s.part];
	const sh = part?.shapes?.[s.shape];
	if (!part || !isPipe(sh)) return null;
	const j = twinOf(part.name, s.shape);
	const other = j === null ? undefined : part.shapes?.[j];
	if (j === null || !isPipe(other) || other.path?.points.length !== sh.path?.points.length) return null;
	return { part: s.part, shape: j };
}
/** Change a pipe (and its twin, mirrored) as one undo step. */
function changePipe(s: Sel3, fn: (sh: SweepShape, flip: boolean) => void, merge?: string) {
	const twin = pipeTwin(s);
	try {
		const copy = JSON.parse(JSON.stringify(md.doc.value)) as Doc3;
		const run = (d: Doc3) => {
			const a = d.parts![s.part].shapes![s.shape];
			if (isPipe(a)) {
				fn(a, false);
				delete a.bake;
			}
			const b = twin ? d.parts![twin.part].shapes![twin.shape] : undefined;
			if (isPipe(b)) {
				fn(b, true);
				delete b.bake;
			}
		};
		run(copy);
		const why = validNow(copy);
		if (why) throw new MeshError("Refused, the pipe would not be valid:\n" + why);
		mutate(run, merge);
	} catch (e) {
		say(e);
	}
}
/** The handles follow the points while a path is rounded: the studio writes them, it does not edit them one by one. */
function reround(sh: SweepShape) {
	const path = sh.path;
	if (!path || !(path.in || path.out)) return;
	if (path.points.length < 3) {
		delete path.in;
		delete path.out;
	} else Object.assign(path, roundHandles(path.points as V3[], !!sh.closed));
}
/** Put a point of a pipe's path somewhere in its part's rest space. */
export function setPipePoint(s: Sel3, i: number, to: Vec3, merge = "pipe-point") {
	changePipe(
		s,
		(sh, flip) => {
			const pts = sh.path?.points;
			if (!pts || !pts[i]) return;
			pts[i] = round3(flip ? mirrorX(to) : to);
			reround(sh);
		},
		merge,
	);
}
/** Move a point of the selected pipe's path by a view-space displacement. */
export function movePipePointView(s: Sel3, i: number, dView: Vec3, merge = "pipe-point") {
	const fp = framePartOf(s.part);
	const sh = parts()[s.part]?.shapes?.[s.shape];
	const p = isPipe(sh) ? sh.path?.points[i] : undefined;
	if (!fp || !p) return;
	const d = xf3ApplyDir(xf3Invert(fp.F), dView);
	setPipePoint(s, i, [p[0] + d[0], p[1] + d[1], p[2] + d[2]], merge);
}
export function setPipeField(s: Sel3, key: "radius" | "segments" | "caps" | "closed", v: number | boolean) {
	changePipe(
		s,
		(sh) => {
			if (key === "radius") sh.radius = Math.max(0.001, r3(v as number));
			else if (key === "segments") sh.segments = Math.max(3, Math.round(v as number));
			else if (key === "caps") {
				if (v) delete sh.caps;
				else sh.caps = false;
			} else {
				if (v) sh.closed = true;
				else delete sh.closed;
				reround(sh);
			}
			// the faces are other faces now: paint that no longer fits goes
			if (sh.paint && sh.paint.length !== cageOf({ ...sh, bake: undefined } as SweepShape).faces.length) {
				delete sh.paint;
				tidyPaint(sh, 0);
			}
		},
		`pipe-${key}`,
	);
}
/** The radius at one point of the path, as a factor of the pipe's radius; every point at 1 leaves `radii` out. */
export function setPipeRadiusAt(s: Sel3, i: number, k: number) {
	changePipe(
		s,
		(sh) => {
			const n = sh.path?.points.length ?? 0;
			const radii = sh.radii && sh.radii.length === n ? [...sh.radii] : new Array<number>(n).fill(1);
			if (i < 0 || i >= n) return;
			radii[i] = Math.max(0, r3(k));
			if (radii.every((x) => x === 1)) delete sh.radii;
			else sh.radii = radii;
		},
		`pipe-radius-${i}`,
	);
}
/** Round a pipe's path through its points, or make it straight runs again. */
export function setPipeRound(s: Sel3, on: boolean) {
	changePipe(s, (sh) => {
		const path = sh.path;
		if (!path) return;
		if (on && path.points.length >= 3) Object.assign(path, roundHandles(path.points as V3[], !!sh.closed));
		else {
			delete path.in;
			delete path.out;
		}
	});
}
/** Take a point out of a pipe's path (two must remain; three on a closed one). */
export function deletePipePoint(s: Sel3, i: number) {
	const sh = parts()[s.part]?.shapes?.[s.shape];
	if (!isPipe(sh)) return;
	const n = sh.path?.points.length ?? 0;
	if (n <= (sh.closed ? 3 : 2)) {
		project.error.value = sh.closed ? "A closed pipe keeps three points; open it first, or delete the pipe." : "A pipe keeps two points; delete the pipe itself to be rid of it.";
		return;
	}
	changePipe(s, (p) => {
		p.path!.points.splice(i, 1);
		if (p.radii) {
			p.radii.splice(i, 1);
			if (p.radii.every((x) => x === 1)) delete p.radii;
		}
		reround(p);
		delete p.paint;
		tidyPaint(p, 0);
	});
	md.pipePt.value = null;
}
/** Pair the selected pipe with a mirrored twin across x (made now, beside it), or let the pair go: each is then its own shape. */
export function setPipeSymmetry(s: Sel3, on: boolean) {
	const part = parts()[s.part];
	const sh = part?.shapes?.[s.shape];
	if (!part || !isPipe(sh)) return;
	if (!on) {
		setTwin(part.name, s.shape, null);
		return;
	}
	if (pipeTwin(s)) return;
	const copy = JSON.parse(JSON.stringify(sh)) as SweepShape;
	delete copy.bake;
	copy.path!.points = copy.path!.points.map(mirrorX);
	for (const k of ["in", "out"] as const) if (copy.path![k]) copy.path![k] = copy.path![k]!.map(mirrorX);
	const at = part.shapes!.length;
	mutate((d) => d.parts![s.part].shapes!.push(copy));
	setTwin(part.name, s.shape, at);
}

// ------------------------------------------------------------- the mannequin

/** Read the mannequin the notes name; nothing when they name none. */
export async function loadMannequin() {
	const m = work.value.mannequin;
	const rel = md.path.value;
	if (!m || !rel) {
		md.mannequin.value = null;
		return;
	}
	const text = await shell.readFile(root(), m.path);
	const parsed = text === null ? null : parseDoc(text).doc;
	if (md.path.value !== rel || work.value.mannequin?.path !== m.path) return;
	if (!parsed || parsed.space !== "3d") {
		md.mannequin.value = null;
		project.error.value = text === null ? `The mannequin ${m.path} is not there any more.` : `${m.path} is not a 3D model, so it cannot be a mannequin.`;
		return;
	}
	const d = parsed as unknown as Doc3;
	delete d.resolved;
	const dir = dirname(m.path);
	const resolved = await resolvePalettes(d as unknown as Parameters<typeof resolvePalettes>[0], (ref) => shell.readFile(root(), joinRel(dir, ref)));
	if (md.path.value !== rel || work.value.mannequin?.path !== m.path) return;
	// it is shown, never edited: drawn from its compiled sidecar (1.8), built first where that is missing or stale
	const compiled = await sidecarOf(root(), m.path, text!);
	if (md.path.value !== rel || work.value.mannequin?.path !== m.path) return;
	md.mannequin.value = { path: m.path, doc: d, tokens: resolved.tokens, compiled };
	md.rev.value++;
}
/** Show another model of the project under this one (null for none), in one of its states. */
export function chooseMannequin(m: Mannequin | null) {
	setMannequin(m);
	void loadMannequin();
}
/** The poses the mannequin stands in: the state the notes name, else its first. */
export function mannequinPoses(): StatePart3[] | undefined {
	const m = md.mannequin.value;
	if (!m) return undefined;
	const want = work.value.mannequin?.state;
	const st = (m.doc.states ?? []).find((x) => x.name === want) ?? m.doc.states?.[0];
	return st?.parts;
}
