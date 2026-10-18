// fart render and fart check-clip: pictures and numbers of motion, the
// two ways an agent can see what a clip does without a window.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { deflateSync } from "node:zlib";
import { parseDoc } from "./parse.ts";
import { resolvePalettes } from "./palette.ts";
import type { Doc, Doc3, Token, Vec3 } from "./types.ts";
import { VIEWS } from "./project.ts";
import { toPng } from "./png.ts";
import type { Raster } from "./textures.ts";
import { clipOf, clipTimes, durationOf } from "./motion.ts";
import { renderClip, renderClipFrames, renderStates, type RenderOptions } from "./render.ts";
import { checkClip, formatClipReport, type CheckClipOptions } from "./clipcheck.ts";

const ZLIB = { deflate: (raw: Uint8Array) => deflateSync(raw, { level: 9 }) };

export const RENDER_USAGE = `fart render <file> [--clip name] [--layout strip|onion] [--frames n | --keys | --at t] [-o out.png]
         [--view name|x,y,z(deg)] [--size px] [--cols n] [--track part/anchor]... [--facing right|left|up|down]
         [--bones] [--labels] [--no-onion] [--no-trails] [--no-axes] [--plain]
         [--state name]... (no --clip: every state side by side) [--frames-dir dir] [--mp4 out.mp4 --fps n]
         a clip as a strip of frames in one world box: the frame before as a blue ghost, the chains' ends' paths with arrows,
         an axis gizmo (+x, +y down, R+ clockwise; 3D: the axes and the model's front, −z); --frames-dir: one PNG a frame;
         --mp4: a video through ffmpeg (for people: an agent reads the strip)`;

export const CHECK_CLIP_USAGE = `fart check-clip <file> [--clip name]... [--fps n] [--tolerance f] [--contact part/anchor]... [--ground y]
         [--facing right|left] [--json]
         every clip (or those named) sampled: limbs that change length, turns that tween the short way, snaps,
         knees that fold backwards, a loop that pops at its seam, feet that slide while down and which way it travels;
         exit 1 on an error`;

async function load(file: string): Promise<{ doc: Doc | Doc3; tokens: Token[] }> {
	const text = await readFile(file, "utf8");
	const { doc, report } = parseDoc(text);
	if (!doc || !report.ok) {
		const lines = report.errors.slice(0, 8).map((e) => `  error ${e.code} ${e.path || "/"}: ${e.message}`);
		throw new Error(`${file} is not valid\n${lines.join("\n")}`);
	}
	const resolved = await resolvePalettes(doc, async (rel) => {
		try {
			return await readFile(resolve(dirname(file), rel), "utf8");
		} catch {
			return null;
		}
	});
	return { doc: doc as Doc | Doc3, tokens: resolved.tokens };
}

function parseView(v: string): string | Vec3 {
	if (v in VIEWS) return v;
	const n = v.split(",").map(Number);
	if (n.length !== 3 || n.some((x) => !Number.isFinite(x))) throw new Error(`--view: a name (${Object.keys(VIEWS).join(", ")}) or x,y,z in degrees, got "${v}"`);
	return n.map((d) => (d * Math.PI) / 180) as Vec3;
}

/** Even sides, for a video encoder: pad with the last row and column. */
function even(r: Raster): Raster {
	const w = r.width + (r.width % 2);
	const h = r.height + (r.height % 2);
	if (w === r.width && h === r.height) return r;
	const data = new Uint8ClampedArray(w * h * 4);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const sx = Math.min(x, r.width - 1);
			const sy = Math.min(y, r.height - 1);
			data.set(r.data.subarray((sy * r.width + sx) * 4, (sy * r.width + sx) * 4 + 4), (y * w + x) * 4);
		}
	return { width: w, height: h, data };
}

async function mp4(frames: Raster[], fps: number, out: string): Promise<void> {
	if (spawnSync("ffmpeg", ["-version"]).error) throw new Error("--mp4 needs ffmpeg on the PATH (brew install ffmpeg); --frames-dir writes the frames as PNGs");
	await new Promise<void>((done, fail) => {
		const p = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-i", "-", "-pix_fmt", "yuv420p", "-vcodec", "libx264", out], { stdio: ["pipe", "inherit", "inherit"] });
		p.on("error", fail);
		p.on("close", (code) => (code === 0 ? done() : fail(new Error(`ffmpeg exited ${code}`))));
		for (const f of frames) p.stdin.write(toPng(even(f), ZLIB));
		p.stdin.end();
	});
}

export async function renderCmd(args: string[]): Promise<number> {
	const files: string[] = [];
	const opts: RenderOptions = {};
	const tracks: string[] = [];
	const states: string[] = [];
	let clipName: string | undefined;
	let layout: "strip" | "onion" = "strip";
	let frames: number | undefined;
	let keys = false;
	let at: number | undefined;
	let out: string | undefined;
	let framesDir: string | undefined;
	let video: string | undefined;
	let fps = 24;
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		const next = () => {
			if (i + 1 >= args.length) throw new Error(`${a} needs a value`);
			return args[++i];
		};
		const num = () => {
			const v = Number(next());
			if (!Number.isFinite(v)) throw new Error(`${a} needs a number`);
			return v;
		};
		if (a === "--clip") clipName = next();
		else if (a === "--state") states.push(next());
		else if (a === "--layout") {
			const v = next();
			if (v !== "strip" && v !== "onion") throw new Error(`--layout is strip or onion`);
			layout = v;
		} else if (a === "--onion") layout = "onion";
		else if (a === "--frames") frames = Math.max(1, Math.round(num()));
		else if (a === "--keys") keys = true;
		else if (a === "--at") at = num();
		else if (a === "-o" || a === "--out") out = next();
		else if (a === "--view") opts.view = parseView(next());
		else if (a === "--size") opts.size = Math.max(32, num());
		else if (a === "--cols") opts.cols = Math.max(1, Math.round(num()));
		else if (a === "--track") tracks.push(next());
		else if (a === "--facing") {
			const v = next();
			if (v !== "right" && v !== "left" && v !== "up" && v !== "down") throw new Error("--facing is right, left, up or down");
			opts.facing = v;
		} else if (a === "--bones") opts.bones = true;
		else if (a === "--labels") opts.bones = opts.labels = true;
		else if (a === "--no-onion") opts.onion = false;
		else if (a === "--no-trails") opts.trails = false;
		else if (a === "--no-axes") opts.axes = false;
		else if (a === "--plain") opts.onion = opts.trails = opts.axes = false;
		else if (a === "--frames-dir") framesDir = next();
		else if (a === "--mp4") video = next();
		else if (a === "--fps") fps = Math.max(1, num());
		else if (a.startsWith("-")) throw new Error(`unknown flag ${a}`);
		else files.push(a);
	}
	if (files.length !== 1) throw new Error(`render takes one file\nusage: ${RENDER_USAGE}`);
	const file = files[0];
	if (tracks.length) opts.tracks = tracks;
	const { doc, tokens } = await load(file);
	const stem = basename(file).replace(/\.fart$/, "");

	if (!clipName) {
		if (framesDir || video) throw new Error("--frames-dir and --mp4 take a --clip");
		const r = renderStates(doc, tokens, states, opts);
		const dest = out ?? `${stem}-states.png`;
		await writeFile(dest, toPng(r, ZLIB));
		const names = states.length ? states : (doc.states ?? []).map((s) => s.name);
		console.log(`wrote ${dest}  (${r.width}×${r.height}, ${names.length ? names.join(", ") : "rest"})`);
		return 0;
	}
	const clip = clipOf(doc, clipName);
	if (!clip) throw new Error(`no clip "${clipName}" (clips: ${(doc.clips ?? []).map((c) => c.name).join(", ") || "none"})`);
	const dur = durationOf(doc, clip);

	if (framesDir || video) {
		const n = Math.max(1, Math.round(dur * fps) + (clip.loop ? 0 : 1));
		const times = frames ? clipTimes(doc, clip, frames) : Array.from({ length: n }, (_, i) => Math.round((i / fps) * 1e4) / 1e4);
		const rasters = renderClipFrames(doc, tokens, clipName, times, opts);
		if (framesDir) {
			await mkdir(framesDir, { recursive: true });
			for (let i = 0; i < rasters.length; i++) await writeFile(join(framesDir, `${stem}-${clipName}-${String(i).padStart(3, "0")}.png`), toPng(rasters[i], ZLIB));
			console.log(`wrote ${rasters.length} frames to ${framesDir}  (${rasters[0].width}×${rasters[0].height}, t 0..${times[times.length - 1].toFixed(2)})`);
		}
		if (video) {
			await mp4(rasters, fps, video);
			console.log(`wrote ${video}  (${rasters.length} frames at ${fps} fps)`);
		}
		return 0;
	}

	let times: number[];
	if (at !== undefined) times = [at];
	else if (keys) times = [...new Set(clip.keys.map((k) => k.t))].filter((t, i, all) => !(clip.loop && i === all.length - 1 && all.length > 1));
	else times = clipTimes(doc, clip, frames ?? (layout === "onion" ? 10 : 8));
	const r = renderClip(doc, tokens, clipName, times, layout, opts);
	const dest = out ?? `${stem}-${clipName}${layout === "onion" ? "-onion" : ""}.png`;
	await writeFile(dest, toPng(r.raster, ZLIB));
	console.log(`wrote ${dest}  (${r.raster.width}×${r.raster.height}, ${times.length} frame${times.length === 1 ? "" : "s"} at t=${times.map((t) => t.toFixed(2)).join(" ")}${r.tracks.length ? `; trails: ${r.tracks.join(", ")}` : ""})`);
	return 0;
}

export async function checkClipCmd(args: string[]): Promise<number> {
	const files: string[] = [];
	const clips: string[] = [];
	const opts: CheckClipOptions = {};
	const contacts: string[] = [];
	let json = false;
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		const next = () => {
			if (i + 1 >= args.length) throw new Error(`${a} needs a value`);
			return args[++i];
		};
		const num = () => {
			const v = Number(next());
			if (!Number.isFinite(v)) throw new Error(`${a} needs a number`);
			return v;
		};
		if (a === "--clip") clips.push(next());
		else if (a === "--fps") opts.fps = num();
		else if (a === "--tolerance") opts.tolerance = num();
		else if (a === "--contact") contacts.push(next());
		else if (a === "--ground") opts.ground = num();
		else if (a === "--contact-tol") opts.contactTol = num();
		else if (a === "--facing") {
			const v = next();
			if (v !== "right" && v !== "left") throw new Error("--facing is right or left");
			opts.facing = v;
		} else if (a === "--json") json = true;
		else if (a.startsWith("-")) throw new Error(`unknown flag ${a}`);
		else files.push(a);
	}
	if (files.length !== 1) throw new Error(`check-clip takes one file\nusage: ${CHECK_CLIP_USAGE}`);
	if (contacts.length) opts.contacts = contacts;
	const { doc } = await load(files[0]);
	const names = clips.length ? clips : (doc.clips ?? []).map((c) => c.name);
	if (!names.length) {
		console.log(`${files[0]}: no clips`);
		return 0;
	}
	const reports = names.map((n) => checkClip(doc, n, opts));
	if (json) console.log(JSON.stringify(reports, null, 2));
	else {
		console.log(files[0]);
		for (const r of reports) console.log(formatClipReport(r));
	}
	return reports.some((r) => r.findings.some((f) => f.level === "error")) ? 1 : 0;
}
