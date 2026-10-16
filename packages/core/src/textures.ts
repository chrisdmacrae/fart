// Textures (1.5): maps that are drawings, tiled over a cell. Resolving a
// texture reads its maps' drawings and palettes; box mapping gives a
// mesh its pattern coordinates; a small software rasteriser turns any
// map into pixels, the same way in every reader, so a bake and a game
// agree; and the 2D mapping's affine form is what fills and projections
// use. Relief (1.10): a map may be softened, and a height map with a
// relief bakes to a normal map.

import type { Doc, Doc3, Mapping2, Shape, StatePart, Texture, TextureMap, Token, Vec2 } from "./types.ts";
import { applyPalette, colorOf, resolvePalettes, shadeColor, type RefReader } from "./palette.ts";
import { drawList, shapeBounds, shapeDistance, shapesOf, xfApply, xfInvert, type Xf } from "./geometry.ts";
import { boxUV, meshUVs } from "./solids.ts";
export { boxUV, meshUVs };

/** A map, read: its drawing, the tokens to draw it with, and the pose to draw. */
export interface ResolvedMap {
	map: TextureMap;
	doc: Doc;
	tokens: Token[];
	pose: string | readonly StatePart[] | undefined;
}
export interface ResolvedTexture {
	texture: Texture;
	maps: Record<string, ResolvedMap>;
	/** refs that could not be read */
	unresolved: string[];
}

/** Read a texture's maps through `read` (paths relative to the document that names them). */
export async function resolveTexture(texture: Texture, read: RefReader, parse: (text: string) => Doc | null): Promise<ResolvedTexture> {
	const out: ResolvedTexture = { texture, maps: {}, unresolved: [] };
	for (const [name, map] of Object.entries(texture.maps)) {
		const text = await read(map.ref);
		const doc = text === null ? null : parse(text);
		if (!doc || doc.space === "3d") {
			out.unresolved.push(map.ref);
			continue;
		}
		// the drawing's own tokens, through its refs (relative to the drawing), then the map's palette laid over
		const dir = map.ref.includes("/") ? map.ref.slice(0, map.ref.lastIndexOf("/") + 1) : "";
		let { tokens } = await resolvePalettes(doc, (rel) => read(dir + rel));
		if (map.palette) {
			const pt = await read(map.palette);
			const pd = pt === null ? null : parse(pt);
			if (pd?.palette) tokens = applyPalette(tokens, pd.palette);
			else out.unresolved.push(map.palette);
		}
		const pose = map.state ?? doc.states?.[0]?.name;
		out.maps[name] = { map, doc, tokens, pose };
	}
	return out;
}

/** Every texture of a document, resolved. */
export async function resolveTextures(doc: Doc | Doc3, read: RefReader, parse: (text: string) => Doc | null): Promise<Map<string, ResolvedTexture>> {
	const out = new Map<string, ResolvedTexture>();
	for (const t of doc.textures ?? []) out.set(t.name, await resolveTexture(t, read, parse));
	return out;
}

// ------------------------------------------------------------- mapping

/** A 2D mapping as the affine map from pattern coordinates to the shape's space. */
export function mappingXf(m: Mapping2 | undefined): Xf {
	if (m?.xf) return [...m.xf] as Xf;
	const at = m?.at ?? [0, 0];
	const a = m?.angle ?? 0;
	const s = m?.scale === undefined || m.scale === 0 ? 1 : m.scale;
	const c = Math.cos(a) * s;
	const sn = Math.sin(a) * s;
	return [c, sn, -sn, c, at[0], at[1]];
}

/** The 2D affine from pattern coordinates to a plane, from three corners with known coordinates on both sides. */
export function affineFrom(uv: readonly Vec2[], xy: readonly Vec2[]): Xf | null {
	// solve M · [u v 1] = [x y] for M (2×3) from three corners
	const [u0, v0] = uv[0];
	const [u1, v1] = uv[1];
	const [u2, v2] = uv[2];
	const det = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
	if (Math.abs(det) < 1e-12) return null;
	const inv = [(v2 - v0) / det, -(v1 - v0) / det, -(u2 - u0) / det, (u1 - u0) / det]; // inverse of [[u1-u0, u2-u0],[v1-v0, v2-v0]]
	const [x0, y0] = xy[0];
	const dx1 = xy[1][0] - x0;
	const dy1 = xy[1][1] - y0;
	const dx2 = xy[2][0] - x0;
	const dy2 = xy[2][1] - y0;
	// [dx1 dx2] = [a c] · [[u1-u0, u2-u0],[v1-v0, v2-v0]]  →  [a c] = [dx1 dx2] · inv
	const a = dx1 * inv[0] + dx2 * inv[1];
	const c = dx1 * inv[2] + dx2 * inv[3];
	const b = dy1 * inv[0] + dy2 * inv[1];
	const d = dy1 * inv[2] + dy2 * inv[3];
	const e = x0 - (a * u0 + c * v0);
	const f = y0 - (b * u0 + d * v0);
	const r = (x: number) => Math.round(x * 1e4) / 1e4 + 0;
	return [r(a), r(b), r(c), r(d), r(e), r(f)];
}

// ------------------------------------------------------------- rasterising

/** Pixels of a map: RGBA, row-major, `px` wide and `py` tall over one cell. */
export interface Raster {
	width: number;
	height: number;
	/** RGBA bytes */
	data: Uint8ClampedArray;
}

const lum = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/**
 * One cell of a map as premultiplied RGBA floats (0..255, alpha 0..1 in the
 * fourth), one sample per pixel at its centre, the drawing's shapes in
 * paint order over a clear ground, then softened (1.10).
 */
function rasterFloats(texture: Texture, res: ResolvedMap, px: number, py: number): Float32Array {
	const [cw, ch] = texture.cell;
	const data = new Float32Array(px * py * 4);
	const items: { shape: Shape; xf: Xf; inv: Xf; scale: number; rgba: [number, number, number, number]; lo: Vec2; hi: Vec2 }[] = [];
	for (const { part, xf, scale } of drawList(res.doc, res.pose)) {
		for (const sh of shapesOf(res.doc, part)) {
			// where the shape can paint, in the drawing's space: a sample outside it is not tested (a stitch is a few pixels of a sheet)
			const b = shapeBounds(sh);
			if (!b) continue;
			const cs = [xfApply(xf, b.lo), xfApply(xf, [b.hi[0], b.lo[1]]), xfApply(xf, b.hi), xfApply(xf, [b.lo[0], b.hi[1]])];
			const lo: Vec2 = [Math.min(...cs.map((c) => c[0])) - 1e-6, Math.min(...cs.map((c) => c[1])) - 1e-6];
			const hi: Vec2 = [Math.max(...cs.map((c) => c[0])) + 1e-6, Math.max(...cs.map((c) => c[1])) + 1e-6];
			items.push({ shape: sh, xf, inv: xfInvert(xf), scale, rgba: shadeColor(colorOf(res.tokens, sh.color ?? ""), sh.shade), lo, hi });
		}
	}
	for (let y = 0; y < py; y++) {
		for (let x = 0; x < px; x++) {
			// the sample, in the drawing's space, wrapped into the cell
			const wx = ((x + 0.5) / px) * cw;
			const wy = ((y + 0.5) / py) * ch;
			let r = 0;
			let g = 0;
			let b = 0;
			let a = 0;
			for (const it of items) {
				// tiling: test the sample and its neighbours a cell away, so shapes crossing the edge wrap
				let hit = false;
				for (let oy = -1; oy <= 1 && !hit; oy++) for (let ox = -1; ox <= 1 && !hit; ox++) {
					const sx = wx + ox * cw;
					const sy = wy + oy * ch;
					if (sx < it.lo[0] || sx > it.hi[0] || sy < it.lo[1] || sy > it.hi[1]) continue;
					if (shapeDistance(it.shape, xfApply(it.inv, [sx, sy])) <= 0) hit = true;
				}
				if (!hit) continue;
				const al = it.rgba[3] / 255;
				r = it.rgba[0] * al + r * (1 - al);
				g = it.rgba[1] * al + g * (1 - al);
				b = it.rgba[2] * al + b * (1 - al);
				a = al + a * (1 - al);
			}
			const o = (y * px + x) * 4;
			data[o] = r;
			data[o + 1] = g;
			data[o + 2] = b;
			data[o + 3] = a;
		}
	}
	const soften = res.map.soften ?? 0;
	if (soften > 0) {
		blurWrapped(data, px, py, 4, (soften * px) / cw, 0);
		blurWrapped(data, px, py, 4, (soften * py) / ch, 1);
	}
	return data;
}

/** A Gaussian of deviation `sigma` pixels along one axis, in place, wrapping at the edges (a tile stays a tile). */
function blurWrapped(data: Float32Array, w: number, h: number, n: number, sigma: number, axis: 0 | 1) {
	if (!(sigma > 0)) return;
	const len = axis === 0 ? w : h;
	const radius = Math.min(Math.ceil(sigma * 3), len * 2);
	const kernel = new Float32Array(radius * 2 + 1);
	let sum = 0;
	for (let i = -radius; i <= radius; i++) sum += kernel[i + radius] = Math.exp(-(i * i) / (2 * sigma * sigma));
	for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
	const lines = axis === 0 ? h : w;
	const step = axis === 0 ? n : w * n;
	const line = new Float32Array(len * n);
	for (let li = 0; li < lines; li++) {
		const base = axis === 0 ? li * w * n : li * n;
		for (let i = 0; i < len; i++) for (let c = 0; c < n; c++) line[i * n + c] = data[base + i * step + c];
		for (let i = 0; i < len; i++) {
			for (let c = 0; c < n; c++) {
				let acc = 0;
				for (let k = -radius; k <= radius; k++) acc += kernel[k + radius] * line[((((i + k) % len) + len) % len) * n + c];
				data[base + i * step + c] = acc;
			}
		}
	}
}

/**
 * Rasterise one cell of a map. No engine needed: this is the reference,
 * and a game may do better with its own canvas.
 */
export function rasterizeMap(texture: Texture, res: ResolvedMap, px: number, py = px): Raster {
	const f = rasterFloats(texture, res, px, py);
	const data = new Uint8ClampedArray(px * py * 4);
	for (let i = 0; i < f.length; i += 4) {
		data[i] = f[i];
		data[i + 1] = f[i + 1];
		data[i + 2] = f[i + 2];
		data[i + 3] = f[i + 3] * 255;
	}
	return { width: px, height: py, data };
}

/** A map's scalar per pixel (luminance times alpha, 0..1), unquantised: what a normal is derived from. */
export function mapValues(texture: Texture, res: ResolvedMap, px: number, py = px): Float32Array {
	const f = rasterFloats(texture, res, px, py);
	const out = new Float32Array(px * py);
	// the floats are premultiplied, so their luminance is already the colour's times its alpha
	for (let i = 0; i < out.length; i++) out[i] = lum(f[i * 4], f[i * 4 + 1], f[i * 4 + 2]);
	return out;
}

/**
 * Relief (1.10) as a tangent-space normal map: the height field `values`
 * (one cell, wrapping) standing `relief` pattern units tall at 1, its
 * normal per pixel packed as rgb = n × 0.5 + 0.5. Red runs along +u; green
 * runs **up the image** (the glTF and OpenGL convention), blue out.
 */
export function normalRaster(values: Float32Array, px: number, py: number, cell: Vec2, relief: number): Raster {
	const data = new Uint8ClampedArray(px * py * 4);
	const at = (x: number, y: number) => values[(((y % py) + py) % py) * px + (((x % px) + px) % px)];
	// height per pattern unit: a pixel is cell/px units wide
	const kx = (relief * px) / cell[0] / 8;
	const ky = (relief * py) / cell[1] / 8;
	for (let y = 0; y < py; y++) {
		for (let x = 0; x < px; x++) {
			// Sobel: a slope that does not ring on a one-pixel step
			const dx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
			const dy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
			const nx = -dx * kx;
			const ny = dy * ky; // v runs down the image, green runs up
			const l = Math.hypot(nx, ny, 1);
			const o = (y * px + x) * 4;
			data[o] = Math.round((nx / l) * 127.5 + 127.5);
			data[o + 1] = Math.round((ny / l) * 127.5 + 127.5);
			data[o + 2] = Math.round((1 / l) * 127.5 + 127.5);
			data[o + 3] = 255;
		}
	}
	return { width: px, height: py, data };
}

/** The scalar maps a PBR material reads, packed as glTF wants them: occlusion in red, roughness in green, metallic in blue. An absent map is 1, 1 and 0. */
export function ormRaster(px: number, py: number, maps: { ao?: Float32Array; rough?: Float32Array; metal?: Float32Array }): Raster {
	const data = new Uint8ClampedArray(px * py * 4);
	for (let i = 0; i < px * py; i++) {
		data[i * 4] = (maps.ao ? maps.ao[i] : 1) * 255;
		data[i * 4 + 1] = (maps.rough ? maps.rough[i] : 1) * 255;
		data[i * 4 + 2] = (maps.metal ? maps.metal[i] : 0) * 255;
		data[i * 4 + 3] = 255;
	}
	return { width: px, height: py, data };
}

/** What a build bakes of one texture (1.10): every map's pixels, the normal map its relief gives, and the packed scalar maps. */
export interface BakedTexture {
	width: number;
	height: number;
	maps: Record<string, Raster>;
	/** from `height` and `relief`, when the texture has both */
	normal?: Raster;
	/** when the texture has any of `ao`, `rough`, `metal` */
	orm?: Raster;
}
export function bakeTexture(res: ResolvedTexture, px: number): BakedTexture {
	const [cw, ch] = res.texture.cell;
	const py = Math.max(1, Math.round((px * ch) / cw));
	const out: BakedTexture = { width: px, height: py, maps: {} };
	for (const [name, map] of Object.entries(res.maps)) out.maps[name] = rasterizeMap(res.texture, map, px, py);
	const relief = res.texture.relief ?? 0;
	if (res.maps.height && relief !== 0) out.normal = normalRaster(mapValues(res.texture, res.maps.height, px, py), px, py, res.texture.cell, relief);
	const scalar = (name: string) => (res.maps[name] ? mapValues(res.texture, res.maps[name], px, py) : undefined);
	if (res.maps.ao || res.maps.rough || res.maps.metal) out.orm = ormRaster(px, py, { ao: scalar("ao"), rough: scalar("rough"), metal: scalar("metal") });
	return out;
}

/** A raster read as the scalar the format defines: luminance times alpha, per pixel, 0..1. */
export function rasterValues(r: Raster): Float32Array {
	const out = new Float32Array(r.width * r.height);
	for (let i = 0; i < out.length; i++) out[i] = lum(r.data[i * 4], r.data[i * 4 + 1], r.data[i * 4 + 2]) * (r.data[i * 4 + 3] / 255);
	return out;
}

/** The colour a textured shape shows at a pattern coordinate: the colour map over (or masking) the token. */
export function textureColor(base: [number, number, number, number], res: ResolvedMap | undefined, raster: Raster | undefined, texture: Texture, uv: Vec2): [number, number, number, number] {
	if (!res || !raster) return base;
	const [cw, ch] = texture.cell;
	const fx = ((uv[0] / cw) % 1 + 1) % 1;
	const fy = ((uv[1] / ch) % 1 + 1) % 1;
	const x = Math.min(raster.width - 1, Math.floor(fx * raster.width));
	const y = Math.min(raster.height - 1, Math.floor(fy * raster.height));
	const o = (y * raster.width + x) * 4;
	const a = raster.data[o + 3] / 255;
	if (res.map.mode === "mask") {
		const v = lum(raster.data[o], raster.data[o + 1], raster.data[o + 2]) * a;
		return [base[0] * v, base[1] * v, base[2] * v, base[3]];
	}
	return [raster.data[o] * a + base[0] * (1 - a), raster.data[o + 1] * a + base[1] * (1 - a), raster.data[o + 2] * a + base[2] * (1 - a), base[3]];
}

