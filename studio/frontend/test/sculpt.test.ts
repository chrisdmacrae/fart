// Sculpting, as geometry: what each brush does to a dense grid and a
// ball, the falloffs, symmetry, the mask, auto-masking and the filters.
// `npm test -w @fastart/studio`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ballMesh, subdivide } from "../../../packages/core/src/index.ts";
import { BRUSHES, FALLOFFS, beginStroke, dab, falloff, filterMesh, neighbours, reshapeMask, symmetries, vertexNormals, type Brush, type StrokeOpts, type V3 } from "../src/state/sculpt.ts";

/** A flat grid in z = 0 facing +z, `n` quads a side, 2 units wide, about the origin. */
function grid(n = 20): { points: V3[]; faces: number[][] } {
	const points: V3[] = [];
	for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) points.push([-1 + (2 * i) / n, -1 + (2 * j) / n, 0]);
	const faces: number[][] = [];
	const at = (i: number, j: number) => j * (n + 1) + i;
	for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) faces.push([at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]);
	return { points, faces };
}
const ball = () => {
	const m = subdivide(ballMesh({ kind: "ball", color: "ink", at: [0, 0, 0], r: 1 }, 6, 12), 1);
	return { points: m.points as V3[], faces: m.faces };
};
const opts = (brush: Brush, more: Partial<StrokeOpts> = {}): StrokeOpts => ({
	brush,
	radius: 0.5,
	strength: 1,
	falloff: "smooth",
	invert: false,
	autoSmooth: 0,
	frontOnly: false,
	toViewer: [0, 0, 1],
	topology: false,
	sym: symmetries([false, false, false]),
	...more,
});
const middle = (g: { points: V3[] }) => g.points.findIndex((p) => p[0] === 0 && p[1] === 0);
const up: V3 = [0, 0, 1];

test("the falloffs run from 1 at the middle to 0 at the rim", () => {
	for (const f of FALLOFFS) {
		assert.ok(Math.abs(falloff(f, 0) - 1) < 1e-9, f);
		assert.equal(falloff(f, 1), 0, f);
		assert.ok(falloff(f, 0.5) <= 1 && falloff(f, 0.5) >= 0, f);
	}
	assert.equal(falloff("constant", 0.99), 1);
});

test("draw raises the middle most, leaves the far points alone, and inverts", () => {
	const g = grid();
	const mid = middle(g);
	const st = beginStroke(g.points, g.faces, opts("draw"));
	for (let k = 0; k < 5; k++) dab(st, { at: [0, 0, 0], n: up });
	const z = st.points.map((p) => p[2]);
	assert.ok(z[mid] > 0.1, `middle raised ${z[mid]}`);
	assert.ok(z.every((v) => v <= z[mid] + 1e-9));
	assert.equal(z[0], 0, "a corner far off stays");
	const inv = beginStroke(g.points, g.faces, opts("draw", { invert: true }));
	dab(inv, { at: [0, 0, 0], n: up });
	assert.ok(inv.points[mid][2] < 0);
});

test("every brush moves something under it and nothing out of reach", () => {
	for (const b of BRUSHES) {
		const g = grid();
		const st = beginStroke(g.points, g.faces, opts(b.kind));
		// a little relief first, so the plane brushes have something to flatten
		st.points[middle(g)] = [0, 0, 0.1];
		const motion: V3 = [0.05, 0, 0];
		dab(st, { at: [0, 0, 0], n: up, motion, total: [0.2, 0, 0], angle: 0.5 });
		dab(st, { at: [0.05, 0, 0], n: up, motion, total: [0.25, 0, 0], angle: 0.6 });
		const moved = st.points.some((p, i) => Math.hypot(p[0] - g.points[i][0], p[1] - g.points[i][1], p[2] - g.points[i][2]) > 1e-4 && i !== middle(g));
		if (b.kind === "mask") assert.ok([...st.mask].some((m) => m > 0), "mask paints");
		else assert.ok(moved || b.kind === "fill" || b.kind === "smooth" || b.kind === "flatten" || b.kind === "scrape", `${b.kind} moves points`);
		if (b.kind !== "elastic") assert.deepEqual(st.points[0], g.points[0], `${b.kind} leaves a far corner`);
	}
});

test("smooth and flatten take a bump down; inflate grows a ball", () => {
	const g = grid();
	const mid = middle(g);
	for (const b of ["smooth", "flatten", "scrape"] as Brush[]) {
		const st = beginStroke(g.points, g.faces, opts(b));
		st.points[mid] = [0, 0, 0.3];
		for (let k = 0; k < 4; k++) dab(st, { at: [0, 0, 0], n: up });
		assert.ok(st.points[mid][2] < 0.3, `${b} lowers the bump (${st.points[mid][2]})`);
	}
	const bl = ball();
	const st = beginStroke(bl.points, bl.faces, opts("inflate", { radius: 5 }));
	dab(st, { at: [0, 0, 1], n: up });
	const r = (p: V3) => Math.hypot(...p);
	assert.ok(st.points.every((p, i) => r(p) >= r(bl.points[i]) - 1e-9));
});

test("layer raises to one height however often it passes", () => {
	const g = grid();
	const mid = middle(g);
	const st = beginStroke(g.points, g.faces, opts("layer"));
	dab(st, { at: [0, 0, 0], n: up });
	const once = st.points[mid][2];
	for (let k = 0; k < 5; k++) dab(st, { at: [0, 0, 0], n: up });
	assert.ok(once > 0);
	assert.ok(Math.abs(st.points[mid][2] - once) < 1e-9, "no higher on later passes");
});

test("grab carries what it held by the whole movement, from where it was", () => {
	const g = grid();
	const mid = middle(g);
	const st = beginStroke(g.points, g.faces, opts("grab"));
	dab(st, { at: [0, 0, 0], n: up, total: [0, 0, 0.2] });
	dab(st, { at: [0, 0, 0], n: up, total: [0, 0, 0.5] });
	assert.ok(Math.abs(st.points[mid][2] - 0.5) < 1e-9, "the middle follows the pointer exactly");
	assert.deepEqual(st.points[0], g.points[0]);
});

test("the mask holds points still, and Front Faces Only spares the back", () => {
	const g = grid();
	const mid = middle(g);
	const mask = new Float32Array(g.points.length);
	mask[mid] = 1;
	const st = beginStroke(g.points, g.faces, opts("draw", { mask }));
	dab(st, { at: [0, 0, 0], n: up });
	assert.equal(st.points[mid][2], 0);
	const bl = ball();
	const fr = beginStroke(bl.points, bl.faces, opts("inflate", { radius: 5, frontOnly: true }));
	dab(fr, { at: [0, 0, 1], n: up });
	bl.points.forEach((p, i) => {
		if (p[2] < -0.2) assert.deepEqual(fr.points[i], p, "a point on the back stays");
	});
});

test("symmetry across x does the mirrored dab; radial turns it round", () => {
	assert.equal(symmetries([true, false, false]).length, 2);
	assert.equal(symmetries([true, true, true]).length, 8);
	assert.equal(symmetries([false, false, false], { axis: 2, count: 6 }).length, 6);
	const g = grid();
	const st = beginStroke(g.points, g.faces, opts("draw", { radius: 0.3, sym: symmetries([true, false, false]) }));
	dab(st, { at: [0.5, 0, 0], n: up });
	const at = (x: number) => st.points[g.points.findIndex((p) => Math.abs(p[0] - x) < 1e-9 && p[1] === 0)][2];
	assert.ok(at(0.5) > 0);
	assert.ok(Math.abs(at(-0.5) - at(0.5)) < 1e-9, "the mirror rises alike");
	assert.equal(at(0), 0, "the middle is out of either reach");
});

test("topology auto-masking keeps a stroke to the piece under it", () => {
	const a = grid(10);
	// a second sheet just above the first, joined to nothing
	const n = a.points.length;
	const points: V3[] = [...a.points, ...a.points.map((p): V3 => [p[0], p[1], 0.05])];
	const faces = [...a.faces, ...a.faces.map((f) => f.map((v) => v + n))];
	const st = beginStroke(points, faces, opts("draw", { topology: true }));
	dab(st, { at: [0, 0, 0], n: up });
	assert.ok(st.points.slice(0, n).some((p) => p[2] > 0));
	assert.ok(st.points.slice(n).every((p) => p[2] === 0.05), "the other sheet stays");
});

test("filters: inflate, scale and random over what the mask leaves", () => {
	const bl = ball();
	const r = (p: V3) => Math.hypot(...p);
	const inflated = filterMesh(bl.points, bl.faces, "inflate", 0.1);
	inflated.forEach((p, i) => assert.ok(Math.abs(r(p) - r(bl.points[i]) - 0.1) < 0.02));
	const mask = new Float32Array(bl.points.length).fill(1);
	assert.deepEqual(filterMesh(bl.points, bl.faces, "scale", 1, mask), bl.points);
	const a = filterMesh(bl.points, bl.faces, "random", 0.1, null, 7);
	const b = filterMesh(bl.points, bl.faces, "random", 0.1, null, 7);
	assert.deepEqual(a, b, "the same seed, the same noise");
});

test("the mask grows, shrinks, inverts and clears by rings", () => {
	const g = grid(4);
	const mid = middle(g);
	const m = new Float32Array(g.points.length);
	m[mid] = 1;
	const grown = reshapeMask(m, g.faces, "grow");
	assert.equal(grown.filter((v) => v === 1).length, 1 + neighbours(g.points.length, g.faces)[mid].length);
	assert.deepEqual([...reshapeMask(grown, g.faces, "shrink")], [...m]);
	assert.equal(reshapeMask(m, g.faces, "invert")[mid], 0);
	assert.ok(reshapeMask(m, g.faces, "clear").every((v) => v === 0));
});

test("a flat grid's normals face +z", () => {
	const g = grid(3);
	for (const n of vertexNormals(g.points, g.faces)) assert.deepEqual(n.map((x) => Math.round(x * 1e6) / 1e6 + 0), [0, 0, 1]);
});
