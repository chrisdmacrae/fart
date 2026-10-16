// The editor store. One document at a time, mutated in place; every
// change bumps `rev` so panels re-render, snapshots the previous state
// for undo, and schedules the live flush to disk.
//
// Saving is a checkpoint, not a copy: the file on disk mirrors the doc a
// beat after every change (a game hot-reloading it sees the experiment
// live); Save marks the checkpoint; leaving any other way rolls the disk
// back to it. The checkpoint also lives beside the file as <name>.fart~.

import { signal, batch } from "@preact/signals";
import {
	shapesOfPosed,
	pivotOf,
	parseDoc,
	is3d,
	validate,
	stringifyDoc,
	resolvePalettes,
	bakeTris,
	type Doc,
	type Shape,
	type Part,
	type State,
	type StatePart,
	type Token,
	type Texture,
	type TextureMap,
	type Vec2,
	type Issue,
	type Rgba,
	type Clip,
	type Constraint,
	type Ease,
	sampleClip,
	solveChain,
	isPaletteFile,
	shapesOf,
	anchorsOf,
	sourceOf,
	sampleTargets,
	solveTargets,
	keyPoses,
	keyTargets,
	type ClipKey,
	type Target,
	type Curve,
	type Anchor,
} from "@fastart/core";
import { shell } from "../shell/shell.ts";
import { loadPatterns, unresolvedOf, type TexturePattern } from "./textures.ts";
import { confirm } from "./prompt.ts";
import { project } from "./project.ts";
import { dirname, joinRel, relativeTo } from "./paths.ts";
import { local, clearLocal } from "./local.ts";

export type Tool = "select" | "circle" | "line" | "poly" | "rect";
export type Pending = "none" | "pivot" | "anchor";

/** A shape by address: part index, shape index. */
export interface Ref {
	p: number;
	s: number;
}

export const ed = {
	doc: signal<Doc>({ version: 1 }),
	rev: signal(0),
	path: signal<string | null>(null),
	/** every token in lookup order: shared refs first, local last */
	tokens: signal<Token[]>([]),
	/** 1.5: the file's textures, resolved and rendered, by name */
	patterns: signal<Map<string, TexturePattern>>(new Map()),
	/** the tokens palette_refs supplied, read-only here */
	shared: signal<Token[]>([]),
	/** palette_refs that could not be read */
	unresolved: signal<string[]>([]),
	/** a palette file: colours and no parts; the canvas gives way to swatches */
	isPalette: signal(false),
	issues: signal<Issue[]>([]),
	tool: signal<Tool>("select"),
	curPart: signal(0),
	/** the part was chosen on purpose (a layer row, a hit, a grip): the inspector shows it. An empty click clears it and the inspector shows the document. */
	partPicked: signal(false),
	curTok: signal(0),
	/** the state on the canvas; there is always one */
	curState: signal(0),
	/** a clip being previewed; -1 none. Clip and state are exclusive. */
	curClip: signal(-1),
	clipTime: signal(0),
	playing: signal(false),
	curKey: signal(-1),
	sel: signal<Ref[]>([]),
	hover: signal<Ref | null>(null),
	collide: signal(false),
	colSel: signal(-1),
	pending: signal<Pending>("none"),
	polyPts: signal<Vec2[]>([]),
	/** 1.7: the pen's out-handle per point in progress (mirrored in); zero for a corner */
	polyOut: signal<Vec2[]>([]),
	/** 1.6/1.7: corner and handle drags reshape the part in the current state (a morph) instead of the base shape */
	deform: signal(false),
	/** the document differs from its checkpoint */
	dirty: signal(false),
	/** when the file itself was last written this session (ms), 0 for not yet */
	written: signal(0),
	/** when the checkpoint was last made this session (ms), 0 for not yet */
	checkpointAt: signal(0),
	canUndo: signal(false),
	canRedo: signal(false),
};

/** A moment to return to: the document, and which state and clip were on the canvas. */
interface Snap {
	doc: string;
	state: number;
	clip: number;
}
let undoStack: Snap[] = [];
let redoStack: Snap[] = [];
let checkpoint = ""; // the doc as of the last checkpoint (⌘S): what Revert goes back to
let lastFlush = ""; // the doc as last written to disk
let writes: Promise<void> = Promise.resolve(); // one file's writes, in order
// the file as the studio last synced with it: what it read, or what it wrote.
// Another tool writing the file moves its mtime; the watch notices.
let diskText = ""; // normalised
let diskMtime: number | null = null;
let watchTimer: number | undefined;
let asking = false; // a conflict dialog is up: hold writes and polls
const WATCH_MS = 1000;
let flushTimer: number | undefined;
let mergeKey: string | null = null;

const FLUSH_MS = 350;
const UNDO_MAX = 200;

// ------------------------------------------------------------- access

/**
 * The document, for anyone rendering it. Reads the revision too, so a
 * component that derives anything from the doc re-renders when it
 * changes: the doc is mutated in place, and the signals integration
 * skips re-rendering a child whose props did not change.
 */
export function doc(): Doc {
	void ed.rev.value;
	return ed.doc.value;
}
export function parts(): Part[] {
	return doc().parts ?? [];
}
export function states(): State[] {
	return doc().states ?? [];
}
export function palette(): Token[] {
	return doc().palette ?? [];
}
export function curPart(): Part | undefined {
	return parts()[ed.curPart.value];
}
export function curState(): State | undefined {
	return states()[ed.curState.value];
}
export function clips(): Clip[] {
	return doc().clips ?? [];
}
export function constraints(): Constraint[] {
	return doc().constraints ?? [];
}
export function curClip(): Clip | undefined {
	return clips()[ed.curClip.value];
}
/** The pose list the canvas draws: a clip frame, else the current state's parts. */
export function frame(): StatePart[] | undefined {
	const c = curClip();
	if (c) return sampleFrame(doc(), c, ed.clipTime.value);
	return curState()?.parts;
}
function sampleFrame(d: Doc, c: Clip, t: number): StatePart[] {
	const poses = sampleClip(d, c, t);
	const targets = sampleTargets(d, c, t);
	if (targets.length) solveTargets(d, poses, targets);
	return poses;
}

/** What a pose gesture works on: a state, or a clip key (its own parts, inline). */
export interface Pose {
	parts: StatePart[];
	targets?: Target[];
}

/** The key the playhead sits on in the clip on the canvas; -1 between keys (or no clip). */
export function keyHere(): number {
	const c = curClip();
	if (!c) return -1;
	const t = ed.clipTime.value;
	const k = ed.curKey.value;
	if (c.keys[k] && Math.abs(c.keys[k].t - t) < 1e-6) return k;
	return c.keys.findIndex((key) => Math.abs(key.t - t) < 1e-6);
}

/**
 * The pose the canvas poses, for reading: the current state; in a clip the
 * key under the playhead (its own parts, or the state it names); between
 * keys, the frame (a gesture there makes a key).
 */
export function pose(): Pose | undefined {
	const c = curClip();
	if (!c) return curState();
	const d = doc();
	const k = keyHere();
	if (k >= 0) return { parts: keyPoses(d, c.keys[k]), targets: keyTargets(d, c.keys[k]) };
	return { parts: frame() ?? [], targets: sampleTargets(d, c, ed.clipTime.value) };
}

/**
 * The pose a gesture changes, called inside a mutate. In a clip it is the
 * key under the playhead, made its own: a key naming a state takes a copy
 * of it inline (the state, and every other key naming it, stay as they
 * are), and between keys a key is made at the playhead from the frame.
 */
export function editPose(d: Doc): Pose | undefined {
	const c = d.clips?.[ed.curClip.value];
	if (!c) return d.states?.[ed.curState.value];
	let k = keyHere();
	const t = Math.round(ed.clipTime.value * 100) / 100;
	// a playhead a hair from a key (the time rounds onto it) poses that key
	if (k < 0) k = c.keys.findIndex((key) => Math.abs(key.t - t) < 1e-6);
	if (k < 0) {
		const key: ClipKey = { t, parts: sampleFrame(d, c, ed.clipTime.value) };
		const tg = sampleTargets(d, c, ed.clipTime.value);
		if (tg.length) key.targets = tg;
		c.keys.push(key);
		k = sortKeys(c, key);
	}
	if (k >= 0 && Math.abs(c.keys[k].t - ed.clipTime.value) > 1e-6) ed.clipTime.value = c.keys[k].t;
	ed.curKey.value = k;
	const key = c.keys[k];
	if (!key.parts) {
		key.parts = structuredClone(keyPoses(d, key));
		const tg = keyTargets(d, key);
		if (tg.length && !key.targets) key.targets = structuredClone(tg);
		delete key.state;
	}
	return key as Pose;
}

export type Mode = "state" | "clip" | "collide";
/** What the canvas is doing: editing a state, posing a clip's keys, or the collision lens. */
export function mode(): Mode {
	if (ed.collide.value) return "collide";
	if (curClip()) return "clip";
	return "state";
}

/** Whether the current part is drawn by the current state (it has an entry). */
export function curPartPose(): StatePart | undefined {
	return poseOfCur();
}
export function curTokName(): string {
	return palette()[ed.curTok.value]?.name ?? palette()[0]?.name ?? "ink";
}
export function shapeAt(r: Ref | null): Shape | undefined {
	if (!r) return undefined;
	const p = parts()[r.p];
	return p ? shapesOf(doc(), p)[r.s] : undefined;
}

/** A part's shapes as drawn: its own, or its `like` source's (the same array, so edits land there). */
export function shapesIn(p: Part): Shape[] {
	return shapesOf(doc(), p);
}
export function anchorsIn(p: Part): Anchor[] {
	return anchorsOf(doc(), p);
}
export function primary(): Ref | null {
	const s = ed.sel.value;
	return s.length ? s[s.length - 1] : null;
}
export function selShape(): Shape | undefined {
	return shapeAt(primary());
}
export function colShape(): Shape | undefined {
	return doc().collision?.[ed.colSel.value];
}
/** The current part's entry in the pose being posed (see pose()); to change it, setPose. */
export function poseOfCur(): StatePart | undefined {
	const pz = pose();
	const p = curPart();
	if (!pz || !p) return undefined;
	return pz.parts.find((sp) => sp.part === p.name);
}
export function rgbaOf(name: string): Rgba {
	const t = ed.tokens.value;
	for (let i = t.length - 1; i >= 0; i--) if (t[i].name === name) return t[i].rgb;
	return [255, 0, 255, 255];
}

/** Part indices drawn right now: all of them, or the current pose's, minus the hidden. */
export function visibleParts(): number[] {
	const fr = frame();
	const ps = parts();
	const hidden = local.hidden.value;
	if (!fr) return ps.map((_, i) => i).filter((i) => !hidden.has(ps[i].name));
	const out: number[] = [];
	for (const sp of fr) {
		const i = ps.findIndex((p) => p.name === sp.part);
		if (i >= 0 && !hidden.has(ps[i].name)) out.push(i);
	}
	return out;
}

/** Parts a click may pick: visible and not locked. */
export function pickableParts(): number[] {
	const ps = parts();
	const locked = local.locked.value;
	return visibleParts().filter((i) => !locked.has(ps[i].name));
}

/** Move the selection by a step (the arrow keys). */
export function nudgeSel(d: Vec2) {
	const shapes = selShapes();
	if (!shapes.length) return;
	mutate(() => {
		for (const sh of shapes) moveShape(sh, d);
	}, "nudge");
}

/** Every shape of every pickable part. */
export function selectAll() {
	const ps = parts();
	const refs: Ref[] = [];
	for (const p of pickableParts()) shapesOf(doc(), ps[p]).forEach((_, s) => refs.push({ p, s }));
	ed.sel.value = refs;
}

/** A fresh name: "part 2", "state 3", whatever is free. */
export function freshName(base: string, taken: Iterable<string>): string {
	const set = new Set(taken);
	if (!set.has(base)) return base;
	for (let i = 2; ; i++) if (!set.has(`${base} ${i}`)) return `${base} ${i}`;
}

// ------------------------------------------------------------- change

function docText(): string {
	return JSON.stringify(doc());
}

function snapshot(): Snap {
	return { doc: docText(), state: ed.curState.value, clip: ed.curClip.value };
}

function touch() {
	batch(() => {
		ed.rev.value++;
		markDirty();
		ed.tokens.value = [...ed.shared.value, ...palette()];
		ed.canUndo.value = undoStack.length > 0;
		ed.canRedo.value = redoStack.length > 0;
	});
	scheduleFlush();
}

export function pushUndo() {
	undoStack.push(snapshot());
	if (undoStack.length > UNDO_MAX) undoStack.shift();
	redoStack = [];
}

/**
 * Apply a change. `merge` names a gesture (a slider drag, a handle drag):
 * the first change in a gesture snapshots for undo, the rest ride along,
 * so one drag is one undo step. endGesture() closes it.
 */
export function mutate(fn: (d: Doc) => void, merge?: string) {
	if (!merge || mergeKey !== merge) {
		pushUndo();
		mergeKey = merge ?? null;
	}
	const texBefore = JSON.stringify(ed.doc.value.textures ?? []);
	fn(doc());
	touch();
	if (JSON.stringify(ed.doc.value.textures ?? []) !== texBefore) void reloadPatterns();
}

export function endGesture() {
	mergeKey = null;
}

function restore(snap: Snap) {
	const refsBefore = JSON.stringify(ed.doc.value.palette_refs ?? []);
	const texBefore = JSON.stringify(ed.doc.value.textures ?? []);
	batch(() => {
		ed.doc.value = JSON.parse(snap.doc) as Doc;
		ed.curState.value = snap.state;
		ed.curClip.value = snap.clip;
		clampCursors();
		ed.sel.value = [];
		ed.colSel.value = -1;
		ed.hover.value = null;
	});
	mergeKey = null;
	touch();
	markDirty();
	scheduleFlush(); // an undo is a change the disk must see too
	if (JSON.stringify(ed.doc.value.palette_refs ?? []) !== refsBefore) void reloadShared();
	else if (JSON.stringify(ed.doc.value.textures ?? []) !== texBefore) void reloadPatterns();
}

export function undo() {
	const snap = undoStack.pop();
	if (snap === undefined) return;
	redoStack.push(snapshot());
	restore(snap);
}

export function redo() {
	const snap = redoStack.pop();
	if (snap === undefined) return;
	undoStack.push(snapshot());
	restore(snap);
}

function clampCursors() {
	const d = doc();
	ed.curPart.value = Math.min(ed.curPart.value, Math.max((d.parts?.length ?? 1) - 1, 0));
	ed.curTok.value = Math.min(ed.curTok.value, Math.max((d.palette?.length ?? 1) - 1, 0));
	if (ed.curState.value >= (d.states?.length ?? 0)) ed.curState.value = Math.max((d.states?.length ?? 1) - 1, 0);
	if (ed.curClip.value >= (d.clips?.length ?? 0)) ed.curClip.value = -1;
	const c = d.clips?.[ed.curClip.value];
	if (!c || ed.curKey.value >= c.keys.length) ed.curKey.value = c ? Math.min(ed.curKey.value, c.keys.length - 1) : -1;
}

// ------------------------------------------------------------- disk

function root(): string {
	return project.root.value ?? "";
}

// ------------------------------------------------------------- disk
// The file on disk is the live document: every edit lands there within
// FLUSH_MS, whole and atomically, so a game watching the folder sees each
// change. Save (⌘S) writes the checkpoint beside it, <name>.fart~, the
// last version you were happy with; "dirty" means the document differs
// from that checkpoint. Nothing reverts on its own: Revert to checkpoint
// is a command, and a file whose checkpoint differs opens dirty and says
// so. Writes to one file go out in order, never interleaved.

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

/** Put the document on disk if it moved since the last write, unless the file moved first. */
export async function flushNow() {
	flushTimer = undefined;
	const rel = ed.path.value;
	if (!rel) return;
	const snap = docText();
	if (snap === lastFlush) return;
	if (asking) return; // the conflict dialog decides
	// another tool may have written the file since we last synced: never write over that unseen
	if (!(await syncDisk(rel))) return;
	if (ed.path.value !== rel) return;
	lastFlush = docText();
	try {
		await writeDoc(rel, stringifyDoc(doc()));
		diskText = lastFlush;
		diskMtime = await shell.stat(root(), rel);
		ed.written.value = Date.now();
	} catch {
		lastFlush = ""; // try again on the next change
	}
}

/**
 * Look at the file on disk. Unchanged since we last synced: true, go on.
 * Changed with nothing of ours pending: take the disk's version (an undo
 * step) and say so; true. Changed while we hold edits: ask, and only a
 * "keep mine" lets the write go on. The watch calls this every second;
 * every write calls it first.
 */
async function syncDisk(rel: string): Promise<boolean> {
	const m = await shell.stat(root(), rel);
	if (m === null || m === diskMtime || ed.path.value !== rel) return true;
	const text = await shell.readFile(root(), rel);
	if (ed.path.value !== rel) return true;
	diskMtime = m;
	const norm = text === null ? null : normalizedText(text);
	if (norm === null || norm === diskText) return true; // touched, or unreadable: nothing to take
	const pending = docText() !== diskText;
	if (!pending) {
		adoptDisk(text!, norm);
		project.error.value = `${rel} changed on disk: reloaded (⌘Z brings back what was here)`;
		return true;
	}
	if (asking) return false;
	asking = true;
	let reload = true;
	try {
		reload = await confirm(`${rel} changed on disk while you were editing`, {
			body: "Reload takes the file's version; your edits stay one ⌘Z away. Cancel keeps yours and overwrites the file's changes.",
			ok: "Reload",
		});
	} finally {
		asking = false;
	}
	if (reload) {
		adoptDisk(text!, norm);
		return false;
	}
	diskText = ""; // ours goes over it, knowingly
	return true;
}

/** The disk's version becomes the document, as an undo step; no write follows. */
function adoptDisk(text: string, norm: string) {
	let d: Doc;
	try {
		const { doc: parsed } = parseDoc(text);
		d = parsed ?? (JSON.parse(text) as Doc);
	} catch {
		return;
	}
	ensureDefaults(d);
	delete d.resolved;
	pushUndo();
	mergeKey = null;
	batch(() => {
		ed.doc.value = d;
		clampCursors();
		ed.sel.value = [];
		ed.hover.value = null;
		ed.polyPts.value = [];
		ed.pending.value = "none";
		ed.rev.value++;
		ed.tokens.value = [...ed.shared.value, ...palette()];
		ed.canUndo.value = undoStack.length > 0;
		ed.canRedo.value = redoStack.length > 0;
	});
	diskText = norm;
	lastFlush = docText();
	markDirty();
	void reloadShared();
}

function startWatch(rel: string) {
	stopWatch();
	watchTimer = window.setInterval(() => {
		if (ed.path.value !== rel || asking || flushTimer !== undefined) return;
		void syncDisk(rel);
	}, WATCH_MS);
}

function stopWatch() {
	if (watchTimer !== undefined) clearInterval(watchTimer);
	watchTimer = undefined;
}

function markDirty() {
	ed.dirty.value = docText() !== checkpoint;
}

/**
 * Save (⌘S): a checkpoint. The file itself is already current; this
 * bakes the triangles, writes the file once more so disk and checkpoint
 * match byte for byte, and keeps the copy Revert goes back to.
 */
export async function save() {
	const rel = ed.path.value;
	if (!rel) return;
	if (flushTimer !== undefined) clearTimeout(flushTimer);
	flushTimer = undefined;
	bakeTris(doc());
	ed.rev.value++;
	lastFlush = "";
	await flushNow();
	checkpoint = docText();
	await writeDoc(`${rel}~`, stringifyDoc(doc()));
	batch(() => {
		ed.dirty.value = false;
		ed.checkpointAt.value = Date.now();
	});
}

/** Leaving a file: whatever is pending lands on disk; nothing reverts. */
export async function leaveFile() {
	const rel = ed.path.value;
	if (!rel) return;
	if (flushTimer !== undefined) clearTimeout(flushTimer);
	flushTimer = undefined;
	stopWatch();
	await flushNow();
	await writes.catch(() => {});
	batch(() => {
		ed.path.value = null;
		ed.dirty.value = false;
		ed.written.value = 0;
		ed.checkpointAt.value = 0;
	});
	diskText = "";
	diskMtime = null;
}

/** The text a file's content becomes as the open document (defaults filled), or null when it does not parse. */
function normalizedText(text: string): string | null {
	try {
		const { doc: parsed, report } = parseDoc(text);
		let d: Doc;
		if (parsed) d = parsed;
		else if (report.errors.some((e) => HARD.has(e.code))) return null;
		else d = JSON.parse(text) as Doc;
		ensureDefaults(d);
		delete d.resolved;
		return JSON.stringify(d);
	} catch {
		return null;
	}
}

/**
 * The checkpoint beside a file just opened. Absent: made now, a copy of
 * the file as read, so Revert always has somewhere to go. Present and
 * different: the file opens dirty and the toolbar says so; nothing is
 * replaced, the file on disk is the document.
 */
async function adoptCheckpoint(rel: string, fileText: string | null) {
	const ck = await shell.readFile(root(), `${rel}~`);
	const norm = ck === null ? null : normalizedText(ck);
	if (norm !== null) checkpoint = norm;
	else {
		checkpoint = docText();
		void writeDoc(`${rel}~`, fileText !== null && fileText.trim().length ? fileText : stringifyDoc(doc()));
	}
	batch(() => {
		ed.dirty.value = docText() !== checkpoint;
		ed.written.value = 0;
		ed.checkpointAt.value = 0;
	});
}

/** Back to the checkpoint, as an undo step; the disk follows. */
export async function revertToCheckpoint(): Promise<boolean> {
	const rel = ed.path.value;
	if (!rel) return false;
	const ck = await shell.readFile(root(), `${rel}~`);
	if (ck === null) {
		project.error.value = "there is no checkpoint beside this file yet (⌘S makes one)";
		return false;
	}
	let d: Doc;
	try {
		const { doc: parsed } = parseDoc(ck);
		d = parsed ?? (JSON.parse(ck) as Doc);
	} catch (e) {
		project.error.value = `the checkpoint does not parse: ${String(e)}`;
		return false;
	}
	applyExternalDoc(d);
	return true;
}

function ensureDefaults(d: Doc) {
	// a palette file stays one: no parts, no states, and an empty list is fine
	if (isPaletteFile(d)) return;
	if (!d.parts?.length) d.parts = [{ name: "body", pivot: [0, 0], shapes: [] }];
	if (!d.palette?.length) d.palette = [{ name: "ink", rgb: [200, 195, 185, 255] }];
	for (const p of d.parts) {
		if (!p.like) p.shapes ??= []; // a part drawn like another has no shapes of its own
		p.pivot ??= [0, 0];
	}
	d.states ??= [];
	// everything is a state: a file without one gets its drawing as one
	if (!d.states.length) d.states.push({ name: "default", parts: d.parts.map((p) => ({ part: p.name, offset: p.pivot ?? [0, 0] })) });
}

/** A file the format refuses outright: not JSON, wrong version, bad shape. */
const HARD = new Set(["json", "version", "schema", "path"]);

/**
 * Open a document (created if missing). Lenient past the hard errors: a
 * dangling token or part reference renders loud rather than refusing to
 * open, and the issues sit in the toolbar for you to fix.
 */
/** The tokens the file's palette_refs supply, read relative to the file. */
async function resolveShared(d: Doc, rel: string): Promise<{ shared: Token[]; unresolved: string[] }> {
	const dir = dirname(rel);
	const resolved = await resolvePalettes(d, (ref) => shell.readFile(root(), joinRel(dir, ref)));
	return { shared: resolved.tokens.slice(0, resolved.tokens.length - (d.palette?.length ?? 0)), unresolved: resolved.unresolved };
}

/** The textures changed (or a map's file did): read and render them again. */
export async function reloadPatterns() {
	const rel = ed.path.value;
	if (!rel) return;
	const p = await loadPatterns(ed.doc.value, rel);
	if (ed.path.value !== rel) return;
	ed.patterns.value = p;
	ed.rev.value++;
}

/** The refs changed (linked, unlinked, undone): read them again and look the file over. */
export async function reloadShared() {
	const rel = ed.path.value;
	if (!rel) return;
	const d = ed.doc.value;
	const { shared, unresolved } = await resolveShared(d, rel);
	if (ed.path.value !== rel) return;
	await reloadPatterns();
	const r = validate(d, { refTokens: unresolved.length ? null : shared.map((t) => t.name), unresolvedRefs: unresolvedOf(ed.patterns.value) });
	batch(() => {
		ed.shared.value = shared;
		ed.unresolved.value = unresolved;
		ed.tokens.value = [...shared, ...(d.palette ?? [])];
		ed.issues.value = [...r.errors, ...r.warnings];
		ed.rev.value++;
	});
}

/**
 * A whole document arriving from outside (Claude, through the chat): one
 * undo step, the canvas updates, the shared palettes are read again.
 * Returns a line on what changed, by name.
 */
export function applyExternalDoc(next: Doc): string {
	const before = ed.doc.value;
	const d = JSON.parse(JSON.stringify(next)) as Doc;
	delete d.resolved;
	ensureDefaults(d);
	pushUndo();
	mergeKey = null;
	batch(() => {
		ed.doc.value = d;
		clampCursors();
		ed.sel.value = [];
		ed.hover.value = null;
		ed.polyPts.value = [];
		ed.pending.value = "none";
	});
	touch();
	void reloadShared();
	return describeChange(before, d);
}

function describeChange(a: Doc, b: Doc): string {
	const bits: string[] = [];
	const diff = (what: string, xs: { name: string }[] | undefined, ys: { name: string }[] | undefined) => {
		const A = new Map((xs ?? []).map((x) => [x.name, JSON.stringify(x)]));
		const B = new Map((ys ?? []).map((y) => [y.name, JSON.stringify(y)]));
		const added = [...B.keys()].filter((k) => !A.has(k));
		const gone = [...A.keys()].filter((k) => !B.has(k));
		const changed = [...B.keys()].filter((k) => A.has(k) && A.get(k) !== B.get(k));
		const parts: string[] = [];
		if (added.length) parts.push(`+${added.join(", ")}`);
		if (gone.length) parts.push(`−${gone.join(", ")}`);
		if (changed.length) parts.push(`~${changed.join(", ")}`);
		if (parts.length) bits.push(`${what}: ${parts.join(" ")}`);
	};
	diff("parts", a.parts, b.parts);
	diff("states", a.states, b.states);
	diff("clips", a.clips, b.clips);
	diff("chains", a.constraints, b.constraints);
	diff("colours", a.palette, b.palette);
	if (JSON.stringify(a.collision ?? []) !== JSON.stringify(b.collision ?? [])) bits.push("collision");
	if (JSON.stringify(a.palette_refs ?? []) !== JSON.stringify(b.palette_refs ?? [])) bits.push("shared palettes");
	return bits.length ? bits.join(" · ") : "nothing changed";
}

/** Draw from a palette file: a ref relative to this file, then a fresh look at the shared tokens. */
export function linkPalette(target: string) {
	const rel = ed.path.value;
	if (!rel || target === rel) return;
	const ref = relativeTo(dirname(rel), target);
	if (doc().palette_refs?.includes(ref)) return;
	mutate((d) => (d.palette_refs ??= []).push(ref));
	void reloadShared();
}

export function unlinkPalette(i: number) {
	mutate((d) => {
		d.palette_refs?.splice(i, 1);
		if (d.palette_refs && !d.palette_refs.length) delete d.palette_refs;
	});
	void reloadShared();
}

/** Copy a shared slot into this file, where it can be changed; the file's own colours win. */
export function overrideToken(name: string) {
	const have = palette().findIndex((t) => t.name === name);
	if (have >= 0) {
		ed.curTok.value = have;
		return;
	}
	const src = [...ed.shared.value].reverse().find((t) => t.name === name);
	if (!src) return;
	mutate((d) => (d.palette ??= []).push({ name, rgb: [...src.rgb] as Rgba }));
	ed.curTok.value = palette().length - 1;
}

export async function openFile(rel: string): Promise<boolean> {
	if (ed.path.value) await leaveFile();
	const text = await shell.readFile(root(), rel);
	let d: Doc = { version: 1, name: rel.replace(/^.*\//, "").replace(/\.fart$/, "") };
	let issues: Issue[] = [];
	if (text !== null && text.trim().length) {
		const { doc: parsed, report } = parseDoc(text);
		if (parsed) d = parsed;
		else if (report.errors.some((e) => HARD.has(e.code))) {
			project.error.value = `${rel}: ${report.errors[0].code} — ${report.errors[0].message}`;
			return false;
		} else d = JSON.parse(text) as Doc;
		issues = [...report.errors, ...report.warnings];
	}
	if (is3d(d)) {
		// 1.3: a 3D model. The studio draws its front view on the shelf; editing it is next.
		project.error.value = `${rel} is a 3D file: Uranus cannot edit it yet. fart project makes its 2D views (see Docs).`;
		return false;
	}
	const isPalette = isPaletteFile(d);
	ensureDefaults(d);
	delete d.resolved; // an old writer's cache, not a field
	const { shared, unresolved } = await resolveShared(d, rel);
	if (issues.length && d.palette_refs?.length) {
		// a second look, now that the shared tokens are known
		const r = validate(d, { refTokens: unresolved.length ? null : shared.map((t) => t.name) });
		issues = [...r.errors, ...r.warnings];
	}

	undoStack = [];
	redoStack = [];
	mergeKey = null;
	clearLocal();
	batch(() => {
		ed.doc.value = d;
		ed.path.value = rel;
		ed.isPalette.value = isPalette;
		ed.shared.value = shared;
		ed.unresolved.value = unresolved;
		ed.tokens.value = [...shared, ...(d.palette ?? [])];
		ed.issues.value = issues;
		ed.curPart.value = 0;
		ed.curTok.value = 0;
		ed.curState.value = 0;
		ed.curClip.value = -1;
		ed.curKey.value = -1;
		ed.clipTime.value = 0;
		ed.playing.value = false;
		ed.sel.value = [];
		ed.hover.value = null;
		ed.collide.value = false;
		ed.colSel.value = -1;
		ed.pending.value = "none";
		ed.polyPts.value = [];
		ed.dirty.value = false;
		ed.canUndo.value = false;
		ed.canRedo.value = false;
		ed.rev.value++;
	});
	lastFlush = docText();
	diskText = lastFlush;
	diskMtime = await shell.stat(root(), rel);
	await adoptCheckpoint(rel, text);
	startWatch(rel);
	void reloadPatterns();
	return true;
}

// ------------------------------------------------------------- selection

export function selHas(r: Ref): boolean {
	return ed.sel.value.some((e) => e.p === r.p && e.s === r.s);
}
export function selOnly(r: Ref) {
	ed.sel.value = [r];
}
export function selClear() {
	ed.sel.value = [];
}
export function selToggle(r: Ref) {
	if (selHas(r)) ed.sel.value = ed.sel.value.filter((e) => !(e.p === r.p && e.s === r.s));
	else ed.sel.value = [...ed.sel.value, r];
}
export function selAdd(refs: Ref[]) {
	const cur = ed.sel.value;
	ed.sel.value = [...cur, ...refs.filter((r) => !cur.some((e) => e.p === r.p && e.s === r.s))];
}
export function selMakePrimary(r: Ref) {
	ed.sel.value = [...ed.sel.value.filter((e) => !(e.p === r.p && e.s === r.s)), r];
}
/** Live shapes for the selection (stale refs dropped). */
export function selShapes(): Shape[] {
	return ed.sel.value.map(shapeAt).filter((s): s is Shape => !!s);
}

/** Can a drag land in a morph: deform on, a state on the canvas, a poly or path of a part with points of its own. */
export function deforming(r: Ref | null = primary()): boolean {
	const p = r ? parts()[r.p] : undefined;
	const sh = r ? shapeAt(r) : undefined;
	return ed.deform.value && ed.curClip.value < 0 && !ed.collide.value && !!p && !p.like && !!sh && (sh.kind === "poly" || sh.kind === "path");
}

/**
 * The current state's morph entry for a shape, as a shape-like view whose
 * `points` (and a path's `in`/`out`) are the morph's own arrays, made from
 * the base when there is none. Handle drags on this view edit the morph.
 */
export function morphView(d: Doc, r: Ref): Shape | null {
	const part = d.parts?.[r.p];
	const st = d.states?.[ed.curState.value];
	const sh = part?.shapes?.[r.s];
	if (!part || !st || !sh || part.like || (sh.kind !== "poly" && sh.kind !== "path")) return null;
	let sp = st.parts.find((e) => e.part === part.name);
	if (!sp) {
		sp = { part: part.name, offset: [...pivotOf(part)] as Vec2 };
		st.parts.push(sp);
	}
	sp.morph ??= [];
	let m = sp.morph.find((x) => x.shape === r.s);
	if (!m || m.points.length !== sh.points.length) {
		m = { shape: r.s, points: sh.points.map((p) => [p[0], p[1]] as Vec2) };
		sp.morph = [...sp.morph.filter((x) => x.shape !== r.s), m];
	}
	if (sh.kind === "path") {
		if (!m.in || m.in.length !== sh.points.length) m.in = (sh.in ?? sh.points.map(() => [0, 0] as Vec2)).map((v) => [v[0], v[1]] as Vec2);
		if (!m.out || m.out.length !== sh.points.length) m.out = (sh.out ?? sh.points.map(() => [0, 0] as Vec2)).map((v) => [v[0], v[1]] as Vec2);
		return { kind: "path", closed: sh.closed, points: m.points, in: m.in, out: m.out, w: sh.w };
	}
	return { kind: "poly", points: m.points };
}

/** The selected shape as the current state has it (its morph applied), for handles and picking. */
export function selShapePosed(): Shape | undefined {
	const r = primary();
	const p = r ? parts()[r.p] : undefined;
	if (!r || !p) return undefined;
	return shapesOfPosed(doc(), p, frame()?.find((sp) => sp.part === p.name))[r.s];
}

/** How many shapes the current state reshapes on a part. */
export function morphCount(partIndex: number): number {
	const part = parts()[partIndex];
	const sp = part && curState()?.parts.find((e) => e.part === part.name);
	return sp?.morph?.length ?? 0;
}
/** Forget the current state's morphs on a part. */
export function resetMorph(partIndex: number) {
	mutate((d) => {
		const part = d.parts?.[partIndex];
		const sp = part && d.states?.[ed.curState.value]?.parts.find((e) => e.part === part.name);
		if (sp) delete sp.morph;
	});
}
/** 1.7: a path's own fields. */
export function setPathField(r: Ref, key: "closed" | "w", v: boolean | number) {
	mutate((d) => {
		const sh = d.parts?.[r.p]?.shapes?.[r.s];
		if (!sh || sh.kind !== "path") return;
		if (key === "closed") {
			if (v) sh.closed = true;
			else {
				delete sh.closed;
				sh.w ??= 1;
			}
		} else sh.w = v as number;
		delete sh.bake;
	}, `path-${key}`);
}

// ------------------------------------------------------------- shape ops

export function moveShape(sh: Shape, d: Vec2) {
	switch (sh.kind) {
		case "circle":
			sh.at = [sh.at[0] + d[0], sh.at[1] + d[1]];
			break;
		case "line":
			sh.a = [sh.a[0] + d[0], sh.a[1] + d[1]];
			sh.b = [sh.b[0] + d[0], sh.b[1] + d[1]];
			break;
		case "poly":
			sh.points = sh.points.map((q) => [q[0] + d[0], q[1] + d[1]] as Vec2);
			break;
	}
}

export function scaleShape(sh: Shape, f: number, anchor: Vec2) {
	const sc = (q: Vec2): Vec2 => [anchor[0] + (q[0] - anchor[0]) * f, anchor[1] + (q[1] - anchor[1]) * f];
	switch (sh.kind) {
		case "circle":
			sh.at = sc(sh.at);
			sh.r *= f;
			break;
		case "line":
			sh.a = sc(sh.a);
			sh.b = sc(sh.b);
			sh.w *= f;
			break;
		case "poly":
			sh.points = sh.points.map(sc);
			break;
	}
}

export function cloneShape(sh: Shape): Shape {
	return JSON.parse(JSON.stringify(sh)) as Shape;
}

export function deleteSel() {
	if (ed.collide.value) {
		const i = ed.colSel.value;
		if (i < 0) return;
		mutate((d) => d.collision?.splice(i, 1));
		ed.colSel.value = -1;
		return;
	}
	const sel = ed.sel.value;
	if (!sel.length) return;
	mutate((d) => {
		// highest indices first so the rest stay valid
		const order = [...sel].sort((a, b) => (a.p - b.p) || (b.s - a.s));
		for (const r of order) {
			const p = d.parts?.[r.p];
			if (p) shapesOf(d, p).splice(r.s, 1);
		}
	});
	ed.sel.value = [];
	ed.hover.value = null;
}

/** Paint the current token onto the selection. */
export function paintSel(token: string) {
	const shapes = selShapes();
	if (!shapes.length) return;
	mutate(() => {
		for (const sh of shapes) sh.color = token;
	});
}

/** Move the selection into the current part (order kept, appended on top). */
export function selToPart() {
	const target = ed.curPart.value;
	const sel = ed.sel.value.filter((r) => r.p !== target);
	if (!sel.length) return;
	const moved: Ref[] = [];
	mutate((d) => {
		const ps = d.parts!;
		const taken: Shape[] = [];
		const order = [...sel].sort((a, b) => (a.p - b.p) || (a.s - b.s));
		for (const r of order) taken.push(shapesOf(d, ps[r.p])[r.s]);
		for (const r of [...order].sort((a, b) => (a.p - b.p) || (b.s - a.s))) shapesOf(d, ps[r.p]).splice(r.s, 1);
		const dst = shapesOf(d, ps[target]);
		for (const sh of taken) {
			dst.push(sh);
			moved.push({ p: target, s: dst.length - 1 });
		}
	});
	ed.sel.value = [...ed.sel.value.filter((r) => r.p === target), ...moved];
}

/** Raise or lower the selection one step through each part's stack, keeping its internal order. */
export function selOrder(up: boolean) {
	const sel = ed.sel.value;
	if (!sel.length) return;
	const next: Ref[] = [];
	mutate((d) => {
		const byPart = new Map<number, number[]>();
		for (const r of sel) byPart.set(r.p, [...(byPart.get(r.p) ?? []), r.s]);
		for (const [p, idxs] of byPart) {
			const part = d.parts?.[p];
			if (!part) continue;
			const shapes = shapesOf(d, part);
			const set = new Set(idxs);
			const n = shapes.length;
			// walk from the leading edge; a member swaps with a non-member neighbour
			if (up) {
				for (let i = n - 2; i >= 0; i--) {
					if (set.has(i) && !set.has(i + 1)) {
						[shapes[i], shapes[i + 1]] = [shapes[i + 1], shapes[i]];
						set.delete(i);
						set.add(i + 1);
					}
				}
			} else {
				for (let i = 1; i < n; i++) {
					if (set.has(i) && !set.has(i - 1)) {
						[shapes[i], shapes[i - 1]] = [shapes[i - 1], shapes[i]];
						set.delete(i);
						set.add(i - 1);
					}
				}
			}
			for (const s of set) next.push({ p, s });
		}
	});
	ed.sel.value = next;
}

// ------------------------------------------------------------- clipboard

interface Clipped {
	part: string;
	sh: Shape;
}
let clipboard: Clipped[] = [];
let pasteN = 0;

export function copySel() {
	const ps = parts();
	clipboard = ed.sel.value
		.filter((r) => ps[r.p] && shapesIn(ps[r.p])[r.s])
		.map((r) => ({ part: ps[r.p].name, sh: cloneShape(shapesIn(ps[r.p])[r.s]) }));
	pasteN = 0;
}

export function pasteClip() {
	if (!clipboard.length) return;
	pasteN++;
	const nudge = 0.8 * pasteN;
	const landed: Ref[] = [];
	mutate((d) => {
		const ps = d.parts!;
		for (const c of clipboard) {
			let pi = ps.findIndex((p) => p.name === c.part);
			if (pi < 0) pi = ed.curPart.value;
			const sh = cloneShape(c.sh);
			moveShape(sh, [nudge, nudge]);
			const dst = shapesOf(d, ps[pi]);
			dst.push(sh);
			landed.push({ p: pi, s: dst.length - 1 });
		}
	});
	ed.sel.value = landed;
}

export function cutSel() {
	copySel();
	deleteSel();
}

export function dupSel() {
	const ps = parts();
	const src = ed.sel.value.filter((r) => ps[r.p] && shapesIn(ps[r.p])[r.s]);
	if (!src.length) return;
	const landed: Ref[] = [];
	mutate((d) => {
		for (const r of src) {
			const shapes = shapesOf(d, d.parts![r.p]);
			const sh = cloneShape(shapes[r.s]);
			moveShape(sh, [0.8, 0.8]);
			shapes.push(sh);
			landed.push({ p: r.p, s: shapes.length - 1 });
		}
	});
	ed.sel.value = landed;
}

// ------------------------------------------------------------- parts

/** A new part joins every state, at rest; leaving one out is a choice made after. */
export function addPart(name: string): number {
	mutate((d) => {
		d.parts!.push({ name, pivot: [0, 0], shapes: [] });
		for (const st of d.states ?? []) st.parts.push({ part: name, offset: [0, 0] });
	});
	ed.curPart.value = parts().length - 1;
	return ed.curPart.value;
}

/** Move the current part one step through the current state's paint order. */
export function movePartInState(name: string, up: boolean) {
	const st = curState();
	if (!st) return;
	const i = st.parts.findIndex((sp) => sp.part === name);
	const j = i + (up ? 1 : -1);
	if (i < 0 || j < 0 || j >= st.parts.length) return;
	mutate(() => {
		[st.parts[i], st.parts[j]] = [st.parts[j], st.parts[i]];
	});
}

/** Duplicate the selection exactly in place (an Alt-drag begins with this). */
export function dupSelInPlace() {
	const ps = parts();
	const src = ed.sel.value.filter((r) => ps[r.p] && shapesIn(ps[r.p])[r.s]);
	if (!src.length) return;
	const landed: Ref[] = [];
	mutate((d) => {
		for (const r of src) {
			const shapes = shapesOf(d, d.parts![r.p]);
			shapes.push(cloneShape(shapes[r.s]));
			landed.push({ p: r.p, s: shapes.length - 1 });
		}
	});
	ed.sel.value = landed;
}

/** Set one numeric property of a shape, from a field. */
export function setShapeNumber(sh: Shape, key: string, sub: 0 | 1 | null, value: number) {
	if (!Number.isFinite(value)) return;
	mutate(() => {
		const o = sh as unknown as Record<string, unknown>;
		if (sub === null) o[key] = value;
		else {
			const v = (o[key] as Vec2) ?? [0, 0];
			const nv: Vec2 = [v[0], v[1]];
			nv[sub] = value;
			o[key] = nv;
		}
	}, `field-${key}-${sub}`);
}

export function setPivotNumber(k: number, sub: 0 | 1, value: number) {
	if (!Number.isFinite(value)) return;
	mutate((d) => {
		const p = d.parts![k];
		const pv: Vec2 = [...(p.pivot ?? [0, 0])];
		pv[sub] = value;
		p.pivot = pv;
	}, `pivot-${sub}`);
}

export function setAnchorNumber(k: number, i: number, sub: 0 | 1, value: number) {
	if (!Number.isFinite(value)) return;
	mutate((d) => {
		const a = anchorsOf(d, d.parts![k])[i];
		const at: Vec2 = [...a.at];
		at[sub] = value;
		a.at = at;
	}, `anchor-${i}-${sub}`);
}

/** The direction an attached thing points (1.2); undefined drops it. */
export function setAnchorAngle(k: number, i: number, angle: number | undefined, merge?: string) {
	mutate((d) => {
		const a = anchorsOf(d, d.parts![k])[i];
		if (!a) return;
		if (angle === undefined) delete a.angle;
		else a.angle = angle;
	}, merge);
}

export function renameAnchor(k: number, i: number, name: string) {
	const p = parts()[k];
	const old = p ? anchorsIn(p)[i]?.name : undefined;
	if (!p || old === undefined || old === name) return;
	const owner = sourceOf(doc(), p).name;
	mutate((d) => {
		anchorsOf(d, d.parts![k])[i].name = name;
		// every part drawn like the owner shares the anchor
		for (const q of d.parts!) {
			if (q.name !== owner && q.like !== owner) continue;
			for (const c of d.constraints ?? []) if (c.end === `${q.name}/${old}`) c.end = `${q.name}/${name}`;
		}
	});
}

export function setDocName(name: string) {
	mutate((d) => {
		if (name) d.name = name;
		else delete d.name;
	}, "docname");
}

export function deletePart(k: number) {
	const name = parts()[k]?.name;
	if (name === undefined) return;
	mutate((d) => {
		// parts drawn like this one keep a copy of its geometry
		const gone = d.parts![k];
		for (const p of d.parts!) {
			if (p.like !== name) continue;
			delete p.like;
			p.shapes = (gone.shapes ?? []).map(cloneShape);
			if (gone.anchors?.length) p.anchors = gone.anchors.map((a) => ({ ...a, at: [a.at[0], a.at[1]] as Vec2 }));
		}
		d.parts!.splice(k, 1);
		for (const st of d.states ?? []) st.parts = st.parts.filter((sp) => sp.part !== name);
		// children lose their parent; chains through it go with it
		for (const p of d.parts!) if (p.parent === name) delete p.parent;
		for (const c of d.clips ?? []) for (const k of c.keys) if (k.parts) k.parts = k.parts.filter((sp) => sp.part !== name);
		if (d.constraints) d.constraints = d.constraints.filter((c) => !c.chain.includes(name));
	});
	batch(() => {
		ed.sel.value = [];
		ed.hover.value = null;
		clampCursors();
	});
}

export function renamePart(k: number, name: string) {
	const old = parts()[k]?.name;
	if (old === undefined || old === name) return;
	mutate((d) => {
		d.parts![k].name = name;
		for (const st of d.states ?? []) for (const sp of st.parts) if (sp.part === old) sp.part = name;
		for (const p of d.parts!) {
			if (p.parent === old) p.parent = name;
			if (p.like === old) p.like = name;
		}
		for (const c of d.clips ?? []) for (const key of c.keys) for (const sp of key.parts ?? []) if (sp.part === old) sp.part = name;
		for (const c of d.constraints ?? []) {
			c.chain = c.chain.map((n) => (n === old ? name : n));
			if (c.end.startsWith(`${old}/`)) c.end = `${name}/${c.end.slice(old.length + 1)}`;
		}
	});
}

/** Names a part may be parented to: everything but itself and its descendants. */
export function parentCandidates(k: number): string[] {
	const ps = parts();
	const me = ps[k]?.name;
	if (me === undefined) return [];
	const isDescendant = (name: string): boolean => {
		const seen = new Set<string>();
		let cur: string | undefined = name;
		while (cur !== undefined && !seen.has(cur)) {
			if (cur === me) return true;
			seen.add(cur);
			cur = ps.find((p) => p.name === cur)?.parent;
		}
		return false;
	};
	return ps.filter((p) => p.name !== me && !isDescendant(p.name)).map((p) => p.name);
}

/** Parts this one may draw like: others with geometry of their own that are not drawn like it. */
export function likeCandidates(k: number): string[] {
	const ps = parts();
	const me = ps[k]?.name;
	if (me === undefined) return [];
	return ps.filter((p) => p.name !== me && !p.like).map((p) => p.name);
}

/** Draw this part like another (1.2), or give it its own copy of the geometry again. */
export function setLike(k: number, like: string | undefined) {
	const p = parts()[k];
	if (!p) return;
	if (like !== undefined && !likeCandidates(k).includes(like)) return;
	if (like !== undefined && (p.shapes?.length || p.anchors?.length)) return; // the UI gates this: shapes would be lost
	const src = like === undefined ? sourceOf(doc(), p) : undefined;
	mutate((d) => {
		const q = d.parts![k];
		if (like === undefined) {
			delete q.like;
			q.shapes = (src?.shapes ?? []).map(cloneShape);
			if (src?.anchors?.length) q.anchors = src.anchors.map((a) => ({ ...a, at: [a.at[0], a.at[1]] as Vec2 }));
		} else {
			q.like = like;
			delete q.shapes;
			delete q.anchors;
			// every part drawn like another has no shapes of its own, so nothing may be like this one
			for (const o of d.parts!) if (o.like === q.name) delete o.like;
		}
	});
	batch(() => {
		ed.sel.value = [];
		ed.hover.value = null;
	});
}

export function setParent(k: number, parent: string | undefined) {
	if (parent !== undefined && !parentCandidates(k).includes(parent)) return;
	mutate((d) => {
		if (parent === undefined) delete d.parts![k].parent;
		else d.parts![k].parent = parent;
	});
}

export function swapParts(a: number, b: number) {
	const ps = parts();
	if (a < 0 || b < 0 || a >= ps.length || b >= ps.length) return;
	mutate((d) => {
		const arr = d.parts!;
		[arr[a], arr[b]] = [arr[b], arr[a]];
	});
	const remap = (r: Ref): Ref => ({ p: r.p === a ? b : r.p === b ? a : r.p, s: r.s });
	batch(() => {
		ed.sel.value = ed.sel.value.map(remap);
		if (ed.curPart.value === a) ed.curPart.value = b;
		else if (ed.curPart.value === b) ed.curPart.value = a;
	});
}

export function setPivot(k: number, at: Vec2) {
	mutate((d) => {
		d.parts![k].pivot = at;
	});
}

export function addAnchor(k: number, name: string, at: Vec2) {
	mutate((d) => {
		const p = sourceOf(d, d.parts![k]);
		(p.anchors ??= []).push({ name, at });
	});
}

export function deleteAnchor(k: number, i: number) {
	mutate((d) => sourceOf(d, d.parts![k]).anchors?.splice(i, 1));
}

/** Whether a part is drawn by a state; toggling adds it (at rest) or drops it. */
export function toggleMembership(stateIdx: number, partName: string) {
	mutate((d) => {
		const st = d.states![stateIdx];
		const i = st.parts.findIndex((sp) => sp.part === partName);
		if (i >= 0) st.parts.splice(i, 1);
		else {
			const part = d.parts!.find((p) => p.name === partName);
			st.parts.push({ part: partName, offset: part?.pivot ?? [0, 0] });
		}
	});
}

// ------------------------------------------------------------- states

/** A new state starts as a copy of another (the current one, unless told). */
export function addState(name: string, from?: number): number {
	const src = states()[from ?? ed.curState.value] ?? states()[0];
	mutate((d) => {
		const st: State = {
			name,
			parts: src
				? src.parts.map((sp) => ({ ...sp, offset: sp.offset ? ([sp.offset[0], sp.offset[1]] as Vec2) : undefined }))
				: d.parts!.map((p) => ({ part: p.name, offset: p.pivot ?? [0, 0] })),
		};
		for (const sp of st.parts) if (sp.offset === undefined) delete sp.offset;
		(d.states ??= []).push(st);
	});
	selectState(states().length - 1);
	return ed.curState.value;
}

/** The last state cannot go: the file always has one. Returns false then. */
export function deleteState(k: number): boolean {
	if (states().length <= 1) return false;
	const name = states()[k]?.name;
	mutate((d) => {
		d.states!.splice(k, 1);
		// keys that named it go too; a clip left with nothing goes with them
		if (d.clips) {
			for (const c of d.clips) c.keys = c.keys.filter((key) => key.state !== name);
			d.clips = d.clips.filter((c) => c.keys.length > 0);
		}
	});
	clampCursors();
	return true;
}

export function renameState(k: number, name: string) {
	const old = states()[k]?.name;
	mutate((d) => {
		d.states![k].name = name;
		for (const c of d.clips ?? []) for (const key of c.keys) if (key.state === old) key.state = name;
	});
}

// ------------------------------------------------------------- clips

export function selectClip(k: number) {
	batch(() => {
		ed.curClip.value = k;
		ed.curKey.value = k >= 0 ? 0 : -1;
		ed.clipTime.value = 0;
		ed.playing.value = false;
		ed.sel.value = [];
		ed.hover.value = null;
	});
}

export function selectState(k: number) {
	batch(() => {
		selectClip(-1);
		ed.curState.value = k;
		ed.sel.value = [];
		ed.hover.value = null;
	});
}

export function addClip(name: string): boolean {
	const st = curState() ?? states()[0];
	if (!st) return false;
	mutate((d) => (d.clips ??= []).push({ name, keys: [{ t: 0, state: st.name }] }));
	selectClip(clips().length - 1);
	return true;
}

export function deleteClip(k: number) {
	mutate((d) => d.clips!.splice(k, 1));
	if (ed.curClip.value === k) selectClip(-1);
	else clampCursors();
}

export function renameClip(k: number, name: string) {
	mutate((d) => {
		d.clips![k].name = name;
	});
}

export function setClipLoop(k: number, loop: boolean) {
	mutate((d) => {
		if (loop) d.clips![k].loop = true;
		else delete d.clips![k].loop;
	});
}

function sortKeys(c: Clip, follow?: Clip["keys"][number]): number {
	c.keys.sort((a, b) => a.t - b.t);
	return follow ? c.keys.indexOf(follow) : -1;
}

/** A key at the playhead, wearing the state of the key before it. */
export function addKey() {
	const c = curClip();
	if (!c) return;
	const t = Math.round(ed.clipTime.value * 100) / 100;
	const before = [...c.keys].reverse().find((k) => k.t <= t);
	const state = before?.state ?? states()[0]?.name;
	if (state === undefined) return;
	const key = { t, state };
	let idx = -1;
	mutate(() => {
		c.keys.push(key);
		idx = sortKeys(c, key);
	});
	ed.curKey.value = idx;
}

export function deleteKey(i: number) {
	const c = curClip();
	if (!c || c.keys.length <= 1) return;
	mutate(() => c.keys.splice(i, 1));
	ed.curKey.value = Math.min(i, c.keys.length - 1);
}

export function setKeyTime(i: number, t: number, merge?: string) {
	const c = curClip();
	if (!c) return;
	const key = c.keys[i];
	if (!key) return;
	let idx = i;
	mutate(() => {
		key.t = Math.max(0, t);
		idx = sortKeys(c, key);
	}, merge);
	ed.curKey.value = idx;
}

export function setKeyState(i: number, state: string) {
	const c = curClip();
	if (!c?.keys[i]) return;
	mutate(() => {
		const key = c.keys[i];
		key.state = state;
		delete key.parts;
	});
}

export function setKeyEase(i: number, e: Ease | undefined) {
	const c = curClip();
	if (!c?.keys[i]) return;
	mutate(() => {
		if (e && e !== "linear") c.keys[i].ease = e;
		else delete c.keys[i].ease;
	});
}

/** A bezier toward this key (1.2), which wins over its ease; undefined drops it. */
export function setKeyCurve(i: number, curve: Curve | undefined, merge?: string) {
	const c = curClip();
	if (!c?.keys[i]) return;
	mutate(() => {
		if (curve) c.keys[i].curve = [Math.min(1, Math.max(0, curve[0])), curve[1], Math.min(1, Math.max(0, curve[2])), curve[3]];
		else delete c.keys[i].curve;
	}, merge);
}

/** The names a runtime hears crossing this key (1.2). */
export function setKeyEvents(i: number, events: string[]) {
	const c = curClip();
	if (!c?.keys[i]) return;
	const clean = events.map((e) => e.trim()).filter(Boolean);
	mutate(() => {
		if (clean.length) c.keys[i].events = clean;
		else delete c.keys[i].events;
	});
}

/** A new state holding a key's pose; the key then names it. */
export function keyToState(i: number, name: string) {
	const c = curClip();
	const key = c?.keys[i];
	if (!key || states().some((s) => s.name === name)) return;
	mutate((d) => {
		const st: State = { name, parts: structuredClone(keyPoses(d, key)) };
		const tg = keyTargets(d, key);
		if (tg.length) st.targets = structuredClone(tg);
		(d.states ??= []).push(st);
		key.state = name;
		delete key.parts;
		delete key.targets;
	});
}

/** Seek the preview; the key under the playhead becomes current. */
export function seek(t: number) {
	const c = curClip();
	if (!c) return;
	ed.clipTime.value = Math.max(0, t);
	const at = c.keys.findIndex((k) => Math.abs(k.t - t) < 1e-6);
	if (at >= 0) ed.curKey.value = at;
}

// ------------------------------------------------------------- chains (IK)

export function addChain(name: string, chain: string[], end: string) {
	mutate((d) => (d.constraints ??= []).push({ name, chain, end }));
}

export function deleteChain(k: number) {
	const name = constraints()[k]?.name;
	mutate((d) => {
		d.constraints!.splice(k, 1);
		for (const st of d.states ?? []) if (st.targets) st.targets = st.targets.filter((t) => t.chain !== name);
		for (const c of d.clips ?? []) for (const key of c.keys) if (key.targets) key.targets = key.targets.filter((t) => t.chain !== name);
	});
}

export function renameChain(k: number, name: string) {
	const old = constraints()[k]?.name;
	mutate((d) => {
		d.constraints![k].name = name;
		for (const st of d.states ?? []) for (const t of st.targets ?? []) if (t.chain === old) t.chain = name;
		for (const c of d.clips ?? []) for (const key of c.keys) for (const t of key.targets ?? []) if (t.chain === old) t.chain = name;
	});
}

/** The pinned point for a chain (1.2) in the pose being posed, if any. */
export function targetOf(chain: string): Target | undefined {
	return pose()?.targets?.find((t) => t.chain === chain);
}

/** Let a chain go: its rotations stay where they are, the pin is gone. */
export function clearTarget(chain: string) {
	if (!targetOf(chain)) return;
	mutate((d) => {
		const pz = editPose(d);
		if (!pz?.targets) return;
		pz.targets = pz.targets.filter((t) => t.chain !== chain);
		if (!pz.targets.length) delete pz.targets;
	});
}

/** After a pose changed: every pinned chain in it reaches again. Call inside a mutate. */
export function settleTargets(d: Doc = doc(), pz: Pose | undefined = editPose(d)) {
	if (!pz?.targets?.length) return;
	solveTargets(d, pz.parts, pz.targets);
}

export function setChain(k: number, chain: string[], end: string) {
	mutate((d) => {
		d.constraints![k].chain = chain;
		d.constraints![k].end = end;
	});
}

export function setChainBend(k: number, bend: 1 | -1 | undefined) {
	mutate((d) => {
		if (bend) d.constraints![k].bend = bend;
		else delete d.constraints![k].bend;
	});
}

/**
 * Pull a chain's end to a point in the current state: only rotations
 * move, and the point is pinned (1.2) so the chain keeps reaching it
 * while the rest of the pose changes. clearTarget lets go.
 */
export function ikTo(c: Constraint, target: Vec2) {
	if (!pose()) return;
	mutate((d) => {
		const pz = editPose(d);
		if (!pz) return;
		solveChain(d, pz.parts, c, target);
		const at: Vec2 = [Math.round(target[0] * 100) / 100, Math.round(target[1] * 100) / 100];
		const tg = (pz.targets ??= []).find((t) => t.chain === c.name);
		if (tg) tg.at = at;
		else pz.targets.push({ chain: c.name, at });
	}, "ik");
}

/**
 * Change a part's entry in the pose being posed (see editPose): the
 * current state's, or the clip key's under the playhead. `sp` names the
 * part; the entry changed is the pose's own, found by that name.
 */
export function setPose(sp: StatePart, patch: Partial<StatePart>, merge?: string) {
	mutate((d) => {
		const pz = editPose(d);
		const e = pz?.parts.find((x) => x.part === sp.part);
		if (!e) return;
		Object.assign(e, patch);
		if (e.mirror === false) delete e.mirror;
		settleTargets(d, pz);
	}, merge);
}

export function resetPose(sp: StatePart) {
	const part = parts().find((p) => p.name === sp.part);
	mutate((d) => {
		const pz = editPose(d);
		const e = pz?.parts.find((x) => x.part === sp.part);
		if (!e) return;
		e.offset = part?.pivot ?? [0, 0];
		delete e.rotate;
		delete e.scale;
		delete e.mirror;
		settleTargets(d, pz);
	});
}

// ------------------------------------------------------------- tokens

export function addToken(name: string) {
	mutate((d) => (d.palette ??= []).push({ name, rgb: [180, 180, 180, 255] }));
	ed.curTok.value = palette().length - 1;
}

export function deleteToken(k: number) {
	mutate((d) => d.palette!.splice(k, 1));
	clampCursors();
}

export function renameToken(k: number, name: string) {
	const old = palette()[k]?.name;
	if (old === undefined || old === name) return;
	mutate((d) => {
		d.palette![k].name = name;
		for (const p of d.parts ?? []) for (const sh of p.shapes ?? []) if (sh.color === old) sh.color = name;
		for (const sh of d.collision ?? []) if (sh.color === old) sh.color = name;
	});
}

/** How much light a slot gives off (1.2); 0 drops the field. */
export function setTokenEmissive(k: number, v: number) {
	mutate((d) => {
		const t = d.palette![k];
		if (!t) return;
		if (v > 0) t.emissive = Math.round(v * 100) / 100;
		else delete t.emissive;
	}, `emissive-${k}`);
}

export function setTokenColor(k: number, rgb: Rgba) {
	mutate((d) => {
		d.palette![k].rgb = rgb;
	}, `token-${k}`);
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
/** The selection takes a texture ("" for none) and a fresh placement. */
export function setSelTexture(name: string) {
	mutate(() => {
		for (const sh of selShapes()) {
			if (name) sh.texture = name;
			else {
				delete sh.texture;
				delete sh.mapping;
			}
		}
	});
}
export function setSelMapping(patch: { at?: Vec2; angle?: number; scale?: number }, merge?: string) {
	mutate(() => {
		for (const sh of selShapes()) {
			if (!sh.texture) continue;
			const m = { ...(sh.mapping ?? {}) };
			delete m.xf; // a placement replaces a projected affine
			Object.assign(m, patch);
			sh.mapping = m;
		}
	}, merge);
}
