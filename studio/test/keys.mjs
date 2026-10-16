// Posing a clip's keys on the canvas, end to end, against served copies of
// examples/space (2D: the fighter) and examples/models (3D: the dog): a
// key picked puts the canvas on it, a drag on the rig gives that key its
// own pose (the state it named stays as it was), a drag between keys
// makes a key, undo takes it back, and a key's pose saves as a state.
// Run with `make check-keys` (needs the app built and playwright's chromium).
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const bin = [path.join(repo, "studio/bin/studio"), path.join(repo, "studio/bin/Uranus"), path.join(repo, "studio/bin/Uranus.app/Contents/MacOS/Uranus")]
	.filter((b) => fs.existsSync(b))
	.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
if (!bin) {
	console.error("no studio binary: run make app (or go build -o bin/studio . in studio/)");
	process.exit(2);
}
const shots = process.argv[2] || "";
let fails = 0;
const check = (name, ok, extra = "") => {
	console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " · " + extra : ""}`);
	if (!ok) fails++;
};

/** Serve a copy of an example folder, hand a page on it to `tour`, validate what it wrote, tear down. */
async function served(example, tour) {
	const P = fs.mkdtempSync(path.join(os.tmpdir(), "uranus-keys-"));
	fs.cpSync(path.join(repo, "examples", example), P, { recursive: true });
	const server = spawn(bin, ["--serve", P], { stdio: "ignore" });
	for (let i = 0; i < 80; i++) {
		try {
			await fetch("http://127.0.0.1:4747/");
			break;
		} catch {
			await new Promise((r) => setTimeout(r, 250));
		}
	}
	// CHROMIUM names a browser to use where playwright's own download is not there
	const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
	try {
		const page = await (await browser.newContext({ viewport: { width: 1400, height: 860 } })).newPage();
		page.on("pageerror", (e) => {
			console.log("pageerror:", e.message);
			fails++;
		});
		await page.goto("http://localhost:4747/");
		await page.waitForTimeout(1500);
		const shot = (n) => (shots ? page.screenshot({ path: path.join(shots, n + ".png") }) : Promise.resolve());
		const rel = await tour(page, shot);
		// what landed on disk is a valid file
		await page.waitForTimeout(800);
		try {
			execFileSync("node", [path.join(repo, "packages/core/src/cli.ts"), "validate", path.join(P, rel)], { stdio: "pipe" });
			check(`${rel} on disk validates`, true);
		} catch (e) {
			check(`${rel} on disk validates`, false, String(e.stdout ?? e));
		}
	} finally {
		await browser.close();
		server.kill();
		// the next example serves on the same port: wait for this one to let it go
		for (let i = 0; i < 40; i++) {
			try {
				await fetch("http://127.0.0.1:4747/");
			} catch {
				break;
			}
			if (i === 20) server.kill("SIGKILL");
			await new Promise((r) => setTimeout(r, 250));
		}
		fs.rmSync(P, { recursive: true, force: true });
	}
}

const open = async (page, name, screen) => {
	await page.evaluate((n) => fastart.openDoc(fastart.project.files.value.find((f) => f.endsWith(n))), name);
	await page.waitForFunction((s) => fastart.project.screen.value === s, screen, { timeout: 15000 }).catch(() => {});
	await page.waitForTimeout(800);
};

/** A canvas point (world) to page pixels: the canvas centre is the pan. */
async function pager(page) {
	return async (w) => {
		// read each time: the timeline coming up shrinks the canvas
		const box = await page.locator(".canvas-wrap canvas").last().boundingBox();
		const [z, p] = await page.evaluate(() => [fastart.view.zoom.value, fastart.view.pan.value]);
		return [box.x + box.width / 2 + (w[0] - p[0]) * z, box.y + box.height / 2 + (w[1] - p[1]) * z];
	};
}

async function drag(page, a, b) {
	await page.mouse.move(a[0], a[1]);
	await page.mouse.down();
	await page.mouse.move(b[0], b[1], { steps: 8 });
	await page.mouse.up();
	await page.waitForTimeout(150);
}

// ------------------------------------------------------------- 2D

await served("space", async (page, shot) => {
	await open(page, "fighter.fart", "edit");
	check("editor open", await page.evaluate(() => fastart.project.screen.value === "edit"));
	const toPage = await pager(page);
	const clipIdx = await page.evaluate(() => fastart.ed.doc.value.clips.findIndex((c) => c.name === "bank_left"));
	const bankBefore = await page.evaluate(() => JSON.stringify(fastart.ed.doc.value.states.find((s) => s.name === "bank_l")));
	await page.evaluate((k) => fastart.editor.selectClip(k), clipIdx);
	// picking the second key: the playhead goes there
	await page.evaluate(() => {
		fastart.ed.curKey.value = 1;
		fastart.editor.seek(0.25);
	});
	await page.waitForTimeout(150);
	check("on the key", await page.evaluate(() => fastart.editor.keyHere() === 1));
	check("status says the key", (await page.locator(".ur-statusbar").textContent()).includes("key at 0.25s"));

	// a joint picks its part
	const wingPivot = await page.evaluate(() => fastart.worldPivot("wing_l"));
	const jp = await toPage(wingPivot);
	await page.mouse.click(jp[0], jp[1]);
	await page.waitForTimeout(150);
	check("joint picks the part", await page.evaluate(() => fastart.editor.curPart()?.name === "wing_l" && fastart.ed.partPicked.value));
	check("pose section shows the key", (await page.locator(".inspector .ur-insp-title", { hasText: "Pose" }).count()) === 1);
	check("a click changes nothing", await page.evaluate(() => fastart.ed.doc.value.clips.find((c) => c.name === "bank_left").keys[1].state === "bank_l"));

	// the lever turns it, in the key only
	const turnBefore = await page.evaluate(() => fastart.editor.poseOfCur()?.rotate ?? 0);
	const lever = await toPage(await page.evaluate(() => fastart.poseLever()));
	const piv = await toPage(wingPivot);
	const r = Math.hypot(lever[0] - piv[0], lever[1] - piv[1]);
	const a0 = Math.atan2(lever[1] - piv[1], lever[0] - piv[0]);
	await drag(page, lever, [piv[0] + Math.cos(a0 + 0.6) * r, piv[1] + Math.sin(a0 + 0.6) * r]);
	await shot("keys-2d-turned");
	const key = await page.evaluate(() => fastart.ed.doc.value.clips.find((c) => c.name === "bank_left").keys[1]);
	check("the key has its own pose", key.state === undefined && Array.isArray(key.parts), JSON.stringify(Object.keys(key)));
	const turned = key.parts?.find((sp) => sp.part === "wing_l")?.rotate ?? 0;
	check("the part turned in the key", Math.abs(turned - turnBefore - 0.6) < 0.08, `${turnBefore.toFixed(3)} → ${turned.toFixed(3)}`);
	check("the state is untouched", (await page.evaluate(() => JSON.stringify(fastart.ed.doc.value.states.find((s) => s.name === "bank_l")))) === bankBefore);
	check("the frame shows it", await page.evaluate((t) => Math.abs((fastart.editor.frame().find((sp) => sp.part === "wing_l")?.rotate ?? 0) - t) < 1e-6, turned));
	check("one undo step", await page.evaluate(() => fastart.ed.canUndo.value));

	// a drag on a part (not a grip) turns it about its pivot
	const wingR = await page.evaluate(() => {
		const ps = fastart.ed.doc.value.parts;
		const i = ps.findIndex((p) => p.name === "wing_r");
		const sh = ps[i].shapes[0];
		const pts = sh.points ?? [sh.at];
		const c = pts.reduce((m, q) => [m[0] + q[0] / pts.length, m[1] + q[1] / pts.length], [0, 0]);
		const xf = fastart.partXf(i);
		return { at: [xf[0] * c[0] + xf[2] * c[1] + xf[4], xf[1] * c[0] + xf[3] * c[1] + xf[5]], pivot: fastart.worldPivot("wing_r") };
	});
	const g0 = await toPage(wingR.at);
	const gp = await toPage(wingR.pivot);
	const gr = Math.hypot(g0[0] - gp[0], g0[1] - gp[1]);
	const ga = Math.atan2(g0[1] - gp[1], g0[0] - gp[0]);
	const rBefore = await page.evaluate(() => fastart.editor.pose().parts.find((sp) => sp.part === "wing_r")?.rotate ?? 0);
	await drag(page, g0, [gp[0] + Math.cos(ga - 0.4) * gr, gp[1] + Math.sin(ga - 0.4) * gr]);
	const rAfter = await page.evaluate(() => fastart.editor.pose().parts.find((sp) => sp.part === "wing_r")?.rotate ?? 0);
	check("a part dragged turns about its pivot", await page.evaluate(() => fastart.editor.curPart()?.name === "wing_r") && Math.abs(rAfter - rBefore + 0.4) < 0.1, `${rBefore.toFixed(3)} → ${rAfter.toFixed(3)}`);

	// between keys: a drag makes a key at the playhead
	await page.evaluate(() => fastart.editor.seek(0.1));
	await page.waitForTimeout(100);
	check("between keys", await page.evaluate(() => fastart.editor.keyHere() === -1));
	const cp = await toPage(await page.evaluate(() => fastart.worldPivot("cockpit")));
	await drag(page, cp, [cp[0] + 30, cp[1] - 20]);
	const keys = await page.evaluate(() => fastart.ed.doc.value.clips.find((c) => c.name === "bank_left").keys.map((k) => ({ t: k.t, state: k.state, inline: !!k.parts })));
	check("a key at the playhead", keys.length === 3 && keys[1].t === 0.1 && keys[1].inline, JSON.stringify(keys));
	check("and it is current", await page.evaluate(() => fastart.editor.keyHere() === 1 && fastart.ed.curKey.value === 1));
	await shot("keys-2d-new");
	await page.evaluate(() => fastart.editor.undo());
	check("undo takes the key back", await page.evaluate(() => fastart.ed.doc.value.clips.find((c) => c.name === "bank_left").keys.length === 2));

	// a key's own pose saves as a state, and the key names it
	await page.evaluate(() => fastart.editor.keyToState(1, "bank_l_more"));
	const k1 = await page.evaluate(() => fastart.ed.doc.value.clips.find((c) => c.name === "bank_left").keys[1]);
	check("the key names the new state", k1.state === "bank_l_more" && !k1.parts);
	check("the new state holds the pose", await page.evaluate((t) => Math.abs((fastart.ed.doc.value.states.find((s) => s.name === "bank_l_more").parts.find((sp) => sp.part === "wing_l").rotate ?? 0) - t) < 1e-6, turned));
	await page.evaluate(() => fastart.flushNow());
	return "ships/fighter.fart";
});

// ------------------------------------------------------------- 3D

await served("models", async (page, shot) => {
	await open(page, "dog.fart", "model");
	check("model open", await page.evaluate(() => fastart.project.screen.value === "model"));
	const toPage = await pager(page);
	const wagBefore = await page.evaluate(() => JSON.stringify(fastart.md.doc.value.states.find((s) => s.name === "wag_l")));
	await page.evaluate(() => {
		fastart.model.selectClip(fastart.md.doc.value.clips.findIndex((c) => c.name === "wag"));
		fastart.md.curKey.value = 1;
		fastart.model.seek(0.2);
	});
	await page.waitForTimeout(200);
	check("3D on the key", await page.evaluate(() => fastart.model.keyHere() === 1));
	const leg = await page.evaluate(() => {
		const i = fastart.md.doc.value.parts.findIndex((p) => p.name === "leg_fr");
		const fp = fastart.model.framePartOf(i);
		// a point on the front leg away from its pivot (the hip): the corner of its faces furthest from it
		let best = fp.pivot;
		let bd = 0;
		for (const f of fp.shapes) for (const q of f.shape.points ?? []) {
			const d = Math.hypot(q[0] - fp.pivot[0], q[1] - fp.pivot[1]);
			if (d > bd) {
				bd = d;
				best = q;
			}
		}
		const towards = [fp.pivot[0] + (best[0] - fp.pivot[0]) * 0.7, fp.pivot[1] + (best[1] - fp.pivot[1]) * 0.7];
		return { i, pivot: fp.pivot, on: towards };
	});
	const rotBefore = await page.evaluate(() => JSON.stringify(fastart.model.pose().parts.find((sp) => sp.part === "leg_fr").rotate ?? [0, 0, 0]));
	const t0 = await toPage(leg.on);
	const tp = await toPage(leg.pivot);
	const tr = Math.hypot(t0[0] - tp[0], t0[1] - tp[1]);
	const ta = Math.atan2(t0[1] - tp[1], t0[0] - tp[0]);
	await drag(page, t0, [tp[0] + Math.cos(ta + 0.5) * tr, tp[1] + Math.sin(ta + 0.5) * tr]);
	await shot("keys-3d-turned");
	const k = await page.evaluate(() => fastart.md.doc.value.clips.find((c) => c.name === "wag").keys[1]);
	check("3D picks the part", await page.evaluate((i) => fastart.md.curPart.value === i && fastart.md.partPicked.value, leg.i));
	check("3D key has its own pose", k.state === undefined && Array.isArray(k.parts));
	const rotAfter = JSON.stringify(k.parts?.find((sp) => sp.part === "leg_fr")?.rotate ?? [0, 0, 0]);
	check("3D part turned in the key", rotAfter !== rotBefore, `${rotBefore} → ${rotAfter}`);
	check("3D state untouched", (await page.evaluate(() => JSON.stringify(fastart.md.doc.value.states.find((s) => s.name === "wag_l")))) === wagBefore);

	// the pose fields in the inspector change the key too
	check("3D pose section", (await page.locator(".inspector .ur-insp-title", { hasText: "Pose" }).count()) === 1);
	await page.evaluate(() => fastart.model.setPose(fastart.model.poseOfCur(), { scale: 1.25 }));
	check("3D inspector edits the key", await page.evaluate(() => fastart.md.doc.value.clips.find((c) => c.name === "wag").keys[1].parts.find((sp) => sp.part === "leg_fr").scale === 1.25));

	// a joint dragged between keys makes a key
	await page.evaluate(() => fastart.model.seek(0.1));
	await page.waitForTimeout(150);
	const hp = await toPage(await page.evaluate(() => fastart.model.framePartOf(fastart.md.doc.value.parts.findIndex((p) => p.name === "ear_r")).pivot));
	await drag(page, hp, [hp[0] + 20, hp[1] + 10]);
	const keys = await page.evaluate(() => fastart.md.doc.value.clips.find((c) => c.name === "wag").keys.map((k) => ({ t: k.t, inline: !!k.parts })));
	check("3D key at the playhead", keys.length === 4 && keys[1].t === 0.1 && keys[1].inline, JSON.stringify(keys));
	check("3D the joint's part moved", await page.evaluate(() => fastart.model.curPart()?.name === "ear_r" && fastart.md.doc.value.clips.find((c) => c.name === "wag").keys[1].parts.find((sp) => sp.part === "ear_r").offset));
	await shot("keys-3d-new");
	await page.evaluate(() => fastart.model.flushNow?.());
	return "dog.fart";
});

console.log(fails ? `\n${fails} failed` : "\nall good");
process.exit(fails ? 1 : 0);
