// Help, in context. The guide (docs/guide.md) is the one source: each of
// its sections is a topic, and this says which topics answer where the
// person is: the screen, and what is chosen on it. The inspector's Help
// tab shows those; a "?" elsewhere (the launcher, settings, Ask) opens
// its topics in a sheet. Every topic must be reachable from a context or
// a "?" (uncovered() says which are not; the workspace test checks it).

import { signal } from "@preact/signals";
import guide from "../docs/guide.md?raw";
import { project } from "./project.ts";
import { ed } from "./editor.ts";
import { md } from "./model.ts";
import { sc } from "./scene.ts";

export interface Topic {
	id: string;
	title: string;
	md: string;
}

const slug = (title: string) =>
	title
		.split(/[:,]/)[0]
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");

/** The guide, cut at its second-level headings; what comes before the first is the introduction. */
export const TOPICS: Topic[] = (() => {
	const out: Topic[] = [];
	const [intro, ...rest] = guide.split(/^## /m);
	out.push({ id: "uranus", title: "Uranus", md: intro.replace(/^# .*\n/, "").trim() });
	for (const part of rest) {
		const nl = part.indexOf("\n");
		const title = part.slice(0, nl).trim();
		out.push({ id: slug(title), title, md: part.slice(nl + 1).trim() });
	}
	return out;
})();

export const topic = (id: string): Topic | undefined => TOPICS.find((t) => t.id === id);

/** Where the person can be, and the topics that answer it, most to the point first. */
export const CONTEXTS: Record<string, string[]> = {
	browse: ["projects", "the-project-s-direction", "the-panels", "files-a-tool-refused", "serve"],
	"2d.document": ["the-editor", "the-inspector", "generated-assets", "colours", "textures", "glow", "saving-is-a-checkpoint"],
	"2d.shape": ["the-editor", "colours", "shade", "textures", "clipboard-and-keys"],
	"2d.part": ["parts-and-the-outline", "rigs", "states", "mirror-and-reuse", "sockets", "chains", "pinned-reach"],
	"2d.clip": ["clips", "events-and-curves", "states"],
	"2d.collision": ["the-collision-lens", "the-editor"],
	palette: ["colours", "glow"],
	"3d.document": ["3d-models", "the-inspector", "generated-assets", "colours", "textures", "saving-is-a-checkpoint"],
	"3d.shape": ["3d-models", "shade", "textures", "colours"],
	"3d.part": ["3d-models", "rigs", "states", "mirror-and-reuse"],
	"3d.clip": ["clips", "events-and-curves", "3d-models"],
	"3d.collision": ["the-collision-lens", "3d-models"],
	scene: ["scenes", "saving-is-a-checkpoint"],
};

/** What each "?" outside the inspector opens. */
export const BUTTONS: Record<string, string[]> = {
	launcher: ["uranus", "projects"],
	settings: ["setup", "appearance", "updates"],
	ask: ["ask-claude"],
	sourceControl: ["projects", "saving-is-a-checkpoint"],
};

const NAMES: Record<string, string> = {
	browse: "The asset browser",
	"2d.document": "A 2D asset",
	"2d.shape": "A shape",
	"2d.part": "A part",
	"2d.clip": "A clip",
	"2d.collision": "The collision lens",
	palette: "A palette",
	"3d.document": "A 3D model",
	"3d.shape": "A solid",
	"3d.part": "A part of a model",
	"3d.clip": "A clip",
	"3d.collision": "Collision solids",
	scene: "A scene",
};

/** The context now: its key and its name. Reads the stores, so a component that calls it follows them. */
export function contextNow(): { key: string; name: string } {
	const s = project.screen.value;
	let key = "browse";
	if (s === "edit") {
		if (ed.isPalette.value) key = "palette";
		else if (ed.collide.value) key = "2d.collision";
		else if (ed.curClip.value >= 0) key = "2d.clip";
		else if (ed.sel.value.length) key = "2d.shape";
		else if (ed.partPicked.value) key = "2d.part";
		else key = "2d.document";
	} else if (s === "model") {
		if (md.collide.value) key = "3d.collision";
		else if (md.curClip.value >= 0) key = "3d.clip";
		else if (md.sel.value) key = "3d.shape";
		else if (md.partPicked.value) key = "3d.part";
		else key = "3d.document";
	} else if (s === "scene") key = "scene";
	void sc.sel.value;
	return { key, name: NAMES[key] };
}

/** The topics no context and no "?" leads to. Empty is the rule. */
export function uncovered(): string[] {
	const seen = new Set([...Object.values(CONTEXTS).flat(), ...Object.values(BUTTONS).flat()]);
	return TOPICS.map((t) => t.id).filter((id) => !seen.has(id));
}
/** Ids a context or a "?" names that the guide does not have: a heading was renamed. */
export function dangling(): string[] {
	return [...new Set([...Object.values(CONTEXTS).flat(), ...Object.values(BUTTONS).flat()])].filter((id) => !topic(id));
}

/** The common questions, as the Help menu groups them. */
export const CATEGORIES: { id: string; title: string; topics: string[] }[] = [
	{ id: "start", title: "Getting started", topics: ["uranus", "projects", "the-editor", "the-panels", "saving-is-a-checkpoint"] },
	{ id: "draw", title: "Drawing and shapes", topics: ["the-editor", "parts-and-the-outline", "the-inspector", "clipboard-and-keys"] },
	{ id: "colour", title: "Colours and textures", topics: ["colours", "textures", "shade", "glow"] },
	{ id: "rig", title: "Rigging and animation", topics: ["rigs", "states", "clips", "events-and-curves", "mirror-and-reuse", "sockets", "chains", "pinned-reach"] },
	{ id: "3d", title: "3D models", topics: ["3d-models", "shade", "textures"] },
	{ id: "scenes", title: "Scenes", topics: ["scenes"] },
	{ id: "game", title: "Collision and games", topics: ["the-collision-lens", "sockets", "events-and-curves", "serve"] },
	{ id: "project", title: "Projects, files and setup", topics: ["projects", "the-project-s-direction", "generated-assets", "saving-is-a-checkpoint", "files-a-tool-refused", "setup", "ask-claude", "appearance", "updates"] },
];

export interface Hit {
	id: string;
	title: string;
	/** the words around the first match, for the result's second line */
	snippet: string;
}
const plain = (md: string) =>
	md
		.replace(/`([^`]*)`/g, "$1")
		.replace(/\*\*([^*]*)\*\*/g, "$1")
		.replace(/[*_>#|]/g, "")
		.replace(/\s+/g, " ");

/** Topics that hold every word of the query; a match in the title comes first. */
export function searchHelp(query: string): Hit[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (!words.length) return [];
	const out: (Hit & { rank: number })[] = [];
	for (const t of TOPICS) {
		const title = t.title.toLowerCase();
		const text = plain(t.md);
		const low = text.toLowerCase();
		if (!words.every((w) => title.includes(w) || low.includes(w))) continue;
		const at = Math.max(0, ...words.map((w) => low.indexOf(w)).filter((i) => i >= 0).slice(0, 1));
		const from = Math.max(0, at - 40);
		const snippet = (from > 0 ? "…" : "") + text.slice(from, from + 130).trim() + (from + 130 < text.length ? "…" : "");
		out.push({ id: t.id, title: t.title, snippet, rank: words.every((w) => title.includes(w)) ? 0 : words.some((w) => title.includes(w)) ? 1 : 2 });
	}
	return out.sort((a, b) => a.rank - b.rank);
}

/** The help search sheet (its query), and the keyboard shortcuts sheet. */
export const helpSearch = signal<string | null>(null);
export const keysSheet = signal(false);

/** The help sheet: the topics it shows, null when shut. */
export const helpSheet = signal<string[] | null>(null);
export function openHelp(ids: string[]) {
	helpSearch.value = null;
	keysSheet.value = false;
	helpSheet.value = ids.filter((id) => topic(id));
}
