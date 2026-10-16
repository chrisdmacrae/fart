// Run the eval tasks through Claude Code with the fastart skill and count
// what each cost: node evals/run.mjs [task-id ...] [--model m]. Each task
// copies its example set to a temp folder, runs `claude -p` there with
// the skill, then checks the file it names validates and meets its
// expectation. Reports tokens (in, out, cache) and turns per task, and
// writes evals/last.json. Costs real turns; run a few at a time.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const args = process.argv.slice(2);
const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : undefined;
const ids = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--model");
const { tasks } = JSON.parse(fs.readFileSync(path.join(repo, "evals/tasks.json"), "utf8"));
const picked = ids.length ? tasks.filter((t) => ids.includes(t.id)) : tasks;
const results = [];
for (const t of picked) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), `eval-${t.id}-`));
	fs.cpSync(path.join(repo, "examples", t.set), dir, { recursive: true });
	for (const f of fs.readdirSync(dir)) if (f.endsWith("~")) fs.rmSync(path.join(dir, f));
	const t0 = Date.now();
	const argv = ["-p", t.prompt, "--output-format", "json", "--allowedTools", "Read,Write,Edit,Glob,Grep,Bash", "--add-dir", repo];
	if (model) argv.push("--model", model);
	const r = spawnSync("claude", argv, { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, FASTART: repo } });
	const secs = (Date.now() - t0) / 1000;
	let usage = {};
	let turns = 0;
	let cost = 0;
	try {
		const out = JSON.parse(r.stdout);
		usage = out.usage ?? {};
		turns = out.num_turns ?? 0;
		cost = out.total_cost_usd ?? 0;
	} catch {
		// no json: the run failed
	}
	const file = path.join(dir, t.file);
	let ok = false;
	let why = "";
	if (fs.existsSync(file)) {
		const v = spawnSync("node", [path.join(repo, "packages/core/src/cli.ts"), "validate", file], { encoding: "utf8" });
		ok = v.status === 0;
		why = ok ? "" : v.stdout.split("\n").slice(-3).join(" ");
		if (ok) {
			const doc = JSON.parse(fs.readFileSync(file, "utf8"));
			const [kind, what] = t.expect.split(":");
			if (kind === "clip") ok = (doc.clips ?? []).some((c) => c.name === what);
			else if (kind === "state") ok = (doc.states ?? []).some((s) => s.name === what);
			else if (kind === "ref") ok = (doc.palette_refs ?? []).some((p) => p.includes(what));
			else if (t.expect.startsWith("shapes>=")) ok = (doc.parts ?? []).reduce((a, p) => a + (p.shapes?.length ?? 0), 0) >= Number(t.expect.slice(8));
			else if (kind === "unchanged") ok = fs.readFileSync(file, "utf8") === fs.readFileSync(path.join(repo, "examples", t.set, t.file), "utf8");
			if (!ok) why = `expected ${t.expect}`;
		}
	} else why = "file missing";
	const row = { id: t.id, ok, why, turns, secs: Math.round(secs), in: usage.input_tokens ?? 0, out: usage.output_tokens ?? 0, cacheRead: usage.cache_read_input_tokens ?? 0, cacheWrite: usage.cache_creation_input_tokens ?? 0, cost: Math.round(cost * 1000) / 1000 };
	results.push(row);
	console.log(`${row.ok ? "ok  " : "FAIL"} ${t.id}: ${turns} turns, ${row.secs}s, in ${row.in} out ${row.out} cache ${row.cacheRead}/${row.cacheWrite}, $${row.cost}${why ? " · " + why : ""}`);
	fs.rmSync(dir, { recursive: true, force: true });
}
const tot = results.reduce((a, r) => ({ turns: a.turns + r.turns, out: a.out + r.out, in: a.in + r.in, cost: a.cost + r.cost, ok: a.ok + (r.ok ? 1 : 0) }), { turns: 0, out: 0, in: 0, cost: 0, ok: 0 });
console.log(`${tot.ok}/${results.length} ok · ${tot.turns} turns · out ${tot.out} · in ${tot.in} · $${Math.round(tot.cost * 100) / 100}`);
fs.writeFileSync(path.join(repo, "evals/last.json"), JSON.stringify({ when: new Date().toISOString(), model: model ?? "default", results, total: tot }, null, 2) + "\n");
void execFileSync;
