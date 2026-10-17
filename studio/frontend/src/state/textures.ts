// Textures in the studio (1.5): a document's textures resolved through
// the project (maps are files of the project, relative to the document),
// and each colour map rendered once into a small canvas the painters
// tile: the 2D canvas as a pattern, WebGL as a sampler. An image map
// (1.12) is read as bytes and decoded by core, so the studio sees the
// pixels a bake and a game see.

import { mapValues, normalRaster, rasterizeMap, resolveTextures, type Doc, type Doc3, type Raster, type ResolvedMap, type ResolvedTexture, type Texture, type TextureMap } from "@fastart/core";
import { drawDoc } from "../canvas/draw.ts";
import { shell } from "../shell/shell.ts";
import { project } from "./project.ts";
import { dirname, joinRel } from "./paths.ts";
import { parseDoc } from "@fastart/core";


/** pixels per drawing unit a rendered map aims for; the canvas is the power of two at or above it (WebGL repeats only those) */
export const MAP_PX = 16;

export interface TexturePattern {
	texture: Texture;
	resolved: ResolvedTexture;
	/** the colour map, one cell; null when it did not resolve */
	canvas: HTMLCanvasElement | null;
	/** pixels per drawing unit along x and y in the canvas */
	sx: number;
	sy: number;
	mode: TextureMap["mode"];
	/** 1.10: the relief's normal map (tangent space, green up the image), when the texture has a height map and a relief; 1.12: its `normal` map */
	normal: HTMLCanvasElement | null;
	/** bumped when the canvas is redrawn, so WebGL re-uploads */
	rev: number;
}

/** the least a map is rendered at along either side: a small cell (a course of thatch, a brick) is still seen close up */
const MIN_PX = 256;
const pow2 = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(MIN_PX, n)));

let revCounter = 0;

/** the widest a picture (1.12) is shown: past it, it is sampled down */
const IMAGE_PX = 2048;

/** A map's canvas size: a drawing's from its cell, a picture's from its pixels (a power of two, for WebGL to repeat). */
function canvasSize(t: Texture, m: ResolvedMap | undefined): [number, number] {
	if (m?.image) return [Math.min(IMAGE_PX, 2 ** Math.ceil(Math.log2(m.image.width))), Math.min(IMAGE_PX, 2 ** Math.ceil(Math.log2(m.image.height)))];
	return [pow2(t.cell[0] * MAP_PX), pow2(t.cell[1] * MAP_PX)];
}

/** Render a map's drawing into one cell, tiled three by three so shapes crossing the edge wrap. */
export function renderMapCanvas(t: Texture, res: ResolvedTexture, map = "color"): { canvas: HTMLCanvasElement; sx: number; sy: number } | null {
	const m = res.maps[map];
	if (!m) return null;
	const [cw, ch] = t.cell;
	const [w, h] = canvasSize(t, m);
	const sx = w / cw;
	const sy = h / ch;
	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;
	if ((m.map.soften ?? 0) > 0 || m.image) {
		// a softened map (1.10) is the reference rasteriser's: the blur wraps and is the same everywhere; so is a picture (1.12), its pixels as core reads them
		putRaster(ctx, rasterizeMap(t, m, w, h));
		return { canvas, sx, sy };
	}
	for (let oy = -1; oy <= 1; oy++) {
		for (let ox = -1; ox <= 1; ox++) {
			ctx.setTransform(sx, 0, 0, sy, ox * w, oy * h);
			drawDoc(ctx, m.doc, m.tokens, { pose: m.pose });
		}
	}
	return { canvas, sx, sy };
}

/** A core raster (premultiplied) into a canvas. */
function putRaster(ctx: CanvasRenderingContext2D, r: Raster) {
	const img = ctx.createImageData(r.width, r.height);
	for (let i = 0; i < r.data.length; i += 4) {
		const a = r.data[i + 3];
		const k = a > 0 ? 255 / a : 0;
		img.data[i] = r.data[i] * k;
		img.data[i + 1] = r.data[i + 1] * k;
		img.data[i + 2] = r.data[i + 2] * k;
		img.data[i + 3] = a;
	}
	ctx.putImageData(img, 0, 0);
}

/** the widest a relief's normal map is rendered: it is worked out in JS, a pixel at a time */
const NORMAL_PX = 512;

/** The relief (1.10) as a normal map: the height map's values, softened, differentiated; or (1.12) the `normal` map as given. Null without either. */
export function renderNormalCanvas(t: Texture, res: ResolvedTexture): HTMLCanvasElement | null {
	if (res.maps.normal) return renderMapCanvas(t, res, "normal")?.canvas ?? null;
	const m = res.maps.height;
	const relief = t.relief ?? 0;
	if (!m || !relief) return null;
	const [cw, ch] = t.cell;
	const w = Math.min(NORMAL_PX, pow2(cw * MAP_PX));
	const h = Math.min(NORMAL_PX, pow2(ch * MAP_PX));
	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;
	putRaster(ctx, normalRaster(mapValues(t, m, w, h), w, h, t.cell, relief));
	return canvas;
}

/** Every texture of a document, resolved and rendered. `rel` is the document's project path. */
export async function loadPatterns(doc: Doc | Doc3, rel: string): Promise<Map<string, TexturePattern>> {
	const out = new Map<string, TexturePattern>();
	const root = project.root.value;
	if (root === null || !doc.textures?.length) return out;
	const dir = dirname(rel);
	const read = (r: string) => shell.readFile(root, joinRel(dir, r));
	// 1.12: a picture's bytes, through the shell's image url (a data url, or the server's)
	const bytes = async (r: string) => {
		const url = await shell.readImage(root, joinRel(dir, r));
		if (!url) return null;
		const got = await fetch(url);
		return got.ok ? new Uint8Array(await got.arrayBuffer()) : null;
	};
	const resolved = await resolveTextures(doc, read, (text) => parseDoc(text).doc, bytes);
	for (const [name, res] of resolved) out.set(name, lazyPattern(res));
	return out;
}

/**
 * A texture's pattern, its canvases rendered the first time something
 * draws them: a file may carry thousands of textures (a wardrobe) and
 * wear a few, and every map rendered up front is 256 KB or more of
 * canvas apiece, enough of them to have WebKit kill the page.
 */
function lazyPattern(res: ResolvedTexture): TexturePattern {
	const t = res.texture;
	const m = res.maps.color;
	// the sizes renderMapCanvas will use, known without rendering
	const [w, h] = canvasSize(t, m);
	const sx = m ? w / t.cell[0] : MAP_PX;
	const sy = m ? h / t.cell[1] : MAP_PX;
	let canvas: HTMLCanvasElement | null | undefined;
	let normal: HTMLCanvasElement | null | undefined;
	return {
		texture: t,
		resolved: res,
		get canvas() {
			if (canvas === undefined) canvas = renderMapCanvas(t, res)?.canvas ?? null;
			return canvas;
		},
		get normal() {
			if (normal === undefined) normal = renderNormalCanvas(t, res);
			return normal;
		},
		sx,
		sy,
		mode: m?.map.mode,
		rev: ++revCounter,
	};
}

/** The unresolved refs across a set of patterns, for the issues list. */
export function unresolvedOf(patterns: Map<string, TexturePattern>): string[] {
	return [...patterns.values()].flatMap((p) => p.resolved.unresolved);
}
