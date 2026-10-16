// Appearance: light and dark, one token set each (tokens.css). The
// stylesheet defines every colour as a variable and overrides it per
// [data-theme]; the canvas reads the same variables, so the grid,
// selection and handles follow the panels. "system" follows the OS, and
// is the default; a choice persists per device.

import { signal } from "@preact/signals";

export type Appearance = "light" | "dark";
export const SYSTEM = "system";
const KEY = "fastart.theme";

export const theme = {
	/** what the user picked: "light", "dark", or "system" */
	choice: signal<string>(SYSTEM),
	/** the appearance actually on the page */
	applied: signal<Appearance>("dark"),
	/** bumps whenever the palette changes, so canvases redraw */
	rev: signal(0),
};

const lightQuery = () => window.matchMedia("(prefers-color-scheme: light)");

function apply() {
	const c = theme.choice.value;
	const id: Appearance = c === "light" || c === "dark" ? c : lightQuery().matches ? "light" : "dark";
	document.documentElement.dataset.theme = id;
	theme.applied.value = id;
	colorCache = null;
	theme.rev.value++;
}

export function setTheme(id: string) {
	theme.choice.value = id;
	try {
		localStorage.setItem(KEY, id);
	} catch {
		// a private window, or storage turned off: the choice lasts the session
	}
	apply();
}

/** The sun/moon button: the other appearance, pinned. */
export function toggleAppearance() {
	setTheme(theme.applied.value === "light" ? "dark" : "light");
}

export function initTheme() {
	try {
		const saved = localStorage.getItem(KEY);
		// the themes of old (graphite, paper, …) fall back to the system's
		if (saved === "light" || saved === "dark") theme.choice.value = saved;
	} catch {
		// see above
	}
	apply();
	lightQuery().addEventListener("change", () => {
		if (theme.choice.value === SYSTEM) apply();
	});
}

export function isLight(): boolean {
	return theme.applied.value === "light";
}

/** What the canvas paints with: the stylesheet's tokens, read once per theme. */
export interface CanvasColors {
	bg: string;
	grid: string;
	gridStrong: string;
	accent: string;
	accentSoft: string;
	hover: string;
	handleFill: string;
	ok: string;
	text2: string;
	text3: string;
	marquee: string;
	/** what a sculpting mask holds, laid dark over the faces */
	mask: string;
	/** the world's axes, for gizmos: always drawn with their letter */
	axisX: string;
	axisY: string;
	axisZ: string;
	/** outline weight, in pixels: 1 normally, more for high contrast */
	line: number;
}

let colorCache: CanvasColors | null = null;

export function canvasColors(): CanvasColors {
	if (colorCache) return colorCache;
	const cs = getComputedStyle(document.documentElement);
	const v = (name: string) => cs.getPropertyValue(name).trim();
	colorCache = {
		bg: v("--bg-canvas"),
		grid: v("--canvas-grid"),
		gridStrong: v("--canvas-grid-major"),
		accent: v("--accent"),
		accentSoft: v("--accent-line"),
		hover: v("--canvas-hover"),
		handleFill: v("--bg-raised"),
		ok: v("--pivot"),
		text2: v("--text-secondary"),
		text3: v("--canvas-origin"),
		marquee: v("--accent-dim"),
		mask: v("--canvas-mask"),
		axisX: v("--axis-x"),
		axisY: v("--axis-y"),
		axisZ: v("--axis-z"),
		line: parseFloat(v("--line")) || 1,
	};
	return colorCache;
}
