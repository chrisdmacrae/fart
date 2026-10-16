// Edits as patches (RFC 6902) addressed by the names the file already
// has, so an agent changes one pivot without rewriting the file and
// never counts array indices for the things that have names:
//
//   /parts/hull/pivot             /parts/hull/shapes/2/points/4
//   /states/open/parts/lid/rotate /clips/walk/keys/2/t   /palette/ink/rgb
//   /textures/plating/cell        /constraints/arm/chain  /collision/0/r
//
// A segment that is a name resolves to the index of the element with that
// name in a list of named things (parts, states, a state's parts by their
// `part`, clips, palette tokens, textures, constraints); a number is an
// index as in plain JSON Pointer. "-" appends. Operations: add, remove,
// replace, move, copy, test, as the RFC says.

export interface PatchOp {
	op: "add" | "remove" | "replace" | "move" | "copy" | "test";
	path: string;
	from?: string;
	value?: unknown;
}

const NAMED: Record<string, string> = { parts: "name", states: "name", clips: "name", palette: "name", textures: "name", constraints: "name" };

/** The index a segment means inside a list: a number, "-" for the end, or a name the list's elements carry. */
function indexIn(list: unknown[], seg: string, parentKey: string, forAdd: boolean): number {
	if (seg === "-") return forAdd ? list.length : -1;
	if (/^\d+$/.test(seg)) return Number(seg);
	// a state's or key's parts are named by `part`; the top-level lists by `name`
	const key = parentKey === "parts" && list.length && typeof (list[0] as Record<string, unknown>)?.part === "string" ? "part" : (NAMED[parentKey] ?? "name");
	const i = list.findIndex((e) => e && typeof e === "object" && (e as Record<string, unknown>)[key] === seg);
	return i;
}

interface Where {
	parent: Record<string, unknown> | unknown[];
	key: string | number;
}

/** Resolve a pointer to its parent container and final key; the last segment may name a missing element when adding. */
function resolve(root: unknown, path: string, forAdd: boolean): Where {
	if (path === "" || path === "/") throw new Error("the root itself cannot be patched; replace the document instead");
	if (!path.startsWith("/")) throw new Error(`a path starts with /: ${path}`);
	const segs = path.slice(1).split("/").map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
	let cur: unknown = root;
	let parentKey = "";
	for (let i = 0; i < segs.length - 1; i++) {
		const seg = segs[i];
		if (Array.isArray(cur)) {
			const idx = indexIn(cur, seg, parentKey, false);
			if (idx < 0 || idx >= cur.length) throw new Error(`no "${seg}" in ${parentKey || "the list"} (${path})`);
			cur = cur[idx];
		} else if (cur && typeof cur === "object") {
			if (!(seg in (cur as object))) throw new Error(`no "${seg}" at ${"/" + segs.slice(0, i).join("/") || "the root"} (${path})`);
			cur = (cur as Record<string, unknown>)[seg];
			parentKey = seg;
		} else throw new Error(`cannot step into "${seg}" (${path})`);
	}
	const last = segs[segs.length - 1];
	if (Array.isArray(cur)) {
		const idx = indexIn(cur, last, parentKey, forAdd);
		if (idx < 0 && !(forAdd && last === "-")) {
			if (forAdd && !/^\d+$/.test(last)) return { parent: cur, key: cur.length }; // adding a new named thing appends
			throw new Error(`no "${last}" in ${parentKey || "the list"} (${path})`);
		}
		return { parent: cur, key: idx < 0 ? cur.length : idx };
	}
	if (cur && typeof cur === "object") return { parent: cur as Record<string, unknown>, key: last };
	throw new Error(`cannot address "${last}" (${path})`);
}

function get(w: Where): unknown {
	return Array.isArray(w.parent) ? w.parent[w.key as number] : w.parent[w.key as string];
}
function set(w: Where, v: unknown, insert: boolean) {
	if (Array.isArray(w.parent)) {
		if (insert) w.parent.splice(w.key as number, 0, v);
		else w.parent[w.key as number] = v;
	} else w.parent[w.key as string] = v;
}
function del(w: Where) {
	if (Array.isArray(w.parent)) w.parent.splice(w.key as number, 1);
	else delete w.parent[w.key as string];
}
const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

/**
 * Apply patch operations to a document in place, in order; the first
 * failure throws with its index and nothing after it applies (callers
 * patch a copy). Returns a line per operation for the record.
 */
export function applyPatch(doc: object, ops: readonly PatchOp[]): string[] {
	const log: string[] = [];
	ops.forEach((op, i) => {
		try {
			switch (op.op) {
				case "add": {
					const w = resolve(doc, op.path, true);
					set(w, clone(op.value), Array.isArray(w.parent) && (op.path.endsWith("/-") || typeof w.key === "number"));
					log.push(`added ${op.path}`);
					break;
				}
				case "replace": {
					const w = resolve(doc, op.path, false);
					if (get(w) === undefined) throw new Error(`nothing at ${op.path} to replace (use add)`);
					set(w, clone(op.value), false);
					log.push(`set ${op.path}`);
					break;
				}
				case "remove": {
					const w = resolve(doc, op.path, false);
					if (get(w) === undefined) throw new Error(`nothing at ${op.path} to remove`);
					del(w);
					log.push(`removed ${op.path}`);
					break;
				}
				case "move":
				case "copy": {
					if (!op.from) throw new Error(`${op.op} needs from`);
					const src = resolve(doc, op.from, false);
					const v = clone(get(src));
					if (v === undefined) throw new Error(`nothing at ${op.from}`);
					if (op.op === "move") del(src);
					const dst = resolve(doc, op.path, true);
					set(dst, v, Array.isArray(dst.parent));
					log.push(`${op.op === "move" ? "moved" : "copied"} ${op.from} → ${op.path}`);
					break;
				}
				case "test": {
					const w = resolve(doc, op.path, false);
					if (JSON.stringify(get(w)) !== JSON.stringify(op.value)) throw new Error(`test failed at ${op.path}`);
					log.push(`tested ${op.path}`);
					break;
				}
				default:
					throw new Error(`unknown op "${String((op as PatchOp).op)}"`);
			}
		} catch (e) {
			throw new Error(`op ${i} (${op.op} ${op.path}): ${(e as Error).message}`);
		}
	});
	return log;
}
