// Solids (1.3): the helpers that make meshes worth having, shared by the
// studio's tools, the example generators, and any script an agent
// writes. Boxes, extruded profiles and lathed profiles come out wound
// outward whatever the input's order; windOutward fixes any closed mesh;
// ballMesh and rodMesh tessellate the round kinds; triMesh flattens a
// shape into the triangle list a renderer uploads; Y_UP takes the
// format's y-down frame to the y-up one most engines use.

import type { BallShape, Doc3, MeshShape, Part3, RodShape, Shape3, StatePart3, SweepShape, Vec2, Vec3 } from "./types.ts";
import { pathPoints, pathPoints3 } from "./curves.ts";
import { applyMods } from "./mods.ts";
import { bakedSurface, cageHash, cornerNormals, smoothNormals, surfaceOf, uvHash } from "./subdiv.ts";
import { faceNormal, shapesOf3Posed, triangulateFace, v3cross, v3dot, v3norm, v3sub, type Xf3 } from "./space3.ts";

export type Axis = "x" | "y" | "z";

const r3 = (x: number) => Math.round(x * 1000) / 1000 + 0;
const round = (p: Vec3): Vec3 => [r3(p[0]), r3(p[1]), r3(p[2])];

/**
 * Make every face of a closed mesh wind outward: neighbours are made to
 * agree across shared edges, then the whole is flipped if its signed
 * volume comes out negative. Concave solids are fine. The mesh is
 * returned, changed in place; `tris` are dropped (bake them again).
 */
export function windOutward(mesh: MeshShape): MeshShape {
	const faces = mesh.faces.map((f) => [...f]);
	const n = faces.length;
	if (!n) return mesh;
	// directed edges of each face, for finding neighbours
	const byEdge = new Map<string, { face: number; dir: 1 | -1 }[]>();
	const edges = (f: number[]) => f.map((a, i) => [a, f[(i + 1) % f.length]] as [number, number]);
	const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
	faces.forEach((f, fi) => {
		for (const [a, b] of edges(f)) {
			const k = key(a, b);
			const list = byEdge.get(k) ?? [];
			list.push({ face: fi, dir: a < b ? 1 : -1 });
			byEdge.set(k, list);
		}
	});
	const seen = new Array<boolean>(n).fill(false);
	for (let start = 0; start < n; start++) {
		if (seen[start]) continue;
		seen[start] = true;
		const queue = [start];
		while (queue.length) {
			const fi = queue.shift()!;
			for (const [a, b] of edges(faces[fi])) {
				const mine = a < b ? 1 : -1;
				for (const nb of byEdge.get(key(a, b)) ?? []) {
					if (nb.face === fi || seen[nb.face]) continue;
					// a consistent neighbour walks the shared edge the other way
					const theirs = faces[nb.face].some((x, i) => x === a && faces[nb.face][(i + 1) % faces[nb.face].length] === b) ? mine : -mine;
					if (theirs === mine) faces[nb.face].reverse();
					seen[nb.face] = true;
					queue.push(nb.face);
				}
			}
		}
	}
	let vol = 0;
	for (const f of faces) {
		const tris = triangulateFace(mesh.points, f);
		for (let i = 0; i + 2 < tris.length; i += 3) {
			const a = mesh.points[tris[i]];
			const b = mesh.points[tris[i + 1]];
			const c = mesh.points[tris[i + 2]];
			vol += v3dot(a, v3cross(b, c));
		}
	}
	mesh.faces = vol < 0 ? faces.map((f) => f.reverse()) : faces;
	delete mesh.tris;
	return mesh;
}

/** A box centred at `center`, `size` along x, y, z. */
export function box(color: string, center: Vec3, size: Vec3): MeshShape {
	const h: Vec3 = [size[0] / 2, size[1] / 2, size[2] / 2];
	const points: Vec3[] = [];
	for (const dz of [-1, 1]) for (const dy of [-1, 1]) for (const dx of [-1, 1]) points.push(round([center[0] + dx * h[0], center[1] + dy * h[1], center[2] + dz * h[2]]));
	const faces = [
		[0, 1, 3, 2],
		[4, 5, 7, 6],
		[0, 1, 5, 4],
		[2, 3, 7, 6],
		[0, 2, 6, 4],
		[1, 3, 7, 5],
	];
	return windOutward({ kind: "mesh", color, points, faces });
}

/** A profile point onto an axis-aligned plane: for axis x the profile is [z, y]; y: [x, z]; z: [x, y]. */
function lift(axis: Axis, along: number, uv: Vec2): Vec3 {
	if (axis === "x") return [along, uv[1], uv[0]];
	if (axis === "y") return [uv[0], along, uv[1]];
	return [uv[0], uv[1], along];
}

/**
 * A profile (three or more points, either way round, concave is fine)
 * extruded along an axis from `from` to `to`: a prism. The classic way
 * to build a low-poly thing is to draw its side and extrude it.
 */
export function extrude(color: string, profile: Vec2[], axis: Axis, from: number, to: number): MeshShape {
	const n = profile.length;
	const points: Vec3[] = [...profile.map((uv) => round(lift(axis, from, uv))), ...profile.map((uv) => round(lift(axis, to, uv)))];
	const faces: number[][] = [profile.map((_, i) => i), profile.map((_, i) => i + n)];
	for (let i = 0; i < n; i++) {
		const j = (i + 1) % n;
		faces.push([i, j, j + n, i + n]);
	}
	return windOutward({ kind: "mesh", color, points, faces });
}

/**
 * A profile of [radius, along] pairs revolved about an axis, in
 * `segments` steps: a barrel, a bottle, a wheel. A zero radius is a
 * point on the axis (an apex); an open end (radius above 0 at either
 * end of the profile) is capped.
 */
export function lathe(color: string, profile: Vec2[], axis: Axis, segments = 12): MeshShape {
	const points: Vec3[] = [];
	const rings: number[][] = [];
	const ring = (r: number, t: number): number[] => {
		if (r <= 0) {
			points.push(round(lift(axis, t, [0, 0])));
			return [points.length - 1];
		}
		const out: number[] = [];
		for (let k = 0; k < segments; k++) {
			const th = (k / segments) * Math.PI * 2;
			points.push(round(lift(axis, t, [r * Math.cos(th), r * Math.sin(th)])));
			out.push(points.length - 1);
		}
		return out;
	};
	for (const [r, t] of profile) rings.push(ring(r, t));
	const faces: number[][] = [];
	for (let i = 0; i + 1 < rings.length; i++) {
		const a = rings[i];
		const b = rings[i + 1];
		if (a.length === 1 && b.length === 1) continue;
		for (let k = 0; k < segments; k++) {
			const k2 = (k + 1) % segments;
			if (a.length === 1) faces.push([a[0], b[k2], b[k]]);
			else if (b.length === 1) faces.push([a[k], a[k2], b[0]]);
			else faces.push([a[k], a[k2], b[k2], b[k]]);
		}
	}
	if (rings[0].length > 1) faces.push([...rings[0]]);
	const last = rings[rings.length - 1];
	if (last.length > 1) faces.push([...last]);
	return windOutward({ kind: "mesh", color, points, faces });
}

/** A ball as a mesh: `rings` from pole to pole, `segments` around. */
export function ballMesh(ball: BallShape, rings = 7, segments = 12): MeshShape {
	const profile: Vec2[] = [];
	for (let i = 0; i <= rings; i++) {
		const ph = (i / rings) * Math.PI;
		profile.push([ball.r * Math.sin(ph), ball.at[1] - ball.r * Math.cos(ph)]);
	}
	const m = lathe(ball.color ?? "", profile, "y", segments);
	m.points = m.points.map((p) => round([p[0] + ball.at[0], p[1], p[2] + ball.at[2]]));
	if (ball.shade !== undefined) m.shade = ball.shade;
	return m;
}

/** A rod as a mesh: a cylinder with flat ends, `sides` around. */
export function rodMesh(rod: RodShape, sides = 10): MeshShape {
	const d = v3sub(rod.b, rod.a);
	const len = Math.hypot(d[0], d[1], d[2]);
	const m = lathe(rod.color ?? "", [[0, 0], [rod.w / 2, 0], [rod.w / 2, len], [0, len]], "y", sides);
	if (len < 1e-9) return m;
	// turn y onto the axis, then move to a
	const w = v3norm(d);
	const seed: Vec3 = Math.abs(w[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
	const u = v3norm(v3cross(w, seed));
	const v = v3cross(w, u);
	m.points = m.points.map((p) => round([rod.a[0] + u[0] * p[0] + w[0] * p[1] + v[0] * p[2], rod.a[1] + u[1] * p[0] + w[1] * p[1] + v[1] * p[2], rod.a[2] + u[2] * p[0] + w[2] * p[1] + v[2] * p[2]]));
	if (rod.shade !== undefined) m.shade = rod.shade;
	return windOutward(m);
}

/** Box mapping (1.5): a face's pattern coordinates from the two axes across its dominant normal, world units over scale. */
export function boxUV(p: Vec3, normal: Vec3, scale = 1): Vec2 {
	const s = scale === 0 ? 1 : scale;
	const ax = Math.abs(normal[0]);
	const ay = Math.abs(normal[1]);
	const az = Math.abs(normal[2]);
	if (ax >= ay && ax >= az) return [p[2] / s, p[1] / s];
	if (ay >= az) return [p[0] / s, p[2] / s];
	return [p[0] / s, p[1] / s];
}

/** A shape's pattern coordinates per face and corner (1.5): its explicit uvs, else box mapped over the mesh it is. */
export function meshUVs(sh: Shape3): Vec2[][] {
	const m = asMesh(sh);
	const mapping = sh.mapping;
	// (a smoothed mesh's explicit coordinates are its surface's: subdivided with the faces, 1.7)
	const uvs = m.mapping?.uvs ?? mapping?.uvs;
	if (uvs && uvs.length === m.faces.length) return uvs;
	const scale = mapping?.scale ?? 1;
	return m.faces.map((f) => {
		const n = faceNormal(m.points, f);
		return f.map((i) => boxUV(m.points[i], n, scale));
	});
}

/** What shapes a pipe (1.8) besides its path. */
export interface PipeOptions {
	/** the section's scale: a round pipe's radius; 1 when absent */
	radius?: number;
	/** one factor per path point, multiplying the radius there, linear between */
	radii?: number[];
	/** sides of the round section, 8 by default */
	segments?: number;
	/** close the ends of an open pipe (the default) */
	caps?: boolean;
	/** join the path's last point to its first */
	closed?: boolean;
	/** a closed section in place of the circle, either way round */
	profile?: Vec2[];
}

/**
 * A section carried along a path in space: a tube, a horn, a plume, a
 * strap. The path is a path body with three coordinates, flattened at the
 * path tolerance. The section keeps its bearing by parallel transport,
 * so it does not twist; a closed path spreads what twist a circuit leaves
 * evenly along itself. Faces come out wound outward: the sides ring by
 * ring, then the cap at the start and the cap at the end. A radius of 0
 * at an open end is an apex.
 */
export function pipe(color: string, path: { points: Vec3[]; in?: Vec3[]; out?: Vec3[] }, opts: PipeOptions = {}): MeshShape {
	const empty: MeshShape = { kind: "mesh", color, points: [], faces: [] };
	const closed = !!opts.closed;
	const flat = pathPoints3(path, closed);
	// a point that sits on the one before it has no direction to offer
	const P: Vec3[] = [];
	const at: number[] = [];
	const apart = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 1e-9;
	flat.points.forEach((p, i) => {
		if (P.length && !apart(p, P[P.length - 1])) return;
		P.push(p);
		at.push(flat.at[i]);
	});
	if (closed && P.length > 1 && !apart(P[0], P[P.length - 1])) {
		P.pop();
		at.pop();
	}
	const m = P.length;
	if (m < (closed ? 3 : 2)) return empty;
	const n = path.points.length;
	const radius = opts.radius ?? 1;
	const radii = opts.radii && opts.radii.length === n ? opts.radii : null;
	const scaleAt = (t: number): number => {
		if (!radii) return radius;
		const i = Math.max(0, Math.min(n - 1, Math.floor(t)));
		if (!closed && i >= n - 1) return radius * radii[n - 1];
		const u = t - i;
		return radius * (radii[i] * (1 - u) + radii[(i + 1) % n] * u);
	};
	let section: Vec2[];
	if (opts.profile && opts.profile.length >= 3) {
		section = opts.profile.map((p) => [p[0], p[1]]);
		let area = 0;
		section.forEach((p, i) => {
			const q = section[(i + 1) % section.length];
			area += p[0] * q[1] - q[0] * p[1];
		});
		if (area < 0) section.reverse();
	} else {
		const sides = Math.max(3, Math.round(opts.segments ?? 8));
		section = [];
		for (let k = 0; k < sides; k++) section.push([Math.cos((k / sides) * Math.PI * 2), Math.sin((k / sides) * Math.PI * 2)]);
	}
	// tangents: along the one segment at an open end, between the two segments elsewhere
	const dir = (i: number): Vec3 => v3norm(v3sub(P[(i + 1) % m], P[i]));
	const T: Vec3[] = [];
	for (let i = 0; i < m; i++) {
		if (!closed && i === 0) T.push(dir(0));
		else if (!closed && i === m - 1) T.push(dir(m - 2));
		else {
			const a = dir((i + m - 1) % m);
			const b = dir(i);
			const sum: Vec3 = [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
			T.push(Math.hypot(sum[0], sum[1], sum[2]) < 1e-9 ? b : v3norm(sum));
		}
	}
	const square = (nrm: Vec3, t: Vec3): Vec3 => {
		const d = v3dot(nrm, t);
		return v3norm([nrm[0] - t[0] * d, nrm[1] - t[1] * d, nrm[2] - t[2] * d]);
	};
	/** v turned about the unit axis k */
	const turn = (v: Vec3, k: Vec3, c: number, sn: number): Vec3 => {
		const kxv = v3cross(k, v);
		const kd = v3dot(k, v) * (1 - c);
		return [v[0] * c + kxv[0] * sn + k[0] * kd, v[1] * c + kxv[1] * sn + k[1] * kd, v[2] * c + kxv[2] * sn + k[2] * kd];
	};
	/** a normal carried from tangent a to tangent b by the shortest turn between them */
	const carry = (nrm: Vec3, a: Vec3, b: Vec3): Vec3 => {
		const axis = v3cross(a, b);
		const sn = Math.hypot(axis[0], axis[1], axis[2]);
		if (sn < 1e-12) return square(nrm, b);
		return square(turn(nrm, [axis[0] / sn, axis[1] / sn, axis[2] / sn], v3dot(a, b), sn), b);
	};
	// the first normal: the axis the path leans on least, squared off against the tangent
	const t0 = T[0].map(Math.abs);
	const seed: Vec3 = t0[0] <= t0[1] && t0[0] <= t0[2] ? [1, 0, 0] : t0[1] <= t0[2] ? [0, 1, 0] : [0, 0, 1];
	const N: Vec3[] = [square(seed, T[0])];
	for (let i = 1; i < m; i++) N.push(carry(N[i - 1], T[i - 1], T[i]));
	if (closed) {
		const back = carry(N[m - 1], T[m - 1], T[0]);
		const twist = Math.atan2(v3dot(v3cross(back, N[0]), T[0]), v3dot(back, N[0]));
		for (let i = 1; i < m; i++) {
			const a = (twist * i) / m;
			N[i] = square(turn(N[i], T[i], Math.cos(a), Math.sin(a)), T[i]);
		}
	}
	const points: Vec3[] = [];
	const rings: number[][] = [];
	for (let i = 0; i < m; i++) {
		const s = scaleAt(at[i]);
		if (!closed && (i === 0 || i === m - 1) && s <= 0) {
			points.push(round(P[i]));
			rings.push([points.length - 1]);
			continue;
		}
		const B = v3cross(T[i], N[i]);
		const ring: number[] = [];
		for (const [x, y] of section) {
			points.push(round([P[i][0] + s * (x * N[i][0] + y * B[0]), P[i][1] + s * (x * N[i][1] + y * B[1]), P[i][2] + s * (x * N[i][2] + y * B[2])]));
			ring.push(points.length - 1);
		}
		rings.push(ring);
	}
	const faces: number[][] = [];
	const K = section.length;
	for (let i = 0; i < (closed ? m : m - 1); i++) {
		const a = rings[i];
		const b = rings[(i + 1) % m];
		if (a.length === 1 && b.length === 1) continue;
		for (let k = 0; k < K; k++) {
			const k2 = (k + 1) % K;
			if (a.length === 1) faces.push([a[0], b[k2], b[k]]);
			else if (b.length === 1) faces.push([a[k], a[k2], b[0]]);
			else faces.push([a[k], a[k2], b[k2], b[k]]);
		}
	}
	if (!closed && opts.caps !== false) {
		if (rings[0].length > 1) faces.push([...rings[0]].reverse());
		if (rings[m - 1].length > 1) faces.push([...rings[m - 1]]);
	}
	return { kind: "mesh", color, points, faces };
}

/** What shapes a rail (1.11) besides its path and its profile. */
export interface RailOptions {
	/** the axis the profile stands along: its second coordinate runs that way. y when absent */
	axis?: Axis;
	/** the radius the path's corners are rounded to; 0 or absent leaves them sharp */
	round?: number;
	/** steps in a quarter turn of a rounded corner, 4 by default */
	segments?: number;
	/** join the path's last point to its first */
	closed?: boolean;
	/** the profile is a closed outline (a moulding, a kerb); open when absent (a face, a skirt) */
	solid?: boolean;
	/** close the ends of a solid profile on an open path (the default) */
	caps?: boolean;
}

/**
 * The path a rail runs along, its corners rounded: each corner cut back
 * by `radius` (or by half the shorter of its two segments, where that
 * is less) and joined by an arc in the plane of the two, `steps` to a
 * quarter turn. A straight run and a path that doubles back keep their
 * point.
 */
export function roundCorners(points: Vec3[], radius: number, steps: number, closed: boolean): Vec3[] {
	const n = points.length;
	if (!(radius > 0) || n < 3) return points.map((p) => [...p] as Vec3);
	const out: Vec3[] = [];
	for (let i = 0; i < n; i++) {
		const P = points[i];
		if (!closed && (i === 0 || i === n - 1)) {
			out.push([...P] as Vec3);
			continue;
		}
		const A = v3sub(points[(i + n - 1) % n], P);
		const B = v3sub(points[(i + 1) % n], P);
		const la = Math.hypot(A[0], A[1], A[2]);
		const lb = Math.hypot(B[0], B[1], B[2]);
		if (la < 1e-9 || lb < 1e-9) {
			out.push([...P] as Vec3);
			continue;
		}
		const a: Vec3 = [A[0] / la, A[1] / la, A[2] / la];
		const b: Vec3 = [B[0] / lb, B[1] / lb, B[2] / lb];
		// the angle between the two segments at the corner, and how far the path turns there
		const inside = Math.acos(Math.max(-1, Math.min(1, v3dot(a, b))));
		const turn = Math.PI - inside;
		if (turn < 1e-6 || inside < 1e-6) {
			out.push([...P] as Vec3);
			continue;
		}
		const d = Math.min(radius / Math.tan(inside / 2), la / 2, lb / 2);
		const r = d * Math.tan(inside / 2);
		const mid = v3norm([a[0] + b[0], a[1] + b[1], a[2] + b[2]]);
		const h = r / Math.sin(inside / 2);
		const C: Vec3 = [P[0] + mid[0] * h, P[1] + mid[1] * h, P[2] + mid[2] * h];
		const v0: Vec3 = [(P[0] + a[0] * d - C[0]) / r, (P[1] + a[1] * d - C[1]) / r, (P[2] + a[2] * d - C[2]) / r];
		const v1: Vec3 = [(P[0] + b[0] * d - C[0]) / r, (P[1] + b[1] * d - C[1]) / r, (P[2] + b[2] * d - C[2]) / r];
		const count = Math.max(1, Math.ceil((turn / (Math.PI / 2)) * steps - 1e-9));
		const sn = Math.sin(turn);
		for (let j = 0; j <= count; j++) {
			const t = j / count;
			const w0 = Math.sin((1 - t) * turn) / sn;
			const w1 = Math.sin(t * turn) / sn;
			out.push([C[0] + r * (w0 * v0[0] + w1 * v1[0]), C[1] + r * (w0 * v0[1] + w1 * v1[1]), C[2] + r * (w0 * v0[2] + w1 * v1[2])]);
		}
	}
	return out;
}

/**
 * A profile carried upright along a path (1.11): a cliff's face, a
 * kerb, a skirting board, a gutter. Where a pipe's section turns with
 * its path, a rail's stands: its second coordinate runs along `axis`
 * wherever the path goes, and its first runs out to the side, level,
 * square to the way the path is going. At a corner the profile stands
 * on the mitre, so a face keeps its distance from the path on both
 * sides of it. An open profile makes a sheet that faces the profile's
 * left as it is drawn; a solid one a moulding, wound outward.
 */
export function rail(color: string, path: { points: Vec3[]; in?: Vec3[]; out?: Vec3[] }, profile: Vec2[], opts: RailOptions = {}): MeshShape {
	const empty: MeshShape = { kind: "mesh", color, points: [], faces: [] };
	const closed = !!opts.closed;
	const solid = !!opts.solid;
	const flat = pathPoints3(path, closed).points;
	const steps = Math.max(1, Math.round(opts.segments ?? 4));
	const curved = [path.in, path.out].some((hs) => hs && hs.some((v) => Math.abs(v[0]) > 1e-9 || Math.abs(v[1]) > 1e-9 || Math.abs(v[2]) > 1e-9));
	const spine = curved ? flat : roundCorners(flat, opts.round ?? 0, steps, closed);
	const apart = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 1e-9;
	const P: Vec3[] = [];
	for (const p of spine) if (!P.length || apart(p, P[P.length - 1])) P.push(p);
	if (closed && P.length > 1 && !apart(P[0], P[P.length - 1])) P.pop();
	const m = P.length;
	if (m < (closed ? 3 : 2)) return empty;
	let section = profile.map((p) => [p[0], p[1]] as Vec2);
	if (section.length < (solid ? 3 : 2)) return empty;
	if (solid) {
		let area = 0;
		section.forEach((p, i) => {
			const q = section[(i + 1) % section.length];
			area += p[0] * q[1] - q[0] * p[1];
		});
		if (area < 0) section = section.reverse();
	}
	const ax = opts.axis ?? "y";
	const A: Vec3 = ax === "x" ? [1, 0, 0] : ax === "y" ? [0, 1, 0] : [0, 0, 1];
	// each segment's way, level: what is left of its direction with the axis taken out. A segment that runs straight
	// along the axis has none, and takes its neighbour's
	const segs = closed ? m : m - 1;
	const H: (Vec3 | null)[] = [];
	for (let i = 0; i < segs; i++) {
		const d = v3sub(P[(i + 1) % m], P[i]);
		const k = v3dot(d, A);
		const h: Vec3 = [d[0] - A[0] * k, d[1] - A[1] * k, d[2] - A[2] * k];
		H.push(Math.hypot(h[0], h[1], h[2]) < 1e-9 ? null : v3norm(h));
	}
	for (let i = 1; i < segs; i++) if (!H[i]) H[i] = H[i - 1];
	for (let i = segs - 2; i >= 0; i--) if (!H[i]) H[i] = H[i + 1];
	if (closed && !H[0]) H[0] = H[segs - 1];
	if (H.some((h) => !h)) return empty;
	// out to the side of each segment: the axis crossed with its way
	const O = (H as Vec3[]).map((h) => v3cross(A, h));
	const points: Vec3[] = [];
	const rings: number[][] = [];
	for (let i = 0; i < m; i++) {
		let side: Vec3;
		let reach = 1;
		const before = closed ? O[(i + segs - 1) % segs] : i > 0 ? O[i - 1] : null;
		const after = closed ? O[i % segs] : i < segs ? O[i] : null;
		if (before && after) {
			const sum: Vec3 = [before[0] + after[0], before[1] + after[1], before[2] + after[2]];
			if (Math.hypot(sum[0], sum[1], sum[2]) < 1e-9) side = after;
			else {
				side = v3norm(sum);
				reach = 1 / Math.max(v3dot(side, after), 0.25);
			}
		} else side = (before ?? after)!;
		const ring: number[] = [];
		for (const [x, y] of section) {
			points.push(round([P[i][0] + reach * x * side[0] + y * A[0], P[i][1] + reach * x * side[1] + y * A[1], P[i][2] + reach * x * side[2] + y * A[2]]));
			ring.push(points.length - 1);
		}
		rings.push(ring);
	}
	const faces: number[][] = [];
	const K = section.length;
	const edges = solid ? K : K - 1;
	for (let i = 0; i < segs; i++) {
		const a = rings[i];
		const b = rings[(i + 1) % m];
		for (let k = 0; k < edges; k++) {
			const k2 = (k + 1) % K;
			faces.push([a[k], a[k2], b[k2], b[k]]);
		}
	}
	if (solid && !closed && opts.caps !== false) {
		faces.push([...rings[0]].reverse());
		faces.push([...rings[m - 1]]);
	}
	return { kind: "mesh", color, points, faces };
}

const sweeps = new WeakMap<object, { key: string; mesh: MeshShape }>();

/** The mesh a sweep (1.7) generates: its profile flattened, then lathed or extruded, or (1.8) carried along a path. The cage, before any mods or smoothing. */
export function sweepMesh(sh: SweepShape): MeshShape {
	const key = JSON.stringify([sh.op, sh.axis, sh.profile, sh.segments, sh.from, sh.to, sh.path, sh.radius, sh.radii, sh.caps, sh.closed, sh.round]);
	const hit = sweeps.get(sh);
	if (hit && hit.key === key) return withLook(hit.mesh, sh);
	const none: MeshShape = { kind: "mesh", color: sh.color, points: [], faces: [] };
	let mesh: MeshShape = none;
	if (sh.op === "rail") {
		if (sh.path && Array.isArray(sh.path.points) && sh.profile) {
			const solid = !!sh.profile.closed;
			mesh = rail(sh.color ?? "", sh.path, pathPoints({ ...sh.profile, closed: solid }), { axis: sh.axis, round: sh.round, segments: sh.segments, closed: sh.closed, solid, caps: sh.caps });
		}
	} else if (sh.op === "pipe") {
		const section = sh.profile ? pathPoints({ ...sh.profile, closed: true }) : undefined;
		if (sh.path && Array.isArray(sh.path.points)) mesh = pipe(sh.color ?? "", sh.path, { radius: sh.radius, radii: sh.radii, segments: sh.segments, caps: sh.caps, closed: sh.closed, profile: section });
	} else if (sh.profile) {
		const profile = pathPoints({ ...sh.profile, closed: sh.op === "extrude" ? true : !!sh.profile.closed });
		if (sh.op === "lathe") mesh = lathe(sh.color ?? "", profile, sh.axis ?? "y", Math.max(3, Math.round(sh.segments ?? 12)));
		else if (profile.length >= 3) mesh = extrude(sh.color ?? "", profile, sh.axis ?? "z", sh.from ?? 0, sh.to ?? 1);
	}
	sweeps.set(sh, { key, mesh });
	return withLook(mesh, sh);
}

/** The generated mesh wearing the sweep's own fields (colour, shade, texture, smoothing). */
function withLook(mesh: MeshShape, sh: SweepShape): MeshShape {
	const out: MeshShape = { ...mesh, color: sh.color, shade: sh.shade };
	if (sh.texture) out.texture = sh.texture;
	if (sh.mapping) out.mapping = sh.mapping;
	if (sh.normals) out.normals = sh.normals;
	if (sh.angle !== undefined) out.angle = sh.angle;
	if (sh.smooth) out.smooth = sh.smooth;
	if (sh.creases) out.creases = sh.creases;
	if (sh.colors) out.colors = sh.colors;
	if (sh.paint) out.paint = sh.paint;
	if (sh.mods) out.mods = sh.mods;
	if (sh.bake) out.bake = sh.bake;
	return out;
}

/** A shape's cage as a mesh: itself, a sweep generated, a ball or rod tessellated. Before smoothing. */
export function cageOf(sh: Shape3): MeshShape {
	if (sh.kind === "mesh") return sh;
	if (sh.kind === "sweep") return sweepMesh(sh);
	return sh.kind === "ball" ? ballMesh(sh) : rodMesh(sh);
}

/** A shape's cage with its mods applied (1.8): what `smooth` refines, what collision and the hull read. Without mods, the cage. */
export function builtOf(sh: Shape3): MeshShape {
	return applyMods(cageOf(sh));
}

/** A shape as the mesh a renderer draws: its cage, its mods applied (1.8), subdivided when it is smooth (1.7). */
export function asMesh(sh: Shape3): MeshShape {
	const cage = cageOf(sh);
	if (!cage.mods?.length) return surfaceOf(cage);
	// a bake of this very cage, mods and all, stands in for the work
	const baked = bakedSurface(cage, cageHash(cage));
	if (baked) return baked;
	return surfaceOf(applyMods(cage));
}

/** Is this shape one whose drawn mesh is made, not written: smoothed, modified, or swept? */
function generated(sh: Shape3): sh is MeshShape | SweepShape {
	if (sh.kind === "sweep") return true;
	return sh.kind === "mesh" && ((sh.smooth ?? 0) > 0 || !!sh.mods?.length);
}

/**
 * Write the mesh each generated shape draws into its `bake`: smooth
 * meshes (1.7), shapes with mods and sweeps of every op (1.8), for a
 * reader that will not generate. `of` is the cage's hash; the bake holds
 * paint for its own faces and shades for its own points when the shape
 * has them. Returns how many it wrote.
 */
export function bakeSurfaces(doc: { parts?: { shapes?: unknown[] }[] }): number {
	let count = 0;
	for (const part of doc.parts ?? []) {
		for (const sh of (part.shapes ?? []) as Shape3[]) {
			if (!sh || !generated(sh)) continue;
			const { bake: _old, ...bare } = cageOf(sh);
			void _old;
			const cage = bare as MeshShape;
			if (cage.points.length < 3 || !cage.faces.length) continue;
			const m = surfaceOf(applyMods(cage));
			const tris: number[] = [];
			for (const f of m.faces) tris.push(...triangulateFace(m.points, f));
			const bake: NonNullable<MeshShape["bake"]> = { points: m.points, faces: m.faces, tris, of: cageHash(cage) };
			const cageUV = cage.mapping?.uvs;
			const fits = (uvs: Vec2[][] | undefined, faces: number[][]) => !!uvs && uvs.length === faces.length && uvs.every((f, i) => Array.isArray(f) && f.length === faces[i].length);
			if (fits(cageUV, cage.faces) && fits(m.mapping?.uvs, m.faces)) {
				bake.uvs = m.mapping!.uvs;
				bake.uvOf = uvHash(cageUV!);
			}
			if (m.paint && m.paint.length === m.faces.length) bake.paint = m.paint;
			if (m.shades && m.shades.length === m.points.length) bake.shades = m.shades;
			sh.bake = bake;
			count++;
		}
	}
	return count;
}

/** What a renderer uploads: flat triangles with one normal per face, and the token and shade to paint them. */
export interface TriMesh {
	color?: string;
	shade?: number;
	/** x, y, z per vertex, three vertices per triangle */
	positions: Float32Array;
	/** one normal per vertex, the face's, unit length */
	normals: Float32Array;
	/** triangles */
	count: number;
	/** 1.5: the texture's name, and pattern coordinates per vertex (u, v), when the shape has one */
	texture?: string;
	uvs?: Float32Array;
	/** 1.8: the token each triangle paints, one per triangle, when the shape is painted; absent, every triangle is `color` */
	colors?: string[];
	/** 1.8: the shade at each vertex (three per triangle), when the shape has `shades`; it multiplies `shade` */
	shades?: Float32Array;
}

/** Flatten one shape. Meshes use their baked tris when they have them. */
export function triMesh(sh: Shape3): TriMesh {
	const m = asMesh(sh);
	const tris = meshTris(m);
	const count = tris.length / 3;
	const positions = new Float32Array(count * 9);
	const normals = new Float32Array(count * 9);
	// smooth shading (1.7): a normal per face corner, averaged around the vertex up to sharp edges
	const cage = builtOf(sh);
	const smooth = smoothNormals(cage);
	const cn = smooth ? cornerNormals(m.points, m.faces, { angle: cage.angle, creases: (cage.smooth ?? 0) > 0 ? undefined : cage.creases }) : null;
	const cornerOf = new Map<number, Vec3>();
	if (cn) m.faces.forEach((f, fi) => f.forEach((idx, ci) => cornerOf.set(fi * 1e6 + idx, cn[fi][ci])));
	// a textured shape: pattern coordinates per corner, by face, so a triangle's corners look them up
	let uvs: Float32Array | undefined;
	let cornerUV: Map<number, Vec2> | undefined;
	if (sh.texture) {
		uvs = new Float32Array(count * 6);
		const perFace = meshUVs(sh);
		cornerUV = new Map();
		m.faces.forEach((f, fi) => f.forEach((idx, ci) => cornerUV!.set(fi * 1e6 + idx, perFace[fi][ci])));
	}
	// paint (1.8): the token of each triangle's face; shades: the value at each corner's point
	const painted = !!m.paint && m.paint.length === m.faces.length && m.paint.some((p) => p > 0) && !!m.colors?.length;
	const colors: string[] | undefined = painted ? [] : undefined;
	const shades = m.shades && m.shades.length === m.points.length ? new Float32Array(count * 3) : undefined;
	// which face each triangle came from: triangles run in face order, a face of n corners giving n − 2
	const faceOf: number[] = [];
	if (cn || cornerUV || painted) m.faces.forEach((f, fi) => {
		for (let i = 0; i < f.length - 2; i++) faceOf.push(fi);
	});
	const faceOfTri = (t: number): number => faceOf[t] ?? -1;
	for (let t = 0; t < count; t++) {
		const a = m.points[tris[t * 3]];
		const b = m.points[tris[t * 3 + 1]];
		const c = m.points[tris[t * 3 + 2]];
		const n = v3norm(v3cross(v3sub(b, a), v3sub(c, a)));
		const fiOf = cn || (uvs && cornerUV) || painted ? faceOfTri(t) : -1;
		if (colors) {
			const p = fiOf >= 0 ? m.paint![fiOf] : 0;
			colors.push((p > 0 ? m.colors![p - 1] : undefined) ?? sh.color ?? "");
		}
		if (shades) for (let k = 0; k < 3; k++) shades[t * 3 + k] = m.shades![tris[t * 3 + k]];
		[a, b, c].forEach((p, k) => {
			positions.set(p, t * 9 + k * 3);
			normals.set(cn ? (cornerOf.get(fiOf * 1e6 + tris[t * 3 + k]) ?? n) : n, t * 9 + k * 3);
			if (uvs && cornerUV) {
				const fi = fiOf;
				const uv = cornerUV.get(fi * 1e6 + tris[t * 3 + k]) ?? boxUV(p, n, sh.mapping?.scale ?? 1);
				uvs.set(uv, t * 6 + k * 2);
			}
		});
	}
	const out: TriMesh = { color: sh.color, shade: sh.shade, positions, normals, count };
	if (uvs) {
		out.texture = sh.texture;
		out.uvs = uvs;
	}
	if (colors) out.colors = colors;
	if (shades) out.shades = shades;
	return out;
}

/** The triangles a mesh draws: its baked tris when sound, else each face triangulated. */
export function meshTris(m: MeshShape): number[] {
	const tris = m.tris;
	if (tris && tris.length % 3 === 0 && tris.every((i) => i < m.points.length)) return tris;
	const out: number[] = [];
	for (const f of m.faces) out.push(...triangulateFace(m.points, f));
	return out;
}

/** Every shape of a part (through `like`), flattened; with a pose entry (1.6), as its morph has them. */
export function flattenPart(doc: Doc3, part: Part3, sp?: StatePart3): TriMesh[] {
	return shapesOf3Posed(doc, part, sp).map(triMesh);
}

/** The outward normal of a mesh face, unit length. */
export function faceUnitNormal(mesh: MeshShape, face: number): Vec3 {
	return v3norm(faceNormal(mesh.points, mesh.faces[face]));
}

/**
 * The format is y-down, z-away (right-handed). Most engines are y-up,
 * z-toward-the-viewer (right-handed too): the same frame turned half a
 * turn about x. Lay this on a world map, or on points, to get there.
 */
export const Y_UP: Xf3 = [1, 0, 0, 0, -1, 0, 0, 0, -1, 0, 0, 0];
export function yUp(p: Vec3): Vec3 {
	return [p[0], -p[1], -p[2]];
}
