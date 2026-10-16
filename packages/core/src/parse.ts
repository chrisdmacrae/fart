import type { Doc, Doc3 } from "./types.ts";
import { validate, type Report, type ValidateOptions } from "./validate.ts";

export interface ParseResult {
	/** The document, when the report is ok. */
	doc: Doc | null;
	report: Report;
}

/** Parse and validate. Never throws; the report says what went wrong. */
export function parseDoc(text: string, opts?: ValidateOptions): ParseResult {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		return { doc: null, report: { ok: false, errors: [{ code: "json", path: "", message: `not JSON: ${message}` }], warnings: [] } };
	}
	const report = validate(raw, opts);
	return { doc: report.ok ? (raw as Doc) : null, report };
}

export class FartError extends Error {
	readonly report: Report;
	constructor(report: Report) {
		super(report.errors.map((e) => `${e.code} at ${e.path || "/"}: ${e.message}`).join("\n"));
		this.name = "FartError";
		this.report = report;
	}
}

/** Parse and validate, throwing a FartError on a bad document. */
export function loadDoc(text: string, opts?: ValidateOptions): Doc {
	const { doc, report } = parseDoc(text, opts);
	if (!doc) throw new FartError(report);
	return doc;
}

/** The canonical on-disk form: two-space indent, trailing newline. */
/**
 * The document as text, the way every tool writes it: objects one key
 * per line, and every array of numbers (a point, a colour, a face) or of
 * such arrays on one line, since a point split over three lines is three
 * times the tokens for anyone reading it. Numbers keep up to three
 * decimals. Older files in the one-number-per-line layout parse the same.
 */
export function stringifyDoc(doc: Doc | Doc3 | object): string {
	return formatJson(doc) + "\n";
}

const isNums = (a: unknown): a is number[] => Array.isArray(a) && a.every((x) => typeof x === "number");
const isNums2 = (a: unknown): a is number[][] => Array.isArray(a) && a.length > 0 && a.every(isNums);
const num = (n: number): string => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000 + 0));

/** JSON with inline number arrays; the layout stringifyDoc uses. */
export function formatJson(v: unknown, indent = ""): string {
	if (isNums(v)) return `[${v.map(num).join(", ")}]`;
	if (isNums2(v)) return `[${v.map((a) => `[${a.map(num).join(", ")}]`).join(", ")}]`;
	if (Array.isArray(v)) {
		if (!v.length) return "[]";
		const inner = indent + "  ";
		return `[\n${v.map((x) => inner + formatJson(x, inner)).join(",\n")}\n${indent}]`;
	}
	if (v && typeof v === "object") {
		const keys = Object.keys(v as object).filter((k) => (v as Record<string, unknown>)[k] !== undefined);
		if (!keys.length) return "{}";
		const inner = indent + "  ";
		return `{\n${keys.map((k) => `${inner}${JSON.stringify(k)}: ${formatJson((v as Record<string, unknown>)[k], inner)}`).join(",\n")}\n${indent}}`;
	}
	return JSON.stringify(v);
}
