/**
 * Runs every captured Pi RPC fixture line through the shared parser. The
 * schemas were derived from these captures, so every stdout frame must parse
 * as a known event — zero invalid-json, zero unknown-frame fallbacks.
 */

/// <reference types="bun" />

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parsePiRpcLine, piCapturedLineSchema } from '../../src/shared/pi-rpc';

const FIXTURE_DIR = new URL('../fixtures/pi-captures', import.meta.url)
	.pathname;

const fixtureNames = readdirSync(FIXTURE_DIR)
	.filter((name) => name.endsWith('.jsonl'))
	.sort();

describe('pi-rpc fixture parsing', () => {
	test('fixture matrix is present', () => {
		expect(fixtureNames.length).toBeGreaterThanOrEqual(12);
	});

	for (const fixtureName of fixtureNames) {
		test(`${fixtureName} parses with zero failures`, () => {
			const content = readFileSync(join(FIXTURE_DIR, fixtureName), 'utf8');
			const failures: string[] = [];
			let frames = 0;
			for (const line of content.split('\n')) {
				if (line.length === 0) {
					continue;
				}
				const wrapped = piCapturedLineSchema.parse(JSON.parse(line));
				if (wrapped.stream !== 'stdout') {
					continue;
				}
				frames += 1;
				const result = parsePiRpcLine(wrapped.raw);
				if (!result.ok) {
					failures.push(
						`${result.reason} (type=${result.frameType ?? 'n/a'}): ${wrapped.raw.slice(0, 120)}`,
					);
				}
			}
			expect(frames).toBeGreaterThan(0);
			expect(failures).toEqual([]);
		});
	}
});
