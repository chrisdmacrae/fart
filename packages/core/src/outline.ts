// What an agent reads instead of the whole file (see spec/TOOLING.md):
// the outline, a few hundred tokens for any document; the lean document,
// without the bakes a reader recomputes; and one part on its own.

import type { Doc, Doc3, Part, Part3 } from "./types.ts";

const BAKED = new Set(["tris", "bake"]);

/** The document without `tris` and `bake` (recomputed by every reader), a deep copy. */
export function leanDoc<T extends object>(doc: T): T {
	const strip = (o: unknown): unknown => {
		if (Array.isArray(o)) return o.map(strip);
		if (o && typeof o === "object") {
			const out: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(o as Record<string, unknown>)) if (!BAKED.has(k)) out[k] = strip(v);
			return out;
		}
		return o;
	};
	return strip(doc) as T;
}

/** A part by name, lean. */
export function partDoc(doc: Doc | Doc3, name: string): Part | Part3 | null {
	const p = (doc.parts as (Part | Part3)[] | undefined)?.find((x) => x.name === name);
	return p ? leanDoc(p) : null;
}

/**
 * The outline: every name the document has and the counts behind it, as
 * text a model reads in one glance. Parts as a tree with their shapes'
 * kinds, the states and which parts each poses or morphs, the clips with
 * their keys, the palette and its refs, textures, chains, collision.
 */
export function outlineDoc(doc: Doc | Doc3, rel?: string): string {
	const lines: string[] = [];
	const d = doc as Doc & Doc3;
	const space = d.space === "3d" ? "3d" : "2d";
	lines.push(`${rel ? rel + " · " : ""}${d.name ?? "untitled"} · ${space}${d.palette_refs?.length ? " · palette_refs " + d.palette_refs.join(", ") : ""}`);
	const parts = (d.parts ?? []) as (Part & Part3)[];
	const kids = new Map<string | undefined, (Part & Part3)[]>();
	for (const p of parts) {
		const key = p.parent && parts.some((q) => q.name === p.parent) ? p.parent : undefined;
		kids.set(key, [...(kids.get(key) ?? []), p]);
	}
	const shapeWord = (p: Part & Part3): string => {
		if (p.like) return `like ${p.like}`;
		const shapes = (p.shapes ?? []) as { kind: string; points?: unknown[]; smooth?: number; op?: string }[];
		if (!shapes.length) return "no shapes";
		const counts = new Map<string, number>();
		let pts = 0;
		for (const s of shapes) {
			const k = s.kind === "sweep" ? `sweep:${s.op}` : s.kind + (s.smooth ? `:smooth${s.smooth}` : "");
			counts.set(k, (counts.get(k) ?? 0) + 1);
			pts += s.points?.length ?? 0;
		}
		return `${[...counts].map(([k, n]) => (n > 1 ? `${n} ${k}` : k)).join(", ")}${pts ? ` (${pts} points)` : ""}`;
	};
	const walk = (parent: string | undefined, depth: number) => {
		for (const p of kids.get(parent) ?? []) {
			const pv = (p.pivot as number[] | undefined) ?? [];
			const anchors = (p.anchors ?? []).map((a) => a.name);
			lines.push(`${"  ".repeat(depth)}- ${p.name} [${pv.join(", ")}] ${shapeWord(p)}${anchors.length ? ` · anchors ${anchors.join(", ")}` : ""}`);
			walk(p.name, depth + 1);
		}
	};
	if (parts.length) {
		lines.push(`parts (${parts.length}):`);
		walk(undefined, 1);
	}
	const states = (d.states ?? []) as { name: string; parts: { part: string; morph?: unknown[]; rotate?: unknown; offset?: unknown }[]; targets?: unknown[] }[];
	if (states.length) {
		lines.push(`states (${states.length}):`);
		for (const s of states) {
			const posed = s.parts.filter((e) => e.rotate !== undefined || e.offset !== undefined).length;
			const morphed = s.parts.filter((e) => e.morph?.length).map((e) => e.part);
			lines.push(`  - ${s.name}: ${s.parts.length} parts${posed ? `, ${posed} posed` : ""}${morphed.length ? `, morphs ${morphed.join(", ")}` : ""}${s.targets?.length ? `, ${s.targets.length} targets` : ""}`);
		}
	}
	const clips = (d.clips ?? []) as { name: string; loop?: boolean; keys: { t: number; state?: string; events?: string[] }[] }[];
	if (clips.length) {
		lines.push(`clips (${clips.length}):`);
		for (const c of clips) {
			const last = c.keys[c.keys.length - 1]?.t ?? 0;
			const ks = c.keys.map((k) => `${k.t}:${k.state ?? "(inline)"}${k.events?.length ? "!" + k.events.join("!") : ""}`).join(" ");
			lines.push(`  - ${c.name}${c.loop ? " (loop)" : ""} ${last}s · ${ks}`);
		}
	}
	const pal = (d.palette ?? []) as { name: string; rgb: number[]; emissive?: number }[];
	if (pal.length) lines.push(`palette: ${pal.map((t) => `${t.name}=${t.rgb.join(",")}${t.emissive ? "*" : ""}`).join(" ")}`);
	const tex = (d.textures ?? []) as { name: string; maps: Record<string, unknown> }[];
	if (tex.length) lines.push(`textures: ${tex.map((t) => `${t.name}(${Object.keys(t.maps).join(",")})`).join(" ")}`);
	const chains = (d.constraints ?? []) as { name: string; chain: string[]; end: string }[];
	if (chains.length) lines.push(`chains: ${chains.map((c) => `${c.name}: ${c.chain.join(">")} → ${c.end}`).join("; ")}`);
	const col = (d.collision ?? []) as { kind: string; part?: string; layer?: string }[];
	if (col.length) lines.push(`collision: ${col.map((c) => `${c.kind}${c.part ? "@" + c.part : ""}${c.layer ? "/" + c.layer : ""}`).join(" ")}`);
	if (d.meta && Object.keys(d.meta).length) lines.push(`meta: ${Object.keys(d.meta).join(", ")}`);
	return lines.join("\n");
}
