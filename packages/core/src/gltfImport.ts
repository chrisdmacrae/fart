// glTF 2.0 import (1.8): a .glb or .gltf from any modelling tool as a 3D
// document. gltf.ts read backwards: a part per mesh node (the node's
// origin as the pivot, its nearest mesh ancestor as the parent), points
// in document space at rest, a token per material, a clip per animation.
// glTF is y-up with the front toward +z; the file is y-down, z-away, so
// every point takes the same half turn about x the exporter gives it.
// A half turn is a rotation: faces keep their winding and their outside.
//
// What glTF has and the format does not is folded down with a warning:
// triangles pair back into quads, split vertices weld, a skin binds each
// face to one joint, a texture leaves its factor behind. Unless the
// caller hands the textures over (1.12: image maps): then the materials
// that wear them carry their uvs, corner by corner, into `mapping.uvs`.

import type { Clip3, ClipKey3, Doc3, MeshShape, Morph, Part3, State3, StatePart3, Texture, Token, Vec2, Vec3 } from "./types.ts";
import { Y_UP } from "./solids.ts";
import { XF3_ID, bakeTris3, matToEuler, quatSlerp, quatToMat, xf3Apply, xf3Det, xf3Invert, xf3Mul, type Quat, type Xf3 } from "./space3.ts";

export interface GltfImportOptions {
	/** document units per glTF unit, default 1 */
	scale?: number;
	/** scale the model to stand this tall at rest (its extent along y); wins over `scale` */
	height?: number;
	/** everything in one part named `main`; animations are left out */
	merge?: boolean;
	/** one shape per material instead of `colors` + `paint`, for readers older than 1.8 */
	splitMaterials?: boolean;
	/** pair coplanar triangles back into quads, default true */
	quads?: boolean;
	/** vertex colours' luminance into `shades`, default true */
	shades?: boolean;
	/** positions closer than this (document units) are one point, default 0.0005 */
	weld?: number;
	/** degrees two triangles' planes may differ by and still make a quad, default 1 */
	quadAngle?: number;
	/** the same across an edge the source shades smooth, where the fold does not show; default 15 */
	smoothQuadAngle?: number;
	/** keep a skin's weights as `skin` (1.9), default true; false flattens it to rigid parts, for readers older than 1.9 */
	skins?: boolean;
	/** bake `tris` into every mesh the way an editor does on save, default true */
	tris?: boolean;
	/** the document's name; absent, the scene's */
	name?: string;
	/** a .gltf's external buffers by the uri it names them with (see gltfBufferUris) */
	buffers?: Record<string, Uint8Array>;
	/**
	 * 1.12: textures the model wears, each added to the document and worn by
	 * the materials it names (every material, when absent), with explicit
	 * uvs from TEXCOORD_0 in the texture's pattern coordinates. A shape wears
	 * one texture, so materials that wear different ones are cut apart.
	 */
	textures?: { texture: Texture; materials?: number[] }[];
}

/** What an import made, for a summary line. */
export interface GltfSummary {
	parts: number;
	shapes: number;
	points: number;
	faces: number;
	quads: number;
	tokens: number;
	states: number;
	clips: number;
	/** the model's extent at rest, [x, y, z] in document units */
	size: Vec3;
	/** document units per glTF unit, as applied */
	scale: number;
}

export interface GltfImport {
	doc: Doc3;
	warnings: string[];
	summary: GltfSummary;
}

/** What is wrong with a file that cannot be imported at all. */
export class GltfError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "GltfError";
	}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = any;

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
/** extensions read, or safe to pass over without a word */
const KNOWN_EXT = new Set(["KHR_materials_emissive_strength", "KHR_mesh_quantization", "KHR_texture_transform"]);
const COMPRESSED = ["KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_meshopt_compression"];

function fromBase64(s: string): Uint8Array {
	const clean = s.replace(/[^A-Za-z0-9+/\-_]/g, "");
	const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
	const val = (c: number) => (c >= 65 && c <= 90 ? c - 65 : c >= 97 && c <= 122 ? c - 71 : c >= 48 && c <= 57 ? c + 4 : c === 43 || c === 45 ? 62 : 63);
	let n = 0;
	for (let i = 0; i + 1 < clean.length; i += 4) {
		const a = val(clean.charCodeAt(i));
		const b = val(clean.charCodeAt(i + 1));
		const c = i + 2 < clean.length ? val(clean.charCodeAt(i + 2)) : -1;
		const d = i + 3 < clean.length ? val(clean.charCodeAt(i + 3)) : -1;
		out[n++] = (a << 2) | (b >> 4);
		if (c >= 0) out[n++] = ((b & 15) << 4) | (c >> 2);
		if (d >= 0) out[n++] = ((c & 3) << 6) | d;
	}
	return out.subarray(0, n);
}

function dataUri(uri: string): Uint8Array | null {
	if (!uri.startsWith("data:")) return null;
	const comma = uri.indexOf(",");
	if (comma < 0) return new Uint8Array(0);
	const body = uri.slice(comma + 1);
	return /;base64$/i.test(uri.slice(0, comma)) ? fromBase64(body) : new TextEncoder().encode(decodeURIComponent(body));
}

type Source = Uint8Array | ArrayBuffer | string | object;

/** The JSON of a .glb or a .gltf, and the .glb's own binary chunk. */
function container(source: Source): { json: J; bin: Uint8Array | null } {
	if (typeof source === "string") return { json: parseJson(source), bin: null };
	if (!(source instanceof Uint8Array) && !(source instanceof ArrayBuffer)) return { json: source, bin: null };
	const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (bytes.length < 12 || dv.getUint32(0, true) !== GLB_MAGIC) return { json: parseJson(new TextDecoder().decode(bytes)), bin: null };
	const version = dv.getUint32(4, true);
	if (version !== 2) throw new GltfError(`this is a binary glTF ${version}; only glTF 2 is read`);
	let json: J = null;
	let bin: Uint8Array | null = null;
	let at = 12;
	while (at + 8 <= bytes.length) {
		const len = dv.getUint32(at, true);
		const kind = dv.getUint32(at + 4, true);
		const body = bytes.subarray(at + 8, Math.min(bytes.length, at + 8 + len));
		if (kind === CHUNK_JSON && json === null) json = parseJson(new TextDecoder().decode(body));
		else if (kind === CHUNK_BIN && bin === null) bin = body;
		at += 8 + len;
	}
	if (json === null) throw new GltfError("the .glb has no JSON chunk");
	return { json, bin };
}

function parseJson(text: string): J {
	try {
		return JSON.parse(text);
	} catch (e) {
		throw new GltfError(`not a glTF: ${e instanceof Error ? e.message : String(e)}`);
	}
}

/** The files a .gltf keeps its geometry in, as it names them: read each and pass them as `buffers`. A .glb names none. */
export function gltfBufferUris(source: Source): string[] {
	const { json } = container(source);
	const out: string[] = [];
	for (const b of Array.isArray(json?.buffers) ? json.buffers : []) {
		if (typeof b?.uri === "string" && !b.uri.startsWith("data:") && !out.includes(b.uri)) out.push(b.uri);
	}
	return out;
}

/** One of a glTF's pictures: its bytes when the file holds them (a buffer view, a data uri, or a file passed in `buffers`), else the uri it names. */
export interface GltfImage {
	name: string;
	mimeType: string;
	bytes: Uint8Array | null;
	/** the file it names, when it is one beside the glTF */
	uri?: string;
}
/** The pictures a material wears, by index into `images`, in glTF's slots. */
export interface GltfMaterialImages {
	material: number;
	name: string;
	color?: number;
	normal?: number;
	/** glTF packs roughness in green and metalness in blue */
	metallicRoughness?: number;
	/** occlusion in red */
	occlusion?: number;
	emissive?: number;
}

/**
 * The pictures a glTF holds and which material wears each (1.12: a .fart
 * keeps them as image maps). Read before importGltf, to hand it the
 * textures; an external picture is named by its uri and found through
 * `buffers` as a buffer is.
 */
export function gltfImages(source: Source, buffers: Record<string, Uint8Array> = {}): { images: GltfImage[]; materials: GltfMaterialImages[] } {
	const { json, bin } = container(source);
	const bufferOf = (i: number): Uint8Array | null => {
		const b = json?.buffers?.[i];
		if (!b) return null;
		if (typeof b.uri !== "string") return i === 0 ? bin : null;
		return dataUri(b.uri) ?? buffers[b.uri] ?? buffers[safeDecode(b.uri)] ?? null;
	};
	const sniff = (bytes: Uint8Array | null, uri?: string): string => {
		if (bytes && bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
		if (bytes && bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
		const ext = (uri ?? "").toLowerCase().split("?")[0].split(".").pop();
		return ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : ext === "ktx2" ? "image/ktx2" : "application/octet-stream";
	};
	const images: GltfImage[] = (Array.isArray(json?.images) ? json.images : []).map((im: J, i: number): GltfImage => {
		const name = snakeName(im?.name ?? (typeof im?.uri === "string" && !im.uri.startsWith("data:") ? im.uri.replace(/\.[^.]*$/, "") : undefined), `image_${i + 1}`);
		let bytes: Uint8Array | null = null;
		let uri: string | undefined;
		if (typeof im?.bufferView === "number") {
			const v = json.bufferViews?.[im.bufferView];
			const buf = v ? bufferOf(v.buffer ?? 0) : null;
			if (buf && v) bytes = buf.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + (v.byteLength ?? 0));
		} else if (typeof im?.uri === "string") {
			bytes = dataUri(im.uri);
			if (!bytes) {
				uri = im.uri;
				bytes = buffers[im.uri] ?? buffers[safeDecode(im.uri)] ?? null;
			}
		}
		return { name, mimeType: typeof im?.mimeType === "string" ? im.mimeType : sniff(bytes, im?.uri), bytes, uri };
	});
	// a texture's picture: its source, or what an extension (webp, basisu) names instead
	const imageOf = (ref: J): number | undefined => {
		const t = typeof ref?.index === "number" ? json.textures?.[ref.index] : undefined;
		if (!t) return undefined;
		const src = typeof t.source === "number" ? t.source : Object.values(t.extensions ?? {}).map((e) => (e as J)?.source).find((x) => typeof x === "number");
		return typeof src === "number" && images[src] ? src : undefined;
	};
	const materials: GltfMaterialImages[] = [];
	(Array.isArray(json?.materials) ? json.materials : []).forEach((m: J, i: number) => {
		const e: GltfMaterialImages = { material: i, name: snakeName(m?.name, `material_${i + 1}`) };
		const set = (k: "color" | "normal" | "metallicRoughness" | "occlusion" | "emissive", ref: J) => {
			const at = imageOf(ref);
			if (at !== undefined) e[k] = at;
		};
		set("color", m?.pbrMetallicRoughness?.baseColorTexture);
		set("normal", m?.normalTexture);
		set("metallicRoughness", m?.pbrMetallicRoughness?.metallicRoughnessTexture);
		set("occlusion", m?.occlusionTexture);
		set("emissive", m?.emissiveTexture);
		if (Object.keys(e).length > 2) materials.push(e);
	});
	return { images, materials };
}

/** lowercase snake_case: what the format's names look like */
export function snakeName(s: unknown, fallback: string): string {
	const t = typeof s === "string" ? s : "";
	const out = t
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
	return out || fallback;
}

function namer(): (want: string) => string {
	const used = new Set<string>();
	return (want) => {
		let name = want;
		for (let i = 2; used.has(name); i++) name = `${want}_${i}`;
		used.add(name);
		return name;
	};
}

const r3 = (x: number) => {
	const v = Math.round(x * 1000) / 1000;
	return v === 0 ? 0 : v;
};
const r5 = (x: number) => {
	const v = Math.round(x * 100000) / 100000;
	return v === 0 ? 0 : v;
};

function srgb(linear: number): number {
	const c = Math.max(0, Math.min(1, linear));
	return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

/** A node's own map, from its matrix or its translation, rotation and scale. */
function trsXf(t: readonly number[], q: readonly number[], s: readonly number[]): Xf3 {
	const m = quatToMat(normQuat(q));
	return [m[0] * s[0], m[1] * s[1], m[2] * s[2], m[3] * s[0], m[4] * s[1], m[5] * s[2], m[6] * s[0], m[7] * s[1], m[8] * s[2], t[0], t[1], t[2]];
}

function normQuat(q: readonly number[]): Quat {
	const l = Math.hypot(q[0], q[1], q[2], q[3]);
	return l > 1e-12 ? [q[0] / l, q[1] / l, q[2] / l, q[3] / l] : [0, 0, 0, 1];
}

function nodeXf(node: J): Xf3 {
	const m = node?.matrix;
	if (Array.isArray(m) && m.length === 16) return [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10], m[12], m[13], m[14]];
	return trsXf(node?.translation ?? [0, 0, 0], node?.rotation ?? [0, 0, 0, 1], node?.scale ?? [1, 1, 1]);
}

/** The vertices of one mesh node, every primitive end to end, in the document's frame. */
interface Soup {
	pos: number[];
	/** NaN where a primitive carried no normals */
	nor: number[];
	/** a shade per vertex, 1 where a primitive carried no colours */
	lum: number[];
	/** TEXCOORD_0 per vertex, [u, v] with v down the image as glTF has it; NaN where a primitive carried none */
	uv: number[];
	/** 1.9: what each vertex follows, as [joint's node, weight, ...]; absent on a mesh with no skin (or one flattened) */
	skin?: number[][];
	hasNormals: boolean;
	hasColors: boolean;
	/** each morph target's positions (not deltas), vertex for vertex */
	targets: number[][];
	targetNames: string[];
	/** the node whose weights drive the targets */
	node: number;
}

/** The triangles of a soup that one part owns. */
interface Job {
	soup: Soup;
	owner: number;
	tris: number[];
	mats: number[];
}

interface Built {
	shape: MeshShape;
	/** per target, the shape's points in that target */
	targets: Vec3[][];
	soup: Soup;
	quads: number;
}

interface BuildOptions {
	weld: number;
	quads: boolean;
	quadCos: number;
	smoothQuadCos: number;
	shades: boolean;
	split: boolean;
	token: (material: number) => string;
	/** 1.12: the texture a material wears, if any */
	texture: (material: number) => Texture | undefined;
	/** 1.9: a joint node's part, and the part the job's faces are given to */
	joint: (node: number) => string | undefined;
	owner: string;
	warn: (w: string) => void;
	label: string;
}

const sub = (a: readonly number[], b: readonly number[]): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: readonly number[], b: readonly number[]): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: readonly number[]) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: readonly number[]): Vec3 => {
	const l = len(a);
	return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};
const MAX_POINTS = 65535;

/** One job as meshes: welded, paired into quads, smooth where the source was, split by material or by size as asked. */
function buildShapes(job: Job, o: BuildOptions): Built[] {
	const out: Built[] = [];
	// a shape wears one texture: materials that wear different ones are different shapes
	const wearing = new Set(job.mats.map((m) => o.texture(m)));
	if (o.split || wearing.size > 1) {
		const order: number[] = [];
		for (const m of job.mats) if (!order.includes(m)) order.push(m);
		for (const m of order) {
			const tris: number[] = [];
			const mats: number[] = [];
			for (let t = 0; t < job.mats.length; t++) {
				if (job.mats[t] !== m) continue;
				tris.push(job.tris[t * 3], job.tris[t * 3 + 1], job.tris[t * 3 + 2]);
				mats.push(m);
			}
			out.push(...buildOne({ ...job, tris, mats }, o));
		}
		return out;
	}
	return buildOne(job, o);
}

function buildOne(job: Job, o: BuildOptions): Built[] {
	const { soup } = job;
	const nt = soup.targets.length;
	// weld: a grid of cells one tolerance wide, each new position looked for in the cells around its own
	const tol = Math.max(o.weld, 1e-9);
	const points: Vec3[] = [];
	const tpoints: Vec3[][] = soup.targets.map(() => []);
	const lumSum: number[] = [];
	const lumN: number[] = [];
	const skinAt: (number[] | null)[] = [];
	const cells = new Map<string, number[]>();
	const welded = new Map<number, number>();
	const weld = (v: number): number => {
		const hit = welded.get(v);
		if (hit !== undefined) return hit;
		const p: Vec3 = [r3(soup.pos[v * 3]), r3(soup.pos[v * 3 + 1]), r3(soup.pos[v * 3 + 2])];
		const tp: Vec3[] = soup.targets.map((t) => [r3(t[v * 3]), r3(t[v * 3 + 1]), r3(t[v * 3 + 2])]);
		const cx = Math.floor(p[0] / tol);
		const cy = Math.floor(p[1] / tol);
		const cz = Math.floor(p[2] / tol);
		let found = -1;
		search: for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
			for (const i of cells.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
				if (len(sub(points[i], p)) > tol + 1e-9) continue;
				// two corners that part in a morph are two corners
				let same = true;
				for (let t = 0; t < nt && same; t++) same = len(sub(tpoints[t][i], tp[t])) <= tol + 1e-9;
				if (!same) continue;
				found = i;
				break search;
			}
		}
		if (found < 0) {
			found = points.length;
			points.push(p);
			tp.forEach((q, t) => tpoints[t].push(q));
			lumSum.push(0);
			lumN.push(0);
			skinAt.push(soup.skin?.[v] ?? null);
			const key = `${cx},${cy},${cz}`;
			const cell = cells.get(key);
			if (cell) cell.push(found);
			else cells.set(key, [found]);
		}
		lumSum[found] += soup.lum[v];
		lumN[found]++;
		welded.set(v, found);
		return found;
	};

	// triangles over welded points, each corner remembering the vertex it came from (its normal)
	const tri: number[] = [];
	const src: number[] = [];
	const mat: number[] = [];
	let dropped = 0;
	for (let t = 0; t < job.mats.length; t++) {
		const v = [job.tris[t * 3], job.tris[t * 3 + 1], job.tris[t * 3 + 2]];
		const w = v.map(weld);
		if (w[0] === w[1] || w[1] === w[2] || w[0] === w[2] || len(cross(sub(points[w[1]], points[w[0]]), sub(points[w[2]], points[w[0]]))) < 1e-9) {
			dropped++;
			continue;
		}
		tri.push(w[0], w[1], w[2]);
		src.push(v[0], v[1], v[2]);
		mat.push(job.mats[t]);
	}
	if (dropped) o.warn(`${o.label}: ${dropped} triangle${dropped === 1 ? "" : "s"} with no area left out`);
	const n = mat.length;
	if (!n) return [];
	const np = points.length;

	// edges, and the two triangles each joins
	const normal: Vec3[] = [];
	for (let t = 0; t < n; t++) normal.push(unit(cross(sub(points[tri[t * 3 + 1]], points[tri[t * 3]]), sub(points[tri[t * 3 + 2]], points[tri[t * 3]]))));
	const edges = new Map<number, number[]>();
	for (let t = 0; t < n; t++) for (let c = 0; c < 3; c++) {
		const a = tri[t * 3 + c];
		const b = tri[t * 3 + ((c + 1) % 3)];
		const key = Math.min(a, b) * np + Math.max(a, b);
		const list = edges.get(key);
		// the corner's slot: which triangle, and which of its corners starts the edge
		if (list) list.push(t * 3 + c);
		else edges.set(key, [t * 3 + c]);
	}
	const normalAt = (slot: number): Vec3 => [soup.nor[src[slot] * 3], soup.nor[src[slot] * 3 + 1], soup.nor[src[slot] * 3 + 2]];
	const next = (slot: number) => slot - (slot % 3) + (((slot % 3) + 1) % 3);
	// 1.12: the texture this shape wears, and whether its corners carry uvs to wear it by
	const texture = o.texture(mat[0]);
	const withUVs = !!texture && src.some((v) => !Number.isNaN(soup.uv[v * 2]));
	if (texture && !withUVs) o.warn(`${o.label}: wears ${texture.name} but has no TEXCOORD_0; it is box mapped`);
	const sameUV = (a: number, b: number) => Math.abs(soup.uv[src[a] * 2] - soup.uv[src[b] * 2]) < 1e-6 && Math.abs(soup.uv[src[a] * 2 + 1] - soup.uv[src[b] * 2 + 1]) < 1e-6;

	// smooth or sharp, edge by edge: smooth where both triangles carry the same normal at each end
	// (flat shading gives each face its own, so across a fold they differ by the fold itself)
	/** degrees two normals may differ by and still be one */
	const SAME = 0.5;
	/** the fold at each edge two triangles share, and whether the source lights across it as one surface */
	const fold = new Map<number, number>();
	const smoothKeys = new Set<number>();
	for (const [key, slots] of edges) {
		if (slots.length !== 2) continue;
		const [s, u] = slots;
		fold.set(key, (Math.acos(Math.max(-1, Math.min(1, dot(normal[Math.floor(s / 3)], normal[Math.floor(u / 3)])))) * 180) / Math.PI);
		if (!soup.hasNormals) continue;
		// the edge runs a→b in one triangle and b→a in the other
		const sa = normalAt(s);
		const sb = normalAt(next(s));
		const ua = tri[u] === tri[s] ? normalAt(u) : normalAt(next(u));
		const ub = tri[u] === tri[s] ? normalAt(next(u)) : normalAt(u);
		if ([sa, sb, ua, ub].some((v) => Number.isNaN(v[0]))) continue;
		const apart = Math.max(Math.acos(Math.min(1, dot(unit(sa), unit(ua)))), Math.acos(Math.min(1, dot(unit(sb), unit(ub))))) * (180 / Math.PI);
		if (apart <= SAME) smoothKeys.add(key);
	}

	// quads: the best pairs first, each triangle used once
	const pair = new Int32Array(n).fill(-1);
	const quadOf = new Map<number, number[]>();
	/** each quad's corners as the slots they came from, for their uvs */
	const quadSlots = new Map<number, number[]>();
	if (o.quads) {
		const cands: { a: number; b: number; key: number; score: number; quad: number[]; corners: number[] }[] = [];
		for (const [key, slots] of edges) {
			if (slots.length !== 2) continue;
			const [s, u] = slots;
			const ta = Math.floor(s / 3);
			const tb = Math.floor(u / 3);
			if (mat[ta] !== mat[tb] || tri[s] === tri[u]) continue;
			// a seam in the uvs along the diagonal: the two halves are mapped apart, so they stay two faces
			if (withUVs) {
				const uA = tri[u] === tri[s] ? u : next(u);
				const uB = tri[u] === tri[s] ? next(u) : u;
				if (!sameUV(s, uA) || !sameUV(next(s), uB)) continue;
			}
			// a fold the source lights as one surface does not show: it may bend further and still be a quad
			const bend = dot(normal[ta], normal[tb]);
			if (bend < (smoothKeys.has(key) ? o.smoothQuadCos : o.quadCos)) continue;
			// from the shared edge a→b of triangle A (a, b, c) and the far corner d of B: a, d, b, c, fanned from a along the old edge
			const a = tri[s];
			const b = tri[next(s)];
			const c = tri[next(next(s))];
			const d = tri[next(next(u))];
			if (d === a || d === b || d === c) continue;
			const quad = [a, d, b, c];
			const corners = [s, next(next(u)), next(s), next(next(s))];
			const nq = unit([normal[ta][0] + normal[tb][0], normal[ta][1] + normal[tb][1], normal[ta][2] + normal[tb][2]]);
			let worst = 0;
			let convex = true;
			for (let i = 0; i < 4 && convex; i++) {
				const p0 = points[quad[i]];
				const e1 = unit(sub(points[quad[(i + 1) % 4]], p0));
				const e2 = unit(sub(points[quad[(i + 3) % 4]], p0));
				// a corner that turns the wrong way, or hardly turns, is no corner of a quad
				if (dot(cross(e1, e2), nq) < 0.035) convex = false;
				worst = Math.max(worst, Math.abs(dot(e1, e2)));
			}
			if (!convex) continue;
			// squareness first, flatness after, then the pair the exporter most likely cut
			cands.push({ a: ta, b: tb, key, score: worst + (1 - bend) + (Math.abs(ta - tb) === 1 ? 0 : 1e-6), quad, corners });
		}
		cands.sort((x, y) => x.score - y.score || x.a - y.a || x.b - y.b);
		for (const c of cands) {
			if (pair[c.a] >= 0 || pair[c.b] >= 0) continue;
			pair[c.a] = c.b;
			pair[c.b] = c.a;
			quadOf.set(Math.min(c.a, c.b), c.quad);
			quadSlots.set(Math.min(c.a, c.b), c.corners);
			fold.delete(c.key);
		}
	}
	const faces: number[][] = [];
	const faceMat: number[] = [];
	const faceUV: Vec2[][] = [];
	// pattern coordinates: glTF's 0..1 over the cell, v already down; precise to a hundred-thousandth of the cell
	const [cw, ch] = texture?.cell ?? [1, 1];
	const places = Math.max(0, Math.ceil(Math.log10(1e5 / Math.max(cw, ch, 1e-9))));
	const ru = (x: number) => {
		const v = Math.round(x * 10 ** places) / 10 ** places;
		return v === 0 ? 0 : v;
	};
	const uvAt = (slot: number): Vec2 => {
		const u = soup.uv[src[slot] * 2];
		const v = soup.uv[src[slot] * 2 + 1];
		return Number.isNaN(u) ? [0, 0] : [ru(u * cw), ru(v * ch)];
	};
	for (let t = 0; t < n; t++) {
		if (pair[t] >= 0 && pair[t] < t) continue;
		faces.push(pair[t] >= 0 ? quadOf.get(t)! : [tri[t * 3], tri[t * 3 + 1], tri[t * 3 + 2]]);
		faceMat.push(mat[t]);
		if (withUVs) faceUV.push((pair[t] >= 0 ? quadSlots.get(t)! : [t * 3, t * 3 + 1, t * 3 + 2]).map(uvAt));
	}

	// what is left between the faces says whether the shape is smooth: folds lit as one surface against folds that show
	// (faces in one plane are lit alike either way and say nothing)
	const sharpAngles: [number, number][] = [];
	let smoothEdges = 0;
	let sharpEdges = 0;
	let maxSmooth = 0;
	let minSharp = 180;
	if (soup.hasNormals) for (const [key, angle] of fold) {
		if (angle < 1) continue;
		if (smoothKeys.has(key)) {
			smoothEdges++;
			maxSmooth = Math.max(maxSmooth, angle);
		} else {
			sharpEdges++;
			minSharp = Math.min(minSharp, angle);
			sharpAngles.push([key, angle]);
		}
	}
	// a capped cylinder is smooth round its side and has twice as many rim edges: a quarter of the folds is enough to call the shape smooth
	const isSmooth = smoothEdges > 0 && smoothEdges * 3 >= sharpEdges;

	// smooth: an angle between the sharpest smooth edge and the gentlest sharp one, and a crease where no angle tells them apart
	const smoothFields: Pick<MeshShape, "normals" | "angle" | "creases"> = {};
	let creaseKeys: number[] = [];
	if (isSmooth) {
		smoothFields.normals = "smooth";
		if (sharpEdges) {
			const angle = minSharp > maxSmooth + 1 ? Math.round((maxSmooth + minSharp) / 2) : Math.ceil(maxSmooth);
			smoothFields.angle = Math.min(180, Math.max(1, angle));
			creaseKeys = sharpAngles.filter(([, a]) => a <= smoothFields.angle!).map(([k]) => k);
		}
	}

	// 1.9: a skin, where any point follows something other than the part its face was given to
	const skinOf = (i: number): [string, number][] => {
		const by = new Map<string, number>();
		const e = skinAt[i] ?? [];
		for (let k = 0; k + 1 < e.length; k += 2) {
			const name = o.joint(e[k]);
			if (name !== undefined && e[k + 1] > 0) by.set(name, (by.get(name) ?? 0) + e[k + 1]);
		}
		const all = [...by].sort((a, b) => b[1] - a[1]).slice(0, 4);
		const total = all.reduce((t, [, w]) => t + w, 0);
		return total > 0 ? all.map(([n, w]) => [n, w / total]) : [[o.owner, 1]];
	};
	const useSkin = !!soup.skin && skinAt.some((_, i) => skinOf(i).some(([n, w]) => n !== o.owner && w > 0.002));

	const shades = o.shades && soup.hasColors ? lumSum.map((s, i) => Math.round((lumN[i] ? s / lumN[i] : 1) * 1000) / 1000) : null;
	const useShades = shades !== null && shades.some((s) => Math.abs(s - 1) > 0.002);

	// a shape's indices are 16 bits wide: past 65,535 points it is cut into several, faces kept whole
	const chunks: number[][] = [[]];
	if (np > MAX_POINTS) {
		let seen = new Set<number>();
		for (let f = 0; f < faces.length; f++) {
			const fresh = faces[f].filter((i) => !seen.has(i)).length;
			if (seen.size + fresh > MAX_POINTS) {
				chunks.push([]);
				seen = new Set<number>();
			}
			for (const i of faces[f]) seen.add(i);
			chunks[chunks.length - 1].push(f);
		}
		o.warn(`${o.label}: ${np} points are more than one shape holds (65,535); cut into ${chunks.length} shapes`);
	} else chunks[0] = faces.map((_, f) => f);

	const built: Built[] = [];
	for (const chunk of chunks) {
		if (!chunk.length) continue;
		const remap = new Map<number, number>();
		const pts: Vec3[] = [];
		const tps: Vec3[][] = soup.targets.map(() => []);
		const shd: number[] = [];
		const joints: string[] = [];
		const weights: number[][] = [];
		const at = (i: number): number => {
			let j = remap.get(i);
			if (j === undefined) {
				j = pts.length;
				remap.set(i, j);
				pts.push(points[i]);
				tps.forEach((t, k) => t.push(tpoints[k][i]));
				if (useShades) shd.push(shades![i]);
				if (useSkin) {
					const entry: number[] = [];
					for (const [name, w] of skinOf(i)) {
						const r = Math.round(w * 1000) / 1000;
						if (r <= 0) continue;
						if (!joints.includes(name)) joints.push(name);
						entry.push(joints.indexOf(name), r);
					}
					// (rounded, they still add up to 1)
					entry[1] = Math.round((entry[1] + 1 - entry.reduce((t, w, k) => (k % 2 ? t + w : t), 0)) * 1000) / 1000;
					weights.push(entry);
				}
			}
			return j;
		};
		const fs = chunk.map((f) => faces[f].map(at));
		// colours in the order the faces meet them: the first is the shape's own
		const order: number[] = [];
		for (const f of chunk) if (!order.includes(faceMat[f])) order.push(faceMat[f]);
		// points and faces follow the fields a reader wants first
		const shape = { kind: "mesh", color: o.token(order[0]) } as MeshShape;
		if (order.length > 1) shape.colors = order.slice(1).map(o.token);
		Object.assign(shape, smoothFields);
		if (creaseKeys.length) {
			const creases: number[][] = [];
			for (const key of creaseKeys) {
				const a = remap.get(Math.floor(key / np));
				const b = remap.get(key % np);
				if (a !== undefined && b !== undefined && fs.some((f) => f.some((v, i) => (v === a && f[(i + 1) % f.length] === b) || (v === b && f[(i + 1) % f.length] === a)))) creases.push([a, b, 1]);
			}
			if (creases.length) shape.creases = creases;
		}
		shape.points = pts;
		shape.faces = fs;
		if (order.length > 1) shape.paint = chunk.map((f) => order.indexOf(faceMat[f]));
		if (useShades) shape.shades = shd;
		if (useSkin) shape.skin = { joints, weights };
		if (texture) {
			shape.texture = texture.name;
			// without uvs the texture is box mapped (1.5)
			if (withUVs) shape.mapping = { uvs: chunk.map((f) => faceUV[f]) };
		}
		built.push({ shape, targets: tps, soup, quads: chunk.filter((f) => faces[f].length === 4).length });
	}
	return built;
}

/** A sampler read at a time: linear, held, or along its cubic spline. */
function sampleChannel(times: readonly number[], values: readonly number[], n: number, mode: string, rotation: boolean, t: number): number[] {
	const cubic = mode === "CUBICSPLINE";
	const at = (k: number): number[] => (cubic ? values.slice(k * 3 * n + n, k * 3 * n + 2 * n) : values.slice(k * n, k * n + n));
	const last = times.length - 1;
	if (last < 0) return [];
	if (t <= times[0]) return at(0);
	if (t >= times[last]) return at(last);
	let k = 0;
	while (k < last && times[k + 1] <= t) k++;
	if (times[k] === t || mode === "STEP") return at(k);
	const dt = times[k + 1] - times[k];
	const u = dt > 0 ? (t - times[k]) / dt : 0;
	const a = at(k);
	const b = at(k + 1);
	if (cubic) {
		const outA = values.slice(k * 3 * n + 2 * n, k * 3 * n + 3 * n);
		const inB = values.slice((k + 1) * 3 * n, (k + 1) * 3 * n + n);
		const u2 = u * u;
		const u3 = u2 * u;
		const v = a.map((x, i) => (2 * u3 - 3 * u2 + 1) * x + (u3 - 2 * u2 + u) * dt * outA[i] + (-2 * u3 + 3 * u2) * b[i] + (u3 - u2) * dt * inB[i]);
		return rotation ? normQuat(v) : v;
	}
	if (rotation) return quatSlerp(normQuat(a), normQuat(b), u);
	return a.map((x, i) => x + (b[i] - x) * u);
}

interface Channel {
	times: number[];
	values: number[];
	n: number;
	mode: string;
}

/** The format's own summary of a document an import made. */
export function gltfSummary(doc: Doc3, scale = 1): GltfSummary {
	let shapes = 0;
	let points = 0;
	let faces = 0;
	let quads = 0;
	const lo: Vec3 = [Infinity, Infinity, Infinity];
	const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
	for (const part of doc.parts ?? []) for (const sh of part.shapes ?? []) {
		shapes++;
		if (sh.kind !== "mesh") continue;
		points += sh.points.length;
		faces += sh.faces.length;
		quads += sh.faces.filter((f) => f.length === 4).length;
		for (const p of sh.points) for (let i = 0; i < 3; i++) {
			lo[i] = Math.min(lo[i], p[i]);
			hi[i] = Math.max(hi[i], p[i]);
		}
	}
	const size: Vec3 = points ? [r3(hi[0] - lo[0]), r3(hi[1] - lo[1]), r3(hi[2] - lo[2])] : [0, 0, 0];
	return { parts: (doc.parts ?? []).length, shapes, points, faces, quads, tokens: (doc.palette ?? []).length, states: (doc.states ?? []).length, clips: (doc.clips ?? []).length, size, scale };
}

/**
 * A glTF 2.0 model as a 3D document. `source` is a .glb's bytes, a
 * .gltf's bytes or text, or its parsed JSON; a .gltf that keeps its
 * geometry in other files needs them in `options.buffers`.
 * Throws a GltfError for what cannot be read at all (not a glTF,
 * compressed geometry, a missing buffer); everything else that is left
 * out is named in `warnings`.
 */
export function importGltf(source: Source, options: GltfImportOptions = {}): GltfImport {
	const { json, bin } = container(source);
	if (typeof json !== "object" || json === null || typeof json.asset !== "object") throw new GltfError("not a glTF: no asset");
	if (typeof json.asset.version === "string" && !json.asset.version.startsWith("2")) throw new GltfError(`this is glTF ${json.asset.version}; only glTF 2 is read`);
	const warnings: string[] = [];
	const warn = (w: string) => {
		if (!warnings.includes(w)) warnings.push(w);
	};

	// what the file leans on
	const required: string[] = Array.isArray(json.extensionsRequired) ? json.extensionsRequired : [];
	const used: string[] = Array.isArray(json.extensionsUsed) ? json.extensionsUsed : [];
	for (const ext of COMPRESSED) {
		if (required.includes(ext)) throw new GltfError(`the geometry is compressed (${ext}), which is not read: export it again without compression`);
	}
	for (const ext of new Set([...used, ...required])) {
		if (KNOWN_EXT.has(ext)) continue;
		if (ext === "KHR_lights_punctual") continue; // counted with the lights below
		if (COMPRESSED.includes(ext)) continue; // an error where a primitive needs it
		warn(`extension ${ext} is not read${required.includes(ext) ? " (the file says it requires it)" : ""}`);
	}
	const cameras = Array.isArray(json.cameras) ? json.cameras.length : 0;
	if (cameras) warn(`${cameras} camera${cameras === 1 ? "" : "s"} left out`);
	const lights = json.extensions?.KHR_lights_punctual?.lights;
	if (Array.isArray(lights) && lights.length) warn(`${lights.length} light${lights.length === 1 ? "" : "s"} left out`);

	// buffers and accessors
	const buffers: (Uint8Array | null)[] = [];
	const bufferOf = (i: number): Uint8Array => {
		if (buffers[i]) return buffers[i]!;
		const b = json.buffers?.[i];
		if (!b) throw new GltfError(`buffer ${i} is not in the file`);
		let data: Uint8Array | null | undefined;
		if (typeof b.uri !== "string") data = i === 0 ? bin : null;
		else data = dataUri(b.uri) ?? options.buffers?.[b.uri] ?? options.buffers?.[safeDecode(b.uri)];
		if (!data) throw new GltfError(typeof b.uri === "string" ? `the file keeps its geometry in ${b.uri}, which was not found beside it` : "the .glb has no binary chunk");
		buffers[i] = data;
		return data;
	};
	const viewBytes = (i: number): { bytes: Uint8Array; stride: number } => {
		const v = json.bufferViews?.[i];
		if (!v) throw new GltfError(`buffer view ${i} is not in the file`);
		for (const ext of COMPRESSED) if (v.extensions?.[ext]) throw new GltfError(`the geometry is compressed (${ext}), which is not read: export it again without compression`);
		const buf = bufferOf(v.buffer ?? 0);
		const off = v.byteOffset ?? 0;
		return { bytes: buf.subarray(off, off + (v.byteLength ?? 0)), stride: v.byteStride ?? 0 };
	};
	const readRaw = (view: number | undefined, offset: number, componentType: number, n: number, count: number, normalized: boolean): number[] => {
		const out: number[] = new Array(count * n).fill(0);
		if (view === undefined) return out;
		const { bytes, stride } = viewBytes(view);
		const size = componentType === 5120 || componentType === 5121 ? 1 : componentType === 5122 || componentType === 5123 ? 2 : 4;
		const step = stride || size * n;
		const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		if (offset + (count - 1) * step + size * n > bytes.length && count > 0) throw new GltfError("an accessor reads past the end of its buffer");
		for (let i = 0; i < count; i++) for (let c = 0; c < n; c++) {
			const at = offset + i * step + c * size;
			let v: number;
			switch (componentType) {
				case 5120:
					v = dv.getInt8(at);
					if (normalized) v = Math.max(v / 127, -1);
					break;
				case 5121:
					v = dv.getUint8(at);
					if (normalized) v /= 255;
					break;
				case 5122:
					v = dv.getInt16(at, true);
					if (normalized) v = Math.max(v / 32767, -1);
					break;
				case 5123:
					v = dv.getUint16(at, true);
					if (normalized) v /= 65535;
					break;
				case 5125:
					v = dv.getUint32(at, true);
					break;
				case 5126:
					v = dv.getFloat32(at, true);
					break;
				default:
					throw new GltfError(`an accessor has a component type (${componentType}) glTF does not define`);
			}
			out[i * n + c] = v;
		}
		return out;
	};
	const accessorCache = new Map<number, { data: number[]; n: number; count: number }>();
	const accessor = (i: number): { data: number[]; n: number; count: number } => {
		const hit = accessorCache.get(i);
		if (hit) return hit;
		const a = json.accessors?.[i];
		if (!a) throw new GltfError(`accessor ${i} is not in the file`);
		const n = COMPONENTS[a.type] ?? 1;
		const count = a.count ?? 0;
		const data = readRaw(a.bufferView, a.byteOffset ?? 0, a.componentType, n, count, a.normalized === true);
		if (a.sparse && a.sparse.count > 0) {
			const idx = readRaw(a.sparse.indices.bufferView, a.sparse.indices.byteOffset ?? 0, a.sparse.indices.componentType, 1, a.sparse.count, false);
			const val = readRaw(a.sparse.values.bufferView, a.sparse.values.byteOffset ?? 0, a.componentType, n, a.sparse.count, a.normalized === true);
			idx.forEach((v, k) => {
				for (let c = 0; c < n; c++) data[v * n + c] = val[k * n + c];
			});
		}
		const out = { data, n, count };
		accessorCache.set(i, out);
		return out;
	};

	// the scene: every node's place at rest, and who it hangs from
	const nodes: J[] = Array.isArray(json.nodes) ? json.nodes : [];
	const scenes: J[] = Array.isArray(json.scenes) ? json.scenes : [];
	const sceneIndex = typeof json.scene === "number" && scenes[json.scene] ? json.scene : 0;
	if (scenes.length > 1) warn(`the file has ${scenes.length} scenes; only ${scenes[sceneIndex]?.name ? `"${scenes[sceneIndex].name}"` : `scene ${sceneIndex}`} is read`);
	let roots: number[] = Array.isArray(scenes[sceneIndex]?.nodes) ? scenes[sceneIndex].nodes : [];
	if (!scenes.length) {
		const kids = new Set<number>();
		for (const nd of nodes) for (const c of nd?.children ?? []) kids.add(c);
		roots = nodes.map((_, i) => i).filter((i) => !kids.has(i));
	}
	const world: (Xf3 | undefined)[] = [];
	const parentOf: number[] = nodes.map(() => -1);
	const order: number[] = [];
	const walk = (i: number, parent: number, above: Xf3) => {
		if (!nodes[i] || world[i]) return;
		world[i] = xf3Mul(above, nodeXf(nodes[i]));
		parentOf[i] = parent;
		order.push(i);
		for (const c of nodes[i].children ?? []) walk(c, i, world[i]!);
	};
	for (const r of roots) walk(r, -1, XF3_ID);
	/** a node's rest map into the document's frame, before the unit scale */
	const docXf = (i: number): Xf3 => xf3Mul(Y_UP, world[i]!);

	// geometry: a soup per mesh node, its triangles handed to the parts that own them
	const jobs: Job[] = [];
	const skinsWarned = new Set<number>();
	const keepSkins = options.skins !== false && options.merge !== true;
	const texturesWarned = new Set<number>();
	const usedMaterials = new Set<number>();
	for (const ni of order) {
		const node = nodes[ni];
		const mesh = typeof node.mesh === "number" ? json.meshes?.[node.mesh] : undefined;
		if (!mesh) continue;
		const label = `mesh ${mesh.name ? `"${mesh.name}"` : node.mesh}`;
		if (node.extensions?.EXT_mesh_gpu_instancing) warn(`${label}: its instances (EXT_mesh_gpu_instancing) are left out; one copy is read`);
		const skin = typeof node.skin === "number" ? json.skins?.[node.skin] : undefined;
		const joints: number[] = skin && Array.isArray(skin.joints) ? skin.joints.filter((j: number) => world[j]) : [];
		const skinned = !!skin && joints.length > 0;
		// each joint's map from the mesh's bind space to where the joint holds it now
		let jointXf: Xf3[] = [];
		if (skinned) {
			const ibm = typeof skin.inverseBindMatrices === "number" ? accessor(skin.inverseBindMatrices).data : null;
			jointXf = (skin.joints as number[]).map((j, k) => {
				if (!world[j]) return XF3_ID;
				const m = ibm ? ibm.slice(k * 16, k * 16 + 16) : null;
				const inv: Xf3 = m ? [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10], m[12], m[13], m[14]] : XF3_ID;
				return xf3Mul(Y_UP, xf3Mul(world[j]!, inv));
			});
			if (!keepSkins && !skinsWarned.has(node.skin)) {
				skinsWarned.add(node.skin);
				warn(`${label} is skinned: smooth skinning is flattened to rigid parts, each face bound to the joint that holds most of it`);
			}
		}
		const D = docXf(ni);
		const flipped = !skinned && xf3Det(D) < 0;
		// normals turn with the inverse transpose
		const Dinv = xf3Invert(D);
		const turnNormal = (M: Xf3, nx: number, ny: number, nz: number): Vec3 => unit([M[0] * nx + M[3] * ny + M[6] * nz, M[1] * nx + M[4] * ny + M[7] * nz, M[2] * nx + M[5] * ny + M[8] * nz]);
		const soup: Soup = { pos: [], nor: [], lum: [], uv: [], hasNormals: false, hasColors: false, targets: [], targetNames: [], node: ni };
		if (skinned && keepSkins) soup.skin = [];
		const targetCount = Math.max(0, ...(mesh.primitives ?? []).map((p: J) => (Array.isArray(p?.targets) ? p.targets.length : 0)));
		for (let t = 0; t < targetCount; t++) {
			soup.targets.push([]);
			soup.targetNames.push(typeof mesh.extras?.targetNames?.[t] === "string" && mesh.extras.targetNames[t] ? mesh.extras.targetNames[t] : `target_${t + 1}`);
		}
		const owners = new Map<number, { tris: number[]; mats: number[] }>();
		const give = (owner: number, a: number, b: number, c: number, material: number) => {
			let o = owners.get(owner);
			if (!o) owners.set(owner, (o = { tris: [], mats: [] }));
			o.tris.push(a, b, c);
			o.mats.push(material);
		};
		(mesh.primitives ?? []).forEach((prim: J, pi: number) => {
			for (const ext of COMPRESSED) if (prim?.extensions?.[ext]) throw new GltfError(`${label} is compressed (${ext}), which is not read: export it again without compression`);
			const mode = prim?.mode ?? 4;
			if (mode < 4) {
				warn(`${label}: ${mode === 0 ? "points" : "lines"} left out (only triangles are read)`);
				return;
			}
			if (typeof prim?.attributes?.POSITION !== "number") {
				warn(`${label}: primitive ${pi} has no positions and is left out`);
				return;
			}
			const P = accessor(prim.attributes.POSITION);
			const N = typeof prim.attributes.NORMAL === "number" ? accessor(prim.attributes.NORMAL) : null;
			const C = options.shades !== false && typeof prim.attributes.COLOR_0 === "number" ? accessor(prim.attributes.COLOR_0) : null;
			const UV = options.textures?.length && typeof prim.attributes.TEXCOORD_0 === "number" ? accessor(prim.attributes.TEXCOORD_0) : null;
			const JN = skinned && typeof prim.attributes.JOINTS_0 === "number" ? accessor(prim.attributes.JOINTS_0) : null;
			const WT = skinned && typeof prim.attributes.WEIGHTS_0 === "number" ? accessor(prim.attributes.WEIGHTS_0) : null;
			const T: ({ data: number[] } | null)[] = [];
			for (let t = 0; t < targetCount; t++) T.push(typeof prim.targets?.[t]?.POSITION === "number" ? accessor(prim.targets[t].POSITION) : null);
			const base = soup.pos.length / 3;
			/** the joint that holds most of each vertex, for the faces to vote with */
			const lead: number[] = [];
			for (let v = 0; v < P.count; v++) {
				const p: Vec3 = [P.data[v * 3], P.data[v * 3 + 1], P.data[v * 3 + 2]];
				let M = D;
				let Minv = Dinv;
				if (JN && WT) {
					// where the weighted joints hold this vertex at rest
					const acc = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
					let total = 0;
					let best = -1;
					let bestW = 0;
					for (let k = 0; k < 4; k++) {
						const w = WT.data[v * WT.n + k] ?? 0;
						const j = JN.data[v * JN.n + k] ?? 0;
						if (!(w > 0) || !jointXf[j]) continue;
						for (let e = 0; e < 12; e++) acc[e] += jointXf[j][e] * w;
						total += w;
						if (w > bestW) {
							bestW = w;
							best = j;
						}
					}
					if (total > 0) {
						M = acc.map((x) => x / total) as Xf3;
						Minv = xf3Invert(M);
					}
					lead.push(best);
					if (soup.skin) {
						const entry: number[] = [];
						for (let k = 0; k < 4; k++) {
							const w = WT.data[v * WT.n + k] ?? 0;
							const j = skin.joints[JN.data[v * JN.n + k] ?? 0];
							if (w > 0 && typeof j === "number" && world[j]) entry.push(j, w);
						}
						soup.skin.push(entry);
					}
				} else if (soup.skin) soup.skin.push([]);
				const q = xf3Apply(M, p);
				soup.pos.push(q[0], q[1], q[2]);
				if (N) {
					const nn = turnNormal(Minv, N.data[v * 3], N.data[v * 3 + 1], N.data[v * 3 + 2]);
					soup.nor.push(nn[0], nn[1], nn[2]);
				} else soup.nor.push(NaN, NaN, NaN);
				if (C) {
					// linear light to the shade a display would show
					const lin = 0.2126 * C.data[v * C.n] + 0.7152 * C.data[v * C.n + 1] + 0.0722 * C.data[v * C.n + 2];
					soup.lum.push(srgb(lin));
				} else soup.lum.push(1);
				if (UV) soup.uv.push(UV.data[v * UV.n], UV.data[v * UV.n + 1]);
				else soup.uv.push(NaN, NaN);
				for (let t = 0; t < targetCount; t++) {
					const d = T[t]?.data;
					const tq = d ? xf3Apply(M, [p[0] + d[v * 3], p[1] + d[v * 3 + 1], p[2] + d[v * 3 + 2]]) : q;
					soup.targets[t].push(tq[0], tq[1], tq[2]);
				}
			}
			if (N) soup.hasNormals = true;
			if (C) soup.hasColors = true;
			const idx = typeof prim.indices === "number" ? accessor(prim.indices).data : Array.from({ length: P.count }, (_, i) => i);
			const material = typeof prim.material === "number" && json.materials?.[prim.material] ? prim.material : -1;
			const tri = (a: number, b: number, c: number) => {
				if (a >= P.count || b >= P.count || c >= P.count) return;
				let owner = ni;
				if (JN && WT) {
					// the joint with the most weight over the three corners
					const votes = new Map<number, number>();
					for (const v of [a, b, c]) for (let k = 0; k < 4; k++) {
						const w = WT.data[v * WT.n + k] ?? 0;
						if (w > 0) votes.set(JN.data[v * JN.n + k], (votes.get(JN.data[v * JN.n + k]) ?? 0) + w);
					}
					let best = lead[a];
					let bestW = -1;
					for (const [j, w] of votes) if (w > bestW + 1e-9) {
						bestW = w;
						best = j;
					}
					const jn = skin.joints[best];
					if (typeof jn === "number" && world[jn]) owner = jn;
				}
				if (flipped) give(owner, base + a, base + c, base + b, material);
				else give(owner, base + a, base + b, base + c, material);
			};
			if (mode === 4) for (let i = 0; i + 2 < idx.length; i += 3) tri(idx[i], idx[i + 1], idx[i + 2]);
			else if (mode === 5) for (let i = 0; i + 2 < idx.length; i++) (i % 2 ? tri(idx[i + 1], idx[i], idx[i + 2]) : tri(idx[i], idx[i + 1], idx[i + 2]));
			else if (mode === 6) for (let i = 1; i + 1 < idx.length; i++) tri(idx[0], idx[i], idx[i + 1]);
			if (material >= 0) usedMaterials.add(material);
			else usedMaterials.add(-1);
		});
		for (const [owner, o] of owners) if (o.mats.length) jobs.push({ soup, owner, tris: o.tris, mats: o.mats });
		if (mesh.weights?.some?.((w: number) => Math.abs(w) > 1e-6) || node.weights?.some?.((w: number) => Math.abs(w) > 1e-6)) warn(`${label}: its morph weights at rest are not zero; the document at rest is the unmorphed mesh`);
	}

	// units: a factor, or the height asked for
	let k = options.scale !== undefined && options.scale > 0 ? options.scale : 1;
	const soups = [...new Set(jobs.map((j) => j.soup))];
	if (options.height !== undefined && options.height > 0) {
		let lo = Infinity;
		let hi = -Infinity;
		for (const j of jobs) for (const v of j.tris) {
			lo = Math.min(lo, j.soup.pos[v * 3 + 1]);
			hi = Math.max(hi, j.soup.pos[v * 3 + 1]);
		}
		if (hi - lo > 1e-9) k = options.height / (hi - lo);
		else warn("the model has no height to scale by; left at scale 1");
	}
	if (k !== 1) for (const s of soups) {
		for (let i = 0; i < s.pos.length; i++) s.pos[i] *= k;
		for (const t of s.targets) for (let i = 0; i < t.length; i++) t[i] *= k;
	}

	// 1.12: the texture each material wears, as the caller says
	const textureOf = (mi: number): Texture | undefined => options.textures?.find((t) => !t.materials || t.materials.includes(mi))?.texture;

	// colour: a token per material that something wears
	const tokenName = namer();
	const tokenOf = new Map<number, string>();
	const palette: Token[] = [];
	const materials: J[] = Array.isArray(json.materials) ? json.materials : [];
	for (const mi of [...usedMaterials].sort((a, b) => a - b)) {
		if (mi < 0) {
			// glTF's own default: white
			const name = tokenName("default");
			tokenOf.set(mi, name);
			palette.push({ name, rgb: [255, 255, 255, 255] });
			continue;
		}
		const m = materials[mi];
		const name = tokenName(snakeName(m?.name, `material_${mi + 1}`));
		tokenOf.set(mi, name);
		const pbr = m?.pbrMetallicRoughness ?? {};
		let f: number[] = Array.isArray(pbr.baseColorFactor) && pbr.baseColorFactor.length === 4 ? pbr.baseColorFactor : [1, 1, 1, 1];
		const e: number[] = Array.isArray(m?.emissiveFactor) ? m.emissiveFactor : [0, 0, 0];
		const strength = typeof m?.extensions?.KHR_materials_emissive_strength?.emissiveStrength === "number" ? m.extensions.KHR_materials_emissive_strength.emissiveStrength : 1;
		const glow = Math.max(e[0] ?? 0, e[1] ?? 0, e[2] ?? 0) * strength;
		// a material that only glows shows its glow's colour
		if (glow > 0 && f[0] + f[1] + f[2] < 1e-6) {
			const top = Math.max(e[0], e[1], e[2]);
			f = [e[0] / top, e[1] / top, e[2] / top, f[3]];
		}
		const token: Token = { name, rgb: [Math.round(srgb(f[0]) * 255), Math.round(srgb(f[1]) * 255), Math.round(srgb(f[2]) * 255), Math.round(Math.max(0, Math.min(1, f[3])) * 255)] };
		if (glow > 0) token.emissive = r3(glow);
		palette.push(token);
		if (pbr.baseColorTexture && !textureOf(mi) && !texturesWarned.has(mi)) {
			texturesWarned.add(mi);
			warn(`material ${m?.name ? `"${m.name}"` : mi + 1} has a base colour texture, which is not imported; its colour factor is used`);
		}
	}

	// parts: a node that owns faces, under its nearest ancestor that does
	const merge = options.merge === true;
	const ownerSet = new Set(jobs.map((j) => j.owner));
	const partNodes = order.filter((i) => ownerSet.has(i));
	const partName = namer();
	const nameOf = new Map<number, string>();
	const parts: Part3[] = [];
	const partOfNode = new Map<number, Part3>();
	const parentPart = new Map<number, number>();
	const pivotRaw = new Map<number, Vec3>();
	if (merge) {
		parts.push({ name: "main", pivot: [0, 0, 0], shapes: [] });
	} else {
		for (const ni of partNodes) {
			const node = nodes[ni];
			const name = partName(snakeName(node.name, snakeName(json.meshes?.[node.mesh]?.name, `node_${ni}`)));
			nameOf.set(ni, name);
			let up = parentOf[ni];
			while (up >= 0 && !ownerSet.has(up)) up = parentOf[up];
			parentPart.set(ni, up);
			const origin = xf3Apply(docXf(ni), [0, 0, 0]);
			pivotRaw.set(ni, origin);
			const part: Part3 = { name };
			if (up >= 0) part.parent = nameOf.get(up)!;
			part.pivot = [r3(origin[0] * k), r3(origin[1] * k), r3(origin[2] * k)];
			part.shapes = [];
			parts.push(part);
			partOfNode.set(ni, part);
		}
	}
	const cos = (deg: number) => Math.cos((Math.max(0, Math.min(180, deg)) * Math.PI) / 180);
	/** what each shape of a part came from, for morphs */
	const builtOf = new Map<Part3, Built[]>();
	for (const job of jobs) {
		const part = merge ? parts[0] : partOfNode.get(job.owner)!;
		const mesh = json.meshes?.[nodes[job.soup.node].mesh];
		const built = buildShapes(job, {
			weld: options.weld !== undefined && options.weld >= 0 ? options.weld : 0.0005,
			quads: options.quads !== false,
			quadCos: cos(options.quadAngle ?? 1),
			smoothQuadCos: cos(options.smoothQuadAngle ?? 15),
			shades: options.shades !== false,
			split: options.splitMaterials === true,
			token: (m) => tokenOf.get(m)!,
			texture: textureOf,
			joint: (n) => nameOf.get(n),
			owner: part.name,
			warn,
			label: `mesh ${mesh?.name ? `"${mesh.name}"` : nodes[job.soup.node].mesh}`,
		});
		for (const b of built) {
			part.shapes!.push(b.shape);
			const list = builtOf.get(part) ?? [];
			list.push(b);
			builtOf.set(part, list);
		}
	}

	// states: the drawing first, then one per morph target
	const restEntry = (p: Part3): StatePart3 => ({ part: p.name, offset: [...(p.pivot ?? [0, 0, 0])] as Vec3 });
	const states: State3[] = [{ name: "default", parts: parts.map(restEntry) }];
	const stateName = namer();
	stateName("default");
	const moved = (a: readonly Vec3[], b: readonly Vec3[]) => a.some((p, i) => p[0] !== b[i][0] || p[1] !== b[i][1] || p[2] !== b[i][2]);
	const targetStates = new Map<string, State3>();
	for (const part of parts) {
		(builtOf.get(part) ?? []).forEach((b, si) => {
			b.targets.forEach((pts, t) => {
				if (!moved(pts, b.shape.points)) return;
				const key = snakeName(b.soup.targetNames[t], `target_${t + 1}`);
				let st = targetStates.get(key);
				if (!st) {
					st = { name: stateName(key), parts: parts.map(restEntry) };
					targetStates.set(key, st);
					states.push(st);
				}
				const entry = st.parts.find((e) => e.part === part.name)!;
				(entry.morph ??= []).push({ shape: si, points: pts });
			});
		});
	}

	// clips: every animation, keyed where its samplers are
	const clips: Clip3[] = [];
	const animations: J[] = Array.isArray(json.animations) ? json.animations : [];
	if (merge && animations.length) warn(`${animations.length} animation${animations.length === 1 ? "" : "s"} left out: a merged model is one part`);
	const clipName = namer();
	if (!merge) animations.forEach((anim: J, ai: number) => {
		const label = `animation ${anim?.name ? `"${anim.name}"` : ai + 1}`;
		const chans = new Map<number, Record<string, Channel>>();
		const modes = new Set<string>();
		for (const ch of anim?.channels ?? []) {
			const s = anim.samplers?.[ch?.sampler];
			const target = ch?.target;
			if (!s || typeof target?.node !== "number" || !world[target.node]) continue;
			if (!["translation", "rotation", "scale", "weights"].includes(target.path)) {
				warn(`${label}: a channel on ${String(target.path)} is not read`);
				continue;
			}
			const times = accessor(s.input).data;
			const out = accessor(s.output);
			if (!times.length) continue;
			const mode = typeof s.interpolation === "string" ? s.interpolation : "LINEAR";
			const per = out.data.length / times.length / (mode === "CUBICSPLINE" ? 3 : 1);
			const rec = chans.get(target.node) ?? {};
			rec[target.path] = { times, values: out.data, n: Math.round(per), mode };
			chans.set(target.node, rec);
		}
		// the nodes between a part and its parent part move it too
		const chainOf = (ni: number): number[] => {
			const stop = parentPart.get(ni) ?? -1;
			const chain: number[] = [];
			for (let i = ni; i >= 0 && i !== stop; i = parentOf[i]) chain.unshift(i);
			return chain;
		};
		const moving = partNodes.filter((ni) => chainOf(ni).some((i) => chans.get(i)?.translation || chans.get(i)?.rotation || chans.get(i)?.scale));
		const morphing = (part: Part3) => (builtOf.get(part) ?? []).some((b) => b.targets.length && chans.get(b.soup.node)?.weights);
		const timeSet = new Map<number, number>();
		const note = (rec: Record<string, Channel> | undefined, paths: string[]) => {
			for (const path of paths) {
				const c = rec?.[path];
				if (!c) continue;
				modes.add(c.mode);
				for (const t of c.times) timeSet.set(Math.round(t * 10000), t);
			}
		};
		for (const ni of moving) for (const i of chainOf(ni)) note(chans.get(i), ["translation", "rotation", "scale"]);
		for (const part of parts) for (const b of builtOf.get(part) ?? []) if (b.targets.length) note(chans.get(b.soup.node), ["weights"]);
		const times = [...timeSet.keys()].sort((a, b) => a - b).map((q) => timeSet.get(q)!);
		if (!times.length) {
			warn(`${label} moves nothing that was imported and is left out`);
			return;
		}
		if (modes.has("CUBICSPLINE")) warn(`${label}: its cubic spline is kept at its keys and runs straight between them`);
		const step = modes.size === 1 && modes.has("STEP");
		if (modes.has("STEP") && modes.size > 1) warn(`${label} mixes held and eased channels; every key eases`);
		const localAt = (i: number, t: number): Xf3 => {
			const rec = chans.get(i);
			const node = nodes[i];
			if (!rec || (!rec.translation && !rec.rotation && !rec.scale)) return nodeXf(node);
			const tr = rec.translation ? sampleChannel(rec.translation.times, rec.translation.values, 3, rec.translation.mode, false, t) : (node.translation ?? [0, 0, 0]);
			const ro = rec.rotation ? sampleChannel(rec.rotation.times, rec.rotation.values, 4, rec.rotation.mode, true, t) : (node.rotation ?? [0, 0, 0, 1]);
			const sc = rec.scale ? sampleChannel(rec.scale.times, rec.scale.values, 3, rec.scale.mode, false, t) : (node.scale ?? [1, 1, 1]);
			return trsXf(tr, ro, sc);
		};
		let skewed = false;
		const keys: ClipKey3[] = times.map((t, ti) => {
			const entries: StatePart3[] = parts.map((part, pi) => {
				const ni = partNodes[pi];
				const entry: StatePart3 = { part: part.name };
				if (moving.includes(ni)) {
					// L = (parent part's rest map) · (the chain, now) · (this node's rest map)⁻¹, in the document's frame
					const up = parentPart.get(ni) ?? -1;
					let M: Xf3 = up >= 0 ? docXf(up) : Y_UP;
					for (const i of chainOf(ni)) M = xf3Mul(M, localAt(i, t));
					const L = xf3Mul(M, xf3Invert(docXf(ni)));
					const det = xf3Det(L);
					const s = Math.cbrt(Math.abs(det)) || 1;
					const R = [L[0] / s, L[1] / s, L[2] / s, L[3] / s, L[4] / s, L[5] / s, L[6] / s, L[7] / s, L[8] / s];
					// a turn's rows are unit and square to each other; anything else is a stretch the format has no word for
					const off = Math.max(Math.abs(R[0] * R[3] + R[1] * R[4] + R[2] * R[5]), Math.abs(R[0] * R[6] + R[1] * R[7] + R[2] * R[8]), Math.abs(R[3] * R[6] + R[4] * R[7] + R[5] * R[8]), Math.abs(Math.hypot(R[0], R[1], R[2]) - 1), Math.abs(Math.hypot(R[3], R[4], R[5]) - 1));
					if (off > 0.01 || det < 0) skewed = true;
					const at = xf3Apply(L, pivotRaw.get(ni)!);
					entry.offset = [r3(at[0] * k), r3(at[1] * k), r3(at[2] * k)];
					const e = matToEuler(R);
					entry.rotate = [r5(e[0]), r5(e[1]), r5(e[2])];
					if (Math.abs(s - 1) > 1e-4) entry.scale = r5(s);
				} else if (morphing(part)) entry.offset = [...(part.pivot ?? [0, 0, 0])] as Vec3;
				// morph weights: the points they add up to at this key
				const morph: Morph<Vec3>[] = [];
				(builtOf.get(part) ?? []).forEach((b, si) => {
					const w = chans.get(b.soup.node)?.weights;
					if (!w || !b.targets.length) return;
					const weights = sampleChannel(w.times, w.values, w.n, w.mode, false, t);
					if (!weights.some((x, i) => Math.abs(x) > 1e-6 && i < b.targets.length)) return;
					const pts = b.shape.points.map((p, v): Vec3 => {
						const q = [p[0], p[1], p[2]];
						b.targets.forEach((tp, i) => {
							const x = weights[i] ?? 0;
							if (!x) return;
							for (let c = 0; c < 3; c++) q[c] += (tp[v][c] - p[c]) * x;
						});
						return [r3(q[0]), r3(q[1]), r3(q[2])];
					});
					if (moved(pts, b.shape.points)) morph.push({ shape: si, points: pts });
				});
				if (morph.length) entry.morph = morph;
				return entry;
			});
			const key: ClipKey3 = { t: Math.round((t - 0) * 10000) / 10000, parts: entries };
			if (step && ti > 0) key.ease = "step";
			return key;
		});
		if (skewed) warn(`${label} stretches or mirrors a part unevenly; the format scales a part by one number, so that part of the motion is lost`);
		clips.push({ name: clipName(snakeName(anim?.name, `clip_${ai + 1}`)), keys });
	});

	const sceneName = scenes[sceneIndex]?.name;
	const doc: Doc3 = { version: 1, space: "3d", name: options.name ?? snakeName(sceneName, "model"), palette, parts, states };
	if (clips.length) doc.clips = clips;
	// 1.12: the textures something wears
	const worn = new Set(parts.flatMap((p) => (p.shapes ?? []).map((sh) => (sh as MeshShape).texture)));
	const textures = (options.textures ?? []).map((t) => t.texture).filter((t) => worn.has(t.name));
	if (textures.length) doc.textures = textures;
	if (options.tris !== false) bakeTris3(doc);
	if (!parts.some((p) => p.shapes?.length)) warn("nothing to draw: the file has no triangles in its scene");

	const summary = gltfSummary(doc, k);
	const tall = Math.max(...summary.size);
	if (summary.points && tall < 2) warn(`the model is ${tall} unit${tall === 1 ? "" : "s"} across and coordinates keep three decimals: import it larger (a scale, or a height) to keep its detail`);
	return { doc, warnings, summary };
}

function safeDecode(uri: string): string {
	try {
		return decodeURIComponent(uri);
	} catch {
		return uri;
	}
}
