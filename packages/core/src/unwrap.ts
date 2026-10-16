// Unwrapping (1.10): explicit uvs nobody writes by hand. A mesh's faces
// are sorted by the axis their normal leans on, the six ways box mapping
// sorts them; neighbours that agree make an island, laid flat as seen
// from outside (never mirrored); the islands are packed on shelves into
// one cell. Several meshes that wear one texture share the sheet. This is
// what a boxy thing wants (a crate, a bag, a head); it is not an unfolder.

import type { MeshShape, Vec2, Vec3 } from "./types.ts";
import { faceNormal } from "./space3.ts";

export interface UnwrapOptions {
	/** the gap between islands and round the sheet, as a fraction of the sheet's width; 0.02 by default */
	margin?: number;
}

/** An island's flat coordinates for a point, seen from outside the face group `g` (axis × 2 + 1 when the normal is negative). */
function flat(p: Vec3, g: number): Vec2 {
	switch (g) {
		case 0: return [p[2], p[1]]; // +x: the right side
		case 1: return [-p[2], p[1]]; // −x: the left side
		case 2: return [p[0], p[2]]; // +y: underneath
		case 3: return [p[0], -p[2]]; // −y: the top
		case 4: return [-p[0], p[1]]; // +z: the back
		default: return [p[0], p[1]]; // −z: the front
	}
}

interface Island {
	mesh: number;
	faces: number[];
	g: number;
	min: Vec2;
	size: Vec2;
	at: Vec2;
}

/** uvs for each mesh, `uvs[mesh][face][corner]`, in the pattern coordinates of a texture with this cell. */
export function unwrapMeshes(meshes: readonly MeshShape[], cell: Vec2, opts: UnwrapOptions = {}): Vec2[][][] {
	const islands: Island[] = [];
	meshes.forEach((mesh, mi) => {
		const group = mesh.faces.map((f) => {
			const n = faceNormal(mesh.points, f);
			const a = [Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])];
			const axis = a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2;
			return axis * 2 + (n[axis] < 0 ? 1 : 0);
		});
		// faces that share an edge and a group are one island
		const parent = mesh.faces.map((_, i) => i);
		const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
		const byEdge = new Map<string, number>();
		mesh.faces.forEach((f, fi) => {
			for (let i = 0; i < f.length; i++) {
				const a = f[i];
				const b = f[(i + 1) % f.length];
				const k = a < b ? `${a},${b}` : `${b},${a}`;
				const other = byEdge.get(k);
				if (other === undefined) byEdge.set(k, fi);
				else if (group[other] === group[fi]) parent[find(fi)] = find(other);
			}
		});
		const byRoot = new Map<number, Island>();
		mesh.faces.forEach((f, fi) => {
			const root = find(fi);
			let is = byRoot.get(root);
			if (!is) {
				is = { mesh: mi, faces: [], g: group[fi], min: [Infinity, Infinity], size: [0, 0], at: [0, 0] };
				byRoot.set(root, is);
				islands.push(is);
			}
			is.faces.push(fi);
			for (const i of f) {
				const p = flat(mesh.points[i], is.g);
				is.min = [Math.min(is.min[0], p[0]), Math.min(is.min[1], p[1])];
				is.size = [Math.max(is.size[0], p[0]), Math.max(is.size[1], p[1])];
			}
		});
		for (const is of byRoot.values()) is.size = [is.size[0] - is.min[0], is.size[1] - is.min[1]];
	});
	const out: Vec2[][][] = meshes.map((m) => m.faces.map(() => []));
	if (!islands.length) return out;

	// shelves: tallest first, left to right; try a spread of sheet widths and keep the one that fits the cell largest
	const margin = opts.margin ?? 0.02;
	const order = [...islands].sort((a, b) => b.size[1] - a.size[1] || b.size[0] - a.size[0]);
	const widest = Math.max(...order.map((i) => i.size[0]));
	const total = order.reduce((s, i) => s + i.size[0], 0);
	let best: { scale: number; at: Vec2[]; gap: number } | null = null;
	const STEPS = 32;
	for (let s = 0; s <= STEPS; s++) {
		const inner = widest + ((total - widest) * s) / STEPS;
		const gap = (margin * inner) / Math.max(1e-9, 1 - margin * 2);
		const at: Vec2[] = [];
		let x = gap;
		let y = gap;
		let row = 0;
		let w = 0;
		for (const is of order) {
			if (x > gap && x + is.size[0] > gap + inner + 1e-9) {
				x = gap;
				y += row + gap;
				row = 0;
			}
			at.push([x, y]);
			x += is.size[0] + gap;
			w = Math.max(w, x);
			row = Math.max(row, is.size[1]);
		}
		const h = y + row + gap;
		const scale = Math.min(cell[0] / Math.max(w, 1e-9), cell[1] / Math.max(h, 1e-9));
		if (!best || scale > best.scale) best = { scale, at, gap };
	}
	const r4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0;
	order.forEach((is, k) => {
		const mesh = meshes[is.mesh];
		const [ox, oy] = best!.at[k];
		for (const fi of is.faces) {
			out[is.mesh][fi] = mesh.faces[fi].map((i) => {
				const p = flat(mesh.points[i], is.g);
				return [r4((p[0] - is.min[0] + ox) * best!.scale), r4((p[1] - is.min[1] + oy) * best!.scale)];
			});
		}
	});
	return out;
}

/** One mesh's uvs over the whole cell. */
export function unwrapMesh(mesh: MeshShape, cell: Vec2, opts: UnwrapOptions = {}): Vec2[][] {
	return unwrapMeshes([mesh], cell, opts)[0];
}

/**
 * Unwrap every textured mesh of a document (or of the named parts), each
 * texture's meshes sharing its sheet, and write the uvs into their
 * mappings. Returns how many shapes were unwrapped.
 */
export function unwrapDoc(doc: { parts?: { name: string; shapes?: unknown[] }[]; textures?: { name: string; cell: Vec2 }[] }, opts: UnwrapOptions & { parts?: readonly string[]; texture?: string } = {}): number {
	let n = 0;
	for (const t of doc.textures ?? []) {
		if (opts.texture !== undefined && opts.texture !== t.name) continue;
		const meshes: MeshShape[] = [];
		for (const part of doc.parts ?? []) {
			if (opts.parts?.length && !opts.parts.includes(part.name)) continue;
			for (const sh of (part.shapes ?? []) as MeshShape[]) if (sh.kind === "mesh" && sh.texture === t.name) meshes.push(sh);
		}
		const uvs = unwrapMeshes(meshes, t.cell, opts);
		meshes.forEach((m, i) => {
			m.mapping = { ...(m.mapping ?? {}), uvs: uvs[i] };
			delete m.mapping.scale;
			n++;
		});
	}
	return n;
}
