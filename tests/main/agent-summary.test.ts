import { describe, expect, test } from 'vitest';

import {
	type AgentSummaryMarker,
	readAgentSummaryMarker,
	withAgentSummaryMarker,
} from '../../src/main/pi-agent/agent-summary.ts';

const marker: AgentSummaryMarker = {
	body: '- Fixed the login redirect',
	branchId: 'branch-1',
	capturedAtOrdinal: 12,
	title: 'Login redirect fix',
	updatedAt: '2026-07-01T00:00:00.000Z',
};

function withSummary(summary: unknown): Record<string, unknown> {
	return { agentSummary: summary, titleProvenance: 'agent' };
}

describe('readAgentSummaryMarker', () => {
	test('reads a complete marker back unchanged', () => {
		expect(readAgentSummaryMarker(withSummary(marker))).toEqual(marker);
	});

	test('returns null for a tab written before the field existed', () => {
		expect(readAgentSummaryMarker({ titleProvenance: 'agent' })).toBeNull();
	});

	test('returns null when the marker is not an object', () => {
		expect(readAgentSummaryMarker(withSummary('a summary'))).toBeNull();
		expect(readAgentSummaryMarker(withSummary(7))).toBeNull();
		expect(readAgentSummaryMarker(withSummary(null))).toBeNull();
	});

	test('rejects a marker with no branch id, which could leak onto a reused tab', () => {
		const { branchId: _branchId, ...withoutBranch } = marker;

		expect(readAgentSummaryMarker(withSummary(withoutBranch))).toBeNull();
	});

	test('rejects a non-string title or body', () => {
		expect(
			readAgentSummaryMarker(withSummary({ ...marker, title: 42 })),
		).toBeNull();
		expect(
			readAgentSummaryMarker(withSummary({ ...marker, body: ['a', 'b'] })),
		).toBeNull();
	});

	test('rejects a numeric-string ordinal rather than comparing it as text', () => {
		expect(
			readAgentSummaryMarker(
				withSummary({ ...marker, capturedAtOrdinal: '12' }),
			),
		).toBeNull();
	});

	test('backfills a missing updatedAt with the epoch so the field is always a string', () => {
		const { updatedAt: _updatedAt, ...withoutTimestamp } = marker;

		expect(readAgentSummaryMarker(withSummary(withoutTimestamp))).toEqual({
			...marker,
			updatedAt: new Date(0).toISOString(),
		});
	});
});

describe('withAgentSummaryMarker', () => {
	test('adds the marker alongside every other metadata key', () => {
		const metadata = { agentRole: 'subagent', titleProvenance: 'agent' };

		expect(withAgentSummaryMarker(metadata, marker)).toEqual({
			agentRole: 'subagent',
			agentSummary: marker,
			titleProvenance: 'agent',
		});
	});

	test('replaces an existing marker', () => {
		const replacement = { ...marker, capturedAtOrdinal: 20 };

		expect(
			withAgentSummaryMarker(withSummary(marker), replacement),
		).toMatchObject({ agentSummary: replacement });
	});

	test('leaves the input metadata untouched', () => {
		const metadata: Record<string, unknown> = { titleProvenance: 'agent' };

		const next = withAgentSummaryMarker(metadata, marker);

		expect(metadata).toEqual({ titleProvenance: 'agent' });
		expect(next).not.toBe(metadata);
	});

	test('round-trips through the reader', () => {
		expect(readAgentSummaryMarker(withAgentSummaryMarker({}, marker))).toEqual(
			marker,
		);
	});
});
