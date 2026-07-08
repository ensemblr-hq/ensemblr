#!/usr/bin/env node
// Converts a bun-generated lcov.info into an Istanbul coverage-final.json so
// `fallow audit --coverage` can read real per-function coverage instead of its
// module-graph estimate. Bun only emits lcov/text (it runs on JSC, so no V8 or
// Istanbul output), hence this bridge.
//
// Usage: node scripts/lcov-to-istanbul.mjs [lcov.info] [coverage-final.json]
// Paths in the output are absolute; pass the repo root as fallow's coverage_root.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const inputPath = process.argv[2] ?? 'coverage/lcov.info';
const outputPath = process.argv[3] ?? 'coverage/coverage-final.json';

const point = (line) => ({ column: 0, line });
const span = (line) => ({ end: point(line), start: point(line) });

// Prefix → reducer for a single lcov line. A dispatch table (rather than an
// if/else chain) keeps each unit's branching low.
const LCOV_HANDLERS = [
	[
		'SF:',
		(state, value) => {
			state.file = value;
		},
	],
	[
		'DA:',
		(state, value) => {
			const [ln, hits] = value.split(',');
			state.da.push({ hits: Number(hits), line: Number(ln) });
		},
	],
	[
		'FN:',
		(state, value) => {
			const comma = value.indexOf(',');
			state.fnLine.set(value.slice(comma + 1), Number(value.slice(0, comma)));
		},
	],
	[
		'FNDA:',
		(state, value) => {
			const comma = value.indexOf(',');
			state.fnHits.set(value.slice(comma + 1), Number(value.slice(0, comma)));
		},
	],
	[
		'BRDA:',
		(state, value) => {
			const [ln, , , taken] = value.split(',');
			state.brda.push({
				line: Number(ln),
				taken: taken === '-' ? 0 : Number(taken),
			});
		},
	],
];

/** Folds one trimmed lcov line into the accumulating record state. */
function applyLcovLine(state, line) {
	for (const [prefix, handle] of LCOV_HANDLERS) {
		if (line.startsWith(prefix)) {
			handle(state, line.slice(prefix.length));
			return;
		}
	}
}

/** Collects the raw DA/FN/FNDA/BRDA rows of one lcov block into a state bag. */
function collectRecord(record) {
	const state = {
		brda: [],
		da: [],
		file: null,
		fnHits: new Map(),
		fnLine: new Map(),
	};
	for (const raw of record.split('\n')) {
		applyLcovLine(state, raw.trim());
	}
	return state;
}

/** Builds the Istanbul file entry (maps + hit counts) from collected lcov state. */
function toIstanbulEntry(state) {
	const statementMap = {};
	const s = {};
	state.da.forEach((entry, index) => {
		statementMap[index] = span(entry.line);
		s[index] = entry.hits;
	});

	const fnMap = {};
	const f = {};
	let fnIndex = 0;
	for (const [name, line] of state.fnLine) {
		fnMap[fnIndex] = { decl: span(line), line, loc: span(line), name };
		f[fnIndex] = state.fnHits.get(name) ?? 0;
		fnIndex += 1;
	}

	const branchMap = {};
	const b = {};
	state.brda.forEach((entry, index) => {
		branchMap[index] = {
			line: entry.line,
			loc: span(entry.line),
			locations: [span(entry.line)],
			type: 'branch',
		};
		b[index] = [entry.taken];
	});

	const path = resolve(state.file);
	return { b, branchMap, f, fnMap, path, s, statementMap };
}

/** Parses one lcov `SF:…end_of_record` block into an Istanbul file entry, or null. */
export function parseRecord(record) {
	const state = collectRecord(record);
	return state.file ? toIstanbulEntry(state) : null;
}

/** Converts a full lcov string into an Istanbul coverage map keyed by absolute path. */
export function convertLcov(text) {
	const coverage = {};
	for (const record of text.split(/^end_of_record$/m)) {
		const entry = parseRecord(record);
		if (entry) {
			coverage[entry.path] = entry;
		}
	}
	return coverage;
}

if (import.meta.main) {
	const coverage = convertLcov(readFileSync(inputPath, 'utf8'));
	mkdirSync(dirname(resolve(outputPath)), { recursive: true });
	writeFileSync(outputPath, JSON.stringify(coverage, null, 2));
	console.log(
		`lcov-to-istanbul: wrote ${Object.keys(coverage).length} files to ${outputPath}`,
	);
}
