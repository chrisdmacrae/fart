// The Fast Art Format, as TypeScript. A Doc is the JSON itself: optional
// fields stay optional, unknown fields ride along untouched (index
// signatures), and the accessors in geometry.ts supply the defaults the
// spec promises. Nothing here is a class; a .fart is data.

/** [x, y]. y-down, x-right, in the project's world units. */
export type Vec2 = [number, number];

/** [r, g, b, a], each 0..255. The field is called rgb; it holds four. */
export type Rgba = [number, number, number, number];

export interface Token {
	name: string;
	rgb: Rgba;
	/** Since 1.2: light this slot gives off, 0 or absent for none. The game decides what that means. */
	emissive?: number;
	[extra: string]: unknown;
}

/** Since 1.5: a 2D shape's mapping from pattern coordinates to its space: a placement, or the affine map itself. */
export interface Mapping2 {
	at?: Vec2;
	angle?: number;
	scale?: number;
	/** [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f; wins over at/angle/scale */
	xf?: [number, number, number, number, number, number];
	[extra: string]: unknown;
}
/** Since 1.5: a 3D shape's mapping: world units per pattern unit, or explicit pattern coordinates per face corner. */
export interface Mapping3 {
	scale?: number;
	uvs?: Vec2[][];
	[extra: string]: unknown;
}
/** Since 1.5: what a textured shape carries. */
export interface TextureFields2 {
	texture?: string;
	mapping?: Mapping2;
}
export interface TextureFields3 {
	texture?: string;
	mapping?: Mapping3;
}
/** Since 1.5: one map of a texture: a drawing, tiled. */
export interface TextureMap {
	/** a relative path to a 2D art file */
	ref: string;
	/** a relative path to a palette file laid over the drawing's tokens */
	palette?: string;
	/** which of the drawing's states to draw; absent: the first, else every part */
	state?: string;
	/** paint (default): its colours over the token; mask: the token times its value */
	mode?: "paint" | "mask";
	/** Since 1.8: a blur over the map, its radius (a Gaussian's deviation) in pattern units, wrapping at the cell */
	soften?: number;
	[extra: string]: unknown;
}
export interface Texture {
	name: string;
	/** [w, h]: the tile, from [0, 0] in the maps' document space */
	cell: Vec2;
	/** by name; "color" is what a reader paints, the rest are the engine's */
	maps: Record<string, TextureMap>;
	/** Since 1.10: how far the `height` map's value 1 stands proud of 0, in pattern units; absent or 0: no relief */
	relief?: number;
	[extra: string]: unknown;
}

/** Since 1.4, on a collision shape: the part it rides (its rest space), and an engine's layer. */
export interface CollisionFields {
	part?: string;
	/** Absent means "solid". The format does not interpret it. */
	layer?: string;
	meta?: Record<string, unknown>;
}

export interface CircleShape extends CollisionFields, TextureFields2 {
	kind: "circle";
	/** A palette token. Required inside a part, optional in collision. */
	color?: string;
	/** Since 1.3: multiplies the resolved colour's r, g, b. Absent means 1. */
	shade?: number;
	at: Vec2;
	r: number;
	[extra: string]: unknown;
}

export interface LineShape extends CollisionFields, TextureFields2 {
	kind: "line";
	color?: string;
	shade?: number;
	a: Vec2;
	b: Vec2;
	/** Stroke width, round caps. As collision, the capsule's girth. */
	w: number;
	[extra: string]: unknown;
}

export interface PolyShape extends CollisionFields, TextureFields2 {
	kind: "poly";
	color?: string;
	shade?: number;
	points: Vec2[];
	/** Index triples into points, baked on save. Absent: triangulate yourself. */
	tris?: number[];
	[extra: string]: unknown;
}

/** Since 1.7: a path's flattened polygon, baked on save so a reader that does not flatten draws it as a poly. */
export interface PathBake {
	points: Vec2[];
	/** index triples into bake.points; a closed path only */
	tris?: number[];
	[extra: string]: unknown;
}

/**
 * Since 1.7: a cubic polybézier. `in[i]` and `out[i]` are the tangent
 * handles relative to `points[i]` (absent or [0,0]: a corner); the segment
 * from i to i+1 runs through points[i]+out[i] and points[i+1]+in[i+1].
 * Closed, it fills; open, it strokes with `w`.
 */
export interface PathShape extends CollisionFields, TextureFields2 {
	kind: "path";
	color?: string;
	shade?: number;
	closed?: boolean;
	points: Vec2[];
	in?: Vec2[];
	out?: Vec2[];
	/** Stroke width for an open path, round joins and caps. */
	w?: number;
	bake?: PathBake;
	[extra: string]: unknown;
}

export type Shape = CircleShape | LineShape | PolyShape | PathShape;
export type ShapeKind = Shape["kind"];

export interface Anchor {
	name: string;
	at: Vec2;
	/** Since 1.2: the direction an attached thing points, radians in the part's rest space. */
	angle?: number;
	[extra: string]: unknown;
}

export interface Part {
	name: string;
	/** Since 1.1: the part this one is posed relative to. */
	parent?: string;
	/** Absent means [0, 0]; with `like`, absent means the source part's pivot. */
	pivot?: Vec2;
	/** Since 1.2: this part's shapes and anchors are that part's. It has none of its own. */
	like?: string;
	shapes?: Shape[];
	anchors?: Anchor[];
	meta?: Record<string, unknown>;
	[extra: string]: unknown;
}

/** Since 1.6: a shape's points as they are in one pose. `shape` indexes the part's own shapes; the count matches the base. */
export interface Morph<V = Vec2> {
	shape: number;
	points: V[];
	/** 1.7: a path's handles in this pose; absent, the base handles ride along */
	in?: V[];
	out?: V[];
	[extra: string]: unknown;
}

export interface StatePart {
	part: string;
	/** Where the pivot lands. Absent means the pivot itself (rest). */
	offset?: Vec2;
	/** Radians about the pivot. Absent means 0. */
	rotate?: number;
	/** Absent or 0 means 1. */
	scale?: number;
	/** Since 1.2: flipped left-to-right about the pivot, before the turn. */
	mirror?: boolean;
	/** Since 1.6: polys of the part reshaped in this pose; lerped between keys. */
	morph?: Morph<Vec2>[];
	[extra: string]: unknown;
}

/** Since 1.2: where a chain should reach in this pose, document space. */
export interface Target {
	chain: string;
	at: Vec2;
	[extra: string]: unknown;
}

export interface State {
	name: string;
	/** Paint order. Parts left out are not drawn. */
	parts: StatePart[];
	/** Since 1.2: chains this pose reaches with; the parts' rotations hold the solved pose too. */
	targets?: Target[];
	[extra: string]: unknown;
}

export type Ease = "linear" | "in" | "out" | "in-out" | "step";

/** Since 1.2: a cubic bezier's two control points, [x1, y1, x2, y2], x in 0..1. */
export type Curve = [number, number, number, number];

/** One moment in a clip: a time, and a pose named or inline. */
export interface ClipKey {
	/** Seconds. */
	t: number;
	state?: string;
	parts?: StatePart[];
	/** How time approaches this key from the previous one. Absent means linear. */
	ease?: Ease;
	/** Since 1.2: a bezier easing that wins over `ease` where a reader knows it. */
	curve?: Curve;
	/** Since 1.2: chains this key reaches with, tweened toward the next key's. */
	targets?: Target[];
	/** Since 1.2: names a runtime hears when the playhead crosses this key. */
	events?: string[];
	[extra: string]: unknown;
}

/** Since 1.1: states in time. */
export interface Clip {
	name: string;
	/** Time wraps at the last key. Absent means false. */
	loop?: boolean;
	/** In non-decreasing t, at least one. */
	keys: ClipKey[];
	[extra: string]: unknown;
}

/** Since 1.1: an inverse-kinematics chain a runtime may solve live. */
export interface Constraint {
	name: string;
	/** Parts root-first, each parented to the previous. */
	chain: string[];
	/** "part/anchor" on the chain's last part. */
	end: string;
	/** Preferred elbow direction where a solution is ambiguous (2D). */
	bend?: 1 | -1;
	/** 3D (1.3): a document-space point the first elbow leans toward. */
	pole?: Vec3;
	[extra: string]: unknown;
}

export interface Doc {
	version: 1;
	/** Since 1.3: "2d" (absent) or "3d". A 3D document is typed as Doc3; see as3d(). */
	space?: "2d" | "3d";
	name?: string;
	palette_refs?: string[];
	palette?: Token[];
	parts?: Part[];
	states?: State[];
	clips?: Clip[];
	constraints?: Constraint[];
	collision?: Shape[];
	/** Since 1.5 */
	textures?: Texture[];
	meta?: Record<string, unknown>;
	[extra: string]: unknown;
}

/** The format major this library speaks. */
export const FORMAT_VERSION = 1;
/** The minor: what this library knows past the major. */
export const FORMAT_MINOR = 9;

// ------------------------------------------------------------------ 1.3: 3D
// A 3D document is the same words with a third coordinate: x-right,
// y-down, z-away, right-handed. Dropping z gives the front view.

/** [x, y, z]. */
export type Vec3 = [number, number, number];

/** Since 1.7: how a mesh is lit and smoothed; the cage in `points`/`faces` is always the file. */
export interface SmoothFields {
	/** "flat" (the default): one normal per face. "smooth": vertex normals averaged, except across sharp edges. Default "smooth" once `smooth` > 0. */
	normals?: "flat" | "smooth";
	/** Degrees: faces meeting at more than this keep their own normals (Blender's auto-smooth). Absent: every edge that is not creased is smooth. */
	angle?: number;
	/** Catmull-Clark levels, 0 (the default) for none. The cage stays the file; readers subdivide, or read `bake`, or draw the cage. */
	smooth?: number;
	/** [a, b, c]: the edge a–b with crease c in 0–1 (1 is infinitely sharp; c maps to OpenSubdiv sharpness c×10); [a, c]: a corner. */
	creases?: number[][];
	/** The subdivided surface, written by `fart bake --smooth` for readers that do not subdivide; `of` hashes the cage it came from. */
	bake?: MeshBake;
}

/** Since 1.8: more than one colour on a shape. `paint` has one entry per face: 0 is the shape's `color`, n is `colors[n - 1]`. */
export interface PaintFields {
	/** Further palette tokens the faces may wear. */
	colors?: string[];
	/** One whole number per face of the cage (for a sweep, of the mesh it generates). */
	paint?: number[];
}

/** Since 1.8: the cage reflected through the plane at 0 on `axis` and joined; points within `merge` of the plane weld and are pinned to it. */
export interface MirrorMod {
	op: "mirror";
	axis: "x" | "y" | "z";
	/** Absent means 0.001. */
	merge?: number;
	[extra: string]: unknown;
}
/** Since 1.8: a surface given thickness along its point normals; a boundary gets a rim of quads. */
export interface SolidifyMod {
	op: "solidify";
	thick: number;
	/** -1 (the default): the cage is the outside and the wall grows inward; 1: the cage is the inside; between, in proportion. */
	offset?: number;
	/** A paint index for the inner faces; absent, each wears its source face's. */
	inner?: number;
	/** A paint index for the rim; absent, each quad wears the paint of the face its edge belongs to. */
	rim?: number;
	[extra: string]: unknown;
}
/** Since 1.8: every edge whose faces meet at more than `angle` degrees takes crease `value`, unless it already has one. */
export interface CreaseMod {
	op: "crease";
	/** Degrees, absent means 30. */
	angle?: number;
	/** 0–1, absent means 1. */
	value?: number;
	[extra: string]: unknown;
}
export type Mod = MirrorMod | SolidifyMod | CreaseMod;

export interface MeshBake {
	points: Vec3[];
	faces: number[][];
	tris?: number[];
	of?: string;
	/** 1.8: the paint of the bake's own faces, and the shade of its own points. */
	paint?: number[];
	shades?: number[];
	/** The cage's explicit pattern coordinates on the surface, one list per face of it; `uvOf` hashes the cage's own. */
	uvs?: Vec2[][];
	uvOf?: string;
	[extra: string]: unknown;
}

/** Since 1.9: the parts a mesh's points follow, and for each point pairs of [index into `joints`, weight] (one to four pairs, adding up to 1). */
export interface Skin {
	/** The joints are parts of the host, the document this one is drawn on; alone, the shape is rigid. */
	host?: boolean;
	joints: string[];
	weights: number[][];
}

export interface MeshShape extends CollisionFields, TextureFields3, SmoothFields, PaintFields {
	kind: "mesh";
	color?: string;
	shade?: number;
	/** Since 1.8: one number per point, multiplying `shade` there; interpolated across faces and through subdivision. */
	shades?: number[];
	/** Since 1.8: modifiers applied to the cage in order, after a morph and before `smooth`. */
	mods?: Mod[];
	/** Since 1.9: the mesh gives at its joints: each point placed by several parts' world maps, weighted. */
	skin?: Skin;
	points: Vec3[];
	/** Index loops into points, wound so (p1-p0)x(p2-p0) points outward. */
	faces: number[][];
	/** Index triples into points, baked on save. */
	tris?: number[];
	[extra: string]: unknown;
}

/**
 * Since 1.7: a solid generated from a 2D profile (a path in the plane
 * across `axis`): `lathe` revolves [radius, along] pairs in `segments`
 * steps; `extrude` runs the closed profile from `from` to `to`. The bake
 * is the mesh it makes; readers that know the kind make it themselves.
 */
export interface SweepShape extends CollisionFields, TextureFields3, SmoothFields, PaintFields {
	kind: "sweep";
	color?: string;
	shade?: number;
	/** `pipe` since 1.8: a section carried along a 3D `path`. */
	op: "lathe" | "extrude" | "pipe" | "rail";
	/** A lathe's and an extrude's; a pipe has none. A rail's (1.11) is the way its profile stands, y when absent. */
	axis?: "x" | "y" | "z";
	/** A lathe's and an extrude's profile; for a pipe, an optional closed section in place of the circle. */
	profile?: { points: Vec2[]; in?: Vec2[]; out?: Vec2[]; closed?: boolean; [extra: string]: unknown };
	segments?: number;
	from?: number;
	to?: number;
	/** 1.8, a pipe's spine: a path body with three coordinates. */
	path?: { points: Vec3[]; in?: Vec3[]; out?: Vec3[]; [extra: string]: unknown };
	/** 1.8: the section's scale (a round pipe's radius); absent means 1. */
	radius?: number;
	/** 1.8: one factor per path point, multiplying `radius` there, linear between. */
	radii?: number[];
	/** 1.8: close the ends of an open pipe; absent means true. */
	caps?: boolean;
	/** 1.8: the path joins its last point to its first. */
	closed?: boolean;
	/** 1.11, a rail: the radius its path's corners are rounded to. */
	round?: number;
	/** 1.8: modifiers on the generated mesh. */
	mods?: Mod[];
	[extra: string]: unknown;
}

export interface BallShape extends CollisionFields, TextureFields3 {
	kind: "ball";
	color?: string;
	shade?: number;
	at: Vec3;
	r: number;
	[extra: string]: unknown;
}

export interface RodShape extends CollisionFields, TextureFields3 {
	kind: "rod";
	color?: string;
	shade?: number;
	a: Vec3;
	b: Vec3;
	w: number;
	[extra: string]: unknown;
}

/** Since 1.4, collision only: a box at its centre, `size` the full extents, turned like a pose. */
export interface BoxShape extends CollisionFields {
	kind: "box";
	at: Vec3;
	size: Vec3;
	rotate?: Vec3;
	[extra: string]: unknown;
}

export type Shape3 = MeshShape | BallShape | RodShape | SweepShape;
/** What a 3D collision list holds: the 3D kinds and boxes. */
/** A collision solid: never a sweep (give the collision its mesh). */
export type CollisionShape3 = MeshShape | BallShape | RodShape | BoxShape;

export interface Anchor3 {
	name: string;
	at: Vec3;
	/** The direction an attached thing points, in the part's rest space. */
	dir?: Vec3;
	[extra: string]: unknown;
}

export interface Part3 {
	name: string;
	parent?: string;
	pivot?: Vec3;
	like?: string;
	shapes?: Shape3[];
	anchors?: Anchor3[];
	meta?: Record<string, unknown>;
	[extra: string]: unknown;
}

export interface StatePart3 {
	part: string;
	offset?: Vec3;
	/** Radians about the pivot: about x, then y, then z. Absent means [0, 0, 0]. */
	rotate?: Vec3;
	scale?: number;
	mirror?: boolean;
	/** Since 1.6: meshes of the part reshaped in this pose; lerped between keys. */
	morph?: Morph<Vec3>[];
	[extra: string]: unknown;
}

/** 3D (1.3): where a chain should reach in this pose, document space. */
export interface Target3 {
	chain: string;
	at: Vec3;
	[extra: string]: unknown;
}

export interface State3 {
	name: string;
	/** Membership. Depth decides painting in 3D; the list's order is kept for readers that want it. */
	parts: StatePart3[];
	targets?: Target3[];
	[extra: string]: unknown;
}

export interface ClipKey3 {
	t: number;
	state?: string;
	parts?: StatePart3[];
	ease?: Ease;
	curve?: Curve;
	targets?: Target3[];
	events?: string[];
	[extra: string]: unknown;
}

export interface Clip3 {
	name: string;
	loop?: boolean;
	keys: ClipKey3[];
	[extra: string]: unknown;
}

export interface Doc3 {
	version: 1;
	space: "3d";
	name?: string;
	palette_refs?: string[];
	palette?: Token[];
	parts?: Part3[];
	states?: State3[];
	clips?: Clip3[];
	constraints?: Constraint[];
	collision?: CollisionShape3[];
	textures?: Texture[];
	meta?: Record<string, unknown>;
	[extra: string]: unknown;
}

/** Is this a 3D document? parseDoc returns a Doc for both spaces; this tells them apart. */
export function is3d(doc: { space?: unknown }): boolean {
	return doc.space === "3d";
}

/** The document as a 3D one, or null when it is not. A validated 3D document is a Doc3. */
export function as3d(doc: Doc | Doc3): Doc3 | null {
	return doc.space === "3d" ? (doc as Doc3) : null;
}

/** What an unresolvable token renders as: loud, on purpose. */
export const MAGENTA: Rgba = [255, 0, 255, 255];
