// The desktop face of the shell: the Go ProjectService over Wails
// bindings. Only ever imported inside the app (see shell.ts).

import * as Project from "../../bindings/studio/projectservice.js";
import { Events } from "@wailsio/runtime";
import type { Shell, ChatEvent, ToolCall, UpdateInfo, UpdateProgress, PopupItem, GitChange, GitProgress, FileInfo } from "./shell.ts";

export class WailsShell implements Shell {
	readonly kind = "wails" as const;
	async pickFolder() {
		const p = await Project.PickFolder();
		return p || null;
	}
	isDir(path: string) {
		return Project.IsDir(path);
	}
	home() {
		return Project.Home();
	}
	defaultRoot() {
		return Project.DefaultRoot();
	}
	async listFiles(root: string) {
		return (await Project.ListFiles(root)) ?? [];
	}
	async stamp(root: string) {
		return (await Project.Stamp(root).catch(() => "")) ?? "";
	}
	async kinds(root: string) {
		const out: Record<string, FileInfo> = {};
		for (const [rel, i] of Object.entries((await Project.Kinds(root)) ?? {})) if (i) out[rel] = { kind: i.kind, refs: i.refs ?? [] };
		return out;
	}
	async readFile(root: string, rel: string) {
		try {
			return await Project.ReadFile(root, rel);
		} catch {
			return null;
		}
	}
	writeFile(root: string, rel: string, text: string) {
		return Project.WriteFile(root, rel, text);
	}
	async readSidecar(root: string, rel: string) {
		try {
			const b64 = await Project.ReadSidecar(root, rel);
			if (!b64) return null;
			const bin = atob(b64);
			const out = new Uint8Array(bin.length);
			for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
			return out;
		} catch {
			return null;
		}
	}
	async writeSidecar(root: string, rel: string, glb: Uint8Array) {
		// in chunks: a large model is too many arguments for one call
		let bin = "";
		for (let i = 0; i < glb.length; i += 0x8000) bin += String.fromCharCode(...glb.subarray(i, i + 0x8000));
		await Project.WriteSidecar(root, rel, btoa(bin));
	}
	async sidecarIgnore(root: string) {
		try {
			return await Project.SidecarIgnore(root);
		} catch {
			return "none";
		}
	}
	async ignoreSidecars(root: string) {
		await Project.IgnoreSidecars(root);
	}
	async readImage(root: string, rel: string) {
		try {
			return await Project.ReadImage(root, rel);
		} catch {
			return null;
		}
	}
	async stat(root: string, rel: string) {
		const t = await Project.Stat(root, rel);
		return t.found ? Number(t.text) : null;
	}
	async caps() {
		const c = await Project.Caps();
		return { trash: !!c.trash, reveal: c.reveal ?? "", os: c.os ?? "" };
	}
	removeFile(root: string, rel: string) {
		return Project.Remove(root, rel);
	}
	renameFile(root: string, from: string, to: string) {
		return Project.Rename(root, from, to);
	}
	duplicateFile(root: string, rel: string) {
		return Project.Duplicate(root, rel);
	}
	revealFile(root: string, rel: string) {
		return Project.Reveal(root, rel);
	}
	readonly setup = true;
	gitRoot(dir: string) {
		return Project.GitRoot(dir);
	}
	checkout() {
		return Project.Checkout();
	}
	async readAt(base: string, rel: string) {
		const t = await Project.ReadAt(base, rel);
		return t.found ? t.text : null;
	}
	writeAt(base: string, rel: string, text: string) {
		return Project.WriteAt(base, rel, text);
	}
	async findNamed(base: string, name: string) {
		return (await Project.FindNamed(base, name)) ?? [];
	}
	readonly chat = true;
	async chatStatus() {
		const s = await Project.ChatStatus();
		return { found: !!s.found, path: s.path ?? "", busy: !!s.busy, loggedIn: !!s.loggedIn, authMethod: s.authMethod ?? "", email: s.email ?? "", plan: s.plan ?? "", org: s.org ?? "" };
	}
	chatAsk(root: string, prompt: string) {
		return Project.ChatAsk(root, prompt);
	}
	chatStop() {
		return Project.ChatStop();
	}
	chatReset(root: string) {
		return Project.ChatReset(root);
	}
	toolReply(id: string, result: string) {
		return Project.ToolReply(id, result);
	}
	onChat(cb: (e: ChatEvent) => void) {
		Events.On("chat", (ev) => cb(ev.data as unknown as ChatEvent));
	}
	onTool(cb: (t: ToolCall) => void) {
		Events.On("tool", (ev) => cb(ev.data as unknown as ToolCall));
	}
	newProject(parent: string, name: string) {
		return Project.NewProject(parent, name);
	}
	async pickParentFolder() {
		const p = await Project.PickParentFolder();
		return p || null;
	}
	branch(dir: string) {
		return Project.Branch(dir);
	}
	async branches(dir: string) {
		return (await Project.Branches(dir)) ?? [];
	}
	switchBranch(dir: string, name: string) {
		return Project.SwitchBranch(dir, name);
	}
	newBranch(dir: string, name: string) {
		return Project.NewBranch(dir, name);
	}
	gitInit(dir: string) {
		return Project.GitInit(dir);
	}
	async gitStatus(dir: string): Promise<GitChange[]> {
		return ((await Project.GitStatus(dir)) ?? []).map((c) => ({ status: c.status, path: c.path }));
	}
	gitCommit(dir: string, message: string) {
		return Project.GitCommit(dir, message);
	}
	gitClone(url: string, parent: string) {
		return Project.GitClone(url, parent);
	}
	onGit(cb: (p: GitProgress) => void) {
		Events.On("git", (ev) => cb(ev.data as unknown as GitProgress));
	}
	popupMenu(items: PopupItem[], x: number, y: number) {
		return Project.PopupMenu(items as never, x, y);
	}
	onPopup(cb: (id: string) => void) {
		Events.On("popup", (ev: { data: string }) => cb(ev.data));
	}
	async pickFile(root: string, dir: string, title: string, button: string, exts: string[]) {
		return (await Project.PickFile(root, dir, title, button, exts)) || null;
	}
	async pickFolderAt(title: string, button: string) {
		return (await Project.PickFolderAt(title, button)) || null;
	}
	fullscreen() {
		return Project.Fullscreen();
	}
	onFullscreen(cb: (on: boolean) => void) {
		Events.On("fullscreen", (ev: { data: boolean }) => cb(!!ev.data));
	}
	closeWindow() {
		return Project.CloseWindow();
	}
	windowLauncher() {
		return Project.WindowLauncher();
	}
	windowWork() {
		return Project.WindowWork();
	}
	async recents() {
		return (await Project.Recents()) ?? [];
	}
	async pushRecent(root: string) {
		return (await Project.PushRecent(root)) ?? [];
	}
	async forgetRecent(root: string) {
		return (await Project.ForgetRecent(root)) ?? [];
	}
	async drainOpenQueue() {
		return (await Project.DrainOpenQueue()) ?? [];
	}
	onOpenFiles(cb: () => void) {
		Events.On("open-files", () => cb());
	}
	serve(root: string) {
		return Project.Serve(root);
	}
	serveStatus() {
		return Project.ServeStatus();
	}
	serveStop() {
		return Project.ServeStop();
	}
	async info() {
		return { name: "" };
	}
	log(msg: string) {
		console.log(msg);
		void Project.Log(msg).catch(() => {});
	}
	readonly updates = true;
	version() {
		return Project.Version();
	}
	async updateCheck(): Promise<UpdateInfo> {
		const i = await Project.UpdateCheck();
		return { current: i.current ?? "", latest: i.latest ?? "", available: !!i.available, url: i.url ?? "", assetUrl: i.assetUrl ?? "", asset: i.asset ?? "", size: Number(i.size ?? 0), notes: i.notes ?? "" };
	}
	updateApply(assetUrl: string) {
		return Project.UpdateApply(assetUrl);
	}
	updateRelaunch() {
		return Project.UpdateRelaunch();
	}
	onUpdate(cb: (p: UpdateProgress) => void) {
		Events.On("update", (ev) => cb(ev.data as unknown as UpdateProgress));
	}
	onMenu(cb: (id: string) => void) {
		Events.On("menu", (ev: { data: string }) => cb(ev.data));
	}
}
