// PNG with no dependencies. The writer: stored (uncompressed) deflate
// blocks inside a zlib stream, one IDAT. Big for what it holds, right
// everywhere; a build that cares pipes it through an optimiser. The
// reader (1.12, image maps): any PNG to 8-bit RGBA, with its own inflate,
// so the browser and a script read a picture the same way.

import type { Raster } from "./textures.ts";

const CRC = new Uint32Array(256).map((_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});
function crc32(bytes: Uint8Array): number {
	let c = 0xffffffff;
	for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}
function adler32(bytes: Uint8Array): number {
	let a = 1;
	let b = 0;
	for (const x of bytes) {
		a = (a + x) % 65521;
		b = (b + a) % 65521;
	}
	return ((b << 16) | a) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	const dv = new DataView(out.buffer);
	dv.setUint32(0, data.length);
	out.set([type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)], 4);
	out.set(data, 8);
	dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
	return out;
}

/** The raster as PNG bytes (RGBA, 8 bits). `deflate`, a zlib compressor (node's `deflateSync`), makes it small. */
export function toPng(r: Raster, opts: { deflate?: (raw: Uint8Array) => Uint8Array } = {}): Uint8Array {
	const stride = r.width * 4 + 1;
	const raw = new Uint8Array(stride * r.height);
	for (let y = 0; y < r.height; y++) {
		raw[y * stride] = 0; // filter: none
		raw.set(r.data.subarray(y * r.width * 4, (y + 1) * r.width * 4), y * stride + 1);
	}
	const z = opts.deflate ? opts.deflate(raw) : stored(raw);
	const ihdr = new Uint8Array(13);
	const dv = new DataView(ihdr.buffer);
	dv.setUint32(0, r.width);
	dv.setUint32(4, r.height);
	ihdr.set([8, 6, 0, 0, 0], 8);
	const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
	return concat([sig, chunk("IHDR", ihdr), chunk("IDAT", z), chunk("IEND", new Uint8Array(0))]);
}

/** A zlib stream of stored blocks: header, blocks of up to 65535 bytes, adler. */
function stored(raw: Uint8Array): Uint8Array {
	const blocks = Math.max(1, Math.ceil(raw.length / 65535));
	const z = new Uint8Array(2 + raw.length + blocks * 5 + 4);
	z[0] = 0x78;
	z[1] = 0x01;
	let o = 2;
	for (let i = 0; i < blocks; i++) {
		const start = i * 65535;
		const len = Math.min(65535, raw.length - start);
		z[o++] = i === blocks - 1 ? 1 : 0;
		z[o++] = len & 0xff;
		z[o++] = len >> 8;
		z[o++] = ~len & 0xff;
		z[o++] = (~len >> 8) & 0xff;
		z.set(raw.subarray(start, start + len), o);
		o += len;
	}
	new DataView(z.buffer).setUint32(o, adler32(raw));
	return z;
}

// ------------------------------------------------------------- reading

/** What is wrong with bytes that are not a PNG this reader can read. */
export class PngError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PngError";
	}
}

/** Is this a PNG, by its signature? */
export function isPng(bytes: Uint8Array): boolean {
	const sig = [137, 80, 78, 71, 13, 10, 26, 10];
	return bytes.length >= 8 && sig.every((b, i) => bytes[i] === b);
}

/** The pixel size a PNG says it is, without decoding it. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
	if (!isPng(bytes) || bytes.length < 24) return null;
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

/**
 * A PNG's pixels as straight (not premultiplied) 8-bit RGBA, whatever its
 * colour type and depth: grey widens to RGB, a palette is looked up (with
 * its tRNS alpha), 16 bits keep their high byte, interlacing is undone,
 * and a picture without alpha is opaque (a tRNS colour key aside).
 */
export function fromPng(bytes: Uint8Array): Raster {
	if (!isPng(bytes)) throw new PngError("not a PNG");
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let width = 0;
	let height = 0;
	let depth = 0;
	let type = 0;
	let interlace = 0;
	let plte: Uint8Array | null = null;
	let trns: Uint8Array | null = null;
	const idat: Uint8Array[] = [];
	for (let at = 8; at + 8 <= bytes.length; ) {
		const len = dv.getUint32(at);
		const name = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
		const data = bytes.subarray(at + 8, at + 8 + len);
		if (name === "IHDR") {
			width = dv.getUint32(at + 8);
			height = dv.getUint32(at + 12);
			depth = bytes[at + 16];
			type = bytes[at + 17];
			interlace = bytes[at + 20];
		} else if (name === "PLTE") plte = data;
		else if (name === "tRNS") trns = data;
		else if (name === "IDAT") idat.push(data);
		else if (name === "IEND") break;
		at += 12 + len;
	}
	const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type];
	if (!width || !height || !channels || ![1, 2, 4, 8, 16].includes(depth)) throw new PngError(`an unreadable header (colour type ${type}, depth ${depth})`);
	if (type === 3 && !plte) throw new PngError("a palette PNG without its palette");
	const z = concat(idat);
	if (z.length < 2) throw new PngError("no image data");
	const raw = inflate(z.subarray(2));
	const bpp = Math.max(1, (channels * depth) >> 3); // bytes per pixel, for the filters
	const out = new Uint8ClampedArray(width * height * 4);
	// one pass of the picture (the whole of it, or one of Adam7's seven), unfiltered and written into out
	let pos = 0;
	const pass = (x0: number, y0: number, dx: number, dy: number) => {
		const pw = Math.ceil((width - x0) / dx);
		const ph = Math.ceil((height - y0) / dy);
		if (pw <= 0 || ph <= 0) return;
		const stride = Math.ceil((pw * channels * depth) / 8);
		let prev = new Uint8Array(stride);
		let line = new Uint8Array(stride);
		for (let y = 0; y < ph; y++) {
			if (pos + 1 + stride > raw.length) throw new PngError("image data ends early");
			const filter = raw[pos++];
			for (let i = 0; i < stride; i++) {
				const x = raw[pos + i];
				const a = i >= bpp ? line[i - bpp] : 0;
				const b = prev[i];
				const c = i >= bpp ? prev[i - bpp] : 0;
				let v: number;
				if (filter === 0) v = x;
				else if (filter === 1) v = x + a;
				else if (filter === 2) v = x + b;
				else if (filter === 3) v = x + ((a + b) >> 1);
				else if (filter === 4) {
					const p = a + b - c;
					const pa = Math.abs(p - a);
					const pb = Math.abs(p - b);
					const pc = Math.abs(p - c);
					v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
				} else throw new PngError(`an unknown filter ${filter}`);
				line[i] = v & 0xff;
			}
			pos += stride;
			for (let x = 0; x < pw; x++) writePixel(out, ((y0 + y * dy) * width + x0 + x * dx) * 4, line, x, channels, depth, type, plte, trns);
			[prev, line] = [line, prev];
		}
	};
	if (interlace) for (const [x0, y0, dx, dy] of [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]) pass(x0, y0, dx, dy);
	else pass(0, 0, 1, 1);
	return { width, height, data: out };
}

function writePixel(out: Uint8ClampedArray, o: number, line: Uint8Array, x: number, channels: number, depth: number, type: number, plte: Uint8Array | null, trns: Uint8Array | null) {
	// sample k of pixel x, at the file's depth, and as 8 bits
	const raw = (k: number): number => {
		if (depth === 16) return (line[(x * channels + k) * 2] << 8) | line[(x * channels + k) * 2 + 1];
		if (depth === 8) return line[x * channels + k];
		const bit = (x * channels + k) * depth;
		return (line[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
	};
	const to8 = (v: number) => (depth === 16 ? v >> 8 : depth === 8 ? v : Math.round((v * 255) / ((1 << depth) - 1)));
	const key = (k: number) => (trns && trns.length >= 2 * (k + 1) ? (trns[2 * k] << 8) | trns[2 * k + 1] : -1);
	if (type === 3) {
		const i = raw(0);
		out[o] = plte![i * 3];
		out[o + 1] = plte![i * 3 + 1];
		out[o + 2] = plte![i * 3 + 2];
		out[o + 3] = trns && i < trns.length ? trns[i] : 255;
	} else if (type === 0 || type === 4) {
		const g = raw(0);
		out[o] = out[o + 1] = out[o + 2] = to8(g);
		out[o + 3] = type === 4 ? to8(raw(1)) : g === key(0) ? 0 : 255;
	} else {
		const r = raw(0);
		const g = raw(1);
		const b = raw(2);
		out[o] = to8(r);
		out[o + 1] = to8(g);
		out[o + 2] = to8(b);
		out[o + 3] = type === 6 ? to8(raw(3)) : r === key(0) && g === key(1) && b === key(2) ? 0 : 255;
	}
}

function concat(parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}

// inflate (RFC 1951): stored, fixed and dynamic Huffman blocks, canonical codes decoded by count
const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

interface Huff {
	counts: Uint16Array;
	symbols: Uint16Array;
}
function huff(lengths: ArrayLike<number>): Huff {
	const counts = new Uint16Array(16);
	for (let i = 0; i < lengths.length; i++) counts[lengths[i]]++;
	counts[0] = 0;
	const offs = new Uint16Array(16);
	for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + counts[i - 1];
	const symbols = new Uint16Array(lengths.length);
	for (let i = 0; i < lengths.length; i++) if (lengths[i]) symbols[offs[lengths[i]]++] = i;
	return { counts, symbols };
}

/** A raw deflate stream, inflated. */
export function inflate(src: Uint8Array): Uint8Array {
	let out = new Uint8Array(Math.max(1024, src.length * 4));
	let n = 0;
	const room = (k: number) => {
		if (n + k <= out.length) return;
		const grown = new Uint8Array(Math.max(out.length * 2, n + k));
		grown.set(out.subarray(0, n));
		out = grown;
	};
	let pos = 0;
	let bitBuf = 0;
	let bitCnt = 0;
	const bits = (k: number): number => {
		while (bitCnt < k) {
			if (pos >= src.length) throw new PngError("compressed data ends early");
			bitBuf |= src[pos++] << bitCnt;
			bitCnt += 8;
		}
		const v = bitBuf & ((1 << k) - 1);
		bitBuf >>>= k;
		bitCnt -= k;
		return v;
	};
	const decode = (h: Huff): number => {
		let code = 0;
		let first = 0;
		let index = 0;
		for (let len = 1; len < 16; len++) {
			code |= bits(1);
			const count = h.counts[len];
			if (code - count < first) return h.symbols[index + (code - first)];
			index += count;
			first += count;
			first <<= 1;
			code <<= 1;
		}
		throw new PngError("a bad Huffman code");
	};
	const fixedLit = huff(Array.from({ length: 288 }, (_, i) => (i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8)));
	const fixedDist = huff(new Array(30).fill(5));
	for (let last = 0; !last; ) {
		last = bits(1);
		const kind = bits(2);
		if (kind === 0) {
			bitBuf = 0;
			bitCnt = 0;
			if (pos + 4 > src.length) throw new PngError("compressed data ends early");
			const len = src[pos] | (src[pos + 1] << 8);
			pos += 4;
			if (pos + len > src.length) throw new PngError("compressed data ends early");
			room(len);
			out.set(src.subarray(pos, pos + len), n);
			n += len;
			pos += len;
			continue;
		}
		let lit: Huff;
		let dist: Huff;
		if (kind === 1) {
			lit = fixedLit;
			dist = fixedDist;
		} else if (kind === 2) {
			const nlen = bits(5) + 257;
			const ndist = bits(5) + 1;
			const ncode = bits(4) + 4;
			const cl = new Uint8Array(19);
			for (let i = 0; i < ncode; i++) cl[CL_ORDER[i]] = bits(3);
			const clh = huff(cl);
			const lengths = new Uint8Array(nlen + ndist);
			for (let i = 0; i < nlen + ndist; ) {
				const sym = decode(clh);
				if (sym < 16) lengths[i++] = sym;
				else {
					let rep = 0;
					let val = 0;
					if (sym === 16) {
						if (!i) throw new PngError("a repeat with nothing before it");
						val = lengths[i - 1];
						rep = 3 + bits(2);
					} else if (sym === 17) rep = 3 + bits(3);
					else rep = 11 + bits(7);
					if (i + rep > nlen + ndist) throw new PngError("too many code lengths");
					lengths.fill(val, i, i + rep);
					i += rep;
				}
			}
			lit = huff(lengths.subarray(0, nlen));
			dist = huff(lengths.subarray(nlen));
		} else throw new PngError("a bad block type");
		for (;;) {
			const sym = decode(lit);
			if (sym < 256) {
				room(1);
				out[n++] = sym;
			} else if (sym === 256) break;
			else {
				const li = sym - 257;
				if (li >= 29) throw new PngError("a bad length");
				const len = LEN_BASE[li] + bits(LEN_EXTRA[li]);
				const di = decode(dist);
				if (di >= 30) throw new PngError("a bad distance");
				const d = DIST_BASE[di] + bits(DIST_EXTRA[di]);
				if (d > n) throw new PngError("a distance past the start");
				room(len);
				for (let k = 0; k < len; k++, n++) out[n] = out[n - d];
			}
		}
	}
	return out.subarray(0, n);
}
