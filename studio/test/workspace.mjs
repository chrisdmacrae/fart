// The workspace, end to end, against served copies of examples/space and
// examples/models: the split view with no top bar, the sidebar as a
// stack (assets, then the open asset), the project bar's switchers, the
// floating tools, and the inspector letting go on an empty click. Run
// with `make check-ui` (needs the app built and playwright's chromium).
import { chromium } from "playwright";
import { spawn } from "node:child_process";
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

/** Serve a copy of an example folder, hand a page on it to `tour`, tear down. */
async function served(example, tour) {
	const P = fs.mkdtempSync(path.join(os.tmpdir(), "uranus-ui-"));
	if (typeof example === "function") example(P);
	else fs.cpSync(path.join(repo, "examples", example), P, { recursive: true });
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
		page.on("pageerror", (e) => console.log("pageerror:", e.message));
		await page.goto("http://localhost:4747/");
		await page.waitForTimeout(1500);
		const shot = (n) => (shots ? page.screenshot({ path: path.join(shots, n + ".png") }) : Promise.resolve());
		const hdrs = async () => (await page.locator(".inspector .ur-insp-title").allTextContents()).map((t) => t.trim().split("\n")[0]);
		await tour(page, shot, hdrs, P);
	} finally {
		await browser.close();
		server.kill();
		await new Promise((r) => setTimeout(r, 300));
		fs.rmSync(P, { recursive: true, force: true });
	}
}

await served("space", async (page, shot, hdrs) => {
	check("workspace up", (await page.locator(".workspace").count()) === 1);
	check("three headers", (await page.locator(".ur-pane-head").count()) === 3);
	check("project bar", (await page.locator(".ur-pathbar").count()) === 1);
	check("navigator at assets", await page.evaluate(() => fastart.sidebar.view.value === "assets"));
	check("shelf shows", (await page.locator(".ur-tile").count()) > 0, `${await page.locator(".ur-tile").count()} cards`);
	check("project inspector", (await page.locator(".inspector .ur-insp-title").first().textContent()).includes("Project"));
	await shot("1-shelf");
	// open an asset from the tree
	const folder = page.locator(".nav-body .ur-row.folder", { hasText: "ships" });
	await folder.click(); await page.waitForTimeout(150);
	await page.locator(".nav-body .ur-row.leaf", { hasText: "fighter" }).first().click();
	await page.waitForTimeout(800);
	check("editor open", await page.evaluate(() => fastart.project.screen.value === "edit"));
	check("sidebar pushed", await page.evaluate(() => fastart.sidebar.view.value === "asset"));
	check("outline shows parts", (await page.locator(".outline .ur-group", { hasText: "Parts" }).count()) === 1);
	check("floating tools", (await page.locator(".ur-pathbar .ur-tool").count()) >= 5);
	check("asset seg", (await page.locator("[data-crumb=\"asset\"] .ur-crumb-label").textContent()).trim() === "fighter");
	const stLabel = (await page.locator("[data-crumb=\"state\"] .ur-crumb-label").textContent()).trim();
	check("state seg", stLabel.length > 0, stLabel);
	// the inspector opens on the document
	let h = await hdrs();
	check("fresh asset: document inspector", h.some((t) => t.startsWith("Document")) && !h.some((t) => t.startsWith("Part")), h.join(" | "));
	await shot("2-editor");
	// help, in context: every section of the guide is reachable, and the Help tab follows the selection
	check("every help topic is covered", (await page.evaluate(() => fastart.help.uncovered().join(","))) === "", await page.evaluate(() => fastart.help.uncovered().join(",")));
	check("no help context names a missing topic", (await page.evaluate(() => fastart.help.dangling().join(","))) === "", await page.evaluate(() => fastart.help.dangling().join(",")));
	await page.keyboard.press("Shift+Slash"); await page.waitForTimeout(200);
	check("? opens the Help tab on the asset", (await page.locator(".inspector.help .help-where").textContent()).includes("2D asset") && (await page.locator(".inspector.help .ur-insp-title").first().textContent()) === "The editor");
	await page.locator(".outline .ur-row").first().click(); await page.waitForTimeout(200);
	check("help follows the selection", (await page.locator(".inspector.help .help-where").textContent()).includes("a part") && (await page.locator(".inspector.help .ur-insp-title").first().textContent()) === "Parts and the outline");
	await page.locator(".inspector.help .ur-insp-head", { hasText: "More help" }).click(); await page.waitForTimeout(100);
	await page.locator(".help-more .ur-row", { hasText: "Updates" }).click(); await page.waitForTimeout(200);
	check("a topic from More help opens in a sheet", (await page.locator(".ur-sheet .ur-sheet-title").textContent()) === "Updates" && (await page.locator(".ur-sheet .help-prose").textContent()).length > 40);
	await page.keyboard.press("Escape"); await page.waitForTimeout(100);
	// the Help menu's three: search, this screen's shortcuts, the common categories
	check("every category names real topics", await page.evaluate(() => fastart.help.CATEGORIES.every((c) => c.topics.length && c.topics.every((id) => fastart.help.TOPICS.some((t) => t.id === id)))));
	await page.keyboard.press("Meta+Shift+Slash"); await page.waitForTimeout(200);
	check("search help opens on the categories", (await page.locator(".ur-sheet .help-results .ur-row").count()) === 8);
	await page.keyboard.type("pivot"); await page.waitForTimeout(200);
	const hits = await page.locator(".ur-sheet .help-hit-title").allTextContents();
	check("a word finds its topics", hits.length >= 2 && hits.includes("Rigs: parents"), hits.join(" | "));
	await page.locator(".ur-sheet .help-hit", { hasText: "Rigs: parents" }).click(); await page.waitForTimeout(200);
	check("a result opens its topic", (await page.locator(".ur-sheet .ur-sheet-title").textContent()) === "Rigs: parents");
	await page.keyboard.press("Escape"); await page.waitForTimeout(100);
	await page.keyboard.press("Meta+Slash"); await page.waitForTimeout(200);
	const keys2d = await page.locator(".keys-sheet").textContent();
	check("keyboard shortcuts are this screen's", (await page.locator(".ur-sheet .ur-sheet-msg").textContent()).includes("the 2D editor") && keys2d.includes("Rect tool") && keys2d.includes("Pointer") && !keys2d.includes("View: front"), `${(await page.locator(".keys-row").count())} rows`);
	await page.keyboard.press("Escape"); await page.waitForTimeout(100);
	await page.keyboard.press("Shift+Slash"); await page.waitForTimeout(150);
	check("? again puts the inspector back", await page.evaluate(() => fastart.sidebar.tab.value === "inspector"));
	const boxh = await page.locator(".canvas-wrap canvas").first().boundingBox();
	await page.mouse.click(boxh.x + 30, boxh.y + 60); await page.waitForTimeout(200);
	// pick a part in the layers: the part shows
	await page.locator(".outline .ur-row").first().click(); await page.waitForTimeout(200);
	h = await hdrs();
	check("layer click: part inspector", h.some((t) => t.startsWith("Part")), h.join(" | "));
	// click the empty canvas: the document again
	const box = await page.locator(".canvas-wrap canvas").first().boundingBox();
	await page.mouse.click(box.x + 30, box.y + 60); await page.waitForTimeout(250);
	h = await hdrs();
	check("empty click: document only", h.some((t) => t.startsWith("Document")) && !h.some((t) => t.startsWith("Part")), h.join(" | "));
	// the state switcher
	await page.locator("[data-crumb=\"state\"]").click(); await page.waitForTimeout(150);
	const rows = await page.locator(".ur-menu .ur-menu-label").allTextContents();
	check("state menu", rows.length >= 1, rows.join(", "));
	await shot("3-state-menu");
	await page.keyboard.press("Escape"); await page.waitForTimeout(100);
	// the asset switcher
	await page.locator("[data-crumb=\"asset\"]").click(); await page.waitForTimeout(150);
	const arows = await page.locator(".ur-menu .ur-menu-label").allTextContents();
	check("asset menu lists files", arows.length >= 3, `${arows.length} rows`);
	await page.keyboard.press("Escape");
	// back to assets in the sidebar
	await page.locator('[role=tab][aria-label^="Assets"]').click(); await page.waitForTimeout(150);
	check("back to assets", await page.evaluate(() => fastart.sidebar.view.value === "assets"));
	check("asset stays open", await page.evaluate(() => fastart.project.screen.value === "edit"));
	check("active row marked", (await page.locator(".nav-body .ur-row.leaf.selected").count()) === 1);
	// add menu at the root
	await page.locator(".nav-foot .ur-anchor button").click(); await page.waitForTimeout(150);
	const add = await page.locator(".ur-menu .ur-menu-label").allTextContents();
	check("add menu", add.join(",") === "2D asset…,3D asset…,Palette…,Scene…,3D scene…", add.join(","));
	await page.keyboard.press("Escape");
	// a 3D asset and a scene, if the corpus has them
	const files = await page.evaluate(() => fastart.project.files.value);
	const scene = files.find((f) => f.endsWith(".shart"));
	// open by the asset menu instead: pick a palette and a scene by name
	const openVia = async (name) => {
		// by the store (a crumb's menu lists only its own folder); leaving an edited asset asks about its checkpoint
		await page.evaluate((n) => { const f = fastart.project.files.value.find((f) => f.replace(/\.(fart|shart)$/, "").endsWith(n)); if (f) void fastart.openDoc(f); }, name);
		await page.waitForTimeout(300);
		const leave = page.locator(".ur-sheet button", { hasText: "Don't save" });
		if (await leave.count()) await leave.click();
		await page.waitForTimeout(800);
	};
	const pal = files.find((f) => f.includes("palette"));
	if (pal) { await openVia(pal.replace(/\.fart$/, "").split("/").pop()); check("palette opens", await page.evaluate(() => fastart.ed.isPalette.value)); check("palette: no tools", (await page.locator(".ur-pathbar .ur-tool").count()) === 0); await shot("4-palette"); }
	if (scene) { await openVia(scene.replace(/\.shart$/, "").split("/").pop()); check("scene opens", await page.evaluate(() => fastart.project.screen.value === "scene")); check("scene sidebar nodes", (await page.locator(".outline .ur-group", { hasText: "Nodes" }).count()) === 1); await shot("5-scene"); }
	// sidebar toggle, inspector toggle
	await page.keyboard.press("Meta+b"); await page.waitForTimeout(100);
	check("cmd+b hides sidebar", (await page.locator(".col-nav").count()) === 0);
	await page.keyboard.press("Meta+b");
	await page.keyboard.press("Meta+w"); await page.waitForTimeout(400);
	check("cmd+w closes asset", await page.evaluate(() => fastart.project.screen.value === "browse"));
	await shot("6-back-to-shelf");
});

await served("models", async (page, shot, hdrs) => {
	await shot("7-models-shelf");
	const leaf = page.locator(".nav-body .ur-row.leaf", { hasText: "dog" }).first();
	if (!(await leaf.count())) { const f = page.locator(".nav-body .ur-row.folder").first(); if (await f.count()) await f.click(); }
	await page.locator(".nav-body .ur-row.leaf", { hasText: "dog" }).first().click();
	await page.waitForTimeout(1200);
	check("model screen", await page.evaluate(() => fastart.project.screen.value === "model"));
	check("sidebar parts", (await page.locator(".outline .ur-group", { hasText: "Parts" }).count()) === 1);
	check("model tools", (await page.locator(".ur-pathbar .ur-field").count()) === 1 && (await page.locator(".ur-pathbar .ur-tool").count()) >= 7);
	let h = await hdrs();
	await page.keyboard.press("Meta+Slash"); await page.waitForTimeout(200);
	const keys3d = await page.locator(".keys-sheet").textContent();
	check("in 3D the shortcuts are the 3D ones", (await page.locator(".ur-sheet .ur-sheet-msg").textContent()).includes("3D model") && keys3d.includes("View: front") && keys3d.includes("Orbit") && keys3d.includes("Move, turn, size"));
	await page.keyboard.press("Escape"); await page.waitForTimeout(100);
	check("fresh model: view + document, no part", h.some((t) => t.startsWith("Document")) && !h.some((t) => t.startsWith("Part")), h.join(" | "));
	await page.locator(".outline .ur-row").first().click(); await page.waitForTimeout(200);
	h = await hdrs();
	check("part row: part inspector", h.some((t) => t.startsWith("Part")) && !h.some((t) => t.startsWith("Document")), h.join(" | "));
	const box = await page.locator(".canvas-wrap canvas").first().boundingBox();
	await page.mouse.click(box.x + 20, box.y + 40); await page.waitForTimeout(250);
	h = await hdrs();
	check("empty click: document again", h.some((t) => t.startsWith("Document")) && !h.some((t) => t.startsWith("Part")), h.join(" | "));
	const stLabel = (await page.locator("[data-crumb=\"state\"] .ur-crumb-label").textContent()).trim();
	check("state seg", stLabel.length > 0, stLabel);
	await shot("8-model");

});

// morphs (1.6): the corpus pair, the model screen's deform mode, the 2D painter drawing a squash
await served(
	(P) => {
		fs.mkdirSync(path.join(P, "assets"));
		fs.copyFileSync(path.join(repo, "spec/examples/valid/morph3d.fart"), path.join(P, "assets/morph3d.fart"));
		fs.copyFileSync(path.join(repo, "spec/examples/valid/morph.fart"), path.join(P, "assets/morph.fart"));
	},
	async (page, shot) => {
	check("two assets on the shelf", (await page.locator(".ur-tile").count()) === 2);
	await page.locator(".nav-body .ur-row.folder").first().click(); await page.waitForTimeout(150);
	await page.locator(".nav-body .ur-row.leaf", { hasText: "morph3d" }).click(); await page.waitForTimeout(1000);
	check("model screen", await page.evaluate(() => fastart.project.screen.value === "model"));
	check("no issues", await page.evaluate(() => fastart.md.issues.value.length === 0), await page.evaluate(() => JSON.stringify(fastart.md.issues.value)));
	// the full state: the chest row says morph
	await page.locator(".outline .ur-row", { hasText: "full" }).click(); await page.waitForTimeout(300);
	check("row chip morph", (await page.locator(".outline .ur-row", { hasText: "chest" }).locator(".ur-chip", { hasText: "morph" }).count()) === 1);
	await page.locator(".outline .ur-row", { hasText: "chest" }).first().click(); await page.waitForTimeout(200);
	check("inspector says reshaped", (await page.locator(".inspector").textContent()).includes("1 mesh reshaped"));
	// D toggles deform
	await page.keyboard.press("d"); await page.waitForTimeout(100);
	check("D toggles deform", await page.evaluate(() => fastart.md.deform.value === true));
	check("deform tool lit", (await page.locator(".ur-pathbar .ur-tool[aria-pressed=\"true\"]").count()) >= 2);
	// reset the morph through the inspector, undo brings it back
	await page.locator(".inspector button[title^=\"Draw the base mesh\"]").click(); await page.waitForTimeout(200);
	check("reset drops the morph", await page.evaluate(() => !fastart.md.doc.value.states[1].parts[0].morph));
	await page.keyboard.press("Meta+z"); await page.waitForTimeout(200);
	check("undo restores it", await page.evaluate(() => fastart.md.doc.value.states[1].parts[0].morph?.length === 1));
	// a clip previews the swell midway: the frame carries a lerped morph
	await page.locator(".outline .ur-row", { hasText: "breathe" }).click(); await page.waitForTimeout(200);
	await page.evaluate(() => (fastart.md.clipTime.value = 0.4)); await page.waitForTimeout(200);
	const mid = await page.evaluate(() => { const s = fastart.md.doc.value; return s && window.fastart.md.clipTime.value; });
	check("clip time set", mid === 0.4);
	await shot("13-morph-mid");
	// the 2D file draws its squash without complaint
	// the asset crumb lists the files beside this one
	await page.locator("[data-crumb=\"asset\"]").click(); await page.waitForTimeout(120);
	await page.locator(".ur-menu .ur-menu-item", { hasText: /^morph$/ }).first().click(); await page.waitForTimeout(900);
	check("2D morph file opens clean", await page.evaluate(() => fastart.project.screen.value === "edit" && fastart.ed.issues.value.length === 0));
	await page.locator(".outline .ur-row", { hasText: "squash" }).click(); await page.waitForTimeout(200);
	await shot("14-morph-2d");
	},
);

// curves and smooth surfaces (1.7): the corpus trio, the pen, 2D deform into a morph, the smooth cage, a sweep
await served(
	(P) => {
		fs.mkdirSync(path.join(P, "assets"));
		for (const f of ["curve", "smooth", "sweep"]) fs.copyFileSync(path.join(repo, `spec/examples/valid/${f}.fart`), path.join(P, `assets/${f}.fart`));
	},
	async (page, shot) => {
	const openVia = async (name) => {
		// by the store (a crumb's menu lists only its own folder); leaving an edited asset asks about its checkpoint
		await page.evaluate((n) => { const f = fastart.project.files.value.find((f) => f.replace(/\.(fart|shart)$/, "").endsWith(n)); if (f) void fastart.openDoc(f); }, name);
		await page.waitForTimeout(300);
		const leave = page.locator(".ur-sheet button", { hasText: "Don't save" });
		if (await leave.count()) await leave.click();
		await page.waitForTimeout(800);
	};
	await page.locator(".nav-body .ur-row.folder").first().click(); await page.waitForTimeout(150);
	await page.locator(".nav-body .ur-row.leaf", { hasText: "curve" }).click(); await page.waitForTimeout(900);
	check("curve opens clean", await page.evaluate(() => fastart.project.screen.value === "edit" && fastart.ed.issues.value.length === 0), await page.evaluate(() => JSON.stringify(fastart.ed.issues.value)));
	// select the path by clicking it, see tangent rings; squash state
	await page.locator(".outline .ur-row").first().click(); await page.waitForTimeout(100);
	const box = await page.locator(".canvas-wrap canvas").first().boundingBox();
	const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
	await page.mouse.click(cx + 20, cy); await page.waitForTimeout(250);
	check("path selected", await page.evaluate(() => fastart.ed.sel.value.length === 1 && fastart.ed.doc.value.parts[0].shapes[fastart.ed.sel.value[0].s].kind === "path"));
	await shot("15-curve-round");
	await page.locator(".outline .ur-row", { hasText: "squash" }).click(); await page.waitForTimeout(250);
	await shot("16-curve-squash");
	// 2D deform: D on, drag a vertex of the path in the squash state -> the morph gains the vertex
	await page.keyboard.press("d"); await page.waitForTimeout(100);
	check("2D deform on", await page.evaluate(() => fastart.ed.deform.value === true));
	await page.mouse.click(cx + 20, cy + 20); await page.waitForTimeout(250);
	check("path selected again in squash", await page.evaluate(() => fastart.ed.sel.value.length === 1 && fastart.worldHandles().length > 6), await page.evaluate(() => JSON.stringify(fastart.ed.sel.value)));
	const handle = await page.evaluate(() => { const c = document.querySelector(".canvas-wrap canvas"); const h = fastart.worldHandles(); const s = fastart.toScreen(h[2], c.clientWidth, c.clientHeight); return [s[0], s[1]]; });
	console.log("handle at", handle);
	await page.mouse.move(box.x + handle[0], box.y + handle[1]); await page.mouse.down(); await page.mouse.move(box.x + handle[0] + 40, box.y + handle[1], { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(250);
	const morph = await page.evaluate(() => fastart.ed.doc.value.states[1].parts[0].morph[0]);
	check("vertex drag landed in the morph", morph && morph.points[2][0] > 10, JSON.stringify(morph.points[2]));
	check("base path untouched", await page.evaluate(() => fastart.ed.doc.value.parts[0].shapes[0].points[2][0] === 8));
	await page.keyboard.press("d");
	// the pen: draw a curved triangle in the round state
	await page.locator(".outline .ur-row", { hasText: "round" }).click(); await page.waitForTimeout(150);
	await page.keyboard.press("p"); await page.waitForTimeout(100);
	const at = (dx, dy) => [box.x + box.width / 2 + dx, box.y + box.height / 2 + dy];
	let [x, y] = at(-200, -150); await page.mouse.click(x, y);
	[x, y] = at(-100, -150); await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 60, y + 40, { steps: 5 }); await page.mouse.up();
	[x, y] = at(-150, -60); await page.mouse.click(x, y);
	await page.keyboard.press("Enter"); await page.waitForTimeout(300);
	const made = await page.evaluate(() => { const ss = fastart.ed.doc.value.parts[fastart.ed.curPart.value].shapes; return ss[ss.length - 1]; });
	check("the pen made a path with a curved vertex", made.kind === "path" && made.out && Math.hypot(...made.out[1]) > 1, JSON.stringify(made.out));
	await shot("17-pen");
	// the smooth cage
	await openVia("assets/smooth");
	check("smooth opens clean", await page.evaluate(() => fastart.project.screen.value === "model" && fastart.md.issues.value.length === 0), await page.evaluate(() => JSON.stringify(fastart.md.issues.value)));
	await page.locator(".outline .ur-row").first().click(); await page.waitForTimeout(100);
	const b3 = await page.locator(".canvas-wrap canvas").first().boundingBox();
	await page.mouse.click(b3.x + b3.width / 2, b3.y + b3.height / 2 + 10); await page.waitForTimeout(300);
	check("mesh selected", await page.evaluate(() => !!fastart.md.sel.value));
	check("inspector shows smooth", /smooth/i.test(await page.locator(".inspector").textContent()));
	await shot("18-smooth");
	await page.locator(".outline .ur-row", { hasText: "breathe" }).click(); await page.waitForTimeout(150);
	await page.evaluate(() => (fastart.md.clipTime.value = 0.8)); await page.waitForTimeout(250);
	await shot("19-smooth-full");
	await openVia("assets/sweep");
	check("sweep opens clean", await page.evaluate(() => fastart.project.screen.value === "model" && fastart.md.issues.value.length === 0));
	await page.evaluate(() => fastart.md.turn.value = [0.5, 0.6, 0]); await page.waitForTimeout(300);
	await shot("20-sweep");
	},
);

// the folder is watched: what something else does on disk shows in the navigator without a click
await served("space", async (page, _shot, _hdrs, P) => {
	const files = () => page.evaluate(() => fastart.project.files.value);
	const before = await files();
	check("the project lists its files", before.length > 0, `${before.length} files`);
	const some = before.find((f) => f.endsWith(".fart"));
	const made = path.join(path.dirname(some), "made-outside.fart");
	fs.copyFileSync(path.join(P, some), path.join(P, made));
	await page.waitForTimeout(3200);
	check("a file made on disk appears", (await files()).includes(made));
	// (the browser shows the folder it is in: go to the file's own)
	await page.evaluate((d) => fastart.goFolder(d), path.dirname(made) === "." ? "" : path.dirname(made));
	await page.waitForTimeout(400);
	check("and shows on screen", (await page.getByText("made-outside").count()) > 0);
	fs.renameSync(path.join(P, made), path.join(P, path.dirname(some), "moved-outside.fart"));
	await page.waitForTimeout(3200);
	const after = await files();
	check("a file renamed on disk follows", after.some((f) => f.endsWith("moved-outside.fart")) && !after.includes(made));
	fs.rmSync(path.join(P, path.dirname(some), "moved-outside.fart"));
	await page.waitForTimeout(3200);
	check("a file removed on disk goes", (await files()).length === before.length);
	check("nothing was left busy", await page.evaluate(() => fastart.project.busy.value === false));
});

console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
