import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { AWARENESS } from '../../src/shared/agent-control.ts';

/**
 * The Pi extension cannot import from `src/` at runtime, so it embeds a copy of
 * the shared `AWARENESS` constant. These tests are the guardrail that stops the
 * two injection points from drifting.
 */
const readExtensionSource = (): string =>
	readFileSync(
		fileURLToPath(
			new URL(
				'../../resources/pi-extensions/ensemblr-control.mts',
				import.meta.url,
			),
		),
		'utf8',
	);

/**
 * Extracts the value of the `const AWARENESS = \`...\`` template literal from the
 * extension source and unescapes its backticks back to their runtime form.
 */
const extractEmbeddedAwareness = (source: string): string => {
	const match = source.match(/const AWARENESS = `((?:\\.|[^`\\])*)`;/s);
	if (!match) {
		throw new Error('Could not find the AWARENESS template literal.');
	}
	return match[1].replace(/\\`/g, '`').replace(/\\\\/g, '\\');
};

describe('agent-control AWARENESS parity', () => {
	it('embeds the shared constant byte-for-byte in the Pi extension', () => {
		expect(extractEmbeddedAwareness(readExtensionSource())).toBe(AWARENESS);
	});

	it('teaches the wait-based orchestration loop', () => {
		expect(AWARENESS).toContain('ensemblr_wait_for_agents');
		expect(AWARENESS).toContain('ensemblr_notify_orchestrator');
	});
});
