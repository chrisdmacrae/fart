// The authoring library: the README's bat, built and validated, written with its generator recorded.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validate } from "@fastart/core";
import { clip, doc, ellipse, mirrorOf, morph, part, path, state, write } from "../src/index.ts";

test("a bat from the README validates, mirrors, morphs, clips and writes with meta.gen", () => {
	const d = doc("bat", { palette: [{ name: "fur", rgb: [60, 50, 70, 255] }, { name: "eye", rgb: [255, 220, 80, 255] }] });
	part(d, "body", { pivot: [0, 0], shapes: [ellipse("fur", [0, 0], 4, 3)] });
	part(d, "wing_l", { parent: "body", pivot: [-3, 0], shapes: [path("fur", [[-3, 0], [-10, -4], [-9, 2]], { closed: true, out: [[-3, -3], [0, 0], [0, 0]], in: [[0, 0], [1, -1], [0, 0]] })] });
	mirrorOf(d, "wing_l", "wing_r");
	assert.equal(d.parts![2].like, "wing_l");
	assert.deepEqual(d.parts![2].pivot, [3, 0]);
	state(d, "glide");
	state(d, "flap", { wing_l: { rotate: -0.7 }, wing_r: { rotate: -0.7, mirror: true } });
	assert.equal(d.states![1].parts.length, 3);
	morph(d, "flap", "body", { shape: 0, scale: [0.9, 1.1] });
	assert.ok(d.states![1].parts[0].morph);
	clip(d, "fly", "0:glide 0.15:flap 0.3:glide", { loop: true });
	assert.deepEqual(validate(d).errors, []);
	const dir = mkdtempSync(join(tmpdir(), "make-"));
	try {
		const file = write(d, join(dir, "assets/bat.fart"), "file:///tmp/project/assets/gen/bats.mjs");
		const back = JSON.parse(readFileSync(file, "utf8"));
		assert.equal(back.meta.gen, "../../tmp/project/assets/gen/bats.mjs".includes("tmp") ? back.meta.gen : "");
		assert.ok(typeof back.meta.gen === "string" && back.meta.gen.endsWith("gen/bats.mjs"));
		assert.ok(back.parts[0].shapes[0].bake, "the path is baked on write");
		assert.ok(readFileSync(file, "utf8").includes('"pivot": [0, 0]'), "the canonical layout");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
