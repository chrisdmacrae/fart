// Format 1.11: rails: a profile carried upright along a path, mitred at its corners, the corners rounded.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { as3d, asMesh, faceNormal, parseDoc, rail, roundCorners, sweepMesh, validate, windOutward, type Doc3, type SweepShape, type Vec3 } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const examples = resolve(here, "../../../spec/examples");
const near = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const codes = async (f: string) => parseDoc(await readFile(join(examples, f), "utf8")).report.errors.map((e) => e.code);
const palette = [{ name: "rock", rgb: [100, 100, 100, 255] }, { name: "turf", rgb: [80, 160, 70, 255] }];
const errs = (...shapes: unknown[]) => validate({ version: 1, space: "3d", palette, parts: [{ name: "a", pivot: [0, 0, 0], shapes }] }).errors.map((e) => e.code);

test("the validator: a rail has a path and a profile; a closed one three path points", async () => {
	assert.deepEqual(await codes("valid/rail.fart"), []);
	assert.deepEqual(await codes("invalid/rail-closed-two.fart"), ["rail"]);
	assert.deepEqual(await codes("invalid/rail-profile-two.fart"), ["curve"]);
	assert.ok((await codes("invalid/rail-no-profile.fart")).includes("schema"));
	const face = { kind: "sweep", color: "rock", op: "rail", path: { points: [[0, 0, 0], [4, 0, 0]] }, profile: { points: [[0, 0], [0, 3]] } };
	assert.deepEqual(errs(face), []);
	assert.deepEqual(errs({ ...face, round: 1, axis: "z", closed: false }), []);
	assert.ok(errs({ ...face, round: -1 }).includes("schema"));
	assert.ok(errs({ ...face, axis: "w" }).includes("schema"));
	assert.ok(errs({ ...face, path: undefined }).includes("schema"));
	// paint counts the faces the rail makes: one a profile edge, a ring
	assert.deepEqual(errs({ ...face, colors: ["turf"], paint: [1] }), []);
	assert.deepEqual(errs({ ...face, colors: ["turf"], paint: [1, 0] }), ["paint"]);
});

test("a rail: the profile stands along the axis, out to the side of the way the path goes, and faces its own left", () => {
	// along z, standing along y (the format's down): out is y cross z, which is x
	const wall = rail("rock", { points: [[0, 0, 0], [0, 0, 4]] }, [[0, 0], [0.5, 1], [0.5, 3]]);
	assert.deepEqual(wall.points, [[0, 0, 0], [0.5, 1, 0], [0.5, 3, 0], [0, 0, 4], [0.5, 1, 4], [0.5, 3, 4]]);
	assert.deepEqual(wall.faces, [[0, 1, 4, 3], [1, 2, 5, 4]]);
	// the face going straight down looks out; the brow looks out and up
	const n1 = faceNormal(wall.points, wall.faces[1]);
	assert.ok(n1[0] > 0 && Math.abs(n1[1]) < 1e-9 && Math.abs(n1[2]) < 1e-9);
	const n0 = faceNormal(wall.points, wall.faces[0]);
	assert.ok(n0[0] > 0 && n0[1] < 0 && Math.abs(n0[2]) < 1e-9);
	// the path may climb: the profile still stands along the axis, not across the path
	const slope = rail("rock", { points: [[0, 0, 0], [0, -4, 4]] }, [[0, 0], [0, 2]]);
	assert.deepEqual(slope.points, [[0, 0, 0], [0, 2, 0], [0, -4, 4], [0, -2, 4]]);
	// another axis
	const up = rail("rock", { points: [[0, 0, 0], [4, 0, 0]] }, [[0, 0], [1, 2]], { axis: "z" });
	assert.deepEqual(up.points, [[0, 0, 0], [0, 1, 2], [4, 0, 0], [4, 1, 2]]);
	// a path with nowhere to go, or straight along the axis, makes nothing
	assert.equal(rail("rock", { points: [[0, 0, 0], [0, 0, 0]] }, [[0, 0], [0, 1]]).points.length, 0);
	assert.equal(rail("rock", { points: [[0, 0, 0], [0, 3, 0]] }, [[0, 0], [0, 1]]).points.length, 0);
});

test("a rail's corner: on the mitre, so a face keeps its distance from the path on both sides", () => {
	const bend = rail("rock", { points: [[0, 0, 0], [0, 0, 4], [-4, 0, 4]] }, [[0, 0], [1, 0]]);
	assert.equal(bend.points.length, 6);
	assert.deepEqual(bend.points[1], [1, 0, 0]);
	assert.deepEqual(bend.points[3], [1, 0, 5]);
	assert.deepEqual(bend.points[5], [-4, 0, 5]);
	// a closed path: every point a corner, as many rings as points, no ends
	const ring = rail("rock", { points: [[0, 0, 0], [0, 0, 4], [-4, 0, 4], [-4, 0, 0]] }, [[0, 0], [1, 0]], { closed: true });
	assert.equal(ring.points.length, 8);
	assert.equal(ring.faces.length, 4);
	assert.deepEqual(ring.points[1], [1, 0, -1]);
});

test("a rail's corners rounded: cut back by the radius, an arc between, steps to a quarter turn", () => {
	const line: Vec3[] = [[0, 0, 0], [0, 0, 4], [-4, 0, 4]];
	const arc = roundCorners(line, 1, 4, false);
	assert.equal(arc.length, 7);
	assert.deepEqual(arc[0], [0, 0, 0]);
	near(arc[1][2], 3);
	near(arc[5][0], -1);
	near(arc[5][2], 4);
	// every point of the arc a radius from its centre
	for (const p of arc.slice(1, 6)) near(Math.hypot(p[0] + 1, p[2] - 3), 1);
	// a radius too big for the segments is cut to half the shorter
	const tight = roundCorners(line, 10, 2, false);
	near(tight[1][2], 2);
	near(tight[3][0], -2);
	// straight on, no corner; no radius, no change
	assert.equal(roundCorners([[0, 0, 0], [0, 0, 2], [0, 0, 4]], 1, 4, false).length, 3);
	assert.deepEqual(roundCorners(line, 0, 4, false), line);
	// a closed path rounds every corner
	assert.equal(roundCorners([[0, 0, 0], [4, 0, 0], [4, 0, 4], [0, 0, 4]], 1, 2, true).length, 12);
	// the sweep: round and segments are the shape's; a path with handles is as round as it is drawn
	const sh = { kind: "sweep", color: "rock", op: "rail", round: 1, segments: 4, path: { points: line }, profile: { points: [[0, 0], [0, 2]] } } as unknown as SweepShape;
	assert.equal(sweepMesh(sh).points.length, 14);
	const drawn = { ...sh, path: { points: line, out: [[0, 0, 1], [0, 0, 0], [0, 0, 0]] } } as unknown as SweepShape;
	assert.notEqual(sweepMesh(drawn).points.length, 14);
});

test("a rail with a closed profile: a moulding, wound outward whichever way it was drawn, capped at an open path's ends", () => {
	const square: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
	const kerb = rail("rock", { points: [[0, 0, 0], [0, 0, 4]] }, square, { solid: true });
	assert.equal(kerb.points.length, 8);
	assert.equal(kerb.faces.length, 6);
	assert.deepEqual(windOutward({ kind: "mesh", points: kerb.points, faces: kerb.faces.map((f) => [...f]) }).faces, kerb.faces);
	const other = rail("rock", { points: [[0, 0, 0], [0, 0, 4]] }, [...square].reverse(), { solid: true });
	assert.deepEqual(windOutward({ kind: "mesh", points: other.points, faces: other.faces.map((f) => [...f]) }).faces, other.faces);
	assert.equal(rail("rock", { points: [[0, 0, 0], [0, 0, 4]] }, square, { solid: true, caps: false }).faces.length, 4);
});

test("the corpus's rails: a painted bank round a rounded corner, a kerb round a closed path, a skirt up a curve", async () => {
	const { doc } = parseDoc(await readFile(join(examples, "valid/rail.fart"), "utf8"));
	const d = as3d(doc!) as Doc3;
	const [bank, kerb, skirt] = d.parts![0].shapes!.map((sh) => asMesh(sh));
	assert.equal(bank.faces.length, 10);
	assert.deepEqual(bank.paint, [1, 0, 1, 0, 1, 0, 1, 0, 1, 0]);
	assert.equal(kerb.faces.length, 16);
	assert.deepEqual(windOutward({ kind: "mesh", points: kerb.points, faces: kerb.faces.map((f) => [...f]) }).faces, kerb.faces);
	assert.ok(skirt.faces.length > 2);
	// standing along z: every ring's first and last points differ only in z
	for (let i = 0; i < skirt.points.length; i += 3) {
		near(skirt.points[i][0], skirt.points[i + 2][0]);
		near(skirt.points[i][1], skirt.points[i + 2][1]);
		near(skirt.points[i + 2][2] - skirt.points[i][2], 1);
	}
});
