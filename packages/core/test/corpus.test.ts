// The conformance corpus: every case in spec/examples/manifest.json gets
// the verdict the manifest promises, with the named error code and the
// named warnings.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadScene, parseDoc, parseScene, refInfo, resolvePalettes, resolveTextures, tokenNames , validateDirection, loadDirection } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const examples = resolve(here, "../../../spec/examples");

interface Case {
	file: string;
	valid: boolean;
	code?: string;
	warnings?: string[];
	note?: string;
	shart?: boolean;
	gas?: boolean;
}
const manifest = JSON.parse(await readFile(join(examples, "manifest.json"), "utf8")) as { cases: Case[] };

for (const c of manifest.cases) {
	test(`${c.file}${c.note ? ` (${c.note})` : ""}`, async () => {
		const file = join(examples, c.file);
		const text = await readFile(file, "utf8");
		if (c.gas) {
			// a direction: its structure, then its extends read from beside it
			let raw: unknown;
			try {
				raw = JSON.parse(text);
			} catch {
				raw = null;
			}
			const errs = validateDirection(raw);
			const loaded = errs.length ? null : await loadDirection(text, async (rel) => {
				try {
					return await readFile(resolve(dirname(file), rel), "utf8");
				} catch {
					return null;
				}
			});
			const bad = errs.length > 0 || (loaded ? loaded.errors.length > 0 : true);
			if (c.valid) assert.ok(!bad, [...errs, ...(loaded?.errors ?? [])].join("; "));
			else assert.ok(bad, "expected a refused direction");
			if (loaded && c.valid) assert.equal(loaded.unresolved.length, 0, `unresolved: ${loaded.unresolved.join(", ")}`);
			return;
		}
		if (c.shart) {
			// a scene: checked with everything it names read from beside it
			const first = parseScene(text);
			let refs;
			if (first.raw) {
				const loaded = await loadScene(
					first.raw,
					async (rel) => {
						try {
							return await readFile(resolve(dirname(file), rel), "utf8");
						} catch {
							return null;
						}
					},
					"",
					[],
					c.file.slice(c.file.lastIndexOf("/") + 1),
				);
				refs = refInfo(loaded);
			}
			const { scene, report } = parseScene(text, { refs });
			assert.equal(report.ok, c.valid, JSON.stringify(report.errors));
			assert.equal(scene !== null, c.valid);
			if (!c.valid) assert.ok(report.errors.some((e) => e.code === c.code), `expected code ${c.code}, got ${report.errors.map((e) => e.code).join(", ") || "none"}`);
			assert.deepEqual([...new Set(report.warnings.map((w) => w.code))].sort(), [...(c.warnings ?? [])].sort());
			return;
		}
		const first = parseDoc(text);
		let refTokens: Iterable<string> | null | undefined;
		if (first.doc?.palette_refs?.length) {
			const resolved = await resolvePalettes(first.doc, async (rel) => {
				try {
					return await readFile(resolve(dirname(file), rel), "utf8");
				} catch {
					return null;
				}
			});
			refTokens = resolved.unresolved.length ? null : tokenNames(resolved);
		}
		// texture maps (1.5): read relative to the file; what cannot be read is an unresolved warning
		const unresolvedRefs: string[] = [];
		if (first.doc?.textures?.length) {
			const read = async (rel: string) => {
				try {
					return await readFile(resolve(dirname(file), rel), "utf8");
				} catch {
					return null;
				}
			};
			for (const t of (await resolveTextures(first.doc, read, (x) => parseDoc(x).doc)).values()) unresolvedRefs.push(...t.unresolved);
		}
		const { doc, report } = parseDoc(text, { refTokens, unresolvedRefs });
		assert.equal(report.ok, c.valid, JSON.stringify(report.errors));
		assert.equal(doc !== null, c.valid);
		if (!c.valid) {
			assert.ok(
				report.errors.some((e) => e.code === c.code),
				`expected code ${c.code}, got ${report.errors.map((e) => e.code).join(", ") || "none"}`,
			);
		}
		const warned = new Set(report.warnings.map((w) => w.code));
		assert.deepEqual([...warned].sort(), [...(c.warnings ?? [])].sort());
	});
}
