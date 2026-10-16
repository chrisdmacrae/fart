// The one list of things the studio can do. The menu bar, the command
// palette and the keyboard all read it; nothing does something the list
// cannot name.

import { signal } from "@preact/signals";

export interface Command {
	id: string;
	title: string;
	/** display form of the shortcut, e.g. "Cmd S" */
	keys?: string;
	group: string;
	/** false hides it from the palette and makes the key a no-op */
	when?: () => boolean;
	run: () => void;
}

const registry = new Map<string, Command>();
export const commandRev = signal(0);

export function register(...cs: Command[]) {
	for (const c of cs) registry.set(c.id, c);
	commandRev.value++;
}

export function command(id: string): Command | undefined {
	return registry.get(id);
}

export function commands(): Command[] {
	return [...registry.values()];
}

/** Run a command by id; false when it does not exist or does not apply now. */
export function run(id: string): boolean {
	const c = registry.get(id);
	if (!c || (c.when && !c.when())) return false;
	c.run();
	return true;
}

/** A keyboard event as "cmd+shift+z", the way the keymap spells it. */
export function keyOf(e: KeyboardEvent): string {
	const parts: string[] = [];
	if (e.metaKey || e.ctrlKey) parts.push("cmd");
	if (e.shiftKey) parts.push("shift");
	if (e.altKey) parts.push("alt");
	let k = e.key;
	if (e.code.startsWith("Digit")) k = e.code.slice(5);
	else if (e.code.startsWith("Key")) k = e.code.slice(3).toLowerCase();
	else if (e.code === "Equal") k = "=";
	else if (e.code === "Minus") k = "-";
	else if (e.code === "Quote") k = "'";
	else if (e.code === "BracketLeft") k = "[";
	else if (e.code === "BracketRight") k = "]";
	else if (e.code === "Slash") k = "/";
	else if (e.code === "Comma") k = ",";
	else if (e.code === "Period" || e.code === "NumpadDecimal") k = ".";
	else if (e.code.startsWith("Numpad") && /^Numpad\d$/.test(e.code)) k = e.code.slice(6);
	else if (e.code === "Space") k = "space";
	else if (e.code === "Tab") k = "tab";
	else k = k.toLowerCase();
	parts.push(k);
	return parts.join("+");
}

export const KEYMAP: Record<string, string> = {
	v: "tool.select",
	r: "tool.rect",
	o: "tool.circle",
	l: "tool.line",
	p: "tool.poly",
	"1": "tool.select",
	"2": "tool.circle",
	"3": "tool.line",
	"4": "tool.poly",
	"5": "tool.rect",
	c: "view.collision",
	d: "edit.deform",
	e: "mesh.extrude",
	i: "mesh.inset",
	k: "mesh.loopCut",
	m: "mesh.merge",
	b: "mesh.paint",
	"shift+tab": "mesh.sculpt",
	u: "tool.pipe",
	"cmd+j": "chat.toggle",
	"cmd+s": "file.save",
	"cmd+n": "file.new",
	"cmd+o": "file.openFolder",
	"cmd+shift+o": "file.openFolder",
	"cmd+alt+c": "file.clone",
	"cmd+shift+1": "file.projects",
	"cmd+,": "app.settings",
	"cmd+z": "edit.undo",
	"cmd+shift+z": "edit.redo",
	"cmd+y": "edit.redo",
	"cmd+c": "edit.copy",
	"cmd+v": "edit.paste",
	"cmd+x": "edit.cut",
	"cmd+d": "edit.duplicate",
	"cmd+a": "edit.selectAll",
	delete: "edit.delete",
	backspace: "edit.delete",
	x: "edit.delete",
	"[": "edit.lower",
	"]": "edit.raise",
	"cmd+[": "nav.back",
	"cmd+]": "nav.forward",
	"cmd+1": "nav.assets",
	"cmd+2": "nav.outline",
	"cmd+3": "nav.search",
	"cmd+4": "nav.git",
	arrowleft: "edit.nudgeLeft",
	arrowright: "edit.nudgeRight",
	arrowup: "edit.nudgeUp",
	arrowdown: "edit.nudgeDown",
	"shift+arrowleft": "edit.nudgeLeft10",
	"shift+arrowright": "edit.nudgeRight10",
	"shift+arrowup": "edit.nudgeUp10",
	"shift+arrowdown": "edit.nudgeDown10",
	escape: "edit.escape",
	enter: "edit.enter",
	"cmd+=": "view.zoomIn",
	"cmd+-": "view.zoomOut",
	"shift+0": "view.zoom100",
	"cmd+0": "view.sidebar",
	"shift+1": "view.fit",
	"shift+2": "view.fitSelection",
	"cmd+'": "view.snapGrid",
	"cmd+b": "view.sidebar",
	"cmd+alt+0": "view.inspector",
	"cmd+shift+p": "asset.switch",
	"cmd+shift+s": "state.switch",
	"cmd+shift+n": "file.newProject",
	"cmd+i": "file.importGltf",
	"cmd+w": "file.browse",
	"cmd+k": "app.palette",
	"cmd+/": "help.keys",
	"cmd+shift+/": "help.search",
	"shift+/": "help.context",
	space: "clip.play",
};

/**
 * In a 3D view every digit is the view's, the way a numpad is in
 * Blender: 1 front, 3 right, 7 top, 9 the other side; 4 and 6 turn it a
 * step, 8 and 2 tilt it; 5 fits everything; F (or .) frames what is
 * chosen. No digit picks a tool there: the tools are on their letters.
 */
export const KEYMAP_3D: Record<string, string> = {
	"1": "view.front",
	"3": "view.right",
	"7": "view.top",
	"9": "view.flip",
	"4": "view.turnLeft",
	"6": "view.turnRight",
	"8": "view.tiltUp",
	"2": "view.tiltDown",
	"5": "view.fit",
	f: "view.frame",
	".": "view.frame",
};

/** A keymap key ("cmd+shift+z") the way a person reads it ("⌘ ⇧ Z"). */
export function prettyKey(k: string): string {
	const names: Record<string, string> = { cmd: "⌘", shift: "⇧", alt: "⌥", arrowleft: "←", arrowright: "→", arrowup: "↑", arrowdown: "↓", backspace: "⌫", delete: "⌦", escape: "Esc", enter: "Return", space: "Space" };
	// a shifted slash is a question mark, and that is how it is known
	if (k === "shift+/") return "?";
	return k
		.split("+")
		.map((p) => names[p] ?? (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)))
		.join(" ");
}

/** Pretty shortcut for a command id, from the keymap. */
export function keysFor(id: string): string | undefined {
	for (const [k, v] of Object.entries(KEYMAP)) if (v === id) return prettyKey(k);
	return undefined;
}

export interface KeyRow {
	keys: string[];
	title: string;
}
/**
 * Every shortcut that does something right now, by group: the keymap
 * (and, in a 3D view, the digits that are the view's there), less the
 * commands that do not apply to this screen.
 */
export function shortcutsNow(in3d: boolean): { group: string; rows: KeyRow[] }[] {
	const byId = new Map<string, string[]>();
	const take = (k: string, id: string) => byId.set(id, [...(byId.get(id) ?? []), prettyKey(k)]);
	for (const [k, id] of Object.entries(KEYMAP)) {
		// in 3D no digit reaches a tool
		if (in3d && /^\d$/.test(k)) continue;
		take(k, id);
	}
	if (in3d) for (const [k, id] of Object.entries(KEYMAP_3D)) take(k, id);
	const groups = new Map<string, KeyRow[]>();
	for (const [id, keys] of byId) {
		const c = registry.get(id);
		if (!c || (c.when && !c.when())) continue;
		groups.set(c.group, [...(groups.get(c.group) ?? []), { keys, title: c.title.replace(/…$/, "") }]);
	}
	const order = ["Tools", "Edit", "Mesh", "View", "Clip", "Scene", "File", "App"];
	return [...groups].sort((a, b) => (order.indexOf(a[0]) + 99) % 99 - ((order.indexOf(b[0]) + 99) % 99)).map(([group, rows]) => ({ group, rows }));
}
