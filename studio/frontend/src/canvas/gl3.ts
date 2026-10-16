// The solids of a model or a scene, drawn with WebGL under the 2D
// overlay: lit triangles with a depth buffer, so a ball half sunk in a
// face shows its front half whichever way the model is turned.
//
// A part's triangles are built once, in the part's own rest space, and
// kept on the GPU until the part's shapes, colours or textures change.
// A frame is then only uniforms: the view's turn, each part's map into
// the world, the pan and the zoom. Panning, zooming, orbiting and moving
// a node rebuild nothing, and a file placed two thousand times in a
// scene is one buffer drawn two thousand times. The light is worked out
// in the shader, from the same rule the projector uses.

import { asMesh, builtOf, cornerNormals, smoothNormals, colorOf, triangulateFace, meshUVs, shapesOf3Skinned, sourceOf3, worldTransforms3, v3cross, v3dot, v3norm, v3sub, xf3Det, xf3Mul, type Doc3, type Shape3, type StatePart3, type Token, type Vec2, type Vec3, type Xf3 } from "@fastart/core";
import type { TexturePattern } from "../state/textures.ts";
import type { Compiled, CompiledPart } from "../state/sidecarRead.ts";

// p, n: position and normal in the part's rest space. c: the slot's colour. t: pattern coordinates.
// k: (the shape's own shade, 1 for a smooth corner normal). m0..m2: the part's map into the world (rows);
// v0..v2: the view's turn (rows). f: -1 under a mirror, for smooth normals. L: the light, a: ambient.
// g, b (1.10, relief): the pattern's own axes across the triangle, along +u and +v, in rest space; zero where there is none.
const VS = `attribute vec3 p; attribute vec3 n; attribute vec4 c; attribute vec2 t; attribute vec2 k; attribute vec3 g; attribute vec3 b;
uniform vec4 m0; uniform vec4 m1; uniform vec4 m2; uniform vec3 v0; uniform vec3 v1; uniform vec3 v2;
uniform float f; uniform vec3 L; uniform float a; uniform vec3 u; uniform vec2 h;
varying vec4 vc; varying vec2 vt; varying float vl; varying vec3 vn; varying vec3 vb; varying vec3 vg; varying vec3 vh; varying float vk;
void main() {
	vec4 q = vec4(p, 1.0);
	vec3 w = vec3(dot(m0, q), dot(m1, q), dot(m2, q));
	vec3 e = vec3(dot(v0, w), dot(v1, w), dot(v2, w));
	vec3 nw = vec3(dot(m0.xyz, n), dot(m1.xyz, n), dot(m2.xyz, n));
	vec3 ne = normalize(vec3(dot(v0, nw), dot(v1, nw), dot(v2, nw))) * (k.y > 0.5 ? f : 1.0);
	float light = (a + (1.0 - a) * max(0.0, dot(ne, L))) * k.x;
	gl_Position = vec4((e.x - u.x) * u.z / h.x, -(e.y - u.y) * u.z / h.y, e.z / 4000.0, 1.0);
	vc = vec4(min(c.rgb * light, vec3(1.0)), c.a); vt = t; vl = light; vn = ne; vb = c.rgb * k.x; vk = k.x;
	vec3 gw = vec3(dot(m0.xyz, g), dot(m1.xyz, g), dot(m2.xyz, g));
	vec3 bw = vec3(dot(m0.xyz, b), dot(m1.xyz, b), dot(m2.xyz, b));
	vg = vec3(dot(v0, gw), dot(v1, gw), dot(v2, gw)); vh = vec3(dot(v0, bw), dot(v1, bw), dot(v2, bw));
}`;
// a textured triangle: the light on the token (vc), the map's colour laid over where it paints (paint) or multiplying it (mask).
// clay: the light is worked out per pixel from the normal instead (vn, in view space; vb is the slot's own colour): a warm key
// with a soft terminator, a cool fill from the other side, a little rim. Rounded forms read the way a cel or clay shaded game
// shows them. dim: a mannequin's layer, washed toward the canvas (bgc).
// relief (1.10): the texture's normal map (ns) tilts the normal in the pattern's frame (vg along +u, vh along +v, which runs
// down the image while the map's green runs up it), and the light is worked out per pixel from that, by the projector's rule.
const FS = `precision mediump float; varying vec4 vc; varying vec2 vt; varying float vl; varying vec3 vn; varying vec3 vb; varying vec3 vg; varying vec3 vh; varying float vk;
uniform sampler2D s; uniform sampler2D ns; uniform float tex; uniform float mask; uniform float nrm; uniform float amb; uniform float clay; uniform vec3 K; uniform float dim; uniform vec3 bgc;
vec3 soft(vec3 base, vec3 n) {
	float key = smoothstep(-0.28, 0.72, dot(n, K));
	float fill = max(0.0, dot(n, normalize(vec3(-K.x, -0.35 * K.y, K.z))));
	float rim = pow(1.0 - clamp(-n.z, 0.0, 1.0), 3.0);
	vec3 shade = base * vec3(0.55, 0.56, 0.67) + base * vec3(0.05, 0.07, 0.11) * fill;
	vec3 light = base * vec3(1.08, 1.03, 0.95);
	return min(mix(shade, light, key) + vec3(1.0, 0.96, 0.88) * rim * (0.05 + 0.13 * key), vec3(1.0));
}
void main() {
	vec4 o = vc;
	vec3 N = normalize(vn);
	// lit: the token's colour under the light, and the light itself; per vertex, or per pixel under a relief
	vec3 lit = vc.rgb;
	float light = vl;
	if (nrm > 0.5 && dot(vg, vg) > 1e-12 && dot(vh, vh) > 1e-12) {
		vec3 d = texture2D(ns, vt).rgb * 2.0 - 1.0;
		vec3 T = normalize(vg - N * dot(N, vg));
		vec3 B = normalize(vh - N * dot(N, vh));
		N = normalize(T * d.x - B * d.y + N * d.z);
		light = (amb + (1.0 - amb) * max(0.0, dot(N, K))) * vk;
		lit = min(vb * (light / max(vk, 1e-4)), vec3(1.0));
		o = vec4(lit, vc.a);
	}
	if (clay > 0.5) {
		vec3 base = vb;
		if (tex > 0.5) {
			vec4 m = texture2D(s, vt);
			base = mask > 0.5 ? vb * dot(m.rgb, vec3(0.2126, 0.7152, 0.0722)) * m.a : mix(vb, m.rgb, m.a);
		}
		o = vec4(soft(base, N), vc.a);
	} else if (tex > 0.5) {
		vec4 m = texture2D(s, vt);
		if (mask > 0.5) { float v = dot(m.rgb, vec3(0.2126, 0.7152, 0.0722)) * m.a; o = vec4(lit * v, vc.a); }
		else o = vec4(mix(lit, m.rgb * light, m.a), vc.a);
	}
	gl_FragColor = vec4(mix(o.rgb, bgc, dim), o.a);
}`;

/** floats per vertex: position 3, normal 3, colour 4, pattern 2, (shade, smooth) 2, the pattern's axes 3 + 3 */
const STRIDE = 20;

/** The pattern's axes across a triangle: how far a point moves per unit of u, and of v. Zero where the pattern is flat on it. */
function patternAxes(a: ArrayLike<number>, b: ArrayLike<number>, c: ArrayLike<number>, ua: ArrayLike<number>, ub: ArrayLike<number>, uc: ArrayLike<number>): [Vec3, Vec3] {
	const du1 = ub[0] - ua[0];
	const dv1 = ub[1] - ua[1];
	const du2 = uc[0] - ua[0];
	const dv2 = uc[1] - ua[1];
	const det = du1 * dv2 - du2 * dv1;
	if (Math.abs(det) < 1e-12) return [[0, 0, 0], [0, 0, 0]];
	const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
	const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
	return [
		[(e1[0] * dv2 - e2[0] * dv1) / det, (e1[1] * dv2 - e2[1] * dv1) / det, (e1[2] * dv2 - e2[2] * dv1) / det],
		[(e2[0] * du1 - e1[0] * du2) / det, (e2[1] * du1 - e1[1] * du2) / det, (e2[2] * du1 - e1[2] * du2) / det],
	];
}

interface Gl {
	gl: WebGLRenderingContext;
	prog: WebGLProgram;
	attr: Record<"p" | "n" | "c" | "t" | "k" | "g" | "b", number>;
	uni: Record<"m0" | "m1" | "m2" | "v0" | "v1" | "v2" | "f" | "L" | "a" | "u" | "h" | "s" | "ns" | "tex" | "mask" | "nrm" | "amb" | "clay" | "K" | "dim" | "bgc", WebGLUniformLocation>;
	/** uploaded colour maps, by texture name, with the pattern rev they came from */
	textures: Map<string, { tex: WebGLTexture; rev: number }>;
	/** the vertex buffers on this context, and the frame each was last drawn in */
	buffers: Map<Batch, { buf: WebGLBuffer; used: number }>;
	frame: number;
}
const ctxs = new WeakMap<HTMLCanvasElement, Gl | null>();

function setup(canvas: HTMLCanvasElement): Gl | null {
	const have = ctxs.get(canvas);
	if (have !== undefined) return have;
	const gl = canvas.getContext("webgl", { antialias: true, alpha: true, premultipliedAlpha: true, depth: true });
	if (!gl) {
		ctxs.set(canvas, null);
		return null;
	}
	const sh = (type: number, src: string) => {
		const s = gl.createShader(type)!;
		gl.shaderSource(s, src);
		gl.compileShader(s);
		return s;
	};
	const prog = gl.createProgram()!;
	gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
	gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
	gl.linkProgram(prog);
	const a = (name: string) => gl.getAttribLocation(prog, name);
	const u = (name: string) => gl.getUniformLocation(prog, name)!;
	const out: Gl = {
		gl,
		prog,
		attr: { p: a("p"), n: a("n"), c: a("c"), t: a("t"), k: a("k"), g: a("g"), b: a("b") },
		uni: { m0: u("m0"), m1: u("m1"), m2: u("m2"), v0: u("v0"), v1: u("v1"), v2: u("v2"), f: u("f"), L: u("L"), a: u("a"), u: u("u"), h: u("h"), s: u("s"), ns: u("ns"), tex: u("tex"), mask: u("mask"), nrm: u("nrm"), amb: u("amb"), clay: u("clay"), K: u("K"), dim: u("dim"), bgc: u("bgc") },
		textures: new Map(),
		buffers: new Map(),
		frame: 0,
	};
	ctxs.set(canvas, out);
	return out;
}

// templates: a unit sphere and a unit cylinder along z, as triangle index lists
const SPHERE = (() => {
	const R = 7;
	const S = 12;
	const pts: Vec3[] = [];
	for (let i = 0; i <= R; i++) {
		const ph = (i / R) * Math.PI;
		for (let j = 0; j < S; j++) {
			const th = (j / S) * Math.PI * 2;
			pts.push([Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)]);
		}
	}
	const tris: number[] = [];
	for (let i = 0; i < R; i++) {
		for (let j = 0; j < S; j++) {
			const a = i * S + j;
			const b = i * S + ((j + 1) % S);
			const c = (i + 1) * S + j;
			const d = (i + 1) * S + ((j + 1) % S);
			if (i > 0) tris.push(a, c, b);
			if (i < R - 1) tris.push(b, c, d);
		}
	}
	return { pts, tris };
})();
const CYL = (() => {
	const S = 10;
	const pts: Vec3[] = [];
	for (const z of [0, 1]) for (let j = 0; j < S; j++) pts.push([Math.cos((j / S) * Math.PI * 2), Math.sin((j / S) * Math.PI * 2), z]);
	pts.push([0, 0, 0], [0, 0, 1]);
	const tris: number[] = [];
	for (let j = 0; j < S; j++) {
		const a = j;
		const b = (j + 1) % S;
		tris.push(a, b, a + S, b, b + S, a + S);
		tris.push(2 * S, b, a); // the near cap
		tris.push(2 * S + 1, a + S, b + S); // the far cap
	}
	return { pts, tris };
})();

/** The triangles of one part that share a texture (or none) and a culling rule, ready for the GPU. */
interface Batch {
	/** the texture's key (its name and its render's rev), null for plain colour */
	texture: string | null;
	pattern?: TexturePattern;
	/** mesh faces are one-sided (the winding is the format's promise); balls and rods are drawn whichever way they face */
	cull: boolean;
	data: Float32Array;
	count: number;
}
/** A part's shapes as triangles, and a sphere that holds them all (rest space). */
export interface PartMesh {
	batches: Batch[];
	centre: Vec3;
	radius: number;
	/** what the colours and textures were when it was built */
	stamp: string;
}

// built meshes, by the part's shapes (the array's identity: a document's own array while nothing reshapes it)
// and then by the colours that paint them (an instance with its own palette is its own mesh)
const built = new WeakMap<readonly Shape3[], Map<readonly Token[], PartMesh>>();

const stampOf = (solids: readonly Shape3[], tokens: readonly Token[], patterns?: Map<string, TexturePattern>): string => {
	let s = "";
	for (const sh of solids) {
		const c = colorOf(tokens, sh.color ?? "");
		s += `${c[0]},${c[1]},${c[2]},${c[3]}`;
		// 1.8: the further tokens its faces are painted with
		if (sh.kind === "mesh" || sh.kind === "sweep") for (const name of sh.colors ?? []) s += `/${colorOf(tokens, name).join(",")}`;
		const p = sh.texture ? patterns?.get(sh.texture) : undefined;
		s += p?.canvas || p?.normal ? `@${sh.texture}:${p.rev};` : ";";
	}
	return s;
};

/** A part's mesh: built once and kept while its shapes, colours and textures stay as they are. */
export function partMesh(solids: readonly Shape3[], tokens: readonly Token[], patterns?: Map<string, TexturePattern>): PartMesh {
	let byTokens = built.get(solids);
	if (!byTokens) built.set(solids, (byTokens = new Map()));
	const stamp = stampOf(solids, tokens, patterns);
	const have = byTokens.get(tokens);
	if (have && have.stamp === stamp) return have;
	const mesh = build(solids, tokens, patterns, stamp);
	// (an edited document hands over a new token list with every change: the meshes built for the old ones go)
	if (byTokens.size >= 16) for (const k of byTokens.keys()) {
		byTokens.delete(k);
		if (byTokens.size < 8) break;
	}
	byTokens.set(tokens, mesh);
	return mesh;
}

function build(solids: readonly Shape3[], tokens: readonly Token[], patterns: Map<string, TexturePattern> | undefined, stamp: string): PartMesh {
	const lists = new Map<string, { texture: string | null; pattern?: TexturePattern; cull: boolean; v: number[] }>();
	let lo: Vec3 = [Infinity, Infinity, Infinity];
	let hi: Vec3 = [-Infinity, -Infinity, -Infinity];
	for (const sh of solids) {
		const rgb = colorOf(tokens, sh.color ?? "");
		const col = [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, rgb[3] / 255];
		const shade = sh.shade ?? 1;
		const pattern = sh.texture ? patterns?.get(sh.texture) : undefined;
		const cell = pattern?.texture.cell ?? [1, 1];
		// a texture name is per document; key the batch by the pattern's identity
		// (a texture with no colour map may still have a relief to light by)
		const texture = pattern?.canvas || pattern?.normal ? `${sh.texture}@${pattern.rev}` : null;
		const round = sh.kind === "ball" || sh.kind === "rod";
		const key = `${texture}|${round ? 0 : 1}`;
		let list = lists.get(key);
		if (!list) lists.set(key, (list = { texture, pattern: texture ? pattern : undefined, cull: !round, v: [] }));
		const v = list.v;
		const ZERO: Vec2 = [0, 0];
		const NO_AXES: [Vec3, Vec3] = [[0, 0, 0], [0, 0, 0]];
		/** One triangle: flat (its own normal, turned away from `out` when given) or with a normal per corner. */
		const tri = (a: Vec3, b: Vec3, c: Vec3, out?: Vec3, vn?: [Vec3, Vec3, Vec3], uv?: [Vec2, Vec2, Vec2], paint: number[] = col, own?: [number, number, number]) => {
			let n = v3cross(v3sub(b, a), v3sub(c, a));
			if (out) {
				const mid: Vec3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
				if (v3dot(n, v3sub(mid, out)) < 0) n = [-n[0], -n[1], -n[2]];
			}
			const corners = [a, b, c];
			const [ax, bx] = uv && pattern?.normal ? patternAxes(a, b, c, uv[0], uv[1], uv[2]) : NO_AXES;
			for (let i = 0; i < 3; i++) {
				const p = corners[i];
				const nn = vn ? vn[i] : n;
				const t = uv ? uv[i] : ZERO;
				v.push(p[0], p[1], p[2], nn[0], nn[1], nn[2], paint[0], paint[1], paint[2], paint[3], t[0], t[1], own ? shade * own[i] : shade, vn ? 1 : 0, ax[0], ax[1], ax[2], bx[0], bx[1], bx[2]);
				if (p[0] < lo[0]) lo[0] = p[0];
				if (p[1] < lo[1]) lo[1] = p[1];
				if (p[2] < lo[2]) lo[2] = p[2];
				if (p[0] > hi[0]) hi[0] = p[0];
				if (p[1] > hi[1]) hi[1] = p[1];
				if (p[2] > hi[2]) hi[2] = p[2];
			}
		};
		if (sh.kind === "mesh" || sh.kind === "sweep") {
			// the surface a mesh or a sweep draws: generated for a sweep, its mods applied (1.8), subdivided when smooth (1.7)
			const m = asMesh(sh);
			// what `smooth` refined: the cage with its mods, whose creases and angle are the hard edges
			const cage = builtOf(sh);
			const pts = m.points;
			const cn = smoothNormals(cage) ? cornerNormals(m.points, m.faces, { angle: cage.angle, creases: (cage.smooth ?? 0) > 0 ? undefined : cage.creases }) : null;
			// paint (1.8): a face wears its own token; shades: a number per point, multiplying the shape's
			const painted = !!m.paint && m.paint.length === m.faces.length && !!m.colors?.length && m.paint.some((p) => p > 0);
			const inks = painted ? [col, ...m.colors!.map((name) => colorOf(tokens, name).map((x) => x / 255))] : null;
			const own = m.shades && m.shades.length === pts.length ? m.shades : null;
			if (texture || cn || inks || own) {
				// per face, so a corner's pattern coordinates and normal are known
				const uvs = texture ? meshUVs(sh) : null;
				m.faces.forEach((f, fi) => {
					const ft = triangulateFace(m.points, f);
					const at = (idx: number) => f.indexOf(idx);
					const uvOf = (idx: number): Vec2 => {
						const uv = uvs?.[fi]?.[at(idx)] ?? [0, 0];
						return [uv[0] / cell[0], uv[1] / cell[1]];
					};
					const ink = inks ? (inks[m.paint![fi]] ?? col) : col;
					for (let i = 0; i + 2 < ft.length; i += 3) {
						const [i0, i1, i2] = [ft[i], ft[i + 1], ft[i + 2]];
						tri(pts[i0], pts[i1], pts[i2], undefined, cn ? [cn[fi][at(i0)], cn[fi][at(i1)], cn[fi][at(i2)]] : undefined, uvs ? [uvOf(i0), uvOf(i1), uvOf(i2)] : undefined, ink, own ? [own[i0], own[i1], own[i2]] : undefined);
					}
				});
				continue;
			}
			let tris = m.tris;
			if (!tris || tris.length % 3 !== 0 || tris.some((i) => i >= pts.length)) {
				tris = [];
				for (const f of m.faces) tris.push(...triangulateFace(m.points, f));
			}
			for (let i = 0; i + 2 < tris.length; i += 3) tri(pts[tris[i]], pts[tris[i + 1]], pts[tris[i + 2]]);
		} else if (sh.kind === "ball") {
			const c = sh.at;
			const pts = SPHERE.pts.map((p): Vec3 => [c[0] + p[0] * sh.r, c[1] + p[1] * sh.r, c[2] + p[2] * sh.r]);
			for (let i = 0; i + 2 < SPHERE.tris.length; i += 3) tri(pts[SPHERE.tris[i]], pts[SPHERE.tris[i + 1]], pts[SPHERE.tris[i + 2]], c);
		} else {
			const a = sh.a;
			const d = v3sub(sh.b, a);
			const len = Math.hypot(d[0], d[1], d[2]);
			if (len < 1e-6) continue;
			const w = v3norm(d);
			// a frame around the axis
			const seed: Vec3 = Math.abs(w[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
			const u = v3norm(v3cross(w, seed));
			const vv = v3cross(w, u);
			const r = sh.w / 2;
			const pts = CYL.pts.map((p): Vec3 => [
				a[0] + (u[0] * p[0] + vv[0] * p[1]) * r + w[0] * p[2] * len,
				a[1] + (u[1] * p[0] + vv[1] * p[1]) * r + w[1] * p[2] * len,
				a[2] + (u[2] * p[0] + vv[2] * p[1]) * r + w[2] * p[2] * len,
			]);
			for (let i = 0; i + 2 < CYL.tris.length; i += 3) {
				const t0 = pts[CYL.tris[i]];
				const t1 = pts[CYL.tris[i + 1]];
				const t2 = pts[CYL.tris[i + 2]];
				// the nearest point of the axis to the triangle's middle, so the caps face out too
				const mid: Vec3 = [(t0[0] + t1[0] + t2[0]) / 3, (t0[1] + t1[1] + t2[1]) / 3, (t0[2] + t1[2] + t2[2]) / 3];
				let k = v3dot(v3sub(mid, a), w) / len;
				k = k <= 0.02 ? -0.5 : k >= 0.98 ? 1.5 : k; // a cap's reference sits beyond its end
				tri(t0, t1, t2, [a[0] + d[0] * k, a[1] + d[1] * k, a[2] + d[2] * k]);
			}
		}
	}
	const some = Number.isFinite(lo[0]);
	const centre: Vec3 = some ? [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2] : [0, 0, 0];
	const radius = some ? Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2 : 0;
	const batches: Batch[] = [...lists.values()].filter((l) => l.v.length).map((l) => ({ texture: l.texture, pattern: l.pattern, cull: l.cull, data: new Float32Array(l.v), count: l.v.length / STRIDE }));
	return { batches, centre, radius, stamp };
}

// a compiled part's triangles (a sidecar's, 1.8) for the GPU, by the colours that paint them: the geometry is
// never generated, and a recolour only writes the buffer again
const compiledBuilt = new WeakMap<CompiledPart, Map<readonly Token[], PartMesh>>();

/** A part read from a compiled sidecar, ready for the GPU: tokens resolved by name through the palette, times each vertex's shade. */
export function compiledMesh(part: CompiledPart, tokens: readonly Token[], patterns?: Map<string, TexturePattern>): PartMesh {
	let byTokens = compiledBuilt.get(part);
	if (!byTokens) compiledBuilt.set(part, (byTokens = new Map()));
	let stamp = "";
	for (const pr of part.prims) {
		const p = pr.texture ? patterns?.get(pr.texture) : undefined;
		stamp += `${colorOf(tokens, pr.token).join(",")}${p?.canvas || p?.normal ? `@${pr.texture}:${p.rev}` : ""};`;
	}
	const have = byTokens.get(tokens);
	if (have && have.stamp === stamp) return have;
	const lists = new Map<string, { texture: string | null; pattern?: TexturePattern; count: number; prims: typeof part.prims }>();
	for (const pr of part.prims) {
		const pattern = pr.texture && pr.uv ? patterns?.get(pr.texture) : undefined;
		const texture = pattern?.canvas || pattern?.normal ? `${pr.texture}@${pattern.rev}` : null;
		const key = String(texture);
		let list = lists.get(key);
		if (!list) lists.set(key, (list = { texture, pattern: texture ? pattern : undefined, count: 0, prims: [] }));
		list.prims.push(pr);
		list.count += pr.pos.length / 3;
	}
	const batches: Batch[] = [];
	for (const l of lists.values()) {
		const data = new Float32Array(l.count * STRIDE);
		let o = 0;
		for (const pr of l.prims) {
			const rgb = colorOf(tokens, pr.token);
			const c = [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, rgb[3] / 255];
			const n = pr.pos.length / 3;
			for (let i = 0; i < n; i++) {
				data[o] = pr.pos[i * 3];
				data[o + 1] = pr.pos[i * 3 + 1];
				data[o + 2] = pr.pos[i * 3 + 2];
				data[o + 3] = pr.nor[i * 3];
				data[o + 4] = pr.nor[i * 3 + 1];
				data[o + 5] = pr.nor[i * 3 + 2];
				data[o + 6] = c[0];
				data[o + 7] = c[1];
				data[o + 8] = c[2];
				data[o + 9] = c[3];
				if (l.texture && pr.uv) {
					data[o + 10] = pr.uv[i * 2];
					data[o + 11] = pr.uv[i * 2 + 1];
				}
				data[o + 12] = pr.shade[i];
				// (the normal is the sidecar's, as it stands: a face's, or a corner's with its creases already respected)
				data[o + 13] = 0;
				if (l.pattern?.normal && pr.uv) {
					// the pattern's axes, from the triangle this vertex is a corner of (a sidecar's vertices come three to a triangle)
					const t0 = i - (i % 3);
					const at = (j: number) => pr.pos.subarray(j * 3, j * 3 + 3);
					const uvAt = (j: number) => pr.uv!.subarray(j * 2, j * 2 + 2);
					const [ax, bx] = patternAxes(at(t0), at(t0 + 1), at(t0 + 2), uvAt(t0), uvAt(t0 + 1), uvAt(t0 + 2));
					data.set(ax, o + 14);
					data.set(bx, o + 17);
				}
				o += STRIDE;
			}
		}
		if (l.count) batches.push({ texture: l.texture, pattern: l.pattern, cull: true, data, count: l.count });
	}
	const mesh: PartMesh = { batches, centre: part.centre, radius: part.radius, stamp };
	if (byTokens.size >= 16) byTokens.clear();
	byTokens.set(tokens, mesh);
	return mesh;
}

/** A part as it stands in a frame: its map from rest space (into the world, or straight into the view) and its shapes. */
export interface PosedPart {
	F: Xf3;
	solids: readonly Shape3[];
	/** its triangles from the document's compiled sidecar (1.8): drawn in place of generating them from `solids` */
	compiled?: CompiledPart | null;
}

/** What a posed part draws: its sidecar's triangles when it has them, else its shapes generated. */
export function meshOfPart(fp: PosedPart, tokens: readonly Token[], patterns?: Map<string, TexturePattern>): PartMesh {
	return fp.compiled ? compiledMesh(fp.compiled, tokens, patterns) : partMesh(fp.solids, tokens, patterns);
}

/**
 * A document's parts under a pose list, in the world: each part's map
 * and its shapes (a morph applied), with nothing projected. What this
 * renderer needs of a frame; the view is laid on by the shader.
 */
export function poseParts(doc: Doc3, poses: readonly StatePart3[] | undefined, instance?: Xf3, compiled?: Compiled | null): PosedPart[] {
	const parts = doc.parts ?? [];
	const list: readonly StatePart3[] = poses ?? parts.map((p) => ({ part: p.name }));
	const W = worldTransforms3(doc, poses ?? []);
	const out: PosedPart[] = [];
	for (const sp of list) {
		const part = parts.find((p) => p.name === sp.part);
		if (!part) continue;
		const w = W.get(sp.part);
		const F: Xf3 = instance ? (w ? xf3Mul(instance, w) : instance) : (w ?? IDENT);
		// a sidecar holds the rest pose: a part this pose reshapes (a morph) is generated as ever
		const index = parts.indexOf(part);
		// (and a part with a skin (1.9) is placed point by point, by its joints)
		const skinned = sourceOf3(doc, part).shapes?.some((sh) => sh.kind === "mesh" && sh.skin) ?? false;
		const own = compiled && !(sp.morph?.length && !part.like) && !skinned ? compiled.parts[index] : undefined;
		const solids = shapesOf3Skinned(doc, part, sp, W);
		out.push(own !== undefined ? { F, solids, compiled: own ?? EMPTY } : { F, solids });
	}
	return out;
}
const IDENT: Xf3 = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
/** a part the sidecar says draws nothing */
const EMPTY: CompiledPart = { prims: [], centre: [0, 0, 0], radius: 0, triangles: 0 };

/** One document's parts in a frame, with the tokens to paint them. */
export interface SolidLayer {
	fps: readonly PosedPart[];
	tokens: readonly Token[];
	patterns?: Map<string, TexturePattern>;
	/** 0..1: how far the layer is washed toward the canvas (a mannequin under the model) */
	dim?: number;
}
/** How a frame is lit, past the light itself. */
export interface GlLook {
	/** the soft clay light, worked out per pixel, in place of the projector's flat rule */
	clay?: boolean;
	/** the canvas's colour (0..1), which a dimmed layer is washed toward */
	bg?: Vec3;
}

export interface GlView {
	W: number;
	H: number;
	dpr: number;
	pan: [number, number];
	zoom: number;
	/** the view's turn, when the parts' maps stop at the world (a scene); absent when they already include it */
	turn?: Xf3;
}

/** The model's solids, into the canvas: the frame's parts carry the view in their maps already. */
export function drawSolids(canvas: HTMLCanvasElement, _doc: Doc3, fps: readonly PosedPart[], tokens: readonly Token[], light: Vec3, ambient: number, view: GlView, patterns?: Map<string, TexturePattern>): boolean {
	return drawLayers(canvas, [{ fps, tokens, patterns }], light, ambient, view);
}

/** What the last frame cost the GPU: for scripts and the console. */
export const glStats = { draws: 0, triangles: 0, buffers: 0 };

/** Several documents' solids in one frame (a scene), one depth buffer. */
export function drawLayers(canvas: HTMLCanvasElement, layers: readonly SolidLayer[], light: Vec3, ambient: number, view: GlView, look: GlLook = {}): boolean {
	const g = setup(canvas);
	if (!g) return false;
	const { gl, attr, uni } = g;
	const frame = ++g.frame;
	glStats.draws = 0;
	glStats.triangles = 0;
	const w = Math.round(view.W * view.dpr);
	const h = Math.round(view.H * view.dpr);
	if (canvas.width !== w || canvas.height !== h) {
		canvas.width = w;
		canvas.height = h;
	}
	gl.viewport(0, 0, w, h);
	gl.clearColor(0, 0, 0, 0);
	gl.enable(gl.DEPTH_TEST);
	gl.depthFunc(gl.LEQUAL);
	gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
	gl.useProgram(g.prog);
	const l = v3norm(light);
	const V = view.turn ?? IDENT;
	gl.uniform3f(uni.v0, V[0], V[1], V[2]);
	gl.uniform3f(uni.v1, V[3], V[4], V[5]);
	gl.uniform3f(uni.v2, V[6], V[7], V[8]);
	gl.uniform3f(uni.L, l[0], l[1], l[2]);
	gl.uniform1f(uni.a, ambient);
	gl.uniform3f(uni.u, view.pan[0], view.pan[1], view.zoom);
	gl.uniform2f(uni.h, view.W / 2, view.H / 2);
	gl.uniform1i(uni.s, 0);
	gl.uniform1i(uni.ns, 1);
	gl.uniform1f(uni.amb, ambient);
	gl.uniform1f(uni.clay, look.clay ? 1 : 0);
	gl.uniform3f(uni.K, l[0], l[1], l[2]);
	const bg = look.bg ?? [1, 1, 1];
	gl.uniform3f(uni.bgc, bg[0], bg[1], bg[2]);
	for (const loc of Object.values(attr)) gl.enableVertexAttribArray(loc);
	let bound: Batch | null = null;
	let tex: string | null | undefined;
	let culling: boolean | undefined;
	let front: number | undefined;
	for (const layer of layers) {
		gl.uniform1f(uni.dim, Math.max(0, Math.min(1, layer.dim ?? 0)));
		for (const fp of layer.fps) {
			const mesh = meshOfPart(fp, layer.tokens, layer.patterns);
			if (!mesh.batches.length) continue;
			const F = fp.F;
			const mirrored = xf3Det(F) < 0;
			gl.uniform4f(uni.m0, F[0], F[1], F[2], F[9]);
			gl.uniform4f(uni.m1, F[3], F[4], F[5], F[10]);
			gl.uniform4f(uni.m2, F[6], F[7], F[8], F[11]);
			gl.uniform1f(uni.f, mirrored ? -1 : 1);
			for (const b of mesh.batches) {
				if (b !== bound) {
					let have = g.buffers.get(b);
					if (!have) {
						have = { buf: gl.createBuffer()!, used: frame };
						gl.bindBuffer(gl.ARRAY_BUFFER, have.buf);
						gl.bufferData(gl.ARRAY_BUFFER, b.data, gl.STATIC_DRAW);
						g.buffers.set(b, have);
					} else gl.bindBuffer(gl.ARRAY_BUFFER, have.buf);
					have.used = frame;
					const B = STRIDE * 4;
					gl.vertexAttribPointer(attr.p, 3, gl.FLOAT, false, B, 0);
					gl.vertexAttribPointer(attr.n, 3, gl.FLOAT, false, B, 12);
					gl.vertexAttribPointer(attr.c, 4, gl.FLOAT, false, B, 24);
					gl.vertexAttribPointer(attr.t, 2, gl.FLOAT, false, B, 40);
					gl.vertexAttribPointer(attr.k, 2, gl.FLOAT, false, B, 48);
					gl.vertexAttribPointer(attr.g, 3, gl.FLOAT, false, B, 56);
					gl.vertexAttribPointer(attr.b, 3, gl.FLOAT, false, B, 68);
					bound = b;
				}
				if (b.texture !== tex) {
					tex = b.texture;
					// a map as a wrapping texture, uploaded when its render changes
					const upload = (key: string, canvas: HTMLCanvasElement, rev: number, unit: number) => {
						let have = g.textures.get(key);
						gl.activeTexture(unit);
						if (!have || have.rev !== rev) {
							const t = have?.tex ?? gl.createTexture()!;
							gl.bindTexture(gl.TEXTURE_2D, t);
							gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
							gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
							gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
							gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
							gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
							have = { tex: t, rev };
							g.textures.set(key, have);
						}
						gl.bindTexture(gl.TEXTURE_2D, have.tex);
					};
					if (b.texture && b.pattern?.canvas) {
						upload(b.texture, b.pattern.canvas, b.pattern.rev, gl.TEXTURE0);
						gl.uniform1f(uni.tex, 1);
						gl.uniform1f(uni.mask, b.pattern.mode === "mask" ? 1 : 0);
					} else {
						gl.uniform1f(uni.tex, 0);
						gl.uniform1f(uni.mask, 0);
					}
					// relief (1.10): the texture's normal map, on the second unit
					if (b.texture && b.pattern?.normal) {
						upload(`${b.texture}#normal`, b.pattern.normal, b.pattern.rev, gl.TEXTURE1);
						gl.uniform1f(uni.nrm, 1);
					} else gl.uniform1f(uni.nrm, 0);
				}
				// a face is drawn when it winds toward the viewer; a mirror reverses the winding
				if (b.cull !== culling) {
					culling = b.cull;
					if (culling) gl.enable(gl.CULL_FACE);
					else gl.disable(gl.CULL_FACE);
				}
				const ff = mirrored ? gl.CW : gl.CCW;
				if (b.cull && ff !== front) {
					front = ff;
					gl.frontFace(ff);
				}
				gl.drawArrays(gl.TRIANGLES, 0, b.count);
				glStats.draws++;
				glStats.triangles += b.count / 3;
			}
		}
	}
	// buffers this frame did not draw (a file closed, a mesh reshaped) go back to the GPU now: a
	// skinned or morphing part (1.6, 1.9) makes new triangles every frame of a clip, and keeping
	// even a few seconds of them runs a dense mesh to gigabytes, at which WebKit kills the page
	for (const [b, have] of g.buffers) {
		if (have.used !== frame) {
			gl.deleteBuffer(have.buf);
			g.buffers.delete(b);
		}
	}
	glStats.buffers = g.buffers.size;
	return true;
}
