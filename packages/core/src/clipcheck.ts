// A clip checked the way an animator would look at it, in numbers: limbs
// that change length, turns that tween the short way round (so the arm
// swings backwards), snaps between frames, knees and elbows that fold
// the other way, a loop whose seam pops, and feet that slide while they
// are on the ground, with which way the figure travels. The clip is
// sampled at a rate and every sample has its targets reached.

import type { Clip, Clip3, Doc, Doc3, StatePart, StatePart3, Vec3 } from "./types.ts";
import { as3d } from "./types.ts";
import { keyPoses } from "./clips.ts";
import { basePoints } from "./clips.ts";
import { basePoints3, keyPoses3, partOf3, quatFromEuler, shapesOf3 } from "./space3.ts";
import { clipOf, dist3, durationOf, keyFrame, measure, parentsOf, posesAt, stepSpan, turnBetween, type AnyClip, type Sample } from "./motion.ts";

export type Level = "error" | "warn" | "note";

export interface ClipFinding {
	level: Level;
	/** bone, scale, wrap, turn, snap, flip, bend, morph, seam, pop, slide, travel */
	kind: string;
	message: string;
	t?: number;
	part?: string;
}

export interface FootReport {
	anchor: string;
	/** fraction of the clip on the ground */
	duty: number;
	/** [from, to] seconds of each stretch on the ground */
	runs: [number, number][];
	/** mean ground speed while down (world units a second; 2D: signed x, 3D: |xz|) */
	speed: number;
	/** 2D: x; 3D: [x, z], the mean slide while down */
	velocity: number[];
}

export interface ClipReport {
	clip: string;
	duration: number;
	loop: boolean;
	samples: number;
	findings: ClipFinding[];
	feet: FootReport[];
	/** which way the figure travels, in words, when that can be told */
	travel?: string;
}

export interface CheckClipOptions {
	/** samples a second (default 30) */
	fps?: number;
	/** a bone may change length by this fraction (default 0.03) */
	tolerance?: number;
	/** "part/anchor"s that touch the ground (default: chain ends and anchors named like feet) */
	contacts?: string[];
	/** the ground's y (default: the lowest the contacts reach; y grows down) */
	ground?: number;
	/** how near the ground counts as on it (default 3% of the figure) */
	contactTol?: number;
	/** 2D: the way the figure faces, to tell walking from moonwalking */
	facing?: "right" | "left";
}

const FOOTY = /foot|feet|toe|heel|paw|hoof|ankle|sole|shoe|boot/i;

const r2 = (x: number) => Math.round(x * 100) / 100 + 0;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const ts = (t: number) => t.toFixed(2);

export function checkClip(doc: Doc | Doc3, clipName: string, opts: CheckClipOptions = {}): ClipReport {
	const clip = clipOf(doc, clipName);
	if (!clip) throw new Error(`no clip "${clipName}" (clips: ${(doc.clips ?? []).map((c) => c.name).join(", ") || "none"})`);
	const d3 = as3d(doc);
	const fps = opts.fps && opts.fps > 0 ? opts.fps : 30;
	const tol = opts.tolerance ?? 0.03;
	const dur = durationOf(doc, clip);
	const n = dur > 0 ? Math.max(2, Math.ceil(dur * fps)) : 1;
	const times: number[] = [];
	for (let i = 0; i <= n; i++) if (!(clip.loop && i === n && n > 1)) times.push(dur > 0 ? (dur * i) / n : 0);
	const step = dur > 0 ? dur / n : 1 / fps;
	const samples = times.map((t) => measure(doc, posesAt(doc, clip, t), t));
	const rest = measure(doc, undefined);
	const size = figureSize(rest);
	const findings: ClipFinding[] = [];
	const chainParts = new Set((doc.constraints ?? []).flatMap((c) => c.chain));
	const parents = parentsOf(doc);

	// -------------------------------------------------- bones keep their length
	const worstBone = new Map<string, { r: number; t: number; from: number; to: number }>();
	const worstScale = new Map<string, { s: number; t: number }>();
	for (const s of samples) {
		const drawn = new Set(s.parts);
		for (const [child, parent] of parents) {
			if (!drawn.has(child)) continue;
			const a0 = rest.joints.get(child)!;
			const b0 = rest.joints.get(parent)!;
			const a = s.joints.get(child)!;
			const b = s.joints.get(parent)!;
			const L0 = dist3(a0, b0);
			const L = dist3(a, b);
			// a joint on its parent's pivot: measured against the figure instead
			const r = L0 > size * 0.01 ? Math.abs(L / L0 - 1) : L / size;
			const w = worstBone.get(child);
			if (r > tol && (!w || r > w.r)) worstBone.set(child, { r, t: s.t, from: L0, to: L });
			const rel = (s.scale.get(child) ?? 1) / (s.scale.get(parent) ?? 1);
			const ws = worstScale.get(child);
			if (Math.abs(rel - 1) > tol && (!ws || Math.abs(rel - 1) > Math.abs(ws.s - 1))) worstScale.set(child, { s: rel, t: s.t });
		}
	}
	for (const [part, w] of worstBone) {
		const limb = chainParts.has(part);
		findings.push({
			level: limb ? "error" : "warn",
			kind: "bone",
			part,
			t: w.t,
			message:
				w.from > size * 0.01
					? `${part} is ${r2(w.from)} from ${parents.get(part)}'s pivot at rest, ${r2(w.to)} at t=${ts(w.t)} (${w.to > w.from ? "+" : "-"}${pct(w.r)}): an offset on a ${limb ? "limb" : "child"} stretches it; turn it instead`
					: `${part} leaves ${parents.get(part)}'s pivot by ${r2(w.to)} at t=${ts(w.t)}: an offset on a ${limb ? "limb" : "child"} detaches it`,
		});
	}
	for (const [part, w] of worstScale) {
		findings.push({ level: chainParts.has(part) ? "error" : "warn", kind: "scale", part, t: w.t, message: `${part} is scaled ${r2(w.s)}× against ${parents.get(part)} at t=${ts(w.t)}: the limb changes size` });
	}

	// -------------------------------------------------- keys: wraps, flips, pops, seam
	const keys = clip.keys;
	const posesOfKey = (i: number) => (d3 ? keyPoses3(d3, (clip as Clip3).keys[i]) : keyPoses(doc as Doc, (clip as Clip).keys[i])) as (StatePart | StatePart3)[];
	for (let i = 0; i + 1 < keys.length; i++) {
		const B = keys[i + 1];
		const pa = posesOfKey(i);
		const pb = new Map(posesOfKey(i + 1).map((sp) => [sp.part, sp]));
		const span = `keys ${i}→${i + 1} (t ${ts(keys[i].t)}→${ts(B.t)})`;
		for (const a of pa) {
			const b = pb.get(a.part);
			if (!b) {
				findings.push({ level: "note", kind: "pop", part: a.part, t: B.t, message: `${a.part} is in key ${i} but not key ${i + 1}: it holds, then vanishes at t=${ts(B.t)}` });
				continue;
			}
			if (!!a.mirror !== !!b.mirror && B.ease !== "step") findings.push({ level: "warn", kind: "pop", part: a.part, t: keys[i].t, message: `${a.part} flips its mirror across ${span}: a mirror does not tween, it holds then jumps` });
			if (B.ease === "step") continue;
			if (d3) {
				const ra = (a as StatePart3).rotate ?? [0, 0, 0];
				const rb = (b as StatePart3).rotate ?? [0, 0, 0];
				const big = [0, 1, 2].filter((k) => Math.abs(rb[k] - ra[k]) > Math.PI);
				const qa = quatFromEuler(ra);
				const qb = quatFromEuler(rb);
				const angle = 2 * Math.acos(Math.min(1, Math.abs(qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3])));
				if (big.length) findings.push({ level: "error", kind: "wrap", part: a.part, t: keys[i].t, message: `${a.part} turns ${big.map((k) => `${"xyz"[k]} ${r2(ra[k])}→${r2(rb[k])}`).join(", ")} across ${span}, more than half a turn: the tween takes the short way (${r2(angle)} rad), not the turn written. Add a key between` });
				else if (angle > 2.6) findings.push({ level: "warn", kind: "turn", part: a.part, t: keys[i].t, message: `${a.part} turns ${r2(angle)} rad across ${span}: near half a turn, which way it goes is fragile. Add a key between` });
			} else {
				const ra = (a as StatePart).rotate ?? 0;
				const rb = (b as StatePart).rotate ?? 0;
				const d = rb - ra;
				let w = d % (Math.PI * 2);
				if (w > Math.PI) w -= Math.PI * 2;
				if (w < -Math.PI) w += Math.PI * 2;
				if (Math.abs(d) > Math.PI + 1e-6) findings.push({ level: "error", kind: "wrap", part: a.part, t: keys[i].t, message: `${a.part} rotate ${r2(ra)}→${r2(rb)} across ${span} is ${r2(d)} rad, but tweens the short way: ${r2(w)} (${Math.sign(w) !== Math.sign(d) ? "the other direction" : "less far"}). Add a key between` });
				else if (Math.abs(d) > 2.6) findings.push({ level: "warn", kind: "turn", part: a.part, t: keys[i].t, message: `${a.part} rotate ${r2(ra)}→${r2(rb)} across ${span}: near half a turn, which way it goes is fragile. Add a key between` });
			}
		}
		for (const name of pb.keys()) if (!pa.some((sp) => sp.part === name)) findings.push({ level: "note", kind: "pop", part: name, t: B.t, message: `${name} is not in key ${i} but is in key ${i + 1}: it appears at t=${ts(B.t)} with no tween` });
	}
	if (clip.loop && keys.length > 1) {
		const first = measure(doc, keyFrame(doc, clip, 0), 0);
		const last = measure(doc, keyFrame(doc, clip, keys.length - 1), dur);
		const bad: string[] = [];
		for (const [name, j] of first.joints) {
			const k = last.joints.get(name);
			const ra = first.rot.get(name);
			const rb = last.rot.get(name);
			if (!k || !ra || !rb) continue;
			if (dist3(j, k) > size * 0.01 || turnBetween(ra, rb) > 0.03) bad.push(name);
		}
		if (bad.length) findings.push({ level: "warn", kind: "seam", t: dur, message: `the loop pops at its seam: the last key (t=${ts(dur)}) is not the first key's pose for ${bad.slice(0, 6).join(", ")}${bad.length > 6 ? ` and ${bad.length - 6} more` : ""}. End on the first key's state` });
	}

	// -------------------------------------------------- snaps between samples
	const maxTurn = 15 * step; // 15 rad/s
	const maxMove = 10 * size * step; // the figure's size in a tenth of a second
	const snapped = new Set<string>();
	for (let i = 0; i + 1 < samples.length; i++) {
		const a = samples[i];
		const b = samples[i + 1];
		if (stepSpan(clip, (a.t + b.t) / 2) || keys.some((k) => k.t > a.t && k.t <= b.t && k.ease === "step")) continue;
		const both = a.parts.filter((p) => b.parts.includes(p));
		for (const name of both) {
			if (snapped.has(name)) continue;
			const turn = turnBetween(a.rot.get(name)!, b.rot.get(name)!);
			const move = dist3(a.joints.get(name)!, b.joints.get(name)!);
			if (turn > maxTurn) {
				snapped.add(name);
				findings.push({ level: "warn", kind: "snap", part: name, t: a.t, message: `${name} turns ${r2(turn)} rad between t=${ts(a.t)} and ${ts(b.t)} (${Math.round(turn / step)} rad/s): a snap${chainParts.has(name) ? ", likely the chain solving to the other side" : ""}` });
			} else if (move > maxMove) {
				snapped.add(name);
				findings.push({ level: "warn", kind: "snap", part: name, t: a.t, message: `${name} jumps ${r2(move)} between t=${ts(a.t)} and ${ts(b.t)}` });
			}
		}
	}

	// -------------------------------------------------- elbows and knees fold one way
	for (const c of doc.constraints ?? []) {
		if (c.chain.length < 2) continue;
		for (let j = 1; j < c.chain.length; j++) {
			const joint = c.chain[j];
			const signs: { t: number; z: number; flipped: boolean }[] = [];
			let normalRef: Vec3 | null = null;
			for (const s of samples) {
				const p0 = s.joints.get(c.chain[j - 1]);
				const p1 = s.joints.get(joint);
				const p2 = j + 1 < c.chain.length ? s.joints.get(c.chain[j + 1]) : s.anchors.get(c.end);
				if (!p0 || !p1 || !p2) continue;
				const u: Vec3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
				const v: Vec3 = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]];
				const nrm: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
				const lu = Math.hypot(...u);
				const lv = Math.hypot(...v);
				if (lu < 1e-9 || lv < 1e-9) continue;
				const sinBend = Math.hypot(...nrm) / (lu * lv);
				if (sinBend < 0.08) continue; // straight enough that the side does not show
				let z: number;
				if (d3) {
					normalRef ??= nrm;
					z = Math.sign(nrm[0] * normalRef[0] + nrm[1] * normalRef[1] + nrm[2] * normalRef[2]);
				} else z = Math.sign(nrm[2]);
				const root = c.chain[0];
				signs.push({ t: s.t, z, flipped: !!s.flipped.get(parents.get(root) ?? root) });
			}
			const flips = signs.filter((s, i) => i > 0 && s.z !== signs[i - 1].z && s.flipped === signs[i - 1].flipped);
			if (flips.length) findings.push({ level: "warn", kind: "flip", part: joint, t: flips[0].t, message: `${c.name}: ${joint} folds the other way at t=${flips.map((f) => ts(f.t)).slice(0, 4).join(", ")} (a knee or elbow bending backwards)${c.bend ? "" : "; a bend on the constraint picks a side"}` });
			if (!d3 && c.bend && signs.length && j === c.chain.length - 1) {
				const against = signs.filter((s) => s.z !== c.bend! * (s.flipped ? -1 : 1));
				if (against.length > signs.length / 2) findings.push({ level: "warn", kind: "bend", part: joint, t: against[0].t, message: `${c.name}: ${joint} bends against the constraint's bend (${c.bend}) for ${pct(against.length / signs.length)} of the clip` });
			}
		}
	}

	// -------------------------------------------------- morphs that stretch a shape
	for (let i = 0; i < keys.length; i++) {
		for (const sp of posesOfKey(i)) {
			if (!sp.morph?.length) continue;
			for (const m of sp.morph) {
				const stretch = d3 ? meshStretch(d3, sp.part, m.shape, m.points as Vec3[]) : polyStretch(doc as Doc, sp.part, m.shape, m.points as [number, number][]);
				if (stretch > 0.35) findings.push({ level: "warn", kind: "morph", part: sp.part, t: keys[i].t, message: `${sp.part} shape ${m.shape} is morphed ${pct(stretch)} away from its edge lengths at key ${i} (t=${ts(keys[i].t)}): fine for squash, wrong for a limb` });
			}
		}
	}

	// -------------------------------------------------- feet
	const { feet, travel, found } = footwork(doc, clip, samples, rest, size, step, dur, opts, findings);
	if (!found && /walk|run|trot|gallop|jog|step|stride|sprint|hop|skip/i.test(clip.name))
		findings.push({ level: "note", kind: "slide", message: `no feet to check (a constraint end or anchor named like foot, toe, heel or paw; or pass --contact part/anchor)` });

	const order: Record<Level, number> = { error: 0, warn: 1, note: 2 };
	findings.sort((a, b) => order[a.level] - order[b.level] || (a.t ?? 0) - (b.t ?? 0));
	return { clip: clip.name, duration: dur, loop: !!clip.loop, samples: samples.length, findings, feet, travel };
}

function figureSize(rest: Sample): number {
	const pts = [...rest.joints.values(), ...rest.anchors.values()];
	if (!pts.length) return 1;
	let span = 0;
	for (let k = 0; k < 3; k++) span = Math.max(span, Math.max(...pts.map((p) => p[k])) - Math.min(...pts.map((p) => p[k])));
	return span || 1;
}

function polyStretch(doc: Doc, part: string, shape: number, pts: [number, number][]): number {
	const base = basePoints(doc, part)(shape);
	if (!base || base.length !== pts.length || base.length < 2) return 0;
	let worst = 0;
	for (let i = 0; i < base.length; i++) {
		const j = (i + 1) % base.length;
		const L0 = Math.hypot(base[j][0] - base[i][0], base[j][1] - base[i][1]);
		const L = Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]);
		if (L0 > 1e-6) worst = Math.max(worst, Math.abs(L / L0 - 1));
	}
	return worst;
}

function meshStretch(doc: Doc3, part: string, shape: number, pts: Vec3[]): number {
	const base = basePoints3(doc, part)(shape);
	const p = partOf3(doc, part);
	const sh = p ? shapesOf3(doc, p)[shape] : undefined;
	if (!base || base.length !== pts.length || !sh || sh.kind !== "mesh") return 0;
	let worst = 0;
	for (const face of sh.faces) {
		for (let k = 0; k < face.length; k++) {
			const a = face[k];
			const b = face[(k + 1) % face.length];
			const L0 = dist3(base[a], base[b]);
			const L = dist3(pts[a], pts[b]);
			if (L0 > 1e-6) worst = Math.max(worst, Math.abs(L / L0 - 1));
		}
	}
	return worst;
}

/** Which anchors touch the ground, when, how they slide while down, and which way that sends the figure. */
function footwork(doc: Doc | Doc3, clip: AnyClip, samples: Sample[], rest: Sample, size: number, step: number, dur: number, opts: CheckClipOptions, findings: ClipFinding[]): { feet: FootReport[]; travel?: string; found: boolean } {
	const d3 = as3d(doc);
	let contacts = opts.contacts ?? [];
	if (!contacts.length) {
		const ends = (doc.constraints ?? []).filter((c) => FOOTY.test(c.end) || c.chain.some((p) => /leg|shin|thigh|calf/i.test(p)) || FOOTY.test(c.name)).map((c) => c.end);
		contacts = ends.length ? ends : [...rest.anchors.keys()].filter((a) => FOOTY.test(a));
	}
	for (const c of contacts) if (!rest.anchors.has(c)) throw new Error(`no anchor "${c}" (part/anchor) to use as a contact`);
	if (!contacts.length || samples.length < 3) return { feet: [], found: contacts.length > 0 };
	const tol = opts.contactTol ?? Math.max(size * 0.03, 1e-3);
	let ground = opts.ground;
	if (ground === undefined) {
		// the lowest height the contacts keep returning to (y grows down): a frame or two dipping deeper is a fault, not the floor
		const ys = samples.flatMap((s) => contacts.map((c) => s.anchors.get(c)?.[1])).filter((y): y is number => y !== undefined).sort((a, b) => b - a);
		// the densest band among the lower half of the heights
		const low = ys.slice(0, Math.max(1, Math.ceil(ys.length / 2)));
		let best = -1;
		for (const v of low) {
			const near = ys.filter((y) => Math.abs(y - v) <= tol / 2);
			const mean = near.reduce((a, y) => a + y, 0) / near.length;
			if (near.length > best) {
				best = near.length;
				ground = mean;
			}
		}
	}
	const dipTol = tol;
	const flat = (p: Vec3): number[] => (d3 ? [p[0], p[2]] : [p[0]]);
	const feet: FootReport[] = [];
	const n = samples.length;
	for (const c of contacts) {
		const pos = samples.map((s) => s.anchors.get(c));
		const down = pos.map((p) => !!p && p[1] >= ground! - tol);
		let deepest = -1;
		pos.forEach((p, i) => {
			if (p && p[1] > ground! + dipTol && (deepest < 0 || p[1] > pos[deepest]![1])) deepest = i;
		});
		if (deepest >= 0) findings.push({ level: "warn", kind: "slide", part: c, t: samples[deepest].t, message: `${c} sinks ${r2(pos[deepest]![1] - ground!)} through the ground (y ${r2(ground!)}) at t=${ts(samples[deepest].t)}${(doc.constraints ?? []).some((k) => k.end === c) ? ": the chain overshoots its target, or the target is out of reach" : ""}` });
		// runs of samples on the ground; a loop joins its last run to its first
		const runs: number[][] = [];
		let cur: number[] = [];
		for (let i = 0; i < n; i++) {
			if (down[i]) cur.push(i);
			else if (cur.length) {
				runs.push(cur);
				cur = [];
			}
		}
		if (cur.length) runs.push(cur);
		if (clip.loop && runs.length > 1 && down[0] && down[n - 1]) {
			const tail = runs.pop()!;
			runs[0] = [...tail, ...runs[0]];
		}
		const report: FootReport = { anchor: c, duty: down.filter(Boolean).length / n, runs: [], speed: 0, velocity: d3 ? [0, 0] : [0] };
		let total = d3 ? [0, 0] : [0];
		let time = 0;
		for (const run of runs) {
			report.runs.push([r2(samples[run[0]].t), r2(samples[run[run.length - 1]].t)]);
			if (run.length < 3) continue;
			const vs: number[][] = [];
			for (let k = 0; k + 1 < run.length; k++) {
				const a = flat(pos[run[k]]!);
				const b = flat(pos[run[k + 1]]!);
				vs.push(a.map((x, i) => (b[i] - x) / step));
			}
			const mean = vs[0].map((_, i) => vs.reduce((acc, v) => acc + v[i], 0) / vs.length);
			const speed = Math.hypot(...mean);
			const runTime = (run.length - 1) * step;
			total = total.map((x, i) => x + mean[i] * runTime);
			time += runTime;
			const span = `${ts(samples[run[0]].t)}–${ts(samples[run[run.length - 1]].t)}`;
			const still = speed * runTime < tol;
			if (still) {
				const start = flat(pos[run[0]]!);
				const wander = Math.max(...run.map((i) => Math.hypot(...flat(pos[i]!).map((x, k) => x - start[k]))));
				if (wander > tol * 1.5) findings.push({ level: "warn", kind: "slide", part: c, t: samples[run[0]].t, message: `${c} is planted t=${span} but wanders ${r2(wander)} and back` });
			} else {
				const uneven = Math.max(...vs.map((v) => Math.hypot(...v.map((x, i) => x - mean[i])))) / speed;
				if (uneven > 0.35) findings.push({ level: "warn", kind: "slide", part: c, t: samples[run[0]].t, message: `${c} slides unevenly on the ground t=${span}: its speed swings ±${pct(uneven)} around ${r2(speed)}/s (a foot down should move at one speed, or not at all)` });
			}
		}
		report.velocity = time > 0 ? total.map((x) => r2(x / time)) : report.velocity;
		report.speed = r2(Math.hypot(...report.velocity));
		feet.push(report);
	}

	// the feet against each other, and which way that sends the figure
	const moving = feet.filter((f) => f.speed * dur > tol);
	let travel: string | undefined;
	if (moving.length >= 2) {
		for (let i = 1; i < moving.length; i++) {
			const a = moving[0];
			const b = moving[i];
			const dot = a.velocity.reduce((acc, x, k) => acc + x * b.velocity[k], 0);
			if (dot < 0) findings.push({ level: "error", kind: "slide", message: `${a.anchor} and ${b.anchor} slide opposite ways on the ground (${a.velocity.join(",")} vs ${b.velocity.join(",")}): one foot is skating` });
			else if (Math.abs(a.speed - b.speed) / Math.max(a.speed, b.speed) > 0.2) findings.push({ level: "warn", kind: "slide", message: `${a.anchor} slides at ${a.speed}/s and ${b.anchor} at ${b.speed}/s: on a treadmill they should match` });
		}
	}
	const still = feet.length > 0 && moving.length === 0;
	let dir: number[] | null = null;
	if (moving.length) {
		// in place: the feet push back, the figure goes the other way
		const m = moving[0].velocity.map((_, k) => moving.reduce((acc, f) => acc + f.velocity[k], 0) / moving.length);
		dir = m.map((x) => -x);
		travel = `walks in place: the feet slide ${words(doc, m)} while down, so it travels ${words(doc, dir)} at ${r2(Math.hypot(...m))}/s`;
	} else if (still) {
		const root = ((doc.parts ?? []) as { name: string; parent?: string }[]).find((p) => !p.parent)?.name;
		const a = root ? samples[0].joints.get(root) : undefined;
		const b = root ? samples[samples.length - 1].joints.get(root) : undefined;
		if (a && b && dist3(a, b) > tol) {
			const fl = (p: Vec3) => (d3 ? [p[0], p[2]] : [p[0]]);
			dir = fl(b).map((x, k) => x - fl(a)[k]);
			travel = `the feet stay planted and ${root} moves ${words(doc, dir)} by ${r2(Math.hypot(...dir))}: root motion`;
		} else travel = "the feet stay planted: it does not travel";
	}
	if (dir) {
		if (!d3 && opts.facing) {
			const want = opts.facing === "right" ? 1 : -1;
			if (Math.sign(dir[0]) === -want) findings.push({ level: "error", kind: "travel", message: `it faces ${opts.facing} but travels ${words(doc, dir)}: it moonwalks. Reverse which way the feet slide (swap the contact and lift keys, or mirror the stride)` });
		}
		if (d3) {
			const len = Math.hypot(dir[0], dir[1]);
			if (len > 0) {
				const fwd = -dir[1] / len; // the model's front is −z
				if (fwd < -0.7) findings.push({ level: "error", kind: "travel", message: `it travels toward +z, its back (the model faces −z): it walks backwards` });
				else if (Math.abs(fwd) < 0.5) findings.push({ level: "warn", kind: "travel", message: `it travels ${words(doc, dir)}, sideways to its front (−z)` });
			}
		}
	}
	return { feet, travel, found: true };
}

function words(doc: Doc | Doc3, v: number[]): string {
	if (!as3d(doc)) return v[0] > 0 ? "+x (right)" : v[0] < 0 ? "-x (left)" : "nowhere";
	const [x, z] = v;
	const parts: string[] = [];
	if (Math.abs(z) >= Math.abs(x) * 0.4) parts.push(z < 0 ? "-z (forward)" : "+z (back)");
	if (Math.abs(x) >= Math.abs(z) * 0.4) parts.push(x > 0 ? "+x" : "-x");
	return parts.join(" and ") || "nowhere";
}

/** The report as text: one line a finding, then the feet. */
export function formatClipReport(r: ClipReport): string {
	const lines = [`clip ${r.clip}: ${r.duration}s${r.loop ? " loop" : ""}, ${r.samples} samples`];
	for (const f of r.findings) lines.push(`  ${f.level.padEnd(5)} ${f.kind.padEnd(6)} ${f.message}`);
	for (const f of r.feet) {
		const runs = f.runs.map(([a, b]) => `${a.toFixed(2)}–${b.toFixed(2)}`).join(", ");
		lines.push(`  foot  ${f.anchor}: down ${pct(f.duty)} (${runs || "never"}), slides ${f.velocity.join(",")}/s while down`);
	}
	if (r.travel) lines.push(`  ${r.travel}`);
	if (!r.findings.some((f) => f.level !== "note")) lines.push("  ok");
	return lines.join("\n");
}
