// The project: a folder, its files, the recents, and which screen is up.
// The editor store keeps the open document; this keeps everything around
// it and the ways a project gets opened (dialog, drop, argv, the Finder).

import { signal, batch } from "@preact/signals";
import { parseScene, loadScene, flattenScene, stringifyDoc, type Doc } from "@fastart/core";
import type { ThumbJob, ThumbResult } from "./thumbWorker.ts";
import { drawSceneThumb } from "../canvas/scene3.ts";
import { sidecars, keepSidecar } from "./sidecar.ts";
import { shell, initShell, type ServeInfo, type Caps, type GitChange, type FileInfo } from "../shell/shell.ts";
import { openFile, leaveFile, save, ed } from "./editor.ts";
import { openModel, leaveModel, md } from "./model.ts";
import { openScene, leaveScene, sc } from "./scene.ts";
import { ask, confirm, choose } from "./prompt.ts";
import { nav, visit, resetNav, walk } from "./nav.ts";
import { logActivity, busy } from "./activity.ts";
import { openDocNow } from "./doc.ts";
import { basename, dirname, joinRel, under, stripExt } from "./paths.ts";
import { refreshSetup } from "./setup.ts";
import { sidebar } from "./sidebar.ts";

/**
 * Which screen is up. "welcome" is the launcher; "browse" is a project with
 * nothing on the canvas (the shelf shows); "edit", "model" and "scene" are a
 * project with an asset open. Docs and setup sit over whichever was there.
 */
export type Screen = "welcome" | "browse" | "edit" | "model" | "scene" | "docs" | "setup";

/**
 * What the project keeps of a file it is not editing: an index of its
 * names and its picture, never the file itself. A project of hundreds of
 * models would not fit in memory otherwise.
 */
export interface Thumb {
	/** names only: the parts, states, clips and colours, and the palettes it draws from */
	doc: Doc;
	/** 1.3: the file is a 3D model; the picture is its front view */
	space3d?: boolean;
	/** a .shart: how many instances it places */
	scene?: { instances: number };
	/** the picture, drawn once (an object URL), "" when there is nothing to draw yet */
	image: string;
	/** when the file was written, as it was read: a later one is read again */
	mtime: number;
}

export const project = {
	root: signal<string | null>(null),
	name: signal(""),
	home: signal(""),
	files: signal<string[]>([]),
	thumbs: signal<Map<string, Thumb>>(new Map()),
	recents: signal<string[]>([]),
	serve: signal<ServeInfo | null>(null),
	screen: signal<Screen>("welcome"),
	docsBack: signal<Screen>("welcome"),
	setupBack: signal<Screen>("welcome"),
	docsPage: signal<string>("guide"),
	error: signal<string | null>(null),
	busy: signal(false),
	/** what the machine can do with files; the menus read it */
	caps: signal<Caps>({ trash: false, reveal: "", os: "" }),
	/** served mode: the folder's absolute path on the machine, for setup only */
	servedRoot: signal(""),
	/** the project has an assets/ folder: new assets land there */
	hasAssets: signal(false),
	/** the branch the project's repository is on; "" outside a repository */
	branch: signal(""),
	branches: signal<string[]>([]),
	/** what is uncommitted under the project, for the source control tab */
	changes: signal<GitChange[]>([]),
	/** what each file is ("2D", "3D", "palette", "scene", "3D scene"), known without reading any of them */
	kinds: signal<Record<string, string>>({}),
	/** the palette files each file draws from, as it names them */
	refs: signal<Record<string, string[]>>({}),
	/** the recents' branches, by folder, for the launcher */
	recentBranches: signal<Record<string, string>>({}),
	/** the window is full screen: the traffic lights are hidden, and so is the room left for them */
	fullscreen: signal(false),
};

const LAUNCH_KEY = "fastart.launcher";
/** "Show this window when Uranus launches": off, the last project opens instead. */
export const showLauncher = signal(readLaunch());
function readLaunch(): boolean {
	try {
		return localStorage.getItem(LAUNCH_KEY) !== "off";
	} catch {
		return true;
	}
}
export function setShowLauncher(on: boolean) {
	showLauncher.value = on;
	try {
		localStorage.setItem(LAUNCH_KEY, on ? "on" : "off");
	} catch {
		// the choice lasts the session
	}
}

/** The traffic lights sit inline (the app on a Mac, out of full screen): the header they sit in leaves them room. */
export function inlineLights(): boolean {
	return project.caps.value.os === "darwin" && !project.fullscreen.value;
}

/** In a project (an asset open or not), as opposed to the launcher, docs or setup. */
export function inWorkspace(s: Screen = project.screen.value): boolean {
	return s === "browse" || s === "edit" || s === "model" || s === "scene";
}

// the window is small for the launcher and big for work
let wasLauncher: boolean | null = null;
project.screen.subscribe((s) => {
	if (shell.kind !== "wails") return;
	const launcher = s === "welcome";
	if (launcher === wasLauncher) return;
	wasLauncher = launcher;
	void (launcher ? shell.windowLauncher() : shell.windowWork());
});

let errorTimer: number | undefined;
project.error.subscribe((e) => {
	if (errorTimer !== undefined) clearTimeout(errorTimer);
	if (e) errorTimer = window.setTimeout(() => (project.error.value = null), 6000);
});

export async function boot() {
	await initShell();
	void shell.caps().then((c) => (project.caps.value = c));
	void shell.fullscreen().then((on) => (project.fullscreen.value = on));
	shell.onFullscreen((on) => (project.fullscreen.value = on));
	if (shell.kind === "http") {
		const info = await shell.info();
		batch(() => {
			project.root.value = "";
			project.name.value = info.name;
			project.servedRoot.value = info.root ?? "";
		});
		project.home.value = await shell.home();
		await goBrowse();
		void refreshSetup();
		return;
	}
	project.home.value = await shell.home();
	project.recents.value = await shell.recents();
	void refreshRecentBranches();
	void refreshSetup();
	shell.onOpenFiles(() => void drainOpens());
	shell.log(`boot: shell=${shell.kind} url=${location.href}`);
	// anything the page drops on the floor lands in the shell's log too
	window.addEventListener("unhandledrejection", (ev) => shell.log(`unhandled: ${String(ev.reason)}`));
	window.addEventListener("error", (ev) => shell.log(`error: ${ev.message} @ ${ev.filename}:${ev.lineno}`));
	if (await drainOpens()) return;
	const def = await shell.defaultRoot();
	if (def) return void (await openProject(def));
	// the launcher, unless it was asked not to show: then the last project
	const last = project.recents.value[0];
	if (!showLauncher.value && last && (await shell.isDir(last))) return void (await openProject(last));
	project.screen.value = "welcome";
}

async function refreshRecentBranches() {
	const out: Record<string, string> = {};
	await Promise.all(project.recents.value.map(async (r) => (out[r] = await shell.branch(r).catch(() => ""))));
	project.recentBranches.value = out;
}

/**
 * Leaving an asset that has changed since its checkpoint asks once. The
 * edits are in the file already; the question is whether this version
 * becomes the one Revert goes back to. False means stay.
 */
export async function mayLeave(): Promise<boolean> {
	const d = openDocNow();
	if (!d || !d.dirty) return true;
	const name = stripExt(basename(d.path));
	const pick = await choose(`Save a checkpoint of "${name}"?`, "Your edits are already in the file on disk. Saving keeps this version as the one Revert goes back to.", [
		{ id: "discard", label: "Don't save", danger: true },
		{ id: "cancel", label: "Cancel" },
		{ id: "save", label: "Save", primary: true },
	]);
	if (pick === "cancel") return false;
	if (pick === "save") await d.save();
	return true;
}

/** How a new project starts: bare, or with one asset of a kind to draw in. */
export type Starter = "Empty" | "2D" | "3D";

/**
 * Create new project: <parent>/<name> with an assets/ folder inside,
 * a first asset when asked for one, a repository when asked for one. It
 * opens at once. Throws with the reason when it cannot.
 */
export async function createProjectAt(parent: string, name: string, start: Starter, repo: boolean) {
	const root = await shell.newProject(parent, name);
	if (repo) await shell.gitInit(root).catch((e) => (project.error.value = `the folder was made, but not the repository: ${String(e)}`));
	await openProject(root);
	const first = name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "asset";
	if (start === "2D") await newFile(first);
	else if (start === "3D") await newModel(first);
}

/** Clone a repository into <parent>/<its name>, then open it. Progress shows in the activity view. */
export async function cloneProject(url: string, parent: string, onProgress?: (message: string, done: number | null) => void) {
	shell.onGit((p) => onProgress?.(p.message, p.done < 0 ? null : p.done));
	const root = await busy(`Cloning ${url.replace(/\.git$/, "").split(/[/:]/).pop()}`, () => shell.gitClone(url, parent));
	onProgress = undefined;
	await openProject(root);
	logActivity(`Cloned ${basename(root)}`, "download");
}

/** The folder a new asset lands in when none is named: assets/ when the project has one. */
export function assetHome(): string {
	return project.hasAssets.value ? "assets" : "";
}

/** A plain name (no slash) goes to the assets folder; a path stays a path. */
export function placed(name: string): string {
	const home = assetHome();
	return home && !name.includes("/") ? `${home}/${name}` : name;
}

export async function refreshBranch() {
	const root = project.root.value;
	if (!root || shell.kind !== "wails") {
		project.branch.value = "";
		project.branches.value = [];
		return;
	}
	const [b, bs] = await Promise.all([shell.branch(root), shell.branches(root)]);
	batch(() => {
		project.branch.value = b;
		project.branches.value = bs;
	});
	void refreshGit();
}

/** What is uncommitted, re-read: after a save, a file operation, a commit. */
export async function refreshGit() {
	const root = project.root.value;
	project.changes.value = root && shell.kind === "wails" && project.branch.value ? await shell.gitStatus(root) : [];
}

/** A branch from here, switched to. */
export async function newBranch(name: string) {
	const root = project.root.value;
	if (!root) return;
	try {
		await shell.newBranch(root, name);
		logActivity(`New branch ${name}`, "git-branch");
	} catch (e) {
		project.error.value = String(e);
	}
	await refreshBranch();
}

/** Everything uncommitted, committed under a message. */
export async function commitAll(message: string) {
	const root = project.root.value;
	if (!root) return;
	const n = project.changes.value.length;
	try {
		await busy("Committing", () => shell.gitCommit(root, message), `Committed ${n} change${n === 1 ? "" : "s"}`, "git-commit-horizontal");
	} catch (e) {
		project.error.value = String(e);
	}
	await refreshGit();
}

/** Check a branch out; git's own words show when it will not. The shelf re-reads. */
export async function switchBranch(name: string) {
	const root = project.root.value;
	if (!root) return;
	if (name === project.branch.value) return;
	if (!(await mayLeave())) return;
	try {
		await shell.switchBranch(root, name);
		logActivity(`Switched to ${name}`, "git-branch");
	} catch (e) {
		project.error.value = String(e);
	}
	await refreshBranch();
	await refreshFiles();
	const open = ed.path.value ?? md.path.value ?? sc.path.value;
	if (open && !project.files.value.includes(open)) await goBrowse();
	else if (open) await openDoc(open);
}

/** Anything the OS handed us: the first one opens. */
export async function drainOpens(): Promise<boolean> {
	const paths = await shell.drainOpenQueue();
	if (!paths.length) return false;
	return openPath(paths[0]);
}

export async function openProject(root: string) {
	let r = root;
	while (r.length > 1 && r.endsWith("/")) r = r.slice(0, -1);
	if (!(await mayLeave())) return;
	resetNav();
	if (ed.path.value) await leaveFile();
	if (md.path.value) await leaveModel();
	if (sc.path.value) await leaveScene();
	batch(() => {
		project.root.value = r;
		project.name.value = basename(r);
	});
	project.recents.value = await shell.pushRecent(r);
	sidebar.view.value = "assets";
	await showBrowser();
	void refreshSetup();
	void refreshBranch();
}

/**
 * A path from a drop, argv or the Finder: a folder becomes the project; a
 * .fart opens inside the project it already belongs to (the open one, else
 * the terminal's folder), or failing both, its own folder becomes one.
 */
export async function openPath(path: string): Promise<boolean> {
	if (await shell.isDir(path)) {
		await openProject(path);
		return true;
	}
	if (!path.endsWith(".fart")) return false;
	let root = dirname(path) || "/";
	const cur = project.root.value;
	if (cur && under(path, cur)) root = cur;
	else {
		const def = await shell.defaultRoot();
		if (def && under(path, def)) root = def;
	}
	const rel = root === "/" ? path.slice(1) : path.slice(root.length + 1);
	if (root !== cur) await openProject(root);
	return openDoc(rel);
}

export async function pickFolder() {
	try {
		const p = await shell.pickFolderAt("Open a project: any folder of .fart files", "Open");
		if (p) await openProject(p);
	} catch (e) {
		shell.log(`pickFolder failed: ${String(e)}`);
		project.error.value = `the folder dialog failed: ${String(e)}`;
	}
}

export async function forgetRecent(root: string) {
	project.recents.value = await shell.forgetRecent(root);
}

export async function goWelcome() {
	if (!(await mayLeave())) return;
	if (ed.path.value) await leaveFile();
	if (md.path.value) await leaveModel();
	if (sc.path.value) await leaveScene();
	project.screen.value = "welcome";
	void refreshRecentBranches();
}

/** The project with nothing open: the asset browser in the content, the assets in the navigator. */
export async function goBrowse(): Promise<boolean> {
	if (!(await mayLeave())) return false;
	await showBrowser();
	return true;
}

async function showBrowser() {
	if (ed.path.value) await leaveFile();
	if (md.path.value) await leaveModel();
	if (sc.path.value) await leaveScene();
	if (sidebar.view.value === "asset") sidebar.view.value = "assets";
	project.screen.value = "browse";
	visit({ kind: "folder", path: nav.folder.value });
	await refreshFiles();
}

/** The browser, on one folder of the project ("" is all of it). */
export async function goFolder(path: string): Promise<boolean> {
	if (inWorkspace() && project.screen.value !== "browse" && !(await mayLeave())) return false;
	nav.folder.value = path;
	nav.selected.value = null;
	// already in the browser: another folder of the same listing, nothing to re-read
	if (project.screen.value === "browse") visit({ kind: "folder", path });
	else await showBrowser();
	return true;
}

/** Back and forward through the folders and documents visited. */
export const goBack = () => walk(-1, (p) => (p.kind === "folder" ? goFolder(p.path) : openDoc(p.path)));
export const goForward = () => walk(1, (p) => (p.kind === "folder" ? goFolder(p.path) : openDoc(p.path)));

export function goDocs(page?: string) {
	if (page) project.docsPage.value = page;
	if (project.screen.value !== "docs") project.docsBack.value = project.screen.value;
	project.screen.value = "docs";
}

export function leaveDocs() {
	project.screen.value = project.docsBack.value;
}

export function goSetup() {
	if (project.screen.value !== "setup") project.setupBack.value = project.screen.value === "edit" || project.screen.value === "model" || project.screen.value === "scene" ? "browse" : project.screen.value;
	project.screen.value = "setup";
}

export function leaveSetup() {
	project.screen.value = project.setupBack.value;
}

const THUMB_PX = 384;

/** A drawing, as a picture the browser can show and forget the drawing. */
function pictureOf(paint: (c: HTMLCanvasElement) => void): Promise<string> {
	const c = document.createElement("canvas");
	paint(c);
	if (!c.width || !c.height) return Promise.resolve("");
	return new Promise((resolve) => c.toBlob((b) => resolve(b ? URL.createObjectURL(b) : "")));
}

// one worker, made when the first picture is asked for
let worker: Worker | null = null;
let jobs = 0;
const waiting = new Map<number, (r: ThumbResult) => void>();
function inWorker(job: Omit<ThumbJob, "id">): Promise<ThumbResult> {
	if (!worker) {
		worker = new Worker(new URL("./thumbWorker.ts", import.meta.url), { type: "module" });
		worker.onmessage = (e: MessageEvent<ThumbResult>) => {
			waiting.get(e.data.id)?.(e.data);
			waiting.delete(e.data.id);
		};
		worker.onerror = () => {
			// a worker that died takes its jobs with it: answer them empty, start afresh next time
			for (const [id, done] of waiting) done({ id, index: null, space3d: false, image: null });
			waiting.clear();
			worker = null;
		};
	}
	const id = ++jobs;
	return new Promise((resolve) => {
		waiting.set(id, resolve);
		worker!.postMessage({ ...job, id });
	});
}

/** Read one file: its index and its picture. null when it cannot be read. */
async function loadThumb(root: string, rel: string, mtime: number): Promise<Thumb | null> {
	const text = await shell.readFile(root, rel);
	if (text === null) return null;
	const dir = dirname(rel);
	if (rel.endsWith(".shart")) {
		// a scene: read what it names, place it
		const { raw } = parseScene(text);
		if (!raw) return null;
		try {
			const loaded = await loadScene(raw, (ref) => shell.readFile(root, joinRel(dir, ref)), "", [], basename(rel));
			const placed = flattenScene(loaded);
			const space3d = raw.space === "3d";
			const image = await pictureOf((c) => drawSceneThumb(c, { placed, space3d }, THUMB_PX));
			return { doc: { version: 1, name: raw.name }, space3d, scene: { instances: placed.length }, image, mtime };
		} catch {
			return null; // a scene that cannot be read stays a glyph
		}
	}
	// the palettes it draws from, read here: the worker has no way to the disk
	const refs: Record<string, string> = {};
	const named = /"palette_refs"\s*:\s*\[([^\]]*)\]/.exec(text.slice(0, 65536));
	for (const m of named?.[1].matchAll(/"((?:[^"\\]|\\.)*)"/g) ?? []) {
		const t = await shell.readFile(root, joinRel(dir, m[1]));
		if (t !== null) refs[m[1]] = t;
	}
	// a 3D file's picture is painted from its compiled sidecar (1.8): read when fresh, built by the worker when not
	const use = sidecars.on.value && project.kinds.value[rel] === "3D";
	const glb = use ? await shell.readSidecar(root, rel).catch(() => null) : null;
	const r = await inWorker({ text, refs, px: THUMB_PX, glb, sidecar: use });
	if (r.built) void keepSidecar(root, rel, r.built);
	if (r.how) thumbHow.set(rel, r.how);
	if (!r.index) return null;
	return { doc: r.index, image: r.image ? URL.createObjectURL(r.image) : "", mtime, ...(r.space3d ? { space3d: true } : {}) };
}

// The thumbnails load lazily. The list of files shows at once, each with
// its kind (the shell sniffs that without parsing); a file is read only
// when its tile nears the screen (the browser asks), or when something
// needs the names inside every file (search). The parsing, projecting
// and painting happen in a worker, so the window never waits for a big
// model. What was read stays until its file changes on disk.
let thumbRun = 0;
let thumbQueue: string[] = [];
let thumbUrgent: string[] = [];
let thumbsWanted = false;
let reading = false;
/** how each 3D file's picture was last made, for scripts and the console */
export const thumbHow = new Map<string, string>();
/** how long each file took to read and draw, for scripts and the console */
export const thumbLog: { rel: string; ms: number }[] = [];
const breathe = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A tile came into view: its file jumps the queue. */
export function wantThumb(rel: string) {
	if (thumbQueue.includes(rel) && !thumbUrgent.includes(rel)) thumbUrgent.push(rel);
	void readThumbs();
}

/** Something needs every file's index: keep reading with an asset open too. */
export function wantAllThumbs() {
	if (thumbsWanted || !thumbQueue.length) return;
	thumbsWanted = true;
	void readThumbs();
}

/** How much of the project has been read: 1 when all of it has. */
export const thumbsRead = signal(1);

async function readThumbs() {
	const root = project.root.value;
	if (reading || root === null) return;
	reading = true;
	const run = thumbRun;
	const thumbs = new Map(project.thumbs.value);
	let last = 0;
	const publish = (now = false) => {
		// many readings, one redraw
		if (!now && performance.now() - last < 250) return;
		last = performance.now();
		batch(() => {
			project.thumbs.value = new Map(thumbs);
			thumbsRead.value = project.files.value.length ? 1 - thumbQueue.length / project.files.value.length : 1;
		});
	};
	try {
		while (run === thumbRun && thumbQueue.length) {
			const urgent = thumbUrgent.shift();
			// nothing on screen is waiting: the rest are read only when something asks for them all
			if (!urgent && !thumbsWanted) break;
			const rel = urgent ?? thumbQueue[0];
			const at = thumbQueue.indexOf(rel);
			if (at < 0) continue;
			thumbQueue.splice(at, 1);
			const mtime = (await shell.stat(root, rel)) ?? 0;
			if (run !== thumbRun) break;
			const had = thumbs.get(rel);
			if (had && had.mtime === mtime) continue;
			// one file that will not read or draw must not stop the rest
			const began = performance.now();
			const t = await loadThumb(root, rel, mtime).catch((e) => (shell.log(`thumb: ${rel}: ${String(e)}`), null));
			thumbLog.push({ rel, ms: Math.round(performance.now() - began) });
			if (run !== thumbRun) {
				if (t?.image) URL.revokeObjectURL(t.image);
				break;
			}
			if (had?.image) URL.revokeObjectURL(had.image);
			if (t) thumbs.set(rel, t);
			else thumbs.delete(rel);
			publish(!!urgent && !thumbUrgent.length);
			// let the pointer and the keys in between two files
			await breathe(urgent ? 0 : 16);
		}
	} finally {
		reading = false;
	}
	if (run === thumbRun) {
		publish(true);
		if (!thumbQueue.length) thumbsWanted = false;
	} else void readThumbs();
}

// The folder is watched: every couple of seconds, and whenever the window comes back to the front, the shell is asked
// for the project's stamp, and the folder is re-read when it has changed. So a file made, moved or written by anything
// else (a script, git, another editor, Claude) shows up without a click. Nothing is read while the window is hidden.
const WATCH_MS = 2000;
let watchStamp: string | null = null;
let watchRoot: string | null = null;
let watching = false;
async function watchTick() {
	const root = project.root.value;
	if (root === null || watching || project.busy.value || document.hidden) return;
	watching = true;
	try {
		const stamp = await shell.stamp(root);
		if (!stamp || root !== project.root.value) return;
		// (until the folder has been read once there is nothing to compare with: reading it leaves the stamp it was read at)
		if (watchRoot !== root || watchStamp === null || stamp === watchStamp) return;
		await refreshFiles(true);
	} finally {
		watching = false;
	}
}
if (typeof window !== "undefined") {
	window.setInterval(() => void watchTick(), WATCH_MS);
	window.addEventListener("focus", () => void watchTick());
	document.addEventListener("visibilitychange", () => void watchTick());
}

/** Read the folder again. `quiet`: the watcher's own re-read, with no busy mark (nothing was asked for). */
export async function refreshFiles(quiet = false) {
	const root = project.root.value;
	if (root === null) return;
	if (!quiet) project.busy.value = true;
	// the stamp is taken before the list: a change that lands between the two is seen again by the next tick, never missed
	const stamp = await shell.stamp(root).catch(() => "");
	const files = await shell.listFiles(root);
	if (root !== project.root.value) return;
	watchRoot = root;
	watchStamp = stamp || null;
	const [hasStat, kinds] = await Promise.all([shell.stat(root, "assets"), shell.kinds(root).catch(() => ({}) as Record<string, FileInfo>)]);
	const hasAssets = files.some((f) => f.startsWith("assets/")) || hasStat !== null;
	if (root !== project.root.value) return;
	thumbRun++;
	// what was read before stays up; each file is checked against the disk as its turn comes
	const thumbs = new Map<string, Thumb>();
	for (const [rel, t] of project.thumbs.value) {
		if (files.includes(rel)) thumbs.set(rel, t);
		else if (t.image) URL.revokeObjectURL(t.image);
	}
	// palettes first: they are small, and the menus that list them should not wait
	thumbQueue = [...files.filter((f) => f.includes("palette")), ...files.filter((f) => !f.includes("palette"))];
	thumbUrgent = [];
	batch(() => {
		project.files.value = files;
		project.hasAssets.value = hasAssets;
		project.kinds.value = Object.fromEntries(Object.entries(kinds).map(([rel, i]) => [rel, i.kind]));
		project.refs.value = Object.fromEntries(Object.entries(kinds).map(([rel, i]) => [rel, i.refs]));
		project.thumbs.value = thumbs;
		project.busy.value = false;
	});
	void readThumbs();
	void refreshGit();
}

export async function openDoc(rel: string): Promise<boolean> {
	if (openDocNow()?.path === rel) return true;
	if (!(await mayLeave())) return false;
	const ok = await openDocOnly(rel);
	if (ok) {
		visit({ kind: "doc", path: rel });
		nav.folder.value = dirname(rel);
		// a fresh asset starts with the document in the inspector, and its insides in the sidebar
		ed.partPicked.value = false;
		md.partPicked.value = false;
		sidebar.view.value = "asset";
	}
	return ok;
}

async function openDocOnly(rel: string): Promise<boolean> {
	const root = project.root.value;
	// a 3D file goes to the model screen; anything else (or nothing yet) to the editor
	const text = root === null ? null : await shell.readFile(root, rel);
	if (rel.endsWith(".shart")) {
		if (text === null) {
			project.error.value = `${rel} could not be read`;
			return false;
		}
		if (ed.path.value) await leaveFile();
		if (md.path.value) await leaveModel();
		const ok = await openScene(rel, text);
		if (ok) project.screen.value = "scene";
		return ok;
	}
	if (sc.path.value) await leaveScene();
	if (text !== null && /"space"\s*:\s*"3d"/.test(text)) {
		let is3d = false;
		try {
			is3d = (JSON.parse(text) as { space?: unknown }).space === "3d";
		} catch {
			is3d = false;
		}
		if (is3d) {
			if (ed.path.value) await leaveFile();
			const ok = await openModel(rel, text);
			if (ok) project.screen.value = "model";
			return ok;
		}
	}
	if (md.path.value) await leaveModel();
	const ok = await openFile(rel);
	if (ok) project.screen.value = "edit";
	return ok;
}

/** A new scene (.shart), empty, of a space; then the scene screen. */
export async function newScene(name: string, space3d: boolean) {
	const root = project.root.value;
	if (root === null) return;
	const rel = placed(name.endsWith(".shart") ? name : `${name}.shart`);
	if (project.files.value.includes(rel)) {
		project.error.value = `${rel} already exists`;
		return;
	}
	const scene = { version: 1, ...(space3d ? { space: "3d" } : {}), name: basename(rel.replace(/\.shart$/, "")), nodes: [] };
	try {
		await shell.writeFile(root, rel, JSON.stringify(scene, null, 2) + "\n");
	} catch (e) {
		project.error.value = `could not write ${rel}: ${String(e)}`;
		return;
	}
	await refreshFiles();
	await openDoc(rel);
}

/** A new 3D file: a part, a colour, a state; then the model screen. */
export async function newModel(name: string) {
	const root = project.root.value;
	if (root === null) return;
	const rel = placed(name.endsWith(".fart") ? name : `${name}.fart`);
	if (project.files.value.includes(rel)) {
		project.error.value = `${rel} already exists`;
		return;
	}
	const doc = { version: 1, space: "3d", name: basename(rel.replace(/\.fart$/, "")), palette: [{ name: "ink", rgb: [200, 195, 185, 255] }], parts: [{ name: "body", pivot: [0, 0, 0], shapes: [] }], states: [{ name: "default", parts: [{ part: "body", offset: [0, 0, 0] }] }] };
	try {
		await shell.writeFile(root, rel, JSON.stringify(doc, null, 2) + "\n");
	} catch (e) {
		project.error.value = `could not write ${rel}: ${String(e)}`;
		return;
	}
	await refreshFiles();
	await openDoc(rel);
}

/** The project's palette files: colours and no parts. */
export function paletteFiles(): string[] {
	return project.files.value.filter((rel) => project.kinds.value[rel] === "palette").sort();
}

/** The files that draw from a palette file, by its project path. */
export function linkedBy(target: string): string[] {
	const out: string[] = [];
	for (const [rel, refs] of Object.entries(project.refs.value)) {
		for (const ref of refs) if (joinRel(dirname(rel), ref) === target) out.push(rel);
	}
	return out.sort();
}

/**
 * A palette file: colours and no parts. A plain name lands in palettes/,
 * a name with a slash is a path from the project's root. Resolves with
 * the file's path, or null.
 */
export async function newPalette(name: string, open = true): Promise<string | null> {
	const root = project.root.value;
	if (root === null) return null;
	const bare = name.endsWith(".fart") ? name.slice(0, -5) : name;
	const rel = `${bare.includes("/") ? bare : placed(`palettes/${bare}`)}.fart`;
	if (project.files.value.includes(rel)) {
		project.error.value = `${rel} already exists`;
		return null;
	}
	const doc: Doc = { version: 1, name: basename(bare), palette: [{ name: "ink", rgb: [200, 195, 185, 255] }] };
	try {
		await shell.writeFile(root, rel, stringifyDoc(doc));
	} catch (e) {
		project.error.value = `could not write ${rel}: ${String(e)}`;
		return null;
	}
	await refreshFiles();
	if (open) await openDoc(rel);
	return rel;
}

export async function newFile(name: string) {
	const rel = placed(name.endsWith(".fart") ? name : `${name}.fart`);
	if (await openDoc(rel)) {
		await save();
		await refreshFiles();
	}
}

// ------------------------------------------------------------- file ops

/** Take a file out of the project, after a word: to the Trash where there is one. */
export async function deleteFile(rel: string) {
	const root = project.root.value;
	if (root === null) return;
	const name = stripExt(basename(rel));
	const trash = project.caps.value.trash;
	const ok = await confirm(trash ? `Move "${name}" to the Trash?` : `Delete "${name}"?`, {
		body: trash ? "Its checkpoint goes with it. The Trash can give it back." : "This cannot be undone.",
		ok: trash ? "Move to Trash" : "Delete",
		danger: true,
	});
	if (!ok) return;
	if (openDocNow()?.path === rel) await showBrowser();
	if (nav.selected.value === rel) nav.selected.value = null;
	try {
		await shell.removeFile(root, rel);
		logActivity(`${trash ? "Moved" : "Deleted"} ${name}${trash ? " to the Trash" : ""}`, "trash-2");
	} catch (e) {
		project.error.value = String(e);
	}
	await refreshFiles();
}

/** What a new name may be: lower-case letters, numbers, - and _. */
export const ASSET_NAME = /^[a-z0-9][a-z0-9_-]*$/;
export const NAME_HINT = "Use lower-case letters, numbers, - and _.";
const extOf = (rel: string) => (rel.endsWith(".shart") ? ".shart" : ".fart");

/** Why a file cannot take this name, or null when it can. */
export function renameProblem(rel: string, name: string): string | null {
	if (!ASSET_NAME.test(name)) return NAME_HINT;
	const dir = dirname(rel);
	const to = `${dir ? `${dir}/` : ""}${name}${extOf(rel)}`;
	return to !== rel && project.files.value.includes(to) ? `${name} already exists here.` : null;
}

/** Rename a file in its folder; the open asset follows it. */
export async function renameTo(rel: string, name: string): Promise<string | null> {
	const root = project.root.value;
	if (root === null) return null;
	const dir = dirname(rel);
	const to = `${dir ? `${dir}/` : ""}${name}${extOf(rel)}`;
	if (to === rel) return rel;
	const open = openDocNow();
	try {
		// the file moves under the open asset: let go of it first, pick it up after
		if (open?.path === rel) await showBrowser();
		await shell.renameFile(root, rel, to);
		logActivity(`Renamed ${stripExt(basename(rel))} to ${name}`, "pencil");
	} catch (e) {
		project.error.value = `could not rename: ${String(e)}`;
		await refreshFiles();
		return null;
	}
	await refreshFiles();
	if (nav.selected.value === rel) nav.selected.value = to;
	if (open?.path === rel) await openDoc(to);
	return to;
}

/** Rename a file, asked in a sheet. */
export async function renameFile(rel: string) {
	const stem = stripExt(basename(rel));
	const name = await ask(`Rename "${stem}"`, stem, { ok: "Rename", mono: true, hint: NAME_HINT, validate: (v) => (v === stem ? null : renameProblem(rel, v)) });
	if (!name || name === stem) return;
	await renameTo(rel, name);
}

/** A copy beside the original ("hero copy"). */
export async function duplicateFile(rel: string): Promise<string | null> {
	const root = project.root.value;
	if (root === null) return null;
	try {
		const copy = await shell.duplicateFile(root, rel);
		await refreshFiles();
		return copy;
	} catch (e) {
		project.error.value = `could not duplicate: ${String(e)}`;
		return null;
	}
}

/** Show a file or folder ("" is the project) in the file browser. */
export async function revealFile(rel: string) {
	const root = project.root.value;
	if (root === null) return;
	try {
		await shell.revealFile(root, rel);
	} catch (e) {
		project.error.value = String(e);
	}
}

export async function toggleServe() {
	const root = project.root.value;
	if (root === null) return;
	const cur = project.serve.value;
	if (cur?.on) {
		await shell.serveStop();
		project.serve.value = null;
		return;
	}
	try {
		project.serve.value = await shell.serve(root);
	} catch (e) {
		project.error.value = `could not serve: ${String(e)}`;
	}
}

export async function refreshServe() {
	const s = await shell.serveStatus();
	project.serve.value = s.on ? s : null;
}
