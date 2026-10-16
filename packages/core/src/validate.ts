// The validator: everything spec/fart.schema.json says, by hand (so the
// runtime stays dependency-free), plus the cross-reference checks a
// schema cannot express. test/schema.test.ts holds the two to the same
// verdict on the corpus, so they cannot drift apart quietly.
//
// Codes are the contract (spec/examples/manifest.json lists them); every
// loader that refuses a file names the same code.

import { FORMAT_VERSION, type SweepShape } from "./types.ts";
import { sweepMesh } from "./solids.ts";

export type ErrorCode =
	| "json"
	| "version"
	| "schema"
	| "ref.token"
	| "ref.part"
	| "tris"
	| "dup.part"
	| "dup.state"
	| "dup.token"
	| "dup.clip"
	| "dup.constraint"
	| "path"
	| "ref.parent"
	| "cycle"
	| "clip"
	| "ref.state"
	| "chain"
	| "ref.anchor"
	| "like"
	| "ref.chain"
	| "space"
	| "face"
	| "convex"
	| "ref.texture"
	| "dup.texture"
	| "morph"
	| "curve"
	| "crease"
	| "paint"
	| "shades"
	| "skin"
	| "mod"
	| "pipe"
	| "rail";
export type WarningCode = "unknown" | "reserved" | "unresolved";

export interface Issue {
	code: ErrorCode | WarningCode;
	/** JSON pointer to the offending value, "" for the document. */
	path: string;
	message: string;
}

export interface Report {
	ok: boolean;
	errors: Issue[];
	warnings: Issue[];
}

export interface ValidateOptions {
	/**
	 * Token names the document's palette_refs supply, if the caller resolved
	 * them. Omit when nothing was resolved; pass null when resolution was
	 * attempted and failed. Either way, token references are then only
	 * checked against the local palette, with a warning.
	 */
	refTokens?: Iterable<string> | null;
	/** Texture map refs the caller tried to read and could not: each is an `unresolved` warning. */
	unresolvedRefs?: Iterable<string>;
}

const KINDS = ["circle", "line", "poly", "path"];
const KINDS3 = ["mesh", "ball", "rod", "sweep"];
const COLLISION_KINDS3 = ["mesh", "ball", "rod", "box"];
const SMOOTH_FIELDS = ["normals", "angle", "smooth", "creases", "bake"];
const SWEEP_FIELDS = ["kind", "color", "shade", "op", "axis", "profile", "segments", "from", "to", "path", "radius", "radii", "caps", "closed", "round"];
// 1.8: paint on meshes and sweeps, modifiers on both, shades where there are points
const PAINT_FIELDS = ["colors", "paint", "mods"];
const KNOWN_MOD: Record<string, string[]> = {
	mirror: ["op", "axis", "merge"],
	solidify: ["op", "thick", "offset", "inner", "rim"],
	crease: ["op", "angle", "value"],
};
const RESERVED_KINDS = ["ring", "path"];
const SPACES = ["2d", "3d"];
// "resolved" is a loader's palette cache that older writers leaked into files; ignored, never meant
const KNOWN_TOP = ["version", "space", "name", "palette_refs", "palette", "parts", "states", "clips", "constraints", "collision", "textures", "meta", "resolved"];
const TEXTURE_FIELDS = ["texture", "mapping"];
const KNOWN_TEXTURE = ["name", "cell", "maps", "relief"];
const KNOWN_MAP = ["ref", "palette", "state", "mode", "soften"];
const KNOWN_MAPPING2 = ["at", "angle", "scale", "xf"];
const KNOWN_MAPPING3 = ["scale", "uvs"];
const RESERVED_TOP: string[] = [];
const KNOWN_PART = ["name", "parent", "pivot", "shapes", "anchors", "meta", "like"];
const KNOWN_CLIP = ["name", "loop", "keys"];
const KNOWN_KEY = ["t", "state", "parts", "ease", "curve", "targets", "events"];
const KNOWN_TARGET = ["chain", "at"];
const EASES = ["linear", "in", "out", "in-out", "step"];
const KNOWN_CONSTRAINT = ["name", "chain", "end", "bend"];
const KNOWN_CONSTRAINT3 = ["name", "chain", "end", "pole"];
const RESERVED_PART = ["children"];
// every shape field is known on every kind: writers that serialise a
// whole struct (the classic editor did) leave the others at zero
const SHAPE_FIELDS = ["kind", "color", "shade", "at", "r", "a", "b", "w", "points", "tris", "closed", "in", "out", "bake"];
const COLLISION_FIELDS = ["part", "layer", "meta"];
const KNOWN_SHAPE: Record<string, string[]> = {
	circle: SHAPE_FIELDS,
	line: SHAPE_FIELDS,
	poly: SHAPE_FIELDS,
	path: SHAPE_FIELDS,
};
const SHAPE3_FIELDS = ["kind", "color", "shade", "at", "r", "a", "b", "w", "points", "faces", "tris"];
const KNOWN_TOKEN = ["name", "rgb", "emissive"];
const KNOWN_ANCHOR = ["name", "at", "angle"];
const KNOWN_ANCHOR3 = ["name", "at", "dir"];
const KNOWN_STATE = ["name", "parts", "targets"];
const KNOWN_STATE_PART = ["part", "offset", "rotate", "scale", "mirror", "morph"];
const KNOWN_MORPH = ["shape", "points", "in", "out"];

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isNum(v: unknown): v is number {
	return typeof v === "number" && Number.isFinite(v);
}
function isVec2(v: unknown): boolean {
	return Array.isArray(v) && v.length === 2 && v.every(isNum);
}
function isVec3(v: unknown): boolean {
	return Array.isArray(v) && v.length === 3 && v.every(isNum);
}
function isRgba(v: unknown): boolean {
	return Array.isArray(v) && v.length === 4 && v.every((x) => Number.isInteger(x) && x >= 0 && x <= 255);
}
function isName(v: unknown): v is string {
	return typeof v === "string" && v.length > 0;
}
function isAbsolutePath(p: string): boolean {
	return /^([A-Za-z]:|[/\\])/.test(p);
}

class Ctx {
	errors: Issue[] = [];
	warnings: Issue[] = [];
	/** The document's space: how many coordinates a point has (1.3). */
	dim: 2 | 3 = 2;
	err(code: ErrorCode, path: string, message: string) {
		this.errors.push({ code, path, message });
	}
	warn(code: WarningCode, path: string, message: string) {
		this.warnings.push({ code, path, message });
	}
	unknown(obj: Obj, known: string[], reserved: string[], path: string) {
		for (const key of Object.keys(obj)) {
			if (known.includes(key)) continue;
			if (reserved.includes(key)) this.warn("reserved", `${path}/${key}`, `"${key}" is reserved for a later version; ignored`);
			else this.warn("unknown", `${path}/${key}`, `"${key}" is not a version ${FORMAT_VERSION} field; preserved, ignored`);
		}
	}
	vec2(v: unknown, path: string): boolean {
		if (isVec2(v)) return true;
		this.err("schema", path, "expected [x, y]");
		return false;
	}
	vec3(v: unknown, path: string): boolean {
		if (isVec3(v)) return true;
		this.err("schema", path, "expected [x, y, z]");
		return false;
	}
	/** A point in the document's space. */
	point(v: unknown, path: string): boolean {
		return this.dim === 3 ? this.vec3(v, path) : this.vec2(v, path);
	}
	name(v: unknown, path: string): v is string {
		if (isName(v)) return true;
		this.err("schema", path, "expected a non-empty string");
		return false;
	}
	number(v: unknown, path: string, min?: number): boolean {
		if (!isNum(v)) {
			this.err("schema", path, "expected a number");
			return false;
		}
		if (min !== undefined && v < min) {
			this.err("schema", path, `expected a number >= ${min}`);
			return false;
		}
		return true;
	}
	array(v: unknown, path: string): v is unknown[] {
		if (Array.isArray(v)) return true;
		this.err("schema", path, "expected an array");
		return false;
	}
	object(v: unknown, path: string): v is Obj {
		if (isObj(v)) return true;
		this.err("schema", path, "expected an object");
		return false;
	}
}

/** Structure of one shape. Returns the kind when it is a known one. */
function checkShape(ctx: Ctx, sh: unknown, path: string, drawn: boolean): string | null {
	if (!ctx.object(sh, path)) return null;
	const kind = sh.kind;
	if (typeof kind !== "string" || !KINDS.includes(kind)) {
		const hint = RESERVED_KINDS.includes(kind as string) ? ` ("${kind}" is reserved, not yet a kind)` : "";
		ctx.err("schema", `${path}/kind`, `kind must be one of ${KINDS.join(", ")}${hint}`);
		return null;
	}
	if ("color" in sh) ctx.name(sh.color, `${path}/color`);
	else if (drawn) ctx.err("schema", `${path}/color`, "a drawn shape names a palette token");
	switch (kind) {
		case "circle":
			ctx.vec2(sh.at, `${path}/at`);
			ctx.number(sh.r, `${path}/r`, 0);
			break;
		case "line":
			ctx.vec2(sh.a, `${path}/a`);
			ctx.vec2(sh.b, `${path}/b`);
			ctx.number(sh.w, `${path}/w`, 0);
			break;
		case "poly": {
			let pointsOk = false;
			if (ctx.array(sh.points, `${path}/points`)) {
				pointsOk = sh.points.every((p, i) => ctx.vec2(p, `${path}/points/${i}`));
				if (sh.points.length < 3) {
					ctx.err("schema", `${path}/points`, "a poly needs at least three points");
					pointsOk = false;
				}
			}
			if ("tris" in sh) checkTris(ctx, sh.tris, `${path}/tris`, pointsOk ? (sh.points as unknown[]).length : -1);
			break;
		}
		case "path":
			checkPath(ctx, sh, path);
			break;
	}
	if ("shade" in sh) ctx.number(sh.shade, `${path}/shade`, 0);
	if (!drawn) checkCollisionFields(ctx, sh, path);
	if (drawn) checkTextureFields(ctx, sh, path, 2, 0);
	ctx.unknown(sh, drawn ? [...KNOWN_SHAPE[kind], ...TEXTURE_FIELDS] : [...KNOWN_SHAPE[kind], ...COLLISION_FIELDS], [], path);
	return kind;
}

/** 1.7: a path's points, its handles (one per point when given), its width when open, and its bake. */
function checkPath(ctx: Ctx, sh: Obj, path: string) {
	let n = -1;
	if (ctx.array(sh.points, `${path}/points`)) {
		const ok = sh.points.every((p, i) => ctx.vec2(p, `${path}/points/${i}`));
		if (sh.points.length < 2) ctx.err("schema", `${path}/points`, "a path needs at least two points");
		else if (ok) n = sh.points.length;
	}
	if ("closed" in sh && typeof sh.closed !== "boolean") ctx.err("schema", `${path}/closed`, "expected true or false");
	for (const k of ["in", "out"] as const) {
		if (!(k in sh)) continue;
		if (!ctx.array(sh[k], `${path}/${k}`)) continue;
		(sh[k] as unknown[]).forEach((v, i) => ctx.vec2(v, `${path}/${k}/${i}`));
		if (n >= 0 && (sh[k] as unknown[]).length !== n) ctx.err("curve", `${path}/${k}`, `${k} has one handle per point: ${(sh[k] as unknown[]).length} for ${n} points`);
	}
	if (sh.closed === true && n >= 0 && n < 3) ctx.err("curve", `${path}/points`, "a closed path needs at least three points");
	if (sh.closed !== true) {
		if (!("w" in sh)) ctx.err("curve", `${path}/w`, "an open path strokes with a width w");
		else ctx.number(sh.w, `${path}/w`, 0);
	} else if ("w" in sh) ctx.number(sh.w, `${path}/w`, 0);
	if ("bake" in sh && ctx.object(sh.bake, `${path}/bake`)) {
		const b = sh.bake;
		let bn = -1;
		if (ctx.array(b.points, `${path}/bake/points`)) {
			const ok = b.points.every((p, i) => ctx.vec2(p, `${path}/bake/points/${i}`));
			if (ok) bn = b.points.length;
		}
		if ("tris" in b) checkTris(ctx, b.tris, `${path}/bake/tris`, bn);
	}
}

/**
 * 1.8: `colors` and `paint` over `faces` faces (unknown when negative),
 * and the paint indices the mods name. Returns how many colours the shape
 * has, for whatever else indexes them.
 */
function checkPaint(ctx: Ctx, sh: Obj, path: string, faces: number): number {
	let nc = 0;
	if ("colors" in sh && ctx.array(sh.colors, `${path}/colors`)) {
		sh.colors.forEach((c, i) => ctx.name(c, `${path}/colors/${i}`));
		nc = sh.colors.length;
	}
	if ("paint" in sh && ctx.array(sh.paint, `${path}/paint`)) {
		const ints = sh.paint.every((v, i) => {
			if (Number.isInteger(v) && (v as number) >= 0) return true;
			ctx.err("schema", `${path}/paint/${i}`, "expected a non-negative integer");
			return false;
		});
		if (!("colors" in sh)) ctx.err("paint", `${path}/paint`, "paint indexes colors, and the shape has none");
		else if (ints) sh.paint.forEach((v, i) => {
			if ((v as number) > nc) ctx.err("paint", `${path}/paint/${i}`, `paint ${v} is past the last colour (${nc}): 0 is the shape's color, n is colors[n - 1]`);
		});
		if (faces >= 0 && sh.paint.length !== faces) ctx.err("paint", `${path}/paint`, `paint has one entry per face: ${sh.paint.length} for ${faces} faces`);
	}
	return nc;
}

/** 1.9: a skin over `n` points (unknown when negative): joints, and per point one to four [joint, weight] pairs adding up to 1. Whether the joints are parts is checked with the document. */
function checkSkin(ctx: Ctx, sh: Record<string, unknown>, path: string, n: number): void {
	if (!("skin" in sh)) return;
	const skin = sh.skin;
	if (!ctx.object(skin, `${path}/skin`)) return;
	if (Array.isArray(sh.mods) && sh.mods.length) ctx.err("skin", `${path}/skin`, "a mesh with mods has no skin: weights are not carried through a modifier");
	if (typeof sh.smooth === "number" && sh.smooth > 0) ctx.err("skin", `${path}/skin`, "a mesh with smooth levels has no skin: weights are not carried through subdivision");
	if ("host" in skin && typeof skin.host !== "boolean") ctx.err("schema", `${path}/skin/host`, "host is true or false");
	let nj = -1;
	if (ctx.array(skin.joints, `${path}/skin/joints`)) {
		nj = skin.joints.length;
		if (nj === 0) ctx.err("skin", `${path}/skin/joints`, "a skin has at least one joint");
		skin.joints.forEach((j, i) => {
			if (typeof j !== "string" || j === "") ctx.err("schema", `${path}/skin/joints/${i}`, "a joint is a part's name");
		});
	}
	if (!ctx.array(skin.weights, `${path}/skin/weights`)) return;
	if (n >= 0 && skin.weights.length !== n) ctx.err("skin", `${path}/skin/weights`, `weights are one entry per point: ${skin.weights.length} for ${n} points`);
	skin.weights.forEach((entry, i) => {
		const at = `${path}/skin/weights/${i}`;
		if (!Array.isArray(entry) || entry.length < 2 || entry.length > 8 || entry.length % 2 !== 0 || entry.some((v) => typeof v !== "number" || !Number.isFinite(v))) {
			ctx.err("skin", at, "an entry is one to four pairs of [joint, weight]");
			return;
		}
		const seen = new Set<number>();
		let sum = 0;
		for (let k = 0; k < entry.length; k += 2) {
			const [j, w] = [entry[k] as number, entry[k + 1] as number];
			if (!Number.isInteger(j) || j < 0 || (nj >= 0 && j >= nj)) ctx.err("skin", at, `${j} is not a joint of the skin`);
			else if (seen.has(j)) ctx.err("skin", at, `joint ${j} twice in one entry`);
			seen.add(j);
			if (!(w > 0)) ctx.err("skin", at, "a weight is above 0");
			sum += w;
		}
		if (Math.abs(sum - 1) > 0.01) ctx.err("skin", at, `a point's weights add up to 1: these add up to ${Math.round(sum * 1000) / 1000}`);
	});
}

/** 1.8: the modifiers on a cage, in order; `nc` is how many colours a paint index may reach. */
function checkMods(ctx: Ctx, sh: Obj, path: string, nc: number) {
	if (!("mods" in sh) || !ctx.array(sh.mods, `${path}/mods`)) return;
	sh.mods.forEach((m, i) => {
		const mp = `${path}/mods/${i}`;
		if (!ctx.object(m, mp)) return;
		if (typeof m.op !== "string") {
			ctx.err("schema", `${mp}/op`, "a mod names its op");
			return;
		}
		switch (m.op) {
			case "mirror":
				if (m.axis !== "x" && m.axis !== "y" && m.axis !== "z") ctx.err("schema", `${mp}/axis`, "axis is x, y or z");
				if ("merge" in m) ctx.number(m.merge, `${mp}/merge`, 0);
				break;
			case "solidify":
				ctx.number(m.thick, `${mp}/thick`, 0);
				if ("offset" in m && !(isNum(m.offset) && m.offset >= -1 && m.offset <= 1)) ctx.err("schema", `${mp}/offset`, "offset is a number from -1 (inward) to 1 (outward)");
				for (const k of ["inner", "rim"] as const) {
					if (!(k in m)) continue;
					if (!(Number.isInteger(m[k]) && (m[k] as number) >= 0)) ctx.err("schema", `${mp}/${k}`, "expected a non-negative integer");
					else if ((m[k] as number) > nc) ctx.err("paint", `${mp}/${k}`, `paint ${m[k]} is past the last colour (${nc})`);
				}
				break;
			case "crease":
				if ("angle" in m && !(isNum(m.angle) && m.angle >= 0 && m.angle <= 180)) ctx.err("schema", `${mp}/angle`, "angle is degrees, 0 to 180");
				if ("value" in m && ctx.number(m.value, `${mp}/value`) && ((m.value as number) < 0 || (m.value as number) > 1)) ctx.err("crease", `${mp}/value`, `a crease is in 0–1; got ${m.value}`);
				break;
			default:
				ctx.err("mod", `${mp}/op`, `"${m.op}" is not a modifier this version has (mirror, solidify, crease)`);
				return;
		}
		ctx.unknown(m, KNOWN_MOD[m.op], [], mp);
	});
}

/** 1.8: a pipe: a 3D path body, a radius and one factor per path point, an optional closed section. */
function checkPipe(ctx: Ctx, sh: Obj, path: string) {
	const n = checkSpine(ctx, sh, path);
	if ("closed" in sh && typeof sh.closed !== "boolean") ctx.err("schema", `${path}/closed`, "expected true or false");
	if ("caps" in sh && typeof sh.caps !== "boolean") ctx.err("schema", `${path}/caps`, "expected true or false");
	if (sh.closed === true && n >= 0 && n < 3) ctx.err("pipe", `${path}/path/points`, "a closed pipe needs at least three path points");
	if ("radius" in sh) ctx.number(sh.radius, `${path}/radius`, 0);
	if ("radii" in sh && ctx.array(sh.radii, `${path}/radii`)) {
		sh.radii.forEach((v, i) => ctx.number(v, `${path}/radii/${i}`, 0));
		if (n >= 0 && sh.radii.length !== n) ctx.err("pipe", `${path}/radii`, `radii are one per path point: ${sh.radii.length} for ${n} points`);
	}
	if ("profile" in sh && ctx.object(sh.profile, `${path}/profile`)) checkPath(ctx, { ...sh.profile, closed: true }, `${path}/profile`);
}

/** 1.11: a rail: a 3D path body, a profile that stands along an axis (open, or closed for a moulding), a radius for the path's corners. */
function checkRail(ctx: Ctx, sh: Obj, path: string) {
	const n = checkSpine(ctx, sh, path);
	if ("closed" in sh && typeof sh.closed !== "boolean") ctx.err("schema", `${path}/closed`, "expected true or false");
	if ("caps" in sh && typeof sh.caps !== "boolean") ctx.err("schema", `${path}/caps`, "expected true or false");
	if (sh.closed === true && n >= 0 && n < 3) ctx.err("rail", `${path}/path/points`, "a closed rail needs at least three path points");
	if ("axis" in sh && sh.axis !== "x" && sh.axis !== "y" && sh.axis !== "z") ctx.err("schema", `${path}/axis`, "axis is x, y or z");
	if ("round" in sh) ctx.number(sh.round, `${path}/round`, 0);
	if (!ctx.object(sh.profile, `${path}/profile`)) return;
	checkPath(ctx, { w: 0, ...sh.profile, closed: sh.profile.closed === true }, `${path}/profile`);
}

/** A sweep's `path` (1.8): a path body with three coordinates. How many points it has, or -1 when it is not sound. */
function checkSpine(ctx: Ctx, sh: Obj, path: string): number {
	let n = -1;
	if (ctx.object(sh.path, `${path}/path`)) {
		const body = sh.path;
		const bp = `${path}/path`;
		if (ctx.array(body.points, `${bp}/points`)) {
			const ok = body.points.every((p, i) => ctx.vec3(p, `${bp}/points/${i}`));
			if (body.points.length < 2) ctx.err("schema", `${bp}/points`, "a path needs at least two points");
			else if (ok) n = body.points.length;
		}
		for (const k of ["in", "out"] as const) {
			if (!(k in body) || !ctx.array(body[k], `${bp}/${k}`)) continue;
			(body[k] as unknown[]).forEach((v, i) => ctx.vec3(v, `${bp}/${k}/${i}`));
			if (n >= 0 && (body[k] as unknown[]).length !== n) ctx.err("curve", `${bp}/${k}`, `${k} has one handle per point: ${(body[k] as unknown[]).length} for ${n} points`);
		}
		ctx.unknown(body, ["points", "in", "out"], [], bp);
	}
	return n;
}

/** 1.7: how a mesh (or a sweep) is lit and smoothed: normals, angle, smooth levels, creases over n points, a bake (1.8: with paint over `nc` colours, and shades). */
function checkSmoothFields(ctx: Ctx, sh: Obj, path: string, n: number, edges: Set<string> | null, nc = 0) {
	if ("normals" in sh && sh.normals !== "flat" && sh.normals !== "smooth") ctx.err("schema", `${path}/normals`, "normals is flat or smooth");
	if ("angle" in sh) ctx.number(sh.angle, `${path}/angle`, 0);
	if ("smooth" in sh && !(Number.isInteger(sh.smooth) && (sh.smooth as number) >= 0)) ctx.err("schema", `${path}/smooth`, "smooth is a whole number of subdivision levels, 0 or more");
	if ("creases" in sh && ctx.array(sh.creases, `${path}/creases`)) {
		sh.creases.forEach((c, i) => {
			const cp = `${path}/creases/${i}`;
			if (!Array.isArray(c) || (c.length !== 2 && c.length !== 3) || !c.every(isNum)) {
				ctx.err("schema", cp, "a crease is [a, b, c] for the edge a–b, or [a, c] for a corner");
				return;
			}
			const val = c[c.length - 1] as number;
			const idx = c.slice(0, -1) as number[];
			if (val < 0 || val > 1) ctx.err("crease", cp, `a crease is in 0–1; got ${val}`);
			for (const k of idx) {
				if (!Number.isInteger(k) || k < 0 || (n >= 0 && k >= n)) ctx.err("crease", cp, `point ${k} is not a point of the mesh`);
			}
			if (c.length === 3 && edges && n >= 0 && idx.every((k) => Number.isInteger(k) && k >= 0 && k < n)) {
				const key = idx[0] < idx[1] ? `${idx[0]}:${idx[1]}` : `${idx[1]}:${idx[0]}`;
				if (idx[0] === idx[1] || !edges.has(key)) ctx.err("crease", cp, `${idx[0]}–${idx[1]} is not an edge of a face`);
			}
		});
	}
	if ("bake" in sh && ctx.object(sh.bake, `${path}/bake`)) {
		const b = sh.bake;
		let bn = -1;
		if (ctx.array(b.points, `${path}/bake/points`) && b.points.every((p, i) => ctx.vec3(p, `${path}/bake/points/${i}`))) bn = b.points.length;
		if (ctx.array(b.faces, `${path}/bake/faces`)) {
			b.faces.forEach((f, i) => {
				if (!Array.isArray(f) || f.length < 3 || !f.every((t) => Number.isInteger(t) && (t as number) >= 0 && (bn < 0 || (t as number) < bn))) ctx.err("face", `${path}/bake/faces/${i}`, "a baked face is three or more indices into bake.points");
			});
		}
		if ("tris" in b) checkTris(ctx, b.tris, `${path}/bake/tris`, bn);
		if ("of" in b && typeof b.of !== "string") ctx.err("schema", `${path}/bake/of`, "of is the cage's hash, a string");
		if ("paint" in b && ctx.array(b.paint, `${path}/bake/paint`)) {
			if (!b.paint.every((v) => Number.isInteger(v) && (v as number) >= 0)) ctx.err("schema", `${path}/bake/paint`, "expected non-negative integers");
			else if (b.paint.some((v) => (v as number) > nc)) ctx.err("paint", `${path}/bake/paint`, `a baked paint index is past the last colour (${nc})`);
			if (Array.isArray(b.faces) && b.paint.length !== b.faces.length) ctx.err("paint", `${path}/bake/paint`, `a bake's paint has one entry per baked face: ${b.paint.length} for ${b.faces.length}`);
		}
		if ("shades" in b && ctx.array(b.shades, `${path}/bake/shades`)) {
			b.shades.forEach((v, i) => ctx.number(v, `${path}/bake/shades/${i}`, 0));
			if (bn >= 0 && b.shades.length !== bn) ctx.err("shades", `${path}/bake/shades`, `a bake's shades are one per baked point: ${b.shades.length} for ${bn}`);
		}
	}
}

/** 1.5: a shape's texture name (checked against the textures later) and its mapping. */
function checkTextureFields(ctx: Ctx, sh: Obj, path: string, dim: 2 | 3, faces: number) {
	if ("texture" in sh) ctx.name(sh.texture, `${path}/texture`);
	if (!("mapping" in sh)) return;
	const mp = `${path}/mapping`;
	if (!ctx.object(sh.mapping, mp)) return;
	const m = sh.mapping;
	if ("scale" in m) ctx.number(m.scale, `${mp}/scale`);
	if (dim === 2) {
		if ("at" in m) ctx.vec2(m.at, `${mp}/at`);
		if ("angle" in m) ctx.number(m.angle, `${mp}/angle`);
		if ("xf" in m && !(Array.isArray(m.xf) && m.xf.length === 6 && m.xf.every(isNum))) ctx.err("schema", `${mp}/xf`, "an xf is six numbers [a, b, c, d, e, f]");
		ctx.unknown(m, KNOWN_MAPPING2, [], mp);
	} else {
		if ("uvs" in m && ctx.array(m.uvs, `${mp}/uvs`)) {
			if (m.uvs.length !== faces) ctx.err("schema", `${mp}/uvs`, `uvs has one list per face; got ${m.uvs.length} for ${faces} faces`);
			m.uvs.forEach((f, i) => {
				if (ctx.array(f, `${mp}/uvs/${i}`)) f.forEach((uv, j) => ctx.vec2(uv, `${mp}/uvs/${i}/${j}`));
			});
		}
		ctx.unknown(m, KNOWN_MAPPING3, [], mp);
	}
}

/** 1.5: a texture: a name, a cell, at least one map with a relative ref. */
function checkTexture(ctx: Ctx, t: unknown, path: string): { name: string | null; refs: string[] } {
	const refs: string[] = [];
	if (!ctx.object(t, path)) return { name: null, refs };
	const named = ctx.name(t.name, `${path}/name`);
	ctx.vec2(t.cell, `${path}/cell`);
	if (!("maps" in t)) ctx.err("schema", `${path}/maps`, "a texture has maps");
	else if (ctx.object(t.maps, `${path}/maps`)) {
		const keys = Object.keys(t.maps);
		if (!keys.length) ctx.err("schema", `${path}/maps`, "a texture has at least one map");
		for (const k of keys) {
			const mp = `${path}/maps/${k}`;
			if (!k) ctx.err("schema", mp, "a map's name is not empty");
			const m = t.maps[k];
			if (!ctx.object(m, mp)) continue;
			if (!("ref" in m)) ctx.err("schema", `${mp}/ref`, "a map names a drawing: a relative path");
			else if (ctx.name(m.ref, `${mp}/ref`)) {
				if (isAbsolutePath(m.ref)) ctx.err("path", `${mp}/ref`, "a map's ref is relative to this file, never absolute");
				else refs.push(m.ref);
			}
			if ("palette" in m && ctx.name(m.palette, `${mp}/palette`) && isAbsolutePath(m.palette)) ctx.err("path", `${mp}/palette`, "a map's palette is relative to this file, never absolute");
			if ("state" in m) ctx.name(m.state, `${mp}/state`);
			if ("mode" in m && m.mode !== "paint" && m.mode !== "mask") ctx.err("schema", `${mp}/mode`, "mode is paint or mask");
			if ("soften" in m && !(isNum(m.soften) && m.soften >= 0)) ctx.err("schema", `${mp}/soften`, "soften is a radius: a number, zero or more");
			ctx.unknown(m, KNOWN_MAP, [], mp);
		}
	}
	if ("relief" in t) ctx.number(t.relief, `${path}/relief`);
	ctx.unknown(t, KNOWN_TEXTURE, [], path);
	return { name: named ? (t.name as string) : null, refs };
}

/** 1.4: a collision shape's part (checked against the parts later) and layer. */
function checkCollisionFields(ctx: Ctx, sh: Obj, path: string) {
	if ("part" in sh) ctx.name(sh.part, `${path}/part`);
	if ("layer" in sh) ctx.name(sh.layer, `${path}/layer`);
	if ("meta" in sh) ctx.object(sh.meta, `${path}/meta`);
}

/** 1.4: every point on or behind the plane of every face, or the mesh is not a solid a plane test can use. */
function checkConvex(ctx: Ctx, sh: Obj, path: string) {
	const pts = sh.points as number[][];
	const faces = sh.faces as number[][];
	const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
	const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
	const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
	let scale = 0;
	for (const p of pts) scale = Math.max(scale, Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2]));
	const eps = 1e-4 * Math.max(1, scale);
	faces.forEach((f, fi) => {
		// Newell's normal, then the plane through the face's first point
		const n = [0, 0, 0];
		for (let i = 0; i < f.length; i++) {
			const a = pts[f[i]];
			const b = pts[f[(i + 1) % f.length]];
			n[0] += (a[1] - b[1]) * (a[2] + b[2]);
			n[1] += (a[2] - b[2]) * (a[0] + b[0]);
			n[2] += (a[0] - b[0]) * (a[1] + b[1]);
		}
		const len = Math.hypot(n[0], n[1], n[2]);
		if (len < 1e-12) return;
		const un = [n[0] / len, n[1] / len, n[2] / len];
		for (let i = 0; i < pts.length; i++) {
			if (dot(un, sub(pts[i], pts[f[0]])) > eps) {
				ctx.err("convex", `${path}/faces/${fi}`, `point ${i} lies in front of face ${fi}: a collision mesh is convex`);
				return;
			}
		}
	});
	void cross;
}

/** Baked triangles: triples of indices into n points (n < 0: the points were bad, skip the range check). */
function checkTris(ctx: Ctx, tris: unknown, path: string, n: number) {
	if (!ctx.array(tris, path)) return;
	const ints = tris.every((t, i) => {
		if (Number.isInteger(t) && (t as number) >= 0) return true;
		ctx.err("schema", `${path}/${i}`, "expected a non-negative integer");
		return false;
	});
	if (!ints || n < 0) return;
	if (tris.length % 3 !== 0) ctx.err("tris", path, `tris come in triples; got ${tris.length} indices`);
	tris.forEach((t, i) => {
		if ((t as number) >= n) ctx.err("tris", `${path}/${i}`, `index ${t} is past the last point (${n - 1})`);
	});
}

/** Structure of one 3D shape (1.3): mesh, ball, rod; in a collision list (1.4) also box. */
function checkShape3(ctx: Ctx, sh: unknown, path: string, drawn: boolean): string | null {
	if (!ctx.object(sh, path)) return null;
	const kind = sh.kind;
	const kinds = drawn ? KINDS3 : COLLISION_KINDS3;
	if (typeof kind !== "string" || !kinds.includes(kind)) {
		const hint = KINDS.includes(kind as string) ? ` ("${kind}" is a 2D kind; a mesh face is what a poly becomes)` : kind === "box" ? ' ("box" is a collision kind, never drawn)' : kind === "sweep" ? ' ("sweep" is drawn, never collision: give the collision its mesh)' : "";
		ctx.err("schema", `${path}/kind`, `kind must be one of ${kinds.join(", ")} in a 3D document${hint}`);
		return null;
	}
	if ("color" in sh) ctx.name(sh.color, `${path}/color`);
	else if (drawn) ctx.err("schema", `${path}/color`, "a drawn shape names a palette token");
	let meshOk = false;
	switch (kind) {
		case "box":
			ctx.vec3(sh.at, `${path}/at`);
			ctx.vec3(sh.size, `${path}/size`);
			if ("rotate" in sh) ctx.vec3(sh.rotate, `${path}/rotate`);
			break;
		case "ball":
			ctx.vec3(sh.at, `${path}/at`);
			ctx.number(sh.r, `${path}/r`, 0);
			break;
		case "rod":
			ctx.vec3(sh.a, `${path}/a`);
			ctx.vec3(sh.b, `${path}/b`);
			ctx.number(sh.w, `${path}/w`, 0);
			break;
		case "mesh": {
			let n = -1;
			if (ctx.array(sh.points, `${path}/points`)) {
				const ok = sh.points.every((p, i) => ctx.vec3(p, `${path}/points/${i}`));
				if (sh.points.length < 3) ctx.err("schema", `${path}/points`, "a mesh needs at least three points");
				else if (ok) n = sh.points.length;
			}
			if (!("faces" in sh)) ctx.err("schema", `${path}/faces`, "a mesh has faces");
			else if (ctx.array(sh.faces, `${path}/faces`)) {
				meshOk = n >= 0;
				sh.faces.forEach((f, i) => {
					const fp = `${path}/faces/${i}`;
					if (!ctx.array(f, fp)) return;
					const ints = f.every((t, j) => {
						if (Number.isInteger(t) && (t as number) >= 0) return true;
						ctx.err("schema", `${fp}/${j}`, "expected a non-negative integer");
						return false;
					});
					if (!ints) meshOk = false;
					if (!ints) return;
					if (f.length < 3) {
						ctx.err("face", fp, `a face needs at least three points; got ${f.length}`);
						meshOk = false;
					}
					if (n >= 0) f.forEach((t, j) => {
						if ((t as number) >= n) {
							ctx.err("face", `${fp}/${j}`, `index ${t} is past the last point (${n - 1})`);
							meshOk = false;
						}
					});
				});
			}
			if ("tris" in sh) checkTris(ctx, sh.tris, `${path}/tris`, n);
			if (!drawn && meshOk) checkConvex(ctx, sh, path);
			if (drawn) {
				const edges = new Set<string>();
				if (meshOk) for (const f of sh.faces as number[][]) for (let i = 0; i < f.length; i++) {
					const a = f[i];
					const b = f[(i + 1) % f.length];
					edges.add(a < b ? `${a}:${b}` : `${b}:${a}`);
				}
				const nc = checkPaint(ctx, sh, path, meshOk ? (sh.faces as unknown[]).length : -1);
				if ("shades" in sh && ctx.array(sh.shades, `${path}/shades`)) {
					sh.shades.forEach((v, i) => ctx.number(v, `${path}/shades/${i}`, 0));
					if (n >= 0 && sh.shades.length !== n) ctx.err("shades", `${path}/shades`, `shades are one per point: ${sh.shades.length} for ${n} points`);
				}
				checkMods(ctx, sh, path, nc);
				checkSmoothFields(ctx, sh, path, n, meshOk ? edges : null, nc);
				checkSkin(ctx, sh, path, n);
			}
			break;
		}
		case "sweep": {
			const before = ctx.errors.length;
			if (sh.op !== "lathe" && sh.op !== "extrude" && sh.op !== "pipe" && sh.op !== "rail") ctx.err("schema", `${path}/op`, "op is lathe, extrude, pipe or rail");
			if (sh.op === "pipe") checkPipe(ctx, sh, path);
			else if (sh.op === "rail") checkRail(ctx, sh, path);
			else {
				if (sh.axis !== "x" && sh.axis !== "y" && sh.axis !== "z") ctx.err("schema", `${path}/axis`, "axis is x, y or z");
				if (!ctx.object(sh.profile, `${path}/profile`)) break;
				checkPath(ctx, { closed: sh.op === "extrude" ? true : sh.profile.closed === true, w: 0, ...sh.profile }, `${path}/profile`);
			}
			if ("segments" in sh && !(Number.isInteger(sh.segments) && (sh.segments as number) >= 3)) ctx.err("schema", `${path}/segments`, "segments is a whole number, 3 or more");
			if ("from" in sh) ctx.number(sh.from, `${path}/from`);
			if ("to" in sh) ctx.number(sh.to, `${path}/to`);
			// paint counts the faces of the mesh the sweep makes: generate it when the sweep itself is sound
			let faces = -1;
			if (ctx.errors.length === before && Array.isArray(sh.paint)) {
				try {
					faces = sweepMesh(sh as unknown as SweepShape).faces.length;
				} catch {
					faces = -1;
				}
			}
			const nc = checkPaint(ctx, sh, path, faces);
			if ("shades" in sh) ctx.err("shades", `${path}/shades`, "shades are one per point, and a sweep has no points of its own");
			checkMods(ctx, sh, path, nc);
			checkSmoothFields(ctx, sh, path, -1, null, nc);
			break;
		}
	}
	if ("shade" in sh) ctx.number(sh.shade, `${path}/shade`, 0);
	if (!drawn) checkCollisionFields(ctx, sh, path);
	if (drawn) checkTextureFields(ctx, sh, path, 3, kind === "mesh" && Array.isArray(sh.faces) ? sh.faces.length : -1);
	ctx.unknown(sh, drawn ? (kind === "sweep" ? [...SWEEP_FIELDS, ...SMOOTH_FIELDS, ...PAINT_FIELDS, ...TEXTURE_FIELDS] : [...SHAPE3_FIELDS, ...SMOOTH_FIELDS, ...PAINT_FIELDS, "shades", "skin", ...TEXTURE_FIELDS]) : [...SHAPE3_FIELDS, "size", "rotate", ...COLLISION_FIELDS], [], path);
	return kind;
}

function checkToken(ctx: Ctx, t: unknown, path: string): string | null {
	if (!ctx.object(t, path)) return null;
	const named = ctx.name(t.name, `${path}/name`);
	if (!isRgba(t.rgb)) ctx.err("schema", `${path}/rgb`, "expected [r, g, b, a], integers 0-255");
	if ("emissive" in t) ctx.number(t.emissive, `${path}/emissive`, 0);
	ctx.unknown(t, KNOWN_TOKEN, [], path);
	return named ? (t.name as string) : null;
}

function checkPart(ctx: Ctx, p: unknown, path: string): string | null {
	if (!ctx.object(p, path)) return null;
	const named = ctx.name(p.name, `${path}/name`);
	if ("parent" in p) ctx.name(p.parent, `${path}/parent`);
	if ("like" in p) {
		ctx.name(p.like, `${path}/like`);
		// a part drawn like another has no geometry of its own
		if (Array.isArray(p.shapes) && p.shapes.length) ctx.err("like", `${path}/shapes`, "a part with like draws that part's shapes; it has none of its own");
		if (Array.isArray(p.anchors) && p.anchors.length) ctx.err("like", `${path}/anchors`, "a part with like has that part's anchors; none of its own");
	}
	if ("pivot" in p) ctx.point(p.pivot, `${path}/pivot`);
	if ("shapes" in p && ctx.array(p.shapes, `${path}/shapes`)) {
		p.shapes.forEach((sh, i) => (ctx.dim === 3 ? checkShape3 : checkShape)(ctx, sh, `${path}/shapes/${i}`, true));
	}
	if ("anchors" in p && ctx.array(p.anchors, `${path}/anchors`)) {
		p.anchors.forEach((a, i) => {
			const ap = `${path}/anchors/${i}`;
			if (!ctx.object(a, ap)) return;
			ctx.name(a.name, `${ap}/name`);
			ctx.point(a.at, `${ap}/at`);
			if (ctx.dim === 3) {
				if ("dir" in a) ctx.vec3(a.dir, `${ap}/dir`);
				ctx.unknown(a, KNOWN_ANCHOR3, [], ap);
			} else {
				if ("angle" in a) ctx.number(a.angle, `${ap}/angle`);
				ctx.unknown(a, KNOWN_ANCHOR, [], ap);
			}
		});
	}
	if ("meta" in p) ctx.object(p.meta, `${path}/meta`);
	ctx.unknown(p, KNOWN_PART, RESERVED_PART, path);
	return named ? (p.name as string) : null;
}

/**
 * 1.6: a morph names one of the part's own shapes, one with points, and
 * carries as many points as the base; a part drawn like another has none.
 */
function checkMorph(ctx: Ctx, morph: unknown, path: string, part: Obj | undefined) {
	if (!ctx.array(morph, path)) return;
	const shapes = part && Array.isArray(part.shapes) ? (part.shapes as unknown[]) : [];
	morph.forEach((m, i) => {
		const mp = `${path}/${i}`;
		if (!ctx.object(m, mp)) return;
		const idx = m.shape;
		if (typeof idx !== "number" || !Number.isInteger(idx) || idx < 0) ctx.err("schema", `${mp}/shape`, "shape is an index into the part's shapes");
		let n = -1;
		if (ctx.array(m.points, `${mp}/points`)) {
			m.points.forEach((p, j) => ctx.point(p, `${mp}/points/${j}`));
			n = m.points.length;
		}
		for (const k of ["in", "out"] as const) {
			if (!(k in m)) continue;
			if (ctx.array(m[k], `${mp}/${k}`)) {
				(m[k] as unknown[]).forEach((p, j) => ctx.point(p, `${mp}/${k}/${j}`));
				if (n >= 0 && (m[k] as unknown[]).length !== n) ctx.err("morph", `${mp}/${k}`, `${k} has one handle per point`);
			}
		}
		ctx.unknown(m, KNOWN_MORPH, [], mp);
		if (!part || typeof idx !== "number" || n < 0) return;
		if (isName(part.like)) {
			ctx.err("morph", mp, "a part drawn like another has no points of its own to morph");
			return;
		}
		const sh = shapes[idx];
		if (!isObj(sh)) {
			ctx.err("morph", `${mp}/shape`, `the part has no shape ${idx}`);
			return;
		}
		if (!Array.isArray(sh.points)) {
			ctx.err("morph", `${mp}/shape`, `shape ${idx} is a ${String(sh.kind)}: only a ${ctx.dim === 3 ? "mesh" : "poly or path"} has points to morph`);
			return;
		}
		if (sh.points.length !== n) ctx.err("morph", `${mp}/points`, `${n} points for a shape with ${sh.points.length}: a morph moves every corner, so the counts match`);
	});
}

function checkStateParts(ctx: Ctx, parts: unknown[], path: string, partNames: Set<string>, partObjs?: Map<string, Obj>) {
	parts.forEach((sp, i) => {
		const spp = `${path}/${i}`;
		if (!ctx.object(sp, spp)) return;
		if (ctx.name(sp.part, `${spp}/part`) && !partNames.has(sp.part)) {
			ctx.err("ref.part", `${spp}/part`, `no part named "${sp.part}"`);
		}
		if ("morph" in sp) checkMorph(ctx, sp.morph, `${spp}/morph`, isName(sp.part) ? partObjs?.get(sp.part) : undefined);
		if ("offset" in sp) ctx.point(sp.offset, `${spp}/offset`);
		if ("rotate" in sp) {
			if (ctx.dim === 3) {
				if (!isVec3(sp.rotate)) ctx.err("schema", `${spp}/rotate`, "a 3D turn is [x, y, z] radians");
			} else ctx.number(sp.rotate, `${spp}/rotate`);
		}
		if ("scale" in sp) ctx.number(sp.scale, `${spp}/scale`, 0);
		if ("mirror" in sp && typeof sp.mirror !== "boolean") ctx.err("schema", `${spp}/mirror`, "expected true or false");
		ctx.unknown(sp, KNOWN_STATE_PART, [], spp);
	});
}

/** 1.2: where chains should reach in a pose. */
function checkTargets(ctx: Ctx, targets: unknown, path: string, chainNames: Set<string>) {
	if (!ctx.array(targets, path)) return;
	targets.forEach((tg, i) => {
		const tp = `${path}/${i}`;
		if (!ctx.object(tg, tp)) return;
		if (ctx.name(tg.chain, `${tp}/chain`) && !chainNames.has(tg.chain)) ctx.err("ref.chain", `${tp}/chain`, `no constraint named "${tg.chain}"`);
		ctx.point(tg.at, `${tp}/at`);
		ctx.unknown(tg, KNOWN_TARGET, [], tp);
	});
}

function checkState(ctx: Ctx, s: unknown, path: string, partNames: Set<string>, chainNames: Set<string>, partObjs?: Map<string, Obj>): string | null {
	if (!ctx.object(s, path)) return null;
	const named = ctx.name(s.name, `${path}/name`);
	if (!("parts" in s)) ctx.err("schema", `${path}/parts`, "a state lists its parts (an empty list is fine)");
	else if (ctx.array(s.parts, `${path}/parts`)) checkStateParts(ctx, s.parts, `${path}/parts`, partNames, partObjs);
	if ("targets" in s) checkTargets(ctx, s.targets, `${path}/targets`, chainNames);
	ctx.unknown(s, KNOWN_STATE, [], path);
	return named ? (s.name as string) : null;
}

function checkClip(ctx: Ctx, c: unknown, path: string, partNames: Set<string>, stateNames: Set<string>, chainNames: Set<string>, partObjs?: Map<string, Obj>): string | null {
	if (!ctx.object(c, path)) return null;
	const named = ctx.name(c.name, `${path}/name`);
	if ("loop" in c && typeof c.loop !== "boolean") ctx.err("schema", `${path}/loop`, "expected true or false");
	if (!("keys" in c)) ctx.err("schema", `${path}/keys`, "a clip has keys");
	else if (ctx.array(c.keys, `${path}/keys`)) {
		if (c.keys.length === 0) ctx.err("schema", `${path}/keys`, "a clip needs at least one key");
		let last = -Infinity;
		c.keys.forEach((k, i) => {
			const kp = `${path}/keys/${i}`;
			if (!ctx.object(k, kp)) return;
			if (ctx.number(k.t, `${kp}/t`, 0)) {
				if ((k.t as number) < last) ctx.err("clip", `${kp}/t`, "keys must be in non-decreasing t");
				last = Math.max(last, k.t as number);
			}
			const hasState = "state" in k;
			const hasParts = "parts" in k;
			if (hasState === hasParts) ctx.err("schema", kp, "a key names a state or carries parts, exactly one of the two");
			if (hasState && ctx.name(k.state, `${kp}/state`) && !stateNames.has(k.state)) {
				ctx.err("ref.state", `${kp}/state`, `no state named "${k.state}"`);
			}
			if (hasParts && ctx.array(k.parts, `${kp}/parts`)) checkStateParts(ctx, k.parts, `${kp}/parts`, partNames, partObjs);
			if ("ease" in k && !EASES.includes(k.ease as string)) ctx.err("schema", `${kp}/ease`, `ease must be one of ${EASES.join(", ")}`);
			if ("curve" in k) {
				const cv = k.curve;
				if (!Array.isArray(cv) || cv.length !== 4 || !cv.every(isNum)) ctx.err("schema", `${kp}/curve`, "a curve is [x1, y1, x2, y2]");
				else if (cv[0] < 0 || cv[0] > 1 || cv[2] < 0 || cv[2] > 1) ctx.err("schema", `${kp}/curve`, "a curve's x1 and x2 stay within 0..1");
			}
			if ("targets" in k) checkTargets(ctx, k.targets, `${kp}/targets`, chainNames);
			if ("events" in k && ctx.array(k.events, `${kp}/events`)) k.events.forEach((ev, j) => ctx.name(ev, `${kp}/events/${j}`));
			ctx.unknown(k, KNOWN_KEY, [], kp);
		});
	}
	ctx.unknown(c, KNOWN_CLIP, [], path);
	return named ? (c.name as string) : null;
}

function checkConstraint(ctx: Ctx, c: unknown, path: string, parts: Map<string, Obj>): string | null {
	if (!ctx.object(c, path)) return null;
	const named = ctx.name(c.name, `${path}/name`);
	let chain: string[] = [];
	if (!("chain" in c)) ctx.err("schema", `${path}/chain`, "a constraint has a chain");
	else if (ctx.array(c.chain, `${path}/chain`)) {
		if (c.chain.length === 0) ctx.err("schema", `${path}/chain`, "a chain needs at least one part");
		const ok = c.chain.every((n, i) => ctx.name(n, `${path}/chain/${i}`));
		if (ok) chain = c.chain as string[];
	}
	chain.forEach((n, i) => {
		const part = parts.get(n);
		if (!part) {
			ctx.err("ref.part", `${path}/chain/${i}`, `no part named "${n}"`);
			return;
		}
		if (i > 0 && part.parent !== chain[i - 1]) {
			ctx.err("chain", `${path}/chain/${i}`, `"${n}" is not parented to "${chain[i - 1]}"`);
		}
	});
	if (!("end" in c)) ctx.err("schema", `${path}/end`, "a constraint has an end: part/anchor");
	else if (typeof c.end !== "string" || !/^[^/]+\/[^/]+$/.test(c.end)) ctx.err("schema", `${path}/end`, "end is part/anchor");
	else if (chain.length) {
		const [pn, an] = c.end.split("/");
		let lastPart = parts.get(chain[chain.length - 1]);
		if (lastPart && isName(lastPart.like) && parts.has(lastPart.like)) lastPart = parts.get(lastPart.like);
		const anchors = Array.isArray(lastPart?.anchors) ? (lastPart!.anchors as Obj[]) : [];
		if (pn !== chain[chain.length - 1] || !anchors.some((a) => isObj(a) && a.name === an)) {
			ctx.err("ref.anchor", `${path}/end`, `"${c.end}" is not an anchor on the chain's last part`);
		}
	}
	if (ctx.dim === 3) {
		if ("pole" in c) ctx.vec3(c.pole, `${path}/pole`);
		ctx.unknown(c, KNOWN_CONSTRAINT3, [], path);
	} else {
		if ("bend" in c && c.bend !== 1 && c.bend !== -1) ctx.err("schema", `${path}/bend`, "bend is 1 or -1");
		ctx.unknown(c, KNOWN_CONSTRAINT, [], path);
	}
	return named ? (c.name as string) : null;
}

function checkDuplicates(ctx: Ctx, names: (string | null)[], code: ErrorCode, path: string, what: string) {
	const seen = new Set<string>();
	names.forEach((n, i) => {
		if (n === null) return;
		if (seen.has(n)) ctx.err(code, `${path}/${i}/name`, `two ${what} named "${n}"`);
		seen.add(n);
	});
}

/** Every token reference a document makes, with the pointer to each. */
function colorRefs(doc: Obj): { color: string; path: string }[] {
	const refs: { color: string; path: string }[] = [];
	const take = (shapes: unknown, path: string) => {
		if (!Array.isArray(shapes)) return;
		shapes.forEach((sh, i) => {
			if (isObj(sh) && isName(sh.color)) refs.push({ color: sh.color, path: `${path}/${i}/color` });
			// 1.8: a shape's further colours resolve as its colour does
			if (isObj(sh) && Array.isArray(sh.colors)) sh.colors.forEach((c, j) => isName(c) && refs.push({ color: c, path: `${path}/${i}/colors/${j}` }));
		});
	};
	if (Array.isArray(doc.parts)) {
		doc.parts.forEach((p, i) => {
			if (isObj(p)) take(p.shapes, `/parts/${i}/shapes`);
		});
	}
	take(doc.collision, "/collision");
	return refs;
}

/**
 * Validate a parsed document. Structure first (what the schema checks),
 * then references. The report's `ok` is false on any error; warnings
 * never fail a file.
 */
export function validate(input: unknown, opts: ValidateOptions = {}): Report {
	const ctx = new Ctx();
	const done = (): Report => ({ ok: ctx.errors.length === 0, errors: ctx.errors, warnings: ctx.warnings });

	if (!isObj(input)) {
		ctx.err("schema", "", "a document is a JSON object");
		return done();
	}
	const doc = input;

	// version: the one field a reader must look at before anything else
	if (!("version" in doc)) ctx.err("version", "/version", "version is required");
	else if (!Number.isInteger(doc.version)) ctx.err("version", "/version", "version must be the integer 1");
	else if ((doc.version as number) > FORMAT_VERSION)
		ctx.err("version", "/version", `version ${doc.version} is newer than this reader (${FORMAT_VERSION})`);
	else if ((doc.version as number) < 1) ctx.err("version", "/version", "version must be 1");
	if (ctx.errors.length) return done();

	// space (1.3): how many coordinates a point has; a reader refuses a space it does not know
	if ("space" in doc) {
		if (typeof doc.space !== "string" || !SPACES.includes(doc.space)) ctx.err("space", "/space", `space must be one of ${SPACES.join(", ")}`);
		else if (doc.space === "3d") ctx.dim = 3;
	}
	if (ctx.errors.length) return done();

	if ("name" in doc && typeof doc.name !== "string") ctx.err("schema", "/name", "expected a string");

	const refs: string[] = [];
	if ("palette_refs" in doc && ctx.array(doc.palette_refs, "/palette_refs")) {
		doc.palette_refs.forEach((r, i) => {
			const rp = `/palette_refs/${i}`;
			if (!ctx.name(r, rp)) return;
			if (isAbsolutePath(r)) ctx.err("path", rp, "palette_refs are relative to this file, never absolute");
			else refs.push(r);
		});
	}

	const tokenNames: (string | null)[] = [];
	if ("palette" in doc && ctx.array(doc.palette, "/palette")) {
		doc.palette.forEach((t, i) => tokenNames.push(checkToken(ctx, t, `/palette/${i}`)));
		checkDuplicates(ctx, tokenNames, "dup.token", "/palette", "tokens");
	}

	const partNames: (string | null)[] = [];
	const partObjs = new Map<string, Obj>();
	if ("parts" in doc && ctx.array(doc.parts, "/parts")) {
		doc.parts.forEach((p, i) => {
			const n = checkPart(ctx, p, `/parts/${i}`);
			partNames.push(n);
			if (n !== null && !partObjs.has(n)) partObjs.set(n, p as Obj);
		});
		checkDuplicates(ctx, partNames, "dup.part", "/parts", "parts");
		// parents: they exist, and they do not loop
		doc.parts.forEach((p, i) => {
			if (!isObj(p) || !isName(p.parent)) return;
			if (!partObjs.has(p.parent)) {
				ctx.err("ref.parent", `/parts/${i}/parent`, `no part named "${p.parent}"`);
				return;
			}
			const seen = new Set<string>([p.name as string]);
			let cur: string | undefined = p.parent;
			while (cur !== undefined) {
				if (seen.has(cur)) {
					ctx.err("cycle", `/parts/${i}/parent`, `parents loop through "${cur}"`);
					break;
				}
				seen.add(cur);
				const next: unknown = partObjs.get(cur)?.parent;
				cur = isName(next) ? next : undefined;
			}
		});
	}
	const partSet = new Set(partNames.filter((n): n is string => n !== null));

	// like (1.2): the source exists, is another part, and draws its own geometry
	if (Array.isArray(doc.parts)) {
		doc.parts.forEach((p, i) => {
			if (!isObj(p) || !isName(p.like)) return;
			const src = partObjs.get(p.like);
			if (!src) ctx.err("ref.part", `/parts/${i}/like`, `no part named "${p.like}"`);
			else if (p.like === p.name) ctx.err("like", `/parts/${i}/like`, "a part cannot be like itself");
			else if (isName(src.like)) ctx.err("like", `/parts/${i}/like`, `"${p.like}" is itself like another part; like does not chain`);
		});
	}

	// skins (1.9): every joint is a part
	if (Array.isArray(doc.parts)) {
		doc.parts.forEach((p, i) => {
			if (!isObj(p) || !Array.isArray(p.shapes)) return;
			p.shapes.forEach((sh, si) => {
				if (!isObj(sh) || !isObj(sh.skin) || !Array.isArray(sh.skin.joints) || sh.skin.host === true) return; // (a host's joints are the host's to have)
				sh.skin.joints.forEach((j, ji) => {
					if (typeof j === "string" && j !== "" && !partSet.has(j)) ctx.err("skin", `/parts/${i}/shapes/${si}/skin/joints/${ji}`, `no part named "${j}"`);
				});
			});
		});
	}

	// constraints before states: targets name them
	const chainNames: (string | null)[] = [];
	if ("constraints" in doc && ctx.array(doc.constraints, "/constraints")) {
		doc.constraints.forEach((c, i) => chainNames.push(checkConstraint(ctx, c, `/constraints/${i}`, partObjs)));
		checkDuplicates(ctx, chainNames, "dup.constraint", "/constraints", "constraints");
	}
	const chainSet = new Set(chainNames.filter((n): n is string => n !== null));

	const stateNames: (string | null)[] = [];
	if ("states" in doc && ctx.array(doc.states, "/states")) {
		doc.states.forEach((s, i) => stateNames.push(checkState(ctx, s, `/states/${i}`, partSet, chainSet, partObjs)));
		checkDuplicates(ctx, stateNames, "dup.state", "/states", "states");
	}
	const stateSet = new Set(stateNames.filter((n): n is string => n !== null));

	if ("clips" in doc && ctx.array(doc.clips, "/clips")) {
		const names = doc.clips.map((c, i) => checkClip(ctx, c, `/clips/${i}`, partSet, stateSet, chainSet, partObjs));
		checkDuplicates(ctx, names, "dup.clip", "/clips", "clips");
	}

	if ("collision" in doc && ctx.array(doc.collision, "/collision")) {
		doc.collision.forEach((sh, i) => {
			(ctx.dim === 3 ? checkShape3 : checkShape)(ctx, sh, `/collision/${i}`, false);
			// 1.4: a shape that rides a part names one the document has
			if (isObj(sh) && isName(sh.part) && !partSet.has(sh.part)) ctx.err("ref.part", `/collision/${i}/part`, `no part named "${sh.part}"`);
		});
	}

	// textures (1.5): names unique, refs relative; shapes name ones the document has
	const textureNames: (string | null)[] = [];
	if ("textures" in doc && ctx.array(doc.textures, "/textures")) {
		doc.textures.forEach((t, i) => textureNames.push(checkTexture(ctx, t, `/textures/${i}`).name));
		checkDuplicates(ctx, textureNames, "dup.texture", "/textures", "textures");
	}
	const textureSet = new Set(textureNames.filter((n): n is string => n !== null));
	if (Array.isArray(doc.parts)) {
		doc.parts.forEach((p, i) => {
			if (!isObj(p) || !Array.isArray(p.shapes)) return;
			p.shapes.forEach((sh, j) => {
				if (isObj(sh) && isName(sh.texture) && !textureSet.has(sh.texture)) ctx.err("ref.texture", `/parts/${i}/shapes/${j}/texture`, `no texture named "${sh.texture}"`);
			});
		});
	}
	for (const ref of opts.unresolvedRefs ?? []) ctx.warn("unresolved", "/textures", `${ref} could not be read, so that map was not checked`);

	if ("meta" in doc) ctx.object(doc.meta, "/meta");
	ctx.unknown(doc, KNOWN_TOP, RESERVED_TOP, "");

	// token references: local palette, then whatever the refs supplied
	const local = new Set(tokenNames.filter((n): n is string => n !== null));
	const supplied = opts.refTokens == null ? null : new Set(opts.refTokens);
	let warnedUnresolved = false;
	for (const { color, path } of colorRefs(doc)) {
		if (local.has(color)) continue;
		if (refs.length === 0) {
			ctx.err("ref.token", path, `no token named "${color}" in the palette`);
		} else if (supplied === null) {
			if (!warnedUnresolved) {
				ctx.warn("unresolved", "/palette_refs", "palette_refs were not resolved, so shared tokens were not checked");
				warnedUnresolved = true;
			}
		} else if (!supplied.has(color)) {
			ctx.err("ref.token", path, `no token named "${color}" in the palette or its refs`);
		}
	}

	return done();
}
