// The shell: everything the editor asks the machine for, behind one
// interface with two faces. Inside the desktop app it is the Go service
// (Wails bindings, in wails.ts, imported only there: the runtime phones
// home on load, which a plain browser cannot answer); loaded from the LAN
// server on a tablet it is the small JSON API rooted at the served
// project. The editor never knows which.

import type { ServeInfo } from "../../bindings/studio/models.js";

export type { ServeInfo };

/** What the machine can do with files, so the menus say the right thing. */
export interface Caps {
	/** removeFile moves to the Trash rather than deleting */
	trash: boolean;
	/** the file browser's name ("Finder"), "" where none can be opened */
	reveal: string;
	/** "darwin" in the app on a Mac: the traffic lights sit inline, the page leaves them room */
	os: string;
}

/** What is known of a file before it is read: its kind, and the palette files it draws from. */
export interface FileInfo {
	kind: string;
	refs: string[];
}

/** A row of a native menu: the page keeps what it does, by id. */
export interface PopupItem {
	id: string;
	label: string;
	separator: boolean;
	disabled: boolean;
	checked: boolean;
	keys: string;
	items: PopupItem[];
}
/** One uncommitted file: M, A, D or R, and its path from the project's root. */
export interface GitChange {
	status: string;
	path: string;
}
export interface GitProgress {
	message: string;
	/** 0..1, -1 when git did not say */
	done: number;
}

/** One thing Claude did or said, relayed as it happens. */
export interface ChatEvent {
	kind: "init" | "text" | "tool" | "result" | "error" | "done" | "log";
	text?: string;
	name?: string;
	input?: string;
	session?: string;
	cost?: number;
	model?: string;
	/** "none" when a plan pays for the turn, else where the API key came from */
	keySource?: string;
}
/** A tool call the editor must answer (see state/tools.ts). */
export interface ToolCall {
	id: string;
	name: string;
	args: Record<string, unknown>;
}
export interface ChatInfo {
	found: boolean;
	path: string;
	busy: boolean;
	loggedIn?: boolean;
	/** "claude.ai" for a plan; anything else is an API key or no login */
	authMethod?: string;
	email?: string;
	/** "max", "pro", … on a claude.ai login */
	plan?: string;
	org?: string;
}

export interface Shell {
	readonly kind: "wails" | "http";
	pickFolder(): Promise<string | null>;
	isDir(path: string): Promise<boolean>;
	home(): Promise<string>;
	defaultRoot(): Promise<string>;
	listFiles(root: string): Promise<string[]>;
	/** a word that changes whenever the project's files do (added, removed, written), whoever did it; "" when it cannot be had */
	stamp(root: string): Promise<string>;
	/** what each file is ("2D", "3D", "palette", "scene", "3D scene"), sniffed without parsing */
	kinds(root: string): Promise<Record<string, FileInfo>>;
	readFile(root: string, rel: string): Promise<string | null>;
	writeFile(root: string, rel: string, text: string): Promise<void>;
	/** an image file of the project as a URL an <img> can load (a reference image); null when it is not there or no image */
	readImage(root: string, rel: string): Promise<string | null>;
	/** a 3D document's compiled sidecar (name.fart.glb, a derived build artifact), by the document's path; null when it has none */
	readSidecar(root: string, rel: string): Promise<Uint8Array | null>;
	/** write a document's sidecar beside it */
	writeSidecar(root: string, rel: string, glb: Uint8Array): Promise<void>;
	/** whether sidecars would be committed: "none" outside a repository, "ignored", or "offer" */
	sidecarIgnore(root: string): Promise<string>;
	/** add *.fart.glb to the project's .gitignore */
	ignoreSidecars(root: string): Promise<void>;
	/** when a file was last written (ms since the epoch), null when it is not there */
	stat(root: string, rel: string): Promise<number | null>;
	caps(): Promise<Caps>;
	/** to the Trash where there is one, else gone; resolves with which */
	removeFile(root: string, rel: string): Promise<string>;
	renameFile(root: string, from: string, to: string): Promise<void>;
	/** a copy beside the original; resolves with its path */
	duplicateFile(root: string, rel: string): Promise<string>;
	/** show it in the file browser; "" is the project folder */
	revealFile(root: string, rel: string): Promise<void>;
	/** the setup probes reach the home folder and the repo root: only on the machine itself */
	readonly setup: boolean;
	gitRoot(dir: string): Promise<string>;
	/** the fastart checkout this studio came from, "" if unknown */
	checkout(): Promise<string>;
	readAt(base: string, rel: string): Promise<string | null>;
	writeAt(base: string, rel: string, text: string): Promise<void>;
	/** files named so below base ("*.odin" for a suffix) */
	findNamed(base: string, name: string): Promise<string[]>;
	/** Claude, inside: only on the machine that runs Claude Code */
	readonly chat: boolean;
	chatStatus(): Promise<ChatInfo>;
	chatAsk(root: string, prompt: string): Promise<void>;
	chatStop(): Promise<void>;
	chatReset(root: string): Promise<void>;
	/** the editor's answer to a relayed tool call: an MCP result, as JSON text */
	toolReply(id: string, result: string): Promise<void>;
	onChat(cb: (e: ChatEvent) => void): void;
	onTool(cb: (t: ToolCall) => void): void;
	/** a project scaffolded at <parent>/<name>: assets/ and a .gitignore; resolves with its root */
	newProject(parent: string, name: string): Promise<string>;
	/** the folder dialog for a new project's home; null when cancelled */
	pickParentFolder(): Promise<string | null>;
	/** the branch a folder's repository has checked out; "" outside a repository */
	branch(dir: string): Promise<string>;
	branches(dir: string): Promise<string[]>;
	switchBranch(dir: string, name: string): Promise<void>;
	newBranch(dir: string, name: string): Promise<void>;
	/** make the folder a repository, if it is not one */
	gitInit(dir: string): Promise<void>;
	gitStatus(dir: string): Promise<GitChange[]>;
	/** stage everything under the project and commit it */
	gitCommit(dir: string, message: string): Promise<void>;
	/** clone into <parent>/<the repository's name>; resolves with the new folder */
	gitClone(url: string, parent: string): Promise<string>;
	onGit(cb: (p: GitProgress) => void): void;
	/** the platform's own menu at a point of the page; a choice comes back by id on onPopup */
	popupMenu(items: PopupItem[], x: number, y: number): Promise<void>;
	onPopup(cb: (id: string) => void): void;
	/** the platform's open dialog, inside the project: a path from its root, null when cancelled */
	pickFile(root: string, dir: string, title: string, button: string, exts: string[]): Promise<string | null>;
	/** the platform's folder dialog, with its own words */
	pickFolderAt(title: string, button: string): Promise<string | null>;
	fullscreen(): Promise<boolean>;
	onFullscreen(cb: (on: boolean) => void): void;
	closeWindow(): Promise<void>;
	/** the window sized for the launcher, or for work */
	windowLauncher(): Promise<void>;
	windowWork(): Promise<void>;
	recents(): Promise<string[]>;
	pushRecent(root: string): Promise<string[]>;
	forgetRecent(root: string): Promise<string[]>;
	drainOpenQueue(): Promise<string[]>;
	onOpenFiles(cb: () => void): void;
	serve(root: string): Promise<ServeInfo>;
	serveStatus(): Promise<ServeInfo>;
	serveStop(): Promise<void>;
	/** http mode only: what the server is serving, and where (an absolute path, for setup) */
	info(): Promise<{ name: string; root?: string }>;
	/** a line into the shell's log, for debugging */
	log(msg: string): void;
	/** the menu bar chose a command (by id) */
	onMenu(cb: (id: string) => void): void;
	/** self-update (the app only): the version this is, what is newer on GitHub, and the steps */
	readonly updates: boolean;
	version(): Promise<string>;
	updateCheck(): Promise<UpdateInfo>;
	updateApply(assetUrl: string): Promise<void>;
	updateRelaunch(): Promise<void>;
	onUpdate(cb: (p: UpdateProgress) => void): void;
}

export interface UpdateInfo {
	current: string;
	latest: string;
	available: boolean;
	url: string;
	assetUrl: string;
	asset: string;
	size: number;
	notes: string;
}
export interface UpdateProgress {
	phase: "download" | "unpack" | "install" | "done" | "error";
	done: number;
	total: number;
	message: string;
}

// Over HTTP the server owns the project: root is always "" and the API
// is relative. Dialogs and recents do not exist on a tablet.
class HttpShell implements Shell {
	readonly kind = "http" as const;
	readonly updates = false;
	async version() {
		return "";
	}
	async updateCheck(): Promise<UpdateInfo> {
		return { current: "", latest: "", available: false, url: "", assetUrl: "", asset: "", size: 0, notes: "" };
	}
	async updateApply() {}
	async updateRelaunch() {}
	onUpdate() {}
	async pickFolder() {
		return null;
	}
	async newProject(): Promise<string> {
		throw new Error("a served studio cannot make a project");
	}
	async pickParentFolder() {
		return null;
	}
	async branch() {
		return "";
	}
	async branches() {
		return [];
	}
	async switchBranch() {}
	async newBranch() {}
	async gitInit() {}
	async gitStatus(): Promise<GitChange[]> {
		return [];
	}
	async gitCommit() {}
	async gitClone(): Promise<string> {
		throw new Error("a served studio cannot clone");
	}
	onGit() {}
	async popupMenu() {}
	onPopup() {}
	async pickFile() {
		return null;
	}
	async pickFolderAt() {
		return null;
	}
	async fullscreen() {
		return false;
	}
	onFullscreen() {}
	async closeWindow() {}
	async windowLauncher() {}
	async windowWork() {}
	async isDir() {
		return false;
	}
	async home() {
		if (!this.setup) return "";
		const r = await fetch("api/setup/home");
		return r.ok ? ((await r.json()) as string) : "";
	}
	async defaultRoot() {
		return "";
	}
	async listFiles() {
		const r = await fetch("api/list");
		return r.ok ? ((await r.json()) as string[]) : [];
	}
	async stamp() {
		const r = await fetch("api/stamp").catch(() => null);
		return r?.ok ? ((await r.json()) as string) : "";
	}
	async kinds() {
		const r = await fetch("api/kinds");
		return r.ok ? ((await r.json()) as Record<string, FileInfo>) : {};
	}
	async readFile(_root: string, rel: string) {
		const r = await fetch(`api/file?path=${encodeURIComponent(rel)}`);
		return r.ok ? await r.text() : null;
	}
	async readImage(_root: string, rel: string) {
		const url = `api/image?path=${encodeURIComponent(rel)}`;
		const r = await fetch(url, { method: "GET" });
		return r.ok ? url : null;
	}
	async writeFile(_root: string, rel: string, text: string) {
		const r = await fetch(`api/file?path=${encodeURIComponent(rel)}`, { method: "PUT", body: text });
		if (!r.ok) throw new Error((await r.text()).trim() || `HTTP ${r.status}`);
	}
	async readSidecar(_root: string, rel: string) {
		const r = await fetch(`api/sidecar?path=${encodeURIComponent(rel)}`);
		return r.ok && r.status !== 204 ? new Uint8Array(await r.arrayBuffer()) : null;
	}
	async writeSidecar(_root: string, rel: string, glb: Uint8Array) {
		const r = await fetch(`api/sidecar?path=${encodeURIComponent(rel)}`, { method: "PUT", body: glb as unknown as BodyInit });
		if (!r.ok) throw new Error((await r.text()).trim() || `HTTP ${r.status}`);
	}
	async sidecarIgnore() {
		const r = await fetch("api/sidecar/ignore");
		return r.ok ? ((await r.json()) as string) : "none";
	}
	async ignoreSidecars() {
		const r = await fetch("api/sidecar/ignore", { method: "POST" });
		if (!r.ok) throw new Error((await r.text()).trim() || `HTTP ${r.status}`);
	}
	async stat(_root: string, rel: string) {
		const r = await fetch(`api/stat?path=${encodeURIComponent(rel)}`);
		if (!r.ok) return null;
		const t = (await r.json()) as { text: string; found: boolean };
		return t.found ? Number(t.text) : null;
	}
	async caps() {
		const r = await fetch("api/info");
		const info = r.ok ? ((await r.json()) as { trash?: boolean }) : {};
		return { trash: !!info.trash, reveal: "", os: "" };
	}
	async removeFile(_root: string, rel: string) {
		const r = await fetch(`api/file?path=${encodeURIComponent(rel)}`, { method: "DELETE" });
		if (!r.ok) throw new Error((await r.text()).trim());
		return (await r.json()) as string;
	}
	async renameFile(_root: string, from: string, to: string) {
		const r = await fetch(`api/rename?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { method: "POST" });
		if (!r.ok) throw new Error((await r.text()).trim());
	}
	async duplicateFile(_root: string, rel: string) {
		const r = await fetch(`api/duplicate?path=${encodeURIComponent(rel)}`, { method: "POST" });
		if (!r.ok) throw new Error((await r.text()).trim());
		return (await r.json()) as string;
	}
	async revealFile() {}
	readonly setup = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
	async gitRoot(dir: string) {
		const r = await fetch(`api/setup/gitroot?dir=${encodeURIComponent(dir)}`);
		return r.ok ? ((await r.json()) as string) : "";
	}
	async checkout() {
		const r = await fetch("api/setup/checkout");
		return r.ok ? ((await r.json()) as string) : "";
	}
	async readAt(base: string, rel: string) {
		const r = await fetch(`api/setup/file?base=${encodeURIComponent(base)}&rel=${encodeURIComponent(rel)}`);
		if (!r.ok) return null;
		const t = (await r.json()) as { text: string; found: boolean };
		return t.found ? t.text : null;
	}
	async writeAt(base: string, rel: string, text: string) {
		const r = await fetch(`api/setup/file?base=${encodeURIComponent(base)}&rel=${encodeURIComponent(rel)}`, { method: "PUT", body: text });
		if (!r.ok) throw new Error((await r.text()).trim());
	}
	async findNamed(base: string, name: string) {
		const r = await fetch(`api/setup/find?base=${encodeURIComponent(base)}&name=${encodeURIComponent(name)}`);
		return r.ok ? ((await r.json()) as string[]) : [];
	}
	readonly chat = this.setup;
	private events?: EventSource;
	private chatCbs: ((e: ChatEvent) => void)[] = [];
	private toolCbs: ((t: ToolCall) => void)[] = [];
	private listen() {
		if (this.events) return;
		this.events = new EventSource("api/chat/events");
		this.events.onmessage = (m) => {
			const { name, data } = JSON.parse(m.data) as { name: string; data: unknown };
			if (name === "chat") for (const cb of this.chatCbs) cb(data as ChatEvent);
			if (name === "tool") for (const cb of this.toolCbs) cb(data as ToolCall);
		};
	}
	async chatStatus() {
		const r = await fetch("api/chat/status");
		return r.ok ? ((await r.json()) as ChatInfo) : { found: false, path: "", busy: false };
	}
	async chatAsk(_root: string, prompt: string) {
		this.listen();
		const r = await fetch("api/chat/ask", { method: "POST", body: prompt });
		if (!r.ok) throw new Error((await r.text()).trim());
	}
	async chatStop() {
		await fetch("api/chat/stop", { method: "POST" });
	}
	async chatReset() {
		await fetch("api/chat/reset", { method: "POST" });
	}
	async toolReply(id: string, result: string) {
		await fetch(`api/chat/tool?id=${encodeURIComponent(id)}`, { method: "POST", body: result });
	}
	onChat(cb: (e: ChatEvent) => void) {
		this.chatCbs.push(cb);
		if (this.chat) this.listen();
	}
	onTool(cb: (t: ToolCall) => void) {
		this.toolCbs.push(cb);
		if (this.chat) this.listen();
	}
	async recents() {
		return [];
	}
	async pushRecent() {
		return [];
	}
	async forgetRecent() {
		return [];
	}
	async drainOpenQueue() {
		return [];
	}
	onOpenFiles() {}
	async serve(): Promise<ServeInfo> {
		return { on: true, url: location.origin, root: "", qr: "" };
	}
	async serveStatus(): Promise<ServeInfo> {
		return { on: true, url: location.origin, root: "", qr: "" };
	}
	async serveStop() {}
	async info() {
		const r = await fetch("api/info");
		return r.ok ? ((await r.json()) as { name: string; root?: string }) : { name: "" };
	}
	log(msg: string) {
		console.log(msg);
	}
	onMenu() {}
}

export let shell: Shell = new HttpShell();

/**
 * Is this page inside the app's webview? The native bridge is what the
 * Wails runtime itself looks for: WKWebView's message handler on macOS,
 * Linux and iOS, WebView2's on Windows, the Android interface. (window._wails
 * is not a sign of anything: the runtime module creates it when it loads.)
 */
function inWails(): boolean {
	const w = window as unknown as {
		webkit?: { messageHandlers?: { external?: { postMessage?: unknown } } };
		chrome?: { webview?: { postMessage?: unknown } };
		wails?: { invoke?: unknown };
	};
	return !!(w.webkit?.messageHandlers?.external?.postMessage || w.chrome?.webview?.postMessage || w.wails?.invoke);
}

/** Pick the face for this environment. Called once, before anything else. */
export async function initShell(): Promise<Shell> {
	if (inWails()) {
		const m = await import("./wails.ts");
		shell = new m.WailsShell();
	}
	return shell;
}
