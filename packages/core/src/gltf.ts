// glTF 2.0 export (1.3): a 3D document as a .glb for engines that will
// not parse JSON meshes. One node per part (children under parents, the
// pivot as the node's origin), one mesh per part with a primitive per
// shape (flat triangles, face normals, the token's colour times the shade
// as COLOR_0), one plain material, and a linear animation per clip,
// sampled at a frame rate with targets reached. Y-up, as glTF wants.
// Morphs (1.6) are morph targets: one per pose that reshapes the part,
// its weights animated so a sampled frame lands on the lerped points.

import { FORMAT_MINOR, FORMAT_VERSION, type Doc3, type Token, type Vec3 } from "./types.ts";
import { colorOf, shadeColor } from "./palette.ts";
import { asMesh, flattenPart, meshTris, yUp } from "./solids.ts";
import { anchorsOf3, clipSpan3, keyPoses3, pivotOf3, quatFromEuler, sampleClip3, sampleTargets3, shapesOf3, clipDuration3, skinJoint3, worldTransforms3, xf3Det, xf3Invert, xf3Mul, matToEuler, type Quat, type Xf3 } from "./space3.ts";
import { solveTargets3 } from "./ik3.ts";
import { posedMesh } from "./mods.ts";

export interface GltfOptions {
	/** the resolved palette; the document's own when absent */
	tokens?: readonly Token[];
	/** animation samples per second, default 24 */
	fps?: number;
	/** 1.5: a PNG of each texture's colour map, by texture name; textured primitives sample it with wrapping */
	images?: Record<string, Uint8Array>;
	/** 1.10: a tangent-space normal map per texture (green up the image), from its relief; those primitives carry tangents */
	normals?: Record<string, Uint8Array>;
	/** 1.10: occlusion, roughness and metallic packed in r, g and b, per texture */
	orms?: Record<string, Uint8Array>;
	/**
	 * 1.8: write the compiled sidecar's layout (`name.fart.glb`): a
	 * primitive per shape and token with the token's name in its extras, a
	 * `_SHADE` per vertex, each node's pivot and anchors in its extras, and
	 * `of` (the source's hash, `sourceHash`) in the asset's.
	 */
	sidecar?: { of: string };
}

/** What a sidecar says made it; `fart build` rebuilds one made by another. */
export const SIDECAR_GENERATOR = "@fastart/core 1.8";

/** A document's sidecar: its own path with `.glb` after it. */
export function sidecarPath(file: string): string {
	return `${file}.glb`;
}

/** The hash a sidecar keeps of its source: FNV-1a, 64 bits, over the file's bytes as they are on disk; sixteen hex digits. */
export function sourceHash(bytes: Uint8Array): string {
	let h = 0xcbf29ce484222325n;
	for (let i = 0; i < bytes.length; i++) {
		h ^= BigInt(bytes[i]);
		h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
	}
	return h.toString(16).padStart(16, "0");
}

/** A binary glTF's JSON chunk, or null when the bytes are not one. */
export function glbJson(glb: Uint8Array): Record<string, unknown> | null {
	if (glb.length < 20) return null;
	const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
	if (dv.getUint32(0, true) !== 0x46546c67 || dv.getUint32(16, true) !== 0x4e4f534a) return null;
	const len = dv.getUint32(12, true);
	if (20 + len > glb.length) return null;
	try {
		const json: unknown = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + len)));
		return json && typeof json === "object" ? (json as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

/** What a sidecar says of itself (`asset.extras.fart`), or null when the bytes are not a sidecar. */
export function sidecarInfo(glb: Uint8Array): { format: string; generator: string; of: string } | null {
	const asset = glbJson(glb)?.asset as { extras?: { fart?: { format?: unknown; generator?: unknown; of?: unknown } } } | undefined;
	const f = asset?.extras?.fart;
	if (!f || typeof f.of !== "string") return null;
	return { format: String(f.format ?? ""), generator: String(f.generator ?? ""), of: f.of };
}

/** Is this sidecar the one this library would write for these source bytes? */
export function sidecarFresh(glb: Uint8Array | null, source: Uint8Array): boolean {
	const info = glb ? sidecarInfo(glb) : null;
	return !!info && info.of === sourceHash(source) && info.generator === SIDECAR_GENERATOR;
}

/** The sidecar for a 3D document read from `source` (its bytes on disk): everything generated, tokens kept by name. */
export function buildSidecar(doc: Doc3, source: Uint8Array, opts: Omit<GltfOptions, "sidecar"> = {}): Uint8Array {
	return toGlb(doc, { ...opts, sidecar: { of: sourceHash(source) } });
}

const FLOAT = 5126;
const ARRAY_BUFFER = 34962;

/** A rotation in the format's frame, seen from y-up (a half turn about x either side). */
function quatYUp(q: Quat): Quat {
	return [q[0], -q[1], -q[2], q[3]];
}

const ID3: Xf3 = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const REFLECT3: Xf3 = [-1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

/**
 * Tangents for flat triangles (three vertices each): xyz along +u, square
 * to the vertex normal, and w so that cross(normal, tangent) × w runs up
 * the image (toward smaller v), where a normal map's green points.
 */
function tangents(pos: Float32Array, nor: Float32Array, uv: Float32Array): Float32Array {
	const out = new Float32Array((pos.length / 3) * 4);
	for (let t = 0; t < pos.length / 9; t++) {
		const p = (k: number): Vec3 => [pos[t * 9 + k * 3], pos[t * 9 + k * 3 + 1], pos[t * 9 + k * 3 + 2]];
		const [p0, p1, p2] = [p(0), p(1), p(2)];
		const e1: Vec3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
		const e2: Vec3 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
		const du1 = uv[t * 6 + 2] - uv[t * 6];
		const dv1 = uv[t * 6 + 3] - uv[t * 6 + 1];
		const du2 = uv[t * 6 + 4] - uv[t * 6];
		const dv2 = uv[t * 6 + 5] - uv[t * 6 + 1];
		const det = du1 * dv2 - du2 * dv1;
		const ok = Math.abs(det) > 1e-12;
		// along +u, and along +v (down the image)
		const T: Vec3 = ok ? [(e1[0] * dv2 - e2[0] * dv1) / det, (e1[1] * dv2 - e2[1] * dv1) / det, (e1[2] * dv2 - e2[2] * dv1) / det] : e1;
		const B: Vec3 = ok ? [(e2[0] * du1 - e1[0] * du2) / det, (e2[1] * du1 - e1[1] * du2) / det, (e2[2] * du1 - e1[2] * du2) / det] : e2;
		for (let k = 0; k < 3; k++) {
			const n: Vec3 = [nor[t * 9 + k * 3], nor[t * 9 + k * 3 + 1], nor[t * 9 + k * 3 + 2]];
			const d = n[0] * T[0] + n[1] * T[1] + n[2] * T[2];
			let x = T[0] - n[0] * d;
			let y = T[1] - n[1] * d;
			let z = T[2] - n[2] * d;
			const l = Math.hypot(x, y, z) || 1;
			x /= l;
			y /= l;
			z /= l;
			const c: Vec3 = [n[1] * z - n[2] * y, n[2] * x - n[0] * z, n[0] * y - n[1] * x];
			const w = c[0] * B[0] + c[1] * B[1] + c[2] * B[2] <= 0 ? 1 : -1;
			out.set([x, y, z, w], (t * 3 + k) * 4);
		}
	}
	return out;
}

/** The document as a binary glTF. */
export function toGlb(doc: Doc3, opts: GltfOptions = {}): Uint8Array {
	const tokens = opts.tokens ?? doc.palette ?? [];
	const fps = opts.fps && opts.fps > 0 ? opts.fps : 24;
	const parts = doc.parts ?? [];
	const chunks: Uint8Array[] = [];
	let byteLength = 0;
	const bufferViews: Record<string, unknown>[] = [];
	const accessors: Record<string, unknown>[] = [];
	const pushView = (data: Float32Array | Uint8Array, target?: number): number => {
		const bytes = data instanceof Uint8Array ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
		const pad = (4 - (bytes.length % 4)) % 4;
		chunks.push(bytes);
		if (pad) chunks.push(new Uint8Array(pad));
		const view: Record<string, unknown> = { buffer: 0, byteOffset: byteLength, byteLength: bytes.length };
		if (target !== undefined) view.target = target;
		bufferViews.push(view);
		byteLength += bytes.length + pad;
		return bufferViews.length - 1;
	};
	const pushAccessor = (data: Float32Array, type: "SCALAR" | "VEC2" | "VEC3" | "VEC4", target?: number, bounds = false): number => {
		const view = pushView(data, target);
		const n = type === "SCALAR" ? 1 : type === "VEC2" ? 2 : type === "VEC3" ? 3 : 4;
		const acc: Record<string, unknown> = { bufferView: view, componentType: FLOAT, count: data.length / n, type };
		if (bounds) {
			const min = new Array(n).fill(Infinity);
			const max = new Array(n).fill(-Infinity);
			for (let i = 0; i < data.length; i++) {
				min[i % n] = Math.min(min[i % n], data[i]);
				max[i % n] = Math.max(max[i % n], data[i]);
			}
			acc.min = min;
			acc.max = max;
		}
		accessors.push(acc);
		return accessors.length - 1;
	};

	// textures (1.5): an image and a material per texture that has pixels
	const materials: Record<string, unknown>[] = [{ name: "flat", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 }, doubleSided: false }];
	const images: Record<string, unknown>[] = [];
	const textures: Record<string, unknown>[] = [];
	const materialOf = new Map<string, number>();
	const tangentsFor = new Set<string>();
	const image = (name: string, png: Uint8Array, sampler: number): { index: number } => {
		images.push({ name, mimeType: "image/png", bufferView: pushView(png) });
		textures.push({ name, source: images.length - 1, sampler });
		return { index: textures.length - 1 };
	};
	for (const t of doc.textures ?? []) {
		const color = opts.images?.[t.name];
		const normal = opts.normals?.[t.name];
		const orm = opts.orms?.[t.name];
		if (!color && !normal && !orm) continue;
		// relief (1.10): a texture with a normal map, packed scalars or a softened colour map is a surface, not pixel art: it filters
		const sampler = normal || orm || (t.maps.color?.soften ?? 0) > 0 ? 1 : 0;
		const pbr: Record<string, unknown> = { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 };
		const material: Record<string, unknown> = { name: t.name, pbrMetallicRoughness: pbr };
		if (color) pbr.baseColorTexture = image(t.name, color, sampler);
		if (normal) material.normalTexture = image(`${t.name}.normal`, normal, sampler);
		if (orm) {
			const tex = image(`${t.name}.orm`, orm, sampler);
			pbr.metallicRoughnessTexture = tex;
			pbr.metallicFactor = 1;
			if (t.maps.ao) material.occlusionTexture = tex;
		}
		materials.push(material);
		materialOf.set(t.name, materials.length - 1);
		if (normal) tangentsFor.add(t.name);
	}
	// morphs (1.6): every pose that reshapes a part is a target of its mesh, named by its source
	// (a state's name, or clip#key for an inline key); each sampled frame weighs the two it sits between
	const targetsOf = new Map<string, { id: string; morph: NonNullable<Doc3["states"]>[number]["parts"][number]["morph"] }[]>();
	const noteMorph = (id: string, poses: readonly { part: string; morph?: unknown }[]) => {
		for (const sp of poses) {
			const part = parts.find((p) => p.name === sp.part);
			if (!part || part.like || !Array.isArray(sp.morph) || !sp.morph.length) continue;
			const list = targetsOf.get(part.name) ?? [];
			if (!list.some((t) => t.id === id)) list.push({ id, morph: sp.morph as never });
			targetsOf.set(part.name, list);
		}
	};
	for (const st of doc.states ?? []) noteMorph(st.name, st.parts);
	for (const clip of doc.clips ?? []) clip.keys.forEach((k, i) => k.parts && noteMorph(`${clip.name}#${i}`, k.parts));
	const targetIds = new Map<string, string[]>([...targetsOf].map(([name, ts]) => [name, ts.map((t) => t.id)]));

	// skins (1.9): a part with a skinned mesh has its whole mesh in the document's own space (not about its pivot),
	// every vertex with joints and weights (a rigid shape's are the part's own), on a node of its own beside the
	// skeleton; the joints are the parts' nodes. A `like` part shares the mesh, with a skin of its own side's joints.
	const skinnedSrc = (p: (typeof parts)[number]) => !opts.sidecar && shapesOf3(doc, p).some((sh) => sh.kind === "mesh" && sh.skin && !sh.skin.host);
	const jointsOf = new Map<string, string[]>();
	// A document with skins goes out with no mirrors in it: a tool that rigs has one rest pose to a bone, and a
	// mirrored bone has none it can keep. A part a pose draws mirrored (the first state's, or the first key's, says
	// which) has its own mesh, its geometry reflected; its node stands at its pivot's mirror image; and every frame
	// gives it the turn that brings that mesh to where the mirrored part was drawn.
	const unmirror = parts.some(skinnedSrc);
	const sidePoses = doc.states?.[0]?.parts ?? (doc.clips?.[0]?.keys[0] ? keyPoses3(doc, doc.clips[0].keys[0]) : []);
	const sideW = worldTransforms3(doc, sidePoses);
	const flipped = (name: string) => unmirror && xf3Det(sideW.get(name) ?? ID3) < 0;
	const restPivot = (p: (typeof parts)[number]): Vec3 => {
		const pv = pivotOf3(p);
		return flipped(p.name) ? [-pv[0], pv[1], pv[2]] : pv;
	};
	// meshes: one per part with geometry of its own; `like` parts share the source's
	const meshes: Record<string, unknown>[] = [];
	const meshOf = new Map<string, number>();
	for (const part of parts) {
		const src = part.like && parts.some((p) => p.name === part.like) ? part.like : part.name;
		const reflect = flipped(part.name);
		const made = reflect ? `${src}\u0000mirrored` : src;
		if (meshOf.has(made)) {
			meshOf.set(part.name, meshOf.get(made)!);
			continue;
		}
		const rx = reflect ? -1 : 1;
		const srcPart = parts.find((p) => p.name === src)!;
		const jl: string[] | null = skinnedSrc(srcPart) ? [src] : null;
		if (jl) jointsOf.set(made, jl);
		const pivot: Vec3 = jl ? [0, 0, 0] : pivotOf3(srcPart);
		const primitives: Record<string, unknown>[] = [];
		const shapes = shapesOf3(doc, srcPart);
		const targets = targetsOf.get(src) ?? [];
		flattenPart(doc, srcPart).forEach((tm, si) => {
			if (!tm.count) return;
			// the sidecar (1.8) keeps tokens apart: a primitive per shape and token, so a reader recolours by name
			const groups: { token?: string; tris: number[] }[] = [];
			if (opts.sidecar) {
				const by = new Map<string, number[]>();
				for (let t = 0; t < tm.count; t++) {
					const token = tm.colors?.[t] ?? tm.color ?? "";
					const list = by.get(token);
					if (list) list.push(t);
					else by.set(token, [t]);
				}
				for (const [token, tris] of by) groups.push({ token, tris });
			} else groups.push({ tris: Array.from({ length: tm.count }, (_, t) => t) });
			// one target per reshaping pose, in the shape's vertex layout: a delta per corner, zero where the pose leaves this shape alone
			const sh = shapes[si];
			const mesh = sh.kind === "mesh" ? sh : null;
			// the surface of the base cage, and of each morphed cage: mods and subdivision keep the layout, so corners line up
			const base = mesh && targets.length ? asMesh(mesh) : null;
			const baseTris = base ? meshTris(base) : [];
			const deltas = targets.map((t) => {
				const delta = new Float32Array(tm.positions.length);
				const m = mesh ? t.morph?.find((x) => x.shape === si) : undefined;
				if (mesh && base && m && m.points.length === mesh.points.length) {
					const posed = asMesh(posedMesh(mesh, m.points));
					for (let v = 0; v < baseTris.length; v++) {
						const b = base.points[baseTris[v]];
						const q = posed.points[baseTris[v]];
						delta.set(yUp([rx * (q[0] - b[0]), q[1] - b[1], q[2] - b[2]]), v * 3);
					}
				}
				return delta;
			});
			const sk = jl && mesh?.skin && !mesh.skin.host && mesh.skin.weights.length === mesh.points.length ? mesh.skin : null;
			const corner = sk ? meshTris(asMesh(mesh!)) : null; // (a skinned mesh has no mods and no levels: its corners are its points)
			const flat = shadeColor(colorOf(tokens, tm.color ?? ""), tm.shade);
			const tex = tm.texture && tm.uvs ? (doc.textures ?? []).find((t) => t.name === tm.texture) : undefined;
			const cell = tex?.cell ?? [1, 1];
			for (const g of groups) {
				const nv = g.tris.length * 3;
				const pos = new Float32Array(nv * 3);
				const nor = new Float32Array(nv * 3);
				const col = new Float32Array(nv * 4);
				const shade = opts.sidecar ? new Float32Array(nv) : null;
				const uv = tm.texture && tm.uvs ? new Float32Array(nv * 2) : null;
				const moved = deltas.map(() => new Float32Array(nv * 3));
				const jn = jl ? new Uint8Array(nv * 4) : null;
				const jw = jl ? new Float32Array(nv * 4) : null;
				g.tris.forEach((t, j) => {
					for (let k = 0; k < 3; k++) {
						const v = t * 3 + k;
						// (a reflected triangle is wound the other way round)
						const d = j * 3 + (reflect ? [0, 2, 1][k] : k);
						pos.set(yUp([rx * (tm.positions[v * 3] - pivot[0]), tm.positions[v * 3 + 1] - pivot[1], tm.positions[v * 3 + 2] - pivot[2]]), d * 3);
						nor.set(yUp([rx * tm.normals[v * 3], tm.normals[v * 3 + 1], tm.normals[v * 3 + 2]]), d * 3);
						// vertex colours: the triangle's token (1.8 paint, else the shape's) times the shade, times the point's own shade (1.8)
						const token = tm.colors?.[t];
						const own = tm.shades ? tm.shades[v] : 1;
						const rgba = token === undefined && own === 1 ? flat : shadeColor(colorOf(tokens, token ?? tm.color ?? ""), (tm.shade ?? 1) * own);
						col.set([rgba[0] / 255, rgba[1] / 255, rgba[2] / 255, rgba[3] / 255], d * 4);
						if (shade) shade[d] = Math.max(0, tm.shade ?? 1) * own;
						// pattern coordinates in cell units become 0..1 per tile; glTF wraps them
						if (uv) uv.set([tm.uvs![v * 2] / cell[0], tm.uvs![v * 2 + 1] / cell[1]], d * 2);
						deltas.forEach((delta, ti) => moved[ti].set(delta.subarray(v * 3, v * 3 + 3), d * 3));
						if (jn && jw && jl) {
							const entry = sk && corner ? sk.weights[corner[v]] : null;
							if (entry && entry.length >= 2) {
								let total = 0;
								for (let e = 0; e + 1 < entry.length && e < 8; e += 2) total += entry[e + 1];
								for (let e = 0; e + 1 < entry.length && e < 8; e += 2) {
									const name = sk!.joints[entry[e]];
									if (!jl.includes(name)) jl.push(name);
									jn[d * 4 + e / 2] = jl.indexOf(name);
									jw[d * 4 + e / 2] = entry[e + 1] / (total || 1);
								}
							} else jw[d * 4] = 1; // (the part's own, wholly: joint 0)
						}
					}
				});
				const attributes: Record<string, number> = { POSITION: pushAccessor(pos, "VEC3", ARRAY_BUFFER, true), NORMAL: pushAccessor(nor, "VEC3", ARRAY_BUFFER), COLOR_0: pushAccessor(col, "VEC4", ARRAY_BUFFER) };
				let material = 0;
				if (uv) {
					attributes.TEXCOORD_0 = pushAccessor(uv, "VEC2", ARRAY_BUFFER);
					material = materialOf.get(tm.texture!) ?? 0;
					if (tangentsFor.has(tm.texture!)) attributes.TANGENT = pushAccessor(tangents(pos, nor, uv), "VEC4", ARRAY_BUFFER);
				}
				if (shade) attributes._SHADE = pushAccessor(shade, "SCALAR", ARRAY_BUFFER);
				if (jn && jw) {
					accessors.push({ bufferView: pushView(jn, ARRAY_BUFFER), componentType: 5121, count: nv, type: "VEC4" });
					attributes.JOINTS_0 = accessors.length - 1;
					attributes.WEIGHTS_0 = pushAccessor(jw, "VEC4", ARRAY_BUFFER);
				}
				const prim: Record<string, unknown> = { attributes, material, mode: 4 };
				if (moved.length) prim.targets = moved.map((delta) => ({ POSITION: pushAccessor(delta, "VEC3", ARRAY_BUFFER, true) }));
				if (opts.sidecar) {
					const extras: Record<string, unknown> = { shape: si, token: g.token ?? "" };
					if (tm.texture) extras.texture = tm.texture;
					prim.extras = extras;
				}
				primitives.push(prim);
			}
		});
		if (primitives.length) {
			const mesh: Record<string, unknown> = { name: src, primitives };
			if (targets.length) {
				mesh.weights = targets.map(() => 0);
				mesh.extras = { targetNames: targets.map((t) => t.id) };
			}
			meshes.push(mesh);
			meshOf.set(made, meshes.length - 1);
			meshOf.set(part.name, meshes.length - 1);
		}
	}

	// nodes: a part's origin is its pivot; a child's translation is from its parent's pivot
	const index = new Map(parts.map((p, i) => [p.name, i]));
	const parentPivot = (p: (typeof parts)[number]): Vec3 => {
		const par = p.parent ? parts.find((q) => q.name === p.parent) : undefined;
		return par ? restPivot(par) : [0, 0, 0];
	};
	const skinKey = (p: (typeof parts)[number]) => {
		const src = p.like && parts.some((q) => q.name === p.like) ? p.like : p.name;
		return flipped(p.name) ? `${src}\u0000mirrored` : src;
	};
	const nodes: Record<string, unknown>[] = parts.map((p) => {
		const pv = restPivot(p);
		const pp = parentPivot(p);
		const node: Record<string, unknown> = { name: p.name, translation: yUp([pv[0] - pp[0], pv[1] - pp[1], pv[2] - pp[2]]) };
		if (opts.sidecar) {
			// the sidecar (1.8): the pivot and the anchors as the file has them, in its own frame and the part's rest space
			const anchors = anchorsOf3(doc, p).map((a) => ({ name: a.name, at: a.at, ...(a.dir ? { dir: a.dir } : {}) }));
			node.extras = { pivot: pivotOf3(p), ...(anchors.length ? { anchors } : {}) };
		}
		const m = meshOf.get(p.name);
		if (m !== undefined && !jointsOf.has(skinKey(p))) node.mesh = m;
		return node;
	});
	parts.forEach((p, i) => {
		if (!p.parent || !index.has(p.parent)) return;
		const par = nodes[index.get(p.parent)!];
		(par.children as number[] | undefined) ? (par.children as number[]).push(i) : (par.children = [i]);
	});
	const roots = parts.map((_, i) => i).filter((i) => !parts[i].parent || !index.has(parts[i].parent!));
	// skins: the joints are the parts' nodes, each at its (rest) pivot
	const skins: Record<string, unknown>[] = [];
	for (const p of parts) {
		const src = p.like && parts.some((q) => q.name === p.like) ? p.like : p.name;
		const jl = jointsOf.get(skinKey(p));
		const m = meshOf.get(p.name);
		if (!jl || m === undefined) continue;
		const names = jl.map((j) => (j === src ? p.name : skinJoint3(doc, p, j)));
		const ibm = new Float32Array(names.length * 16);
		names.forEach((name, k) => {
			const jp = parts.find((q) => q.name === name);
			const t = yUp(jp ? restPivot(jp) : [0, 0, 0]);
			ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -t[0], -t[1], -t[2], 1], k * 16);
		});
		accessors.push({ bufferView: pushView(ibm), componentType: FLOAT, count: names.length, type: "MAT4" });
		skins.push({ name: p.name, joints: names.map((name) => index.get(name) ?? 0), inverseBindMatrices: accessors.length - 1 });
		nodes.push({ name: `${p.name}.skin`, mesh: m, skin: skins.length - 1, extras: { fart: { part: p.name } } });
		roots.push(nodes.length - 1);
	}

	// animations: every clip, sampled; a part left out of a frame stands at rest
	const animations: Record<string, unknown>[] = [];
	for (const clip of doc.clips ?? []) {
		const dur = clipDuration3(clip);
		const n = Math.max(2, Math.ceil(dur * fps) + 1);
		const times = new Float32Array(n);
		const tr = parts.map(() => new Float32Array(n * 3));
		const ro = parts.map(() => new Float32Array(n * 4));
		const sc = parts.map(() => new Float32Array(n * 3));
		const wt = parts.map((p) => new Float32Array(n * (targetIds.get(p.name)?.length ?? 0)));
		/** which target a key's pose stands for, per part: the state's name, or the inline key's id */
		const sourceAt = (ki: number): ((part: string) => string | null) => {
			const key = clip.keys[ki];
			const poses = keyPoses3(doc, key);
			return (part) => {
				const sp = poses.find((x) => x.part === part);
				if (!sp?.morph?.length) return null;
				return key.state !== undefined ? key.state : `${clip.name}#${ki}`;
			};
		};
		for (let k = 0; k < n; k++) {
			const t = (k / (n - 1)) * dur;
			times[k] = t;
			const poses = sampleClip3(doc, clip, t);
			const span = clipSpan3(clip, t);
			if (span) {
				const fromA = sourceAt(span.a);
				const fromB = sourceAt(span.b);
				parts.forEach((p, i) => {
					const ids = targetIds.get(p.name);
					if (!ids?.length) return;
					const a = fromA(p.name);
					const b = fromB(p.name);
					const w = wt[i];
					if (span.a === span.b) {
						if (a) w[k * ids.length + ids.indexOf(a)] = 1;
						return;
					}
					if (a) w[k * ids.length + ids.indexOf(a)] += 1 - span.u;
					if (b) w[k * ids.length + ids.indexOf(b)] += span.u;
				});
			}
			const tg = sampleTargets3(doc, clip, t);
			if (tg.length) solveTargets3(doc, poses, tg);
			// (with no mirrors: each node's map from its parent's, from where the parts stand in the world)
			const W = unmirror ? worldTransforms3(doc, poses) : null;
			const stand = (q: (typeof parts)[number]): Xf3 => {
				const pv = pivotOf3(q);
				const G = xf3Mul(W!.get(q.name) ?? ID3, [1, 0, 0, 0, 1, 0, 0, 0, 1, pv[0], pv[1], pv[2]]);
				return flipped(q.name) ? xf3Mul(G, REFLECT3) : G;
			};
			parts.forEach((p, i) => {
				if (W) {
					const par = p.parent ? parts.find((q) => q.name === p.parent) : undefined;
					const L = par ? xf3Mul(xf3Invert(stand(par)), stand(p)) : stand(p);
					const k3 = Math.cbrt(Math.abs(xf3Det(L))) || 1;
					tr[i].set(yUp([L[9], L[10], L[11]]), k * 3);
					ro[i].set(quatYUp(quatFromEuler(matToEuler(L.slice(0, 9).map((x) => x / k3)))), k * 4);
					sc[i].set([k3, k3, k3], k * 3);
					return;
				}
				const sp = poses.find((x) => x.part === p.name);
				const pv = pivotOf3(p);
				const pp = parentPivot(p);
				const off = sp?.offset ?? pv;
				const s = sp?.scale === undefined || sp.scale === 0 ? 1 : sp.scale;
				tr[i].set(yUp([off[0] - pp[0], off[1] - pp[1], off[2] - pp[2]]), k * 3);
				ro[i].set(quatYUp(quatFromEuler(sp?.rotate ?? [0, 0, 0])), k * 4);
				sc[i].set([sp?.mirror ? -s : s, s, s], k * 3);
			});
		}
		const timeAcc = pushAccessor(times, "SCALAR", undefined, true);
		const samplers: Record<string, unknown>[] = [];
		const channels: Record<string, unknown>[] = [];
		parts.forEach((p, i) => {
			for (const [path, data, type] of [["translation", tr[i], "VEC3"], ["rotation", ro[i], "VEC4"], ["scale", sc[i], "VEC3"]] as const) {
				samplers.push({ input: timeAcc, output: pushAccessor(data, type), interpolation: "LINEAR" });
				channels.push({ sampler: samplers.length - 1, target: { node: i, path } });
			}
			if (targetIds.get(p.name)?.length && meshOf.has(p.name)) {
				samplers.push({ input: timeAcc, output: pushAccessor(wt[i], "SCALAR"), interpolation: "LINEAR" });
				channels.push({ sampler: samplers.length - 1, target: { node: i, path: "weights" } });
			}
		});
		animations.push({ name: clip.name, samplers, channels });
	}

	const gltf: Record<string, unknown> = {
		asset: { version: "2.0", generator: "fastart", ...(opts.sidecar ? { extras: { fart: { format: `${FORMAT_VERSION}.${FORMAT_MINOR}`, generator: SIDECAR_GENERATOR, of: opts.sidecar.of } } } : {}) },
		scene: 0,
		scenes: [{ name: doc.name ?? "fart", nodes: roots }],
		nodes,
		meshes,
		materials,
		accessors,
		bufferViews,
		buffers: [{ byteLength }],
	};
	if (skins.length) gltf.skins = skins;
	if (animations.length) gltf.animations = animations;
	if (images.length) {
		gltf.images = images;
		gltf.textures = textures;
		gltf.samplers = [
			{ magFilter: 9728, minFilter: 9728, wrapS: 10497, wrapT: 10497 },
			{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 },
		];
	}

	// the container: header, a JSON chunk padded with spaces, a BIN chunk padded with zeros
	const json = new TextEncoder().encode(JSON.stringify(gltf));
	const jsonPad = (4 - (json.length % 4)) % 4;
	const bin = new Uint8Array(byteLength);
	let off = 0;
	for (const c of chunks) {
		bin.set(c, off);
		off += c.length;
	}
	const total = 12 + 8 + json.length + jsonPad + 8 + byteLength;
	const out = new Uint8Array(total);
	const dv = new DataView(out.buffer);
	dv.setUint32(0, 0x46546c67, true);
	dv.setUint32(4, 2, true);
	dv.setUint32(8, total, true);
	dv.setUint32(12, json.length + jsonPad, true);
	dv.setUint32(16, 0x4e4f534a, true);
	out.set(json, 20);
	out.fill(0x20, 20 + json.length, 20 + json.length + jsonPad);
	const binAt = 20 + json.length + jsonPad;
	dv.setUint32(binAt, byteLength, true);
	dv.setUint32(binAt + 4, 0x004e4942, true);
	out.set(bin, binAt + 8);
	return out;
}
