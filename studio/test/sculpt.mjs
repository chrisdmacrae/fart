// Sculpt mode in the model screen, end to end, in the served studio with
// a headless browser: entering it, a Draw stroke (one undo step), ⌘ to
// invert, ⇧ to smooth, the brushes' letters, F to size the brush,
// symmetry across x, the mask (painted, holding the surface, inverted,
// cleared), Grab, a filter, Subdivide, a drag off the mesh orbiting, the
// help in context, and leaving it.
// `node studio/test/sculpt.mjs [dir for screenshots]` (needs the app built:
// npx vite build in studio/frontend, go build -o bin/studio . in studio).
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ballMesh, subdivide, stringifyDoc } from "../../packages/core/src/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const bin = [path.join(repo, "studio/bin/studio"), path.join(repo, "studio/bin/Uranus")].filter((b) => fs.existsSync(b)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
if (!bin) {
	console.error("no studio binary: go build -o bin/studio . in studio/");
	process.exit(2);
}
const shots = process.argv[2] || "";
if (shots) fs.mkdirSync(shots, { recursive: true });
let fails = 0;
const check = (name, ok, extra = "") => {
	console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " · " + extra : ""}`);
	if (!ok) fails++;
};

// ------------------------------------------------------------- the project
const P = fs.mkdtempSync(path.join(os.tmpdir(), "uranus-sculpt-"));
const palette = [{ name: "clay", rgb: [190, 170, 150, 255] }];
const ball = subdivide(ballMesh({ kind: "ball", color: "clay", at: [0, 0, 0], r: 5 }, 10, 16), 1);
const shape = { kind: "mesh", color: "clay", points: ball.points, faces: ball.faces };
const doc = { version: 1, space: "3d", name: "head", palette, parts: [{ name: "head", pivot: [0, 0, 0], shapes: [shape] }], states: [{ name: "rest", parts: [{ part: "head", offset: [0, 0, 0] }] }] };
fs.writeFileSync(path.join(P, "head.fart"), stringifyDoc(doc));

const server = spawn(bin, ["--serve", P], { stdio: "ignore" });
for (let i = 0; i < 80; i++) {
	try {
		await fetch("http://127.0.0.1:4747/");
		break;
	} catch {
		await new Promise((r) => setTimeout(r, 250));
	}
}
const browser = await chromium.launch();
try {
	const page = await (await browser.newContext({ viewport: { width: 1400, height: 860 } })).newPage();
	page.on("pageerror", (e) => {
		console.log("pageerror:", e.message);
		fails++;
	});
	await page.goto("http://localhost:4747/");
	await page.waitForFunction(() => globalThis.fastart?.project.files.value.length > 0);
	await page.evaluate(() => fastart.openDoc("head.fart"));
	await page.waitForFunction(() => fastart.project.screen.value === "model" && fastart.md.path.value === "head.fart");
	await page.waitForTimeout(600);
	const shot = (n) => (shots ? page.screenshot({ path: path.join(shots, n + ".png") }) : Promise.resolve());
	const wait = (ms = 160) => page.waitForTimeout(ms);
	const ev = (fn, arg) => page.evaluate(fn, arg);
	const box0 = await page.locator(".canvas-wrap canvas").last().boundingBox();
	const pts = () => ev(() => fastart.md.doc.value.parts[0].shapes[0].points);
	/** a point of the part's space, where it is on the page */
	const onPage = (p) =>
		ev(
			({ p, box }) => {
				const fp = fastart.model.framePartOf(0);
				const F = fp.F;
				const v = [F[0] * p[0] + F[1] * p[1] + F[2] * p[2] + F[9], F[3] * p[0] + F[4] * p[1] + F[5] * p[2] + F[10]];
				const z = fastart.view.zoom.value;
				const pan = fastart.view.pan.value;
				const [W, H] = fastart.view.size.value;
				return [box.x + (v[0] - pan[0]) * z + W / 2, box.y + (v[1] - pan[1]) * z + H / 2];
			},
			{ p, box: box0 },
		);
	const radiusOf = (p) => Math.hypot(p[0], p[1], p[2]);
	const moved = (a, b) => a.filter((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1], p[2] - b[i][2]) > 1e-3).length;
	const stroke = async (from, to, opts = {}) => {
		const a = await onPage(from);
		const b = await onPage(to);
		if (opts.mods) for (const m of opts.mods) await page.keyboard.down(m);
		await page.mouse.move(a[0], a[1]);
		await page.mouse.down();
		await page.mouse.move(b[0], b[1], { steps: opts.steps ?? 14 });
		await page.mouse.up();
		if (opts.mods) for (const m of opts.mods) await page.keyboard.up(m);
		await wait();
	};
	const insp = page.locator(".inspector");

	await ev(() => fastart.model.setView("front"));
	await page.keyboard.press("Shift+1");
	await wait(300);
	await ev(() => {
		fastart.md.sel.value = { part: 0, shape: 0 };
		fastart.md.curPart.value = 0;
	});
	await wait();
	// a known brush to begin with, whatever this browser remembered
	await ev(() => fastart.sculpting.setSculpt({ brush: "draw", radius: 60, mirror: [true, false, false], radial: 1, method: "space", spacing: 0.1, stabilize: 0, frontOnly: true, topology: false, strength: {}, falloff: {}, autoSmooth: {} }));

	// ------------------------------------------------------------- 1. into sculpt mode
	await page.keyboard.press("Shift+Tab");
	await wait();
	check("⇧Tab turns sculpt mode on", await ev(() => fastart.md.sculpting.value));
	check("the inspector has a Sculpt section", (await insp.locator(".ur-insp-title", { hasText: "Sculpt" }).count()) === 1);
	check("and no Mesh section while sculpting", (await insp.locator(".ur-insp-title", { hasText: /^Mesh$/ }).count()) === 0);
	check("help is about sculpting", await ev(() => fastart.help.contextNow().key === "3d.sculpt"));
	check("every help topic is covered", (await ev(() => fastart.help.uncovered().join(","))) === "");
	check("the status bar says so", /Sculpt · Draw/.test(await page.locator(".ur-statusbar, .statusbar").first().innerText().catch(() => "")) || (await ev(() => document.body.innerText.includes("Sculpt · Draw"))));

	// ------------------------------------------------------------- 2. a Draw stroke, one undo step
	const p0 = await pts();
	await stroke([-2, -1, -5], [2, 1, -5]);
	const p1 = await pts();
	const out = p1.filter((p, i) => radiusOf(p) > radiusOf(p0[i]) + 1e-3).length;
	check("a Draw stroke raises the surface under it", out > 3, `${out} points out`);
	check("and leaves the back alone", p1.every((p, i) => p0[i][2] < 1 || Math.hypot(p[0] - p0[i][0], p[1] - p0[i][1], p[2] - p0[i][2]) < 1e-9));
	check("symmetric across x", (() => {
		// each raised point's mirror is raised alike
		let worst = 0;
		p1.forEach((p, i) => {
			const j = p0.findIndex((q) => Math.abs(q[0] + p0[i][0]) < 1e-6 && Math.abs(q[1] - p0[i][1]) < 1e-6 && Math.abs(q[2] - p0[i][2]) < 1e-6);
			if (j >= 0) worst = Math.max(worst, Math.abs(radiusOf(p) - radiusOf(p1[j])));
		});
		return worst < 2e-3;
	})());
	await shot("1-draw");
	await page.keyboard.press("Control+z");
	await wait();
	check("one undo takes the whole stroke back", moved(await pts(), p0) === 0);

	// ------------------------------------------------------------- 3. ⌘ inverts, ⇧ smooths
	await stroke([-2, -1, -5], [2, 1, -5], { mods: ["Control"] });
	const p2 = await pts();
	const inward = p2.filter((p, i) => radiusOf(p) < radiusOf(p0[i]) - 1e-3).length;
	check("⌘ pushes in", inward > 3, `${inward} points in`);
	await page.keyboard.press("Control+z");
	await wait();
	await stroke([-2, -1, -5], [2, 1, -5]);
	const bumped = await pts();
	await stroke([-2, -1, -5], [2, 1, -5], { mods: ["Shift"] });
	const smoothed = await pts();
	const peak = (l) => Math.max(...l.map(radiusOf));
	check("⇧ smooths the bump down", peak(smoothed) < peak(bumped) - 1e-4, `${peak(bumped)} → ${peak(smoothed)}`);
	await page.keyboard.press("Control+z");
	await page.keyboard.press("Control+z");
	await wait();
	check("two undos back to the ball", moved(await pts(), p0) === 0);

	// ------------------------------------------------------------- 4. letters and F
	const mid = await onPage([0, 0, -5]);
	await page.mouse.move(mid[0], mid[1]);
	await page.keyboard.press("g");
	check("G picks Grab", await ev(() => fastart.sculpting.sculpt.value.brush === "grab"));
	await page.keyboard.press("s");
	check("S picks Smooth", await ev(() => fastart.sculpting.sculpt.value.brush === "smooth"));
	await page.keyboard.press("x");
	check("X picks Draw, and X does not delete", await ev(() => fastart.sculpting.sculpt.value.brush === "draw" && !!fastart.md.sel.value && fastart.md.doc.value.parts[0].shapes.length === 1));
	await page.keyboard.press("f");
	await page.mouse.move(mid[0] + 30, mid[1], { steps: 4 });
	await page.mouse.down();
	await page.mouse.up();
	await wait();
	const r1 = await ev(() => fastart.sculpting.sculpt.value.radius);
	check("F then the pointer sizes the brush", Math.abs(r1 - 90) <= 3, `${r1}px`);
	await page.keyboard.press("f");
	await page.mouse.move(mid[0] + 100, mid[1], { steps: 4 });
	await page.keyboard.press("Escape");
	check("Esc puts the radius back", (await ev(() => fastart.sculpting.sculpt.value.radius)) === r1);
	check("and stays in sculpt mode", await ev(() => fastart.md.sculpting.value));
	check("no pending point moved", moved(await pts(), p0) === 0);
	await ev(() => fastart.sculpting.setSculpt({ radius: 60 }));

	// ------------------------------------------------------------- 5. the mask
	await page.keyboard.press("m");
	await stroke([-0.5, -2, -5], [-0.5, 2, -5], { steps: 10 });
	const mask = await ev(() => Array.from(fastart.sculpting.maskOf({ part: 0, shape: 0 }) ?? []));
	const held = mask.filter((v) => v > 0.5).length;
	check("the Mask brush paints a mask", held > 2, `${held} held`);
	check("and moves nothing", moved(await pts(), p0) === 0);
	await shot("2-mask");
	await page.keyboard.press("x");
	await stroke([-2, 0, -5], [2, 0, -5]);
	const p3 = await pts();
	const heldMoved = p3.filter((p, i) => mask[i] > 0.99 && Math.hypot(p[0] - p0[i][0], p[1] - p0[i][1], p[2] - p0[i][2]) > 1e-3).length;
	check("a stroke leaves the masked points", heldMoved === 0, `${heldMoved} moved`);
	check("and moves the rest", moved(p3, p0) > 3);
	await page.keyboard.press("Control+z");
	await page.keyboard.press("Control+i");
	await wait();
	check("⌘I inverts the mask", await ev(() => (fastart.sculpting.maskOf({ part: 0, shape: 0 }) ?? []).filter((v) => v > 0.5).length) > held);
	await page.keyboard.press("Alt+m");
	await wait();
	check("⌥M clears it", await ev(() => fastart.sculpting.maskOf({ part: 0, shape: 0 }) === null));

	// ------------------------------------------------------------- 6. grab
	await page.keyboard.press("g");
	await stroke([0, 0, -5], [0, -2, -5], { steps: 8 });
	const p4 = await pts();
	const top = p0.reduce((b, p, i) => (p[2] < p0[b][2] ? i : b), 0);
	check("Grab drags what was under the brush", Math.abs(p4[top][1] - p0[top][1]) > 0.5, `moved ${(p4[top][1] - p0[top][1]).toFixed(3)} in y`);
	await page.keyboard.press("Control+z");
	await wait();

	// ------------------------------------------------------------- 7. filter and subdivide
	await ev(() => fastart.sculpting.setSculpt({ filter: "inflate", filterAmount: 0.5 }));
	await insp.locator("button", { hasText: "Apply" }).click();
	await wait();
	const p5 = await pts();
	check("the Inflate filter grows every point", p5.every((p, i) => radiusOf(p) > radiusOf(p0[i]) + 0.4));
	await page.keyboard.press("Control+z");
	await wait();
	const faces0 = await ev(() => fastart.md.doc.value.parts[0].shapes[0].faces.length);
	await insp.locator("button", { hasText: "Subdivide" }).click();
	await wait(300);
	const faces1 = await ev(() => fastart.md.doc.value.parts[0].shapes[0].faces.length);
	check("Subdivide makes four times the faces", faces1 === faces0 * 4, `${faces0} → ${faces1}`);
	await page.keyboard.press("x");
	await stroke([-2, -1, -5], [2, 1, -5]);
	check("and the finer mesh sculpts", (await ev(() => fastart.md.canUndo.value)) && moved((await pts()).slice(0, p0.length), p0) > 0);
	await shot("3-subdivided");
	await page.keyboard.press("Control+z");
	await page.keyboard.press("Control+z");
	await wait();
	check("undo takes Subdivide back", (await ev(() => fastart.md.doc.value.parts[0].shapes[0].faces.length)) === faces0);

	// ------------------------------------------------------------- 8. a press off the mesh: no orbit, a stroke once it gets there (a trackpad's click sculpts)
	const turn0 = await ev(() => fastart.md.turn.value.join(","));
	await page.mouse.move(box0.x + 40, box0.y + 40);
	await page.mouse.down();
	await page.mouse.move(box0.x + 140, box0.y + 60, { steps: 6 });
	await page.mouse.up();
	await wait();
	check("a drag off the mesh does not orbit", (await ev(() => fastart.md.turn.value.join(","))) === turn0);
	check("and sculpts nothing", moved(await pts(), p0) === 0);
	{
		const inside = await onPage([0, 0, -5]);
		// from the canvas's left edge, well off the ball, across onto it
		const left = [box0.x + 20, inside[1]];
		await page.mouse.move(left[0], left[1]);
		await page.mouse.down();
		await page.mouse.move(inside[0], inside[1], { steps: 20 });
		await page.mouse.up();
		await wait();
		check("a drag begun off the mesh sculpts once it reaches it", moved(await pts(), p0) > 3);
		check("as one undo step", await ev(() => fastart.md.canUndo.value));
		await page.keyboard.press("Control+z");
		await wait();
		check("which takes it all back", moved(await pts(), p0) === 0);
	}
	await page.keyboard.down("Alt");
	await page.mouse.move(box0.x + 40, box0.y + 40);
	await page.mouse.down();
	await page.mouse.move(box0.x + 140, box0.y + 60, { steps: 6 });
	await page.mouse.up();
	await page.keyboard.up("Alt");
	await wait();
	check("⌥-drag orbits", (await ev(() => fastart.md.turn.value.join(","))) !== turn0);
	check("and sculpts nothing", moved(await pts(), p0) === 0);
	await ev(() => fastart.model.setView("front"));
	await wait(200);
	// a mesh wound inside out (as imports often are) still takes a stroke, outward
	await ev(() => fastart.model.mutate((d) => (d.parts[0].shapes[0].faces = d.parts[0].shapes[0].faces.map((f) => [...f].reverse()))));
	await wait();
	await stroke([-2, -1, -5], [2, 1, -5]);
	const pIn = await pts();
	const outIn = pIn.filter((p, i) => radiusOf(p) > radiusOf(p0[i]) + 1e-3).length;
	const inIn = pIn.filter((p, i) => radiusOf(p) < radiusOf(p0[i]) - 1e-3).length;
	check("an inside-out mesh sculpts, outward", outIn > 3 && inIn === 0, `${outIn} out, ${inIn} in`);
	await page.keyboard.press("Control+z");
	await page.keyboard.press("Control+z");
	await wait();
	check("and undoes back to the ball", moved(await pts(), p0) === 0 && (await ev(() => JSON.stringify(fastart.md.doc.value.parts[0].shapes[0].faces[0]))) === JSON.stringify(shape.faces[0]));

	// ------------------------------------------------------------- 9. the file on disk
	await page.keyboard.press("x");
	await ev(() => fastart.model.setView("front"));
	await wait(200);
	await stroke([-2, -1, -5], [2, 1, -5]);
	await ev(() => fastart.flushNow());
	await wait(300);
	const disk = JSON.parse(fs.readFileSync(path.join(P, "head.fart"), "utf8"));
	check("the stroke is in the file", moved(disk.parts[0].shapes[0].points, p0) > 0);

	// ------------------------------------------------------------- 10. the Ask panel's tools
	const call = (name, args) => ev(({ name, args }) => fastart.callTool(name, args), { name, args });
	const before = await pts();
	const r1t = await call("mesh_sculpt_stroke", { brush: "draw", points: [[-2, 0, -5], [2, 0, -5]], radius: 1.5, mirror: ["x"] });
	check("mesh_sculpt_stroke draws along a path", !r1t.isError && moved(await pts(), before) > 3, JSON.stringify(r1t).slice(0, 160));
	const r2t = await call("mesh_sculpt_stroke", { brush: "wobble", points: [[0, 0, -5]], radius: 1 });
	check("an unknown brush is refused with the list", !!r2t.isError && /draw/.test(JSON.stringify(r2t)));
	const r3t = await call("mesh_sculpt_filter", { filter: "smooth", amount: 0.5 });
	check("mesh_sculpt_filter smooths", !r3t.isError);
	const f0 = await ev(() => fastart.md.doc.value.parts[0].shapes[0].faces.length);
	const r4t = await call("mesh_subdivide", {});
	check("mesh_subdivide makes four times the faces", !r4t.isError && (await ev(() => fastart.md.doc.value.parts[0].shapes[0].faces.length)) === f0 * 4);

	// ------------------------------------------------------------- 11. out
	await page.keyboard.press("Escape");
	await wait();
	check("Esc leaves sculpt mode", !(await ev(() => fastart.md.sculpting.value)));
	check("the Mesh section is back", (await insp.locator(".ur-insp-title", { hasText: "Mesh" }).count()) === 1);
} finally {
	await browser.close();
	server.kill();
}
console.log(fails ? `${fails} failed` : "all ok");
process.exit(fails ? 1 : 0);
