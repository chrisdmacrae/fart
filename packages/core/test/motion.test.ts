// fart render and fart check-clip: motion as pictures and as numbers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkClip, clipTimes, parseDoc, renderClip, renderClipFrames, renderStates, sampleAt, validate, type Doc } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const examples = resolve(here, "../../../spec/examples");
const load = async (f: string): Promise<Doc> => {
	const { doc, report } = parseDoc(await readFile(f, "utf8"));
	assert.ok(doc, JSON.stringify(report.errors));
	return doc;
};

/**
 * Feet alone, side on, facing right, walking in place: each foot slides
 * back (−x) at one speed while down, then lifts and swings forward. No
 * chains, so what is measured is exactly what is keyed.
 */
function feet(): Doc {
	const all = (l: [number, number], r: [number, number]) => [{ part: "hip" }, { part: "foot_l", offset: l }, { part: "foot_r", offset: r }];
	const foot = (name: string) => ({ name, pivot: [0, 18], shapes: [{ kind: "line", color: "ink", a: [-1, 18], b: [2, 18], w: 1 }], anchors: [{ name: "sole", at: [0, 18] }] });
	return {
		version: 1,
		name: "feet",
		palette: [{ name: "ink", rgb: [40, 40, 40, 255] }],
		parts: [{ name: "hip", pivot: [0, 0], shapes: [{ kind: "circle", color: "ink", at: [0, 0], r: 3 }] }, foot("foot_l"), foot("foot_r")],
		states: [
			{ name: "contact_a", parts: all([5, 18], [-5, 18]) },
			{ name: "pass_a", parts: all([0, 18], [0, 14]) },
			{ name: "contact_b", parts: all([-5, 18], [5, 18]) },
			{ name: "pass_b", parts: all([0, 14], [0, 18]) },
			{ name: "skate", parts: all([-5, 18], [8, 18]) },
		],
		clips: [
			{ name: "walk", loop: true, keys: ["contact_a", "pass_a", "contact_b", "pass_b", "contact_a"].map((state, i) => ({ t: i * 0.2, state })) },
			{ name: "skate", loop: true, keys: ["contact_a", "skate", "contact_a"].map((state, i) => ({ t: i * 0.4, state })) },
		],
	} as unknown as Doc;
}

/** A side-on biped facing right (knees forward) that walks in place: each foot slides back (−x) while down, then lifts and swings forward. */
function walker(): Doc {
	const leg = (side: string, x: number) => [
		{ name: `thigh_${side}`, parent: "hip", pivot: [x, 2], shapes: [{ kind: "line", color: "ink", a: [x, 2], b: [x + 2, 11], w: 2 }] },
		{ name: `shin_${side}`, parent: `thigh_${side}`, pivot: [x + 2, 11], shapes: [{ kind: "line", color: "ink", a: [x + 2, 11], b: [x, 20], w: 2 }], anchors: [{ name: "foot", at: [x, 20] }] },
	];
	const all = ["hip", "thigh_l", "shin_l", "thigh_r", "shin_r"].map((part) => ({ part }));
	const st = (name: string, l: [number, number], r: [number, number]) => ({ name, parts: all, targets: [{ chain: "leg_l", at: l }, { chain: "leg_r", at: r }] });
	return {
		version: 1,
		name: "walker",
		palette: [{ name: "ink", rgb: [40, 40, 40, 255] }],
		parts: [{ name: "hip", pivot: [0, 0], shapes: [{ kind: "circle", color: "ink", at: [0, 0], r: 3 }] }, ...leg("l", 0), ...leg("r", 0)],
		states: [
			st("contact_a", [5, 18], [-5, 18]),
			st("pass_a", [0, 18], [0, 14]),
			st("contact_b", [-5, 18], [5, 18]),
			st("pass_b", [0, 14], [0, 18]),
			{ name: "long", parts: [{ part: "hip" }, { part: "thigh_l" }, { part: "shin_l", offset: [0, 14] }, { part: "thigh_r" }, { part: "shin_r" }] },
			{ name: "spun", parts: [{ part: "hip", rotate: 4 }, { part: "thigh_l" }, { part: "shin_l" }, { part: "thigh_r" }, { part: "shin_r" }] },
		],
		clips: [
			{ name: "walk", loop: true, keys: ["contact_a", "pass_a", "contact_b", "pass_b", "contact_a"].map((state, i) => ({ t: i * 0.2, state })) },
			{ name: "stretch", keys: [{ t: 0, state: "contact_a" }, { t: 0.3, state: "long" }] },
			{ name: "spin", loop: true, keys: [{ t: 0, state: "contact_a" }, { t: 0.4, state: "spun" }] },
		],
		constraints: [
			{ name: "leg_l", chain: ["thigh_l", "shin_l"], end: "shin_l/foot", bend: 1 },
			{ name: "leg_r", chain: ["thigh_r", "shin_r"], end: "shin_r/foot", bend: 1 },
		],
	} as unknown as Doc;
}

test("the fixtures are valid documents", () => {
	for (const doc of [walker(), feet()]) {
		const r = validate(doc);
		assert.ok(r.ok, JSON.stringify(r.errors));
	}
});

test("a sample puts the anchors where the keys say, and reaches targets", () => {
	const f = feet();
	const s = sampleAt(f, f.clips![0], 0.1);
	assert.deepEqual(s.anchors.get("foot_l/sole")!.map((x) => Math.round(x * 1e6) / 1e6), [2.5, 18, 0]);
	const w = walker();
	const foot = sampleAt(w, w.clips![0], 0).anchors.get("shin_l/foot")!;
	assert.ok(Math.hypot(foot[0] - 5, foot[1] - 18) < 1, `foot at ${foot}`);
});

test("check-clip tells which way the walk travels, and catches a moonwalk and a skate", () => {
	const doc = feet();
	const r = checkClip(doc, "walk", { contacts: ["foot_l/sole", "foot_r/sole"] });
	assert.equal(r.feet.length, 2);
	for (const f of r.feet) {
		assert.ok(f.velocity[0] < -20, `${f.anchor} slides back: ${f.velocity}`);
		assert.ok(f.duty > 0.4 && f.duty < 0.7, `${f.anchor} is down about half the time: ${f.duty}`);
	}
	assert.match(r.travel ?? "", /travels \+x/);
	assert.ok(!r.findings.some((f) => f.level !== "note"), JSON.stringify(r.findings));
	// the feet are found by name without --contact
	assert.equal(checkClip(doc, "walk").feet.length, 2);
	const wrong = checkClip(doc, "walk", { facing: "left" });
	assert.ok(wrong.findings.some((f) => f.kind === "travel" && f.level === "error"), "facing left but walking right is an error");
	const skate = checkClip(doc, "skate");
	assert.ok(skate.findings.some((f) => f.kind === "slide" && f.level === "error"), JSON.stringify(skate.findings));
});

test("check-clip catches a limb that stretches and a turn that goes the short way", () => {
	const doc = walker();
	const s = checkClip(doc, "stretch");
	const bone = s.findings.find((f) => f.kind === "bone" && f.part === "shin_l");
	assert.ok(bone && bone.level === "error", JSON.stringify(s.findings));
	const w = checkClip(doc, "spin");
	assert.ok(w.findings.some((f) => f.kind === "wrap" && f.part === "hip" && f.level === "error"), JSON.stringify(w.findings));
	assert.ok(w.findings.some((f) => f.kind === "seam"), "a loop that ends off its first pose pops");
});

test("check-clip catches a knee that folds backwards", () => {
	const doc = walker();
	// keyed by hand, no targets: the right knee bends forward, then back the other way
	doc.states = [
		{ name: "fwd", parts: [{ part: "hip" }, { part: "thigh_l" }, { part: "shin_l" }, { part: "thigh_r", rotate: -0.3 }, { part: "shin_r", rotate: 0.5 }] },
		{ name: "back", parts: [{ part: "hip" }, { part: "thigh_l" }, { part: "shin_l" }, { part: "thigh_r", rotate: 0.3 }, { part: "shin_r", rotate: -0.9 }] },
	];
	doc.clips = [{ name: "kick", keys: [{ t: 0, state: "fwd" }, { t: 0.4, state: "back" }] }];
	const r = checkClip(doc, "kick");
	assert.ok(r.findings.some((f) => f.kind === "flip" && f.part === "shin_r"), JSON.stringify(r.findings));
	assert.ok(!r.findings.some((f) => f.kind === "flip" && f.part === "shin_l"), "the left knee stays put");
});

test("render draws a strip in one world box, an onion and same-size frames", () => {
	const doc = walker();
	const tokens = doc.palette!;
	const times = clipTimes(doc, doc.clips![0], 4);
	assert.deepEqual(times, [0, 0.2, 0.4, 0.6]);
	const strip = renderClip(doc, tokens, "walk", times, "strip", { size: 80, bones: true });
	assert.deepEqual(strip.tracks, ["shin_l/foot", "shin_r/foot"]);
	assert.deepEqual(renderClip(feet(), tokens, "walk", [0], "strip", { size: 40 }).tracks, ["foot_l/sole", "foot_r/sole"]);
	assert.equal(strip.raster.data.length, strip.raster.width * strip.raster.height * 4);
	// the ink is drawn: some pixels are dark
	let dark = 0;
	for (let i = 0; i < strip.raster.data.length; i += 4) if (strip.raster.data[i] < 60 && strip.raster.data[i + 1] < 60) dark++;
	assert.ok(dark > 200, `dark pixels: ${dark}`);
	const onion = renderClip(doc, tokens, "walk", times, "onion", { size: 80 });
	assert.ok(onion.raster.width < strip.raster.width);
	const frames = renderClipFrames(doc, tokens, "walk", times, { size: 64 });
	assert.equal(frames.length, 4);
	assert.ok(frames.every((f) => f.width === frames[0].width && f.height === frames[0].height));
	const states = renderStates(doc, tokens, ["contact_a", "pass_a"], { size: 64 });
	assert.ok(states.width > 0);
	assert.throws(() => renderClip(doc, tokens, "nope", [0], "strip"), /no clip/);
	assert.throws(() => renderClip(doc, tokens, "walk", [0], "strip", { tracks: ["hip/nope"] }), /no anchor/);
});

test("every clip in the corpus renders and checks without throwing", async () => {
	let n = 0;
	for (const f of (await readdir(join(examples, "valid"))).filter((f) => f.endsWith(".fart"))) {
		const doc = await load(join(examples, "valid", f));
		for (const clip of doc.clips ?? []) {
			renderClip(doc, doc.palette ?? [], clip.name, clipTimes(doc, clip, 3), "strip", { size: 40 });
			checkClip(doc, clip.name, { fps: 10 });
			n++;
		}
	}
	assert.ok(n > 5, `clips seen: ${n}`);
});
