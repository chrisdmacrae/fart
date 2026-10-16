// The agent's tools (spec/TOOLING.md) and the direction file (spec/DIRECTION.md).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyPatch, formatJson, leanDoc, lintDirection, loadDirection, make, mergeDirection, morph, outlineDoc, parseDoc, pose, setClip, stringifyDoc, validate, type Doc } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const examples = resolve(here, "../../../spec/examples");
const load = async (f: string): Promise<Doc> => {
	const { doc, report } = parseDoc(await readFile(join(examples, f), "utf8"));
	assert.ok(doc, JSON.stringify(report.errors));
	return doc;
};

test("the canonical layout puts number arrays on one line and round-trips", async () => {
	const doc = await load("valid/hero.fart");
	const text = stringifyDoc(doc);
	assert.ok(/"pivot": \[-?\d/.test(text), "a pivot is inline");
	assert.ok(!/\[\n\s+-?\d+,\n/.test(text), "no number stands alone on a line");
	assert.deepEqual(JSON.parse(text), JSON.parse(JSON.stringify(doc)));
	assert.equal(formatJson([[1, 2], [3, 4.5]]), "[[1, 2], [3, 4.5]]");
	assert.equal(formatJson({ a: [1, 2.3456] }), '{\n  "a": [1, 2.346]\n}');
});

test("the outline names everything and the lean view drops the bakes", async () => {
	const doc = await load("valid/hero.fart");
	const o = outlineDoc(doc, "hero.fart");
	assert.ok(o.startsWith("hero.fart ·"));
	assert.ok(o.includes("parts (") && o.includes("states ("), o);
	for (const p of doc.parts ?? []) assert.ok(o.includes(`- ${p.name}`), p.name);
	const lean = leanDoc(doc);
	assert.ok(!JSON.stringify(lean).includes('"tris"'));
	assert.deepEqual(validate(lean).errors, []);
});

test("patches address parts, states, clips and tokens by name", async () => {
	const doc = await load("valid/chest.fart");
	const log = applyPatch(doc, [
		{ op: "replace", path: "/parts/lid/pivot", value: [1, 2] },
		{ op: "replace", path: "/states/open/parts/lid/rotate", value: -1.5 },
		{ op: "add", path: "/states/open/parts/lid/scale", value: 1.2 },
		{ op: "add", path: "/states/-", value: { name: "ajar", parts: [{ part: "box" }, { part: "lid", rotate: -0.5 }] } },
		{ op: "test", path: "/states/ajar/parts/lid/rotate", value: -0.5 },
	]);
	assert.equal(log.length, 5);
	assert.deepEqual(doc.parts!.find((p) => p.name === "lid")!.pivot, [1, 2]);
	assert.equal(doc.states!.find((s) => s.name === "open")!.parts.find((e) => e.part === "lid")!.rotate, -1.5);
	assert.ok(doc.states!.some((s) => s.name === "ajar"));
	assert.deepEqual(validate(doc).errors, []);
	assert.throws(() => applyPatch(doc, [{ op: "replace", path: "/parts/nothing/pivot", value: [0, 0] }]), /no "nothing"/);
	// a failed later op leaves the earlier ones applied on the copy the caller made: the caller's business
	applyPatch(doc, [{ op: "remove", path: "/states/ajar" }]);
	assert.ok(!doc.states!.some((s) => s.name === "ajar"));
});

test("the verbs: pose, morph by moves and scale, a clip from a line, a shape from a recipe", async () => {
	const doc = await load("valid/morph.fart");
	assert.match(pose(doc, "round", "blob", { rotate: 0.3, scale: 1.1 }), /rotate 0.3/);
	assert.equal(doc.states![0].parts[0].rotate, 0.3);
	morph(doc, "round", "blob", { shape: 0, moves: { "0": [0, -2] } });
	assert.deepEqual(doc.states![0].parts[0].morph![0].points[0], [-6, -6]);
	morph(doc, "round", "blob", { shape: 0, scale: 2 });
	assert.ok(Math.abs(doc.states![0].parts[0].morph![0].points[1][0]) > 10);
	morph(doc, "round", "blob", { shape: 0, reset: true });
	assert.equal(doc.states![0].parts[0].morph, undefined);
	assert.throws(() => morph(doc, "round", "twin", { shape: 0, scale: 2 }), /drawn like/);
	assert.match(setClip(doc, "wobble", { keys: "0:round 0.5:squash!thump 1:round", loop: true }), /3 keys, 1s, loop/);
	const c = doc.clips!.find((k) => k.name === "wobble")!;
	assert.deepEqual(c.keys[1].events, ["thump"]);
	assert.throws(() => setClip(doc, "bad", { keys: "0:nope" }), /no state/);
	const r = make(doc, "blob", { kind: "roundedRect", color: "skin", at: [0, 0], w: 10, h: 6, r: 2 });
	assert.equal(doc.parts![0].shapes![r.index].kind, "path");
	assert.throws(() => make(doc, "blob", { kind: "ball", color: "skin", at: [0, 0, 0], r: 1 }), /3D shape/);
	assert.deepEqual(validate(doc).errors, []);
});

test("directions merge, extend and lint", async () => {
	const base = { version: 1 as const, about: "base", avoid: ["gradients"], light: { ambient: 0.4 } };
	const over = { version: 1 as const, about: "over", avoid: ["black"], light: { light: [1, 2, 3] as [number, number, number] }, classes: { prop: { motion: { max: 1 } } } };
	const m = mergeDirection(base, over);
	assert.equal(m.about, "over");
	assert.deepEqual(m.avoid, ["gradients", "black"]);
	assert.deepEqual(m.light, { ambient: 0.4, light: [1, 2, 3] });
	const town = await readFile(join(examples, "valid/town.gas"), "utf8");
	const { direction, unresolved, errors } = await loadDirection(town, (ref) => readFile(join(examples, "valid", ref), "utf8"));
	assert.deepEqual([unresolved, errors], [[], []]);
	assert.equal(direction.about, "A harbour town at dusk.");
	assert.deepEqual(direction.avoid, ["gradients"]);
	assert.equal(direction.rules?.length, 1);
	// the space direction against the fighter: it links the hull palette, has no black, names fine
	const space = JSON.parse(await readFile(join(examples, "valid/direction.gas"), "utf8"));
	const fighter = parseDoc(await readFile(resolve(here, "../../../examples/space/ships/fighter.fart"), "utf8")).doc!;
	const lints = lintDirection(space, fighter, "ships/fighter.fart");
	assert.deepEqual(lints.map((l) => l.code), [], JSON.stringify(lints));
	// a rock with a long clip is fine (its class allows 4s), a ship with one is not
	const rock: Doc = { version: 1, name: "r", palette: [{ name: "c", rgb: [1, 1, 1, 255] }], parts: [{ name: "a", shapes: [] }], states: [{ name: "s", parts: [] }], clips: [{ name: "spin", keys: [{ t: 0, state: "s" }, { t: 3, state: "s" }] }] };
	assert.ok(!lintDirection(space, rock, "rocks/big.fart").some((l) => l.code === "direction.motion"));
	assert.ok(lintDirection(space, rock, "ships/big.fart").some((l) => l.code === "direction.motion"));
	// a rule's check fires
	const black: Doc = { version: 1, palette: [{ name: "void", rgb: [0, 0, 0, 255] }], parts: [], states: [] };
	assert.ok(lintDirection(space, black, "props/x.fart").some((l) => l.rule === "nothing is pure black"));
});
