import { describe, expect, it } from 'vitest';

import {
	type ConciergeReference,
	conciergeReferenceBlockPattern,
	conciergeReferenceId,
	formatConciergeReferenceBlock,
	formatConciergeReferenceHref,
	parseConciergeReferenceBlock,
	parseConciergeReferenceHref,
} from '@/shared/concierge-references';

const WORKSPACE: ConciergeReference = {
	cwd: '/Users/me/Ensemblr/workspaces/ensemblr/khachaturian',
	kind: 'workspace',
	label: 'khachaturian',
	project: 'ensemblr',
	projectId: 'repo-1',
	workspaceId: 'ws-1',
};

const CHAT: ConciergeReference = {
	agentSessionId: 'sess-1',
	chatTabId: 'tab-1',
	kind: 'chat',
	label: 'Concierge "@" chips',
	state: 'closed',
	workspace: 'khachaturian',
	workspaceId: 'ws-1',
};

const PROJECT: ConciergeReference = {
	kind: 'project',
	label: 'ensemblr',
	projectId: 'repo-1',
};

/** Runs the block pattern once and rebuilds whatever it matched. */
function roundTripBlock(block: string): ConciergeReference | null {
	const match = conciergeReferenceBlockPattern().exec(block);
	return match
		? parseConciergeReferenceBlock(match[1] ?? '', match[2] ?? '')
		: null;
}

describe('concierge reference links', () => {
	it('round-trips every kind', () => {
		for (const reference of [WORKSPACE, CHAT, PROJECT]) {
			const href = formatConciergeReferenceHref(
				reference.kind,
				conciergeReferenceId(reference),
			);
			expect(parseConciergeReferenceHref(href)).toEqual({
				id: conciergeReferenceId(reference),
				kind: reference.kind,
			});
		}
	});

	it('writes the scheme the sanitizer is told to admit', () => {
		expect(formatConciergeReferenceHref('workspace', 'ws-1')).toBe(
			'ensemblr:workspace/ws-1',
		);
	});

	it('refuses another scheme, an unknown kind, and a malformed id', () => {
		expect(parseConciergeReferenceHref('javascript:workspace/ws-1')).toBeNull();
		expect(parseConciergeReferenceHref('https://example.com')).toBeNull();
		expect(parseConciergeReferenceHref('ensemblr:terminal/t-1')).toBeNull();
		expect(parseConciergeReferenceHref('ensemblr:workspace/')).toBeNull();
		expect(parseConciergeReferenceHref('ensemblr:workspace/a"b')).toBeNull();
	});
});

describe('concierge reference blocks', () => {
	it('round-trips a workspace', () => {
		expect(roundTripBlock(formatConciergeReferenceBlock(WORKSPACE))).toEqual(
			WORKSPACE,
		);
	});

	it('round-trips a chat whose title carries a quote', () => {
		const block = formatConciergeReferenceBlock(CHAT);
		expect(block).not.toContain('"@"');
		expect(roundTripBlock(block)).toEqual(CHAT);
	});

	// The pattern reads the attribute run as `[^>]*?`, so an unescaped `>` in an
	// agent-written chat title leaves the whole block unmatched and the prompt
	// renders its own markup as prose.
	it('round-trips a title carrying the characters that close a block', () => {
		const awkward: ConciergeReference = {
			...CHAT,
			label: 'Fix a > b, and <script> & "quotes"',
		};
		const block = formatConciergeReferenceBlock(awkward);
		expect(block).not.toContain('>b');
		expect([...block.matchAll(conciergeReferenceBlockPattern())]).toHaveLength(
			1,
		);
		expect(roundTripBlock(block)).toEqual(awkward);
	});

	it('reads a label that spelled out an entity back as those characters', () => {
		const literal: ConciergeReference = { ...CHAT, label: 'say &quot; twice' };
		expect(roundTripBlock(formatConciergeReferenceBlock(literal))).toEqual(
			literal,
		);
	});

	it('round-trips a project', () => {
		expect(roundTripBlock(formatConciergeReferenceBlock(PROJECT))).toEqual(
			PROJECT,
		);
	});

	it('reads an unset agent session back as null', () => {
		const orphan: ConciergeReference = { ...CHAT, agentSessionId: null };
		expect(roundTripBlock(formatConciergeReferenceBlock(orphan))).toEqual(
			orphan,
		);
	});

	it('finds every block in a prompt, in order', () => {
		const prompt = [
			'compare',
			formatConciergeReferenceBlock(WORKSPACE),
			'against',
			formatConciergeReferenceBlock(CHAT),
		].join('\n\n');
		const kinds = [...prompt.matchAll(conciergeReferenceBlockPattern())].map(
			(match) => match[1],
		);
		expect(kinds).toEqual(['workspace', 'chat']);
	});

	it('refuses a block whose ids were truncated away', () => {
		expect(roundTripBlock('<referenced_workspace name="x" />')).toBeNull();
		expect(roundTripBlock('<referenced_chat title="x" />')).toBeNull();
	});
});
