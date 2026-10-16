// General art style, a .gas file (see spec/DIRECTION.md): a small JSON document
// at a project's root that says what its art is like, so every asset
// made after it belongs with the others. Read merged (`extends`
// resolved, `classes` laid over), linted against assets with a fixed
// list of checks, and used for the defaults a new asset starts from.

import type { Doc, Doc3 } from "./types.ts";

/** The file extension. One place to change if the name changes. */
export const DIRECTION_EXT = ".gas";
/** The file a project's direction lives in, at its root. */
export const DIRECTION_FILE = `style${DIRECTION_EXT}`;

export interface DirectionRule {
	say: string;
	/** a named check with its arguments; see CHECKS */
	check?: string;
	/** the check's arguments, by name */
	args?: Record<string, unknown>;
}

export interface Direction {
	version: 1;
	name?: string;
	extends?: string[];
	about?: string;
	palette_refs?: string[];
	roles?: Record<string, string>;
	scale?: { unit?: string; sizes?: Record<string, [number, number]> };
	line?: { outline?: number; where?: string };
	shapes?: { kinds?: string[]; corners?: string; budget?: Record<string, number> };
	light?: { light?: [number, number, number]; ambient?: number; bands?: number; shade?: string };
	motion?: { ease?: string; idle?: [number, number]; names?: string[]; max?: number };
	names?: { parts?: string; states?: string; pattern?: string };
	references?: { file: string; for: string }[];
	rules?: DirectionRule[];
	avoid?: string[];
	classes?: Record<string, Partial<Direction>>;
	meta?: Record<string, unknown>;
	[extra: string]: unknown;
}

const LISTS = new Set(["extends", "palette_refs", "references", "rules", "avoid"]);

/** Lay `over` on `base`: later keys win, lists append, objects merge one level down. */
export function mergeDirection(base: Partial<Direction>, over: Partial<Direction>): Direction {
	const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
	for (const [k, v] of Object.entries(over)) {
		if (v === undefined) continue;
		const b = out[k];
		if (LISTS.has(k) && Array.isArray(v) && Array.isArray(b)) out[k] = [...b, ...v];
		else if (k === "classes" && b && typeof b === "object" && v && typeof v === "object") {
			const merged: Record<string, unknown> = { ...(b as Record<string, unknown>) };
			for (const [cn, cv] of Object.entries(v as Record<string, Partial<Direction>>)) merged[cn] = mergeDirection(((b as Record<string, Partial<Direction>>)[cn] ?? {}) as Partial<Direction>, cv);
			out[k] = merged;
		} else if (v && typeof v === "object" && !Array.isArray(v) && b && typeof b === "object" && !Array.isArray(b)) out[k] = { ...(b as object), ...(v as object) };
		else out[k] = v;
	}
	out.version = 1;
	return out as Direction;
}

/** The direction for one class of asset: the project's, with the class's overrides laid on. */
export function directionFor(d: Direction, cls?: string): Direction {
	if (!cls || !d.classes?.[cls]) return d;
	const { classes: _c, ...base } = d;
	void _c;
	return mergeDirection(base, d.classes[cls]);
}

/**
 * Load a direction with its `extends` chain resolved, nearest last
 * (so the file itself wins). `read` fetches a file by the path as
 * written, relative to the file naming it; it returns null when a file
 * cannot be read, which is reported, not fatal.
 */
export async function loadDirection(text: string, read: (ref: string) => Promise<string | null>, seen: string[] = []): Promise<{ direction: Direction; unresolved: string[]; errors: string[] }> {
	const unresolved: string[] = [];
	const errors: string[] = [];
	let raw: Partial<Direction>;
	try {
		raw = JSON.parse(text) as Partial<Direction>;
	} catch {
		return { direction: { version: 1 }, unresolved, errors: ["not JSON"] };
	}
	let acc: Direction = { version: 1 };
	for (const ref of raw.extends ?? []) {
		if (seen.includes(ref)) {
			errors.push(`extends loops through ${ref}`);
			continue;
		}
		const t = await read(ref);
		if (t === null) {
			unresolved.push(ref);
			continue;
		}
		const sub = await loadDirection(t, (r) => read(joinRef(ref, r)), [...seen, ref]);
		unresolved.push(...sub.unresolved.map((u) => joinRef(ref, u)));
		errors.push(...sub.errors);
		acc = mergeDirection(acc, sub.direction);
	}
	const { extends: _e, ...own } = raw;
	void _e;
	return { direction: mergeDirection(acc, own), unresolved, errors };
}

function joinRef(from: string, ref: string): string {
	if (ref.startsWith("/")) return ref;
	const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
	const segs = (dir ? dir + "/" + ref : ref).split("/");
	const out: string[] = [];
	for (const s of segs) {
		if (s === "..") out.pop();
		else if (s !== "." && s !== "") out.push(s);
	}
	return out.join("/");
}

/** The fields of a new document a direction fills in. */
export function directionDefaults(d: Direction, cls?: string): Partial<Doc> {
	const dd = directionFor(d, cls);
	const out: Partial<Doc> = {};
	if (dd.palette_refs?.length) out.palette_refs = [...dd.palette_refs];
	return out;
}

export interface Lint {
	code: string;
	path: string;
	message: string;
	rule?: string;
}

/** What a lint sees of an asset: counts the checks compare. */
function facts(doc: Doc | Doc3) {
	const d = doc as Doc & Doc3;
	const parts = (d.parts ?? []) as { name: string; like?: string; shapes?: { kind: string; color?: string; w?: number; points?: unknown[]; faces?: unknown[]; smooth?: number }[] }[];
	const shapes = parts.flatMap((p) => p.shapes ?? []);
	const faces = shapes.reduce((a, s) => a + (s.faces?.length ?? 0), 0);
	const points = shapes.reduce((a, s) => a + (s.points?.length ?? 0), 0);
	const kinds = new Set(shapes.map((s) => s.kind));
	const colors = new Set(shapes.map((s) => s.color).filter((c): c is string => !!c));
	const clips = (d.clips ?? []) as { name: string; keys: { t: number }[] }[];
	const longest = clips.reduce((a, c) => Math.max(a, c.keys[c.keys.length - 1]?.t ?? 0), 0);
	return { parts, shapes, faces, points, kinds, colors, clips, longest, states: (d.states ?? []) as { name: string }[], palette: (d.palette ?? []) as { name: string; rgb: number[] }[], refs: d.palette_refs ?? [], smooth: Math.max(0, ...shapes.map((s) => s.smooth ?? 0)) };
}

/**
 * The fixed checks a rule may name, each with its arguments. A linter
 * runs them against an asset and reports what fails; every one is a
 * yes-or-no question, as the art-bible advice has it.
 */
export const CHECKS: Record<string, { args: string; test: (f: ReturnType<typeof facts>, args: Record<string, unknown>, doc: Doc | Doc3) => string | null }> = {
	"palette.refs": { args: "{file}", test: (f, a) => (f.refs.some((r) => r.endsWith(String(a.file))) ? null : `does not link ${String(a.file)}`) },
	"palette.max": { args: "{n}", test: (f, a) => (f.palette.length <= Number(a.n) ? null : `${f.palette.length} colours of its own, more than ${String(a.n)}`) },
	"palette.only": { args: "{}", test: (f) => (f.refs.length && f.palette.length ? `has ${f.palette.length} colours of its own beside its palette refs` : null) },
	"token.never": { args: "{rgb: [r,g,b]}", test: (f, a) => { const want = a.rgb as number[]; const hit = f.palette.find((t) => t.rgb.slice(0, 3).every((x, i) => x === want[i])); return hit ? `${hit.name} is ${want.join(",")}` : null; } },
	"shapes.max": { args: "{n}", test: (f, a) => (f.shapes.length <= Number(a.n) ? null : `${f.shapes.length} shapes, more than ${String(a.n)}`) },
	"points.max": { args: "{n}", test: (f, a) => (f.points <= Number(a.n) ? null : `${f.points} points, more than ${String(a.n)}`) },
	"faces.max": { args: "{n}", test: (f, a) => (f.faces <= Number(a.n) ? null : `${f.faces} faces, more than ${String(a.n)}`) },
	"kinds.only": { args: "{kinds: [...]}", test: (f, a) => { const ok = new Set(a.kinds as string[]); const bad = [...f.kinds].filter((k) => !ok.has(k)); return bad.length ? `uses ${bad.join(", ")}` : null; } },
	"smooth.max": { args: "{n}", test: (f, a) => (f.smooth <= Number(a.n) ? null : `smooth ${f.smooth}, more than ${String(a.n)}`) },
	"clip.max": { args: "{seconds}", test: (f, a) => (f.longest <= Number(a.seconds) ? null : `a clip runs ${f.longest}s, longer than ${String(a.seconds)}`) },
	"states.has": { args: "{names: [...]}", test: (f, a) => { const have = new Set(f.states.map((s) => s.name)); const miss = (a.names as string[]).filter((n) => !have.has(n)); return miss.length ? `missing states ${miss.join(", ")}` : null; } },
	"names.match": { args: "{pattern}", test: (f, a) => { const re = new RegExp(String(a.pattern)); const bad = [...f.parts.map((p) => p.name), ...f.states.map((s) => s.name), ...f.clips.map((c) => c.name)].filter((n) => !re.test(n)); return bad.length ? `names off the pattern: ${bad.slice(0, 5).join(", ")}` : null; } },
	"line.width": { args: "{w, tolerance?}", test: (f, a) => { const w = Number(a.w); const tol = Number(a.tolerance ?? 0.05); const bad = f.shapes.filter((s) => (s.kind === "line" || (s.kind === "path" && s.w !== undefined)) && Math.abs((s.w ?? 0) - w) > tol); return bad.length ? `${bad.length} strokes off the line width ${w}` : null; } },
	"size.within": { args: "{min, max}", test: (f, a, doc) => { const b = boundsOf(doc); if (!b) return null; const s = Math.max(b[2] - b[0], b[3] - b[1]); return s < Number(a.min) || s > Number(a.max) ? `${s.toFixed(1)} units across, outside ${String(a.min)}–${String(a.max)}` : null; } },
};

function boundsOf(doc: Doc | Doc3): [number, number, number, number] | null {
	let lo = [Infinity, Infinity];
	let hi = [-Infinity, -Infinity];
	let any = false;
	for (const p of (doc.parts ?? []) as { shapes?: { points?: number[][]; at?: number[]; r?: number; a?: number[]; b?: number[] }[] }[]) {
		for (const s of p.shapes ?? []) {
			const pts: number[][] = s.points ?? (s.at ? [[s.at[0] - (s.r ?? 0), s.at[1] - (s.r ?? 0)], [s.at[0] + (s.r ?? 0), s.at[1] + (s.r ?? 0)]] : s.a && s.b ? [s.a, s.b] : []);
			for (const q of pts) {
				any = true;
				lo = [Math.min(lo[0], q[0]), Math.min(lo[1], q[1])];
				hi = [Math.max(hi[0], q[0]), Math.max(hi[1], q[1])];
			}
		}
	}
	return any ? [lo[0], lo[1], hi[0], hi[1]] : null;
}

/** The class an asset belongs to: meta.class, else the first folder of its path. */
export function classOf(doc: Doc | Doc3, rel?: string): string | undefined {
	const m = (doc.meta as { class?: unknown } | undefined)?.class;
	if (typeof m === "string") return m;
	if (rel && rel.includes("/")) return rel.split("/")[0].replace(/s$/, "");
	return undefined;
}

/** Lint one asset against a direction: the rules' checks and the numeric sections. Advisory. */
export function lintDirection(direction: Direction, doc: Doc | Doc3, rel?: string): Lint[] {
	const cls = classOf(doc, rel);
	const d = directionFor(direction, cls);
	const f = facts(doc);
	const out: Lint[] = [];
	const budget = d.shapes?.budget?.[cls ?? ""] ?? d.shapes?.budget?.["*"];
	if (budget !== undefined && f.shapes.length > budget) out.push({ code: "direction.budget", path: "/parts", message: `${f.shapes.length} shapes; the ${cls ?? "default"} budget is ${budget}` });
	if (d.shapes?.kinds) {
		const ok = new Set(d.shapes.kinds);
		const bad = [...f.kinds].filter((k) => !ok.has(k));
		if (bad.length) out.push({ code: "direction.kinds", path: "/parts", message: `uses ${bad.join(", ")}; the direction allows ${d.shapes.kinds.join(", ")}` });
	}
	if (d.motion?.max !== undefined && f.longest > d.motion.max) out.push({ code: "direction.motion", path: "/clips", message: `a clip runs ${f.longest}s; the direction's longest is ${d.motion.max}s` });
	if (d.names?.pattern) {
		const re = new RegExp(d.names.pattern);
		const bad = f.parts.map((p) => p.name).filter((n) => !re.test(n));
		if (bad.length) out.push({ code: "direction.names", path: "/parts", message: `part names off ${d.names.pattern}: ${bad.slice(0, 5).join(", ")}` });
	}
	if (d.palette_refs?.length) {
		const missing = d.palette_refs.filter((r) => !f.refs.some((x) => x.endsWith(r.split("/").pop() ?? r)));
		if (missing.length) out.push({ code: "direction.palette", path: "/palette_refs", message: `does not link ${missing.join(", ")}` });
	}
	if (d.scale?.sizes && cls && d.scale.sizes[cls]) {
		const [lo, hi] = d.scale.sizes[cls];
		const b = boundsOf(doc);
		if (b) {
			const s = Math.max(b[2] - b[0], b[3] - b[1]);
			if (s < lo || s > hi) out.push({ code: "direction.scale", path: "/parts", message: `${s.toFixed(1)} units across; a ${cls} is ${lo}–${hi}` });
		}
	}
	for (const r of d.rules ?? []) {
		if (!r.check) continue;
		const c = CHECKS[r.check];
		if (!c) {
			out.push({ code: "direction.rule", path: "/", message: `unknown check ${r.check} in rule "${r.say}"`, rule: r.say });
			continue;
		}
		const why = c.test(f, r.args ?? {}, doc);
		if (why) out.push({ code: "direction.rule", path: "/", message: `${r.say}: ${why}`, rule: r.say });
	}
	return out;
}

/** Structure of a direction file: the errors a validator reports (the schema says the rest). */
export function validateDirection(raw: unknown): string[] {
	const errs: string[] = [];
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return ["a direction is a JSON object"];
	const d = raw as Record<string, unknown>;
	if (d.version !== 1) errs.push("version is 1");
	for (const k of ["extends", "palette_refs", "avoid"]) if (k in d && !(Array.isArray(d[k]) && (d[k] as unknown[]).every((x) => typeof x === "string"))) errs.push(`${k} is a list of strings`);
	if ("references" in d) {
		if (!Array.isArray(d.references)) errs.push("references is a list of {file, for}");
		else (d.references as unknown[]).forEach((r, i) => { if (!r || typeof r !== "object" || typeof (r as { file?: unknown }).file !== "string") errs.push(`references/${i} needs a file`); });
	}
	if ("rules" in d) {
		if (!Array.isArray(d.rules)) errs.push("rules is a list of {say, check?, args?}");
		else (d.rules as unknown[]).forEach((r, i) => {
			if (!r || typeof r !== "object" || typeof (r as { say?: unknown }).say !== "string") errs.push(`rules/${i} needs a say`);
			else if ((r as { check?: unknown }).check !== undefined && !(typeof (r as { check?: unknown }).check === "string" && (r as { check: string }).check in CHECKS)) errs.push(`rules/${i}: unknown check ${String((r as { check?: unknown }).check)} (one of ${Object.keys(CHECKS).join(", ")})`);
		});
	}
	for (const k of ["roles", "classes"]) if (k in d && (!d[k] || typeof d[k] !== "object" || Array.isArray(d[k]))) errs.push(`${k} is an object`);
	if ("light" in d) {
		const l = d.light as { light?: unknown; ambient?: unknown };
		if (l && typeof l === "object") {
			if (l.light !== undefined && !(Array.isArray(l.light) && l.light.length === 3)) errs.push("light.light is [x, y, z]");
			if (l.ambient !== undefined && (typeof l.ambient !== "number" || l.ambient < 0 || l.ambient > 1)) errs.push("light.ambient is 0–1");
		} else errs.push("light is an object");
	}
	return errs;
}
