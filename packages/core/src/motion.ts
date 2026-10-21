// Motion as numbers: a clip (or a state) sampled into where every joint
// and anchor is in the world, 2D and 3D alike (a 2D point has z = 0).
// What `fart render` draws its overlays from and `fart check-clip`
// measures; the targets are reached at every sample, as a runtime would.

import type { Clip, Clip3, Doc, Doc3, StatePart, StatePart3, Vec2, Vec3 } from "./types.ts";
import { as3d } from "./types.ts";
import { anchorsOf, partOf, pivotOf, stateOf, worldTransforms, type Xf } from "./geometry.ts";
import { clipDuration, keyPoses, keyTargets, sampleClip, sampleTargets } from "./clips.ts";
import { solveTargets } from "./ik.ts";
import { anchorsOf3, clipDuration3, keyPoses3, keyTargets3, partOf3, pivotOf3, sampleClip3, sampleTargets3, stateOf3, worldTransforms3, xf3Apply, type Xf3 } from "./space3.ts";
import { solveTargets3 } from "./ik3.ts";

/** One instant of a document: the poses, and where they put things. */
export interface Sample {
	t: number;
	/** the pose list (2D or 3D entries), targets reached */
	poses: StatePart[] | StatePart3[];
	/** the parts drawn, in paint order */
	parts: string[];
	/** each part's pivot in the world */
	joints: Map<string, Vec3>;
	/** each part's world orientation, 3×3 row-major, scale divided out */
	rot: Map<string, number[]>;
	/** each part's world scale */
	scale: Map<string, number>;
	/** each part's world map flips handedness (a mirror) */
	flipped: Map<string, boolean>;
	/** every anchor in the world, by "part/anchor" */
	anchors: Map<string, Vec3>;
}

export type AnyClip = Clip | Clip3;

/** The clip named, or null. */
export function clipOf(doc: Doc | Doc3, name: string): AnyClip | null {
	return (doc.clips as AnyClip[] | undefined)?.find((c) => c.name === name) ?? null;
}

export function durationOf(doc: Doc | Doc3, clip: AnyClip): number {
	return as3d(doc) ? clipDuration3(clip as Clip3) : clipDuration(clip as Clip);
}

/** The poses at time t with the targets reached. */
export function posesAt(doc: Doc | Doc3, clip: AnyClip, t: number): StatePart[] | StatePart3[] {
	const d3 = as3d(doc);
	if (d3) {
		const poses = sampleClip3(d3, clip as Clip3, t);
		const tg = sampleTargets3(d3, clip as Clip3, t);
		if (tg.length) solveTargets3(d3, poses, tg);
		return poses;
	}
	const d = doc as Doc;
	const poses = sampleClip(d, clip as Clip, t);
	const tg = sampleTargets(d, clip as Clip, t);
	if (tg.length) solveTargets(d, poses, tg);
	return poses;
}

/** A key's own poses with its targets reached (not the tween into it). */
export function keyFrame(doc: Doc | Doc3, clip: AnyClip, i: number): StatePart[] | StatePart3[] {
	const d3 = as3d(doc);
	if (d3) {
		const key = (clip as Clip3).keys[i];
		const poses = keyPoses3(d3, key).map((sp) => ({ ...sp }));
		const tg = keyTargets3(d3, key);
		if (tg.length) solveTargets3(d3, poses, tg);
		return poses;
	}
	const key = (clip as Clip).keys[i];
	const poses = keyPoses(doc as Doc, key).map((sp) => ({ ...sp }));
	const tg = keyTargets(doc as Doc, key);
	if (tg.length) solveTargets(doc as Doc, poses, tg);
	return poses;
}

/** A state's poses with its targets reached; null when there is no such state. */
export function statePoses(doc: Doc | Doc3, name: string): StatePart[] | StatePart3[] | null {
	const d3 = as3d(doc);
	if (d3) {
		const st = stateOf3(d3, name);
		if (!st) return null;
		const poses = st.parts.map((sp) => ({ ...sp }));
		if (st.targets?.length) solveTargets3(d3, poses, st.targets);
		return poses;
	}
	const st = stateOf(doc as Doc, name);
	if (!st) return null;
	const poses = st.parts.map((sp) => ({ ...sp }));
	if (st.targets?.length) solveTargets(doc as Doc, poses, st.targets);
	return poses;
}

/** Where a pose list (or the rest pose: undefined) puts every joint and anchor. */
export function measure(doc: Doc | Doc3, poses: StatePart[] | StatePart3[] | undefined, t = 0): Sample {
	const d3 = as3d(doc);
	const s: Sample = { t, poses: poses ?? [], parts: [], joints: new Map(), rot: new Map(), scale: new Map(), flipped: new Map(), anchors: new Map() };
	const allParts = (doc.parts ?? []) as { name: string }[];
	s.parts = poses ? (poses as { part: string }[]).map((sp) => sp.part) : allParts.map((p) => p.name);
	if (d3) {
		const W = worldTransforms3(d3, poses as StatePart3[] | undefined);
		for (const p of d3.parts ?? []) {
			const w = W.get(p.name);
			if (!w) continue;
			s.joints.set(p.name, xf3Apply(w, pivotOf3(p)));
			const { rot, scale, flipped } = orient3(w);
			s.rot.set(p.name, rot);
			s.scale.set(p.name, scale);
			s.flipped.set(p.name, flipped);
			for (const a of anchorsOf3(d3, p)) s.anchors.set(`${p.name}/${a.name}`, xf3Apply(w, a.at));
		}
		return s;
	}
	const d = doc as Doc;
	const W = worldTransforms(d, poses as StatePart[] | undefined);
	for (const p of d.parts ?? []) {
		const w = W.get(p.name);
		if (!w) continue;
		s.joints.set(p.name, z0(apply(w, pivotOf(p))));
		const { rot, scale, flipped } = orient2(w);
		s.rot.set(p.name, rot);
		s.scale.set(p.name, scale);
		s.flipped.set(p.name, flipped);
		for (const a of anchorsOf(d, p)) s.anchors.set(`${p.name}/${a.name}`, z0(apply(w, a.at)));
	}
	return s;
}

/** The clip at time t, measured. */
export function sampleAt(doc: Doc | Doc3, clip: AnyClip, t: number): Sample {
	return measure(doc, posesAt(doc, clip, t), t);
}

/**
 * Times across a clip: n of them, evenly; a loop leaves out its end (it
 * is the start again), a one-shot includes both ends.
 */
export function clipTimes(doc: Doc | Doc3, clip: AnyClip, n: number): number[] {
	const dur = durationOf(doc, clip);
	if (n <= 1 || dur <= 0) return [0];
	const out: number[] = [];
	if (clip.loop) for (let i = 0; i < n; i++) out.push((dur * i) / n);
	else for (let i = 0; i < n; i++) out.push((dur * i) / (n - 1));
	return out.map((t) => Math.round(t * 1e4) / 1e4);
}

/** The key whose time this is (within half a millisecond), if any. */
export function keyAt(clip: AnyClip, t: number): number {
	return clip.keys.findIndex((k) => Math.abs(k.t - t) < 5e-4);
}

/** Does the span holding time t end in a `step` key (a cut, on purpose)? */
export function stepSpan(clip: AnyClip, t: number): boolean {
	const keys = clip.keys;
	for (let i = 0; i + 1 < keys.length; i++) if (t >= keys[i].t && t <= keys[i + 1].t) return keys[i + 1].ease === "step";
	return false;
}

/** The anchors a clip's motion is best followed by: the chains' ends, else every anchor. */
export function defaultTracks(doc: Doc | Doc3, max = 6): string[] {
	const ends = (doc.constraints ?? []).map((c) => c.end).filter((e) => e.includes("/"));
	if (ends.length) return [...new Set(ends)].slice(0, max);
	const out: string[] = [];
	const d3 = as3d(doc);
	for (const p of (doc.parts ?? []) as { name: string }[]) {
		const anchors = d3 ? anchorsOf3(d3, partOf3(d3, p.name)!) : anchorsOf(doc as Doc, partOf(doc as Doc, p.name)!);
		for (const a of anchors) out.push(`${p.name}/${a.name}`);
	}
	return out.slice(0, max);
}

/** The parent of each part that has one. */
export function parentsOf(doc: Doc | Doc3): Map<string, string> {
	const names = new Set(((doc.parts ?? []) as { name: string }[]).map((p) => p.name));
	const out = new Map<string, string>();
	for (const p of (doc.parts ?? []) as { name: string; parent?: string }[]) if (p.parent && names.has(p.parent)) out.set(p.name, p.parent);
	return out;
}

/** The angle between two orientations, radians (0..π). */
export function turnBetween(a: number[], b: number[]): number {
	// trace(Aᵀ B) = 1 + 2 cos θ
	let tr = 0;
	for (let i = 0; i < 9; i++) tr += a[i] * b[i];
	return Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2)));
}

export const dist3 = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function apply(T: Xf, p: Vec2): Vec2 {
	return [T[0] * p[0] + T[2] * p[1] + T[4], T[1] * p[0] + T[3] * p[1] + T[5]];
}
const z0 = (p: Vec2): Vec3 => [p[0], p[1], 0];

function orient2(T: Xf): { rot: number[]; scale: number; flipped: boolean } {
	const det = T[0] * T[3] - T[1] * T[2];
	const scale = Math.sqrt(Math.abs(det)) || 1;
	const [a, b, c, d] = [T[0] / scale, T[1] / scale, T[2] / scale, T[3] / scale];
	return { rot: [a, c, 0, b, d, 0, 0, 0, 1], scale, flipped: det < 0 };
}

function orient3(T: Xf3): { rot: number[]; scale: number; flipped: boolean } {
	const m = T.slice(0, 9);
	const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
	const scale = Math.cbrt(Math.abs(det)) || 1;
	return { rot: m.map((x) => x / scale), scale, flipped: det < 0 };
}
