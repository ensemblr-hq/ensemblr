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
	role: 'orchestrator',
	state: 'closed',
	workspace: 'khachaturian',
	workspaceId: 'ws-1',
};

const PROJECT: ConciergeReference = {
	kind: 'project',
	label: 'ensemblr',
	projectId: 'repo-1',
};

const ARTIFACT: ConciergeReference = {
	kind: 'artifact',
	label: 'release-plan.md',
	path: 'releases/release-plan.md',
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
		for (const reference of [WORKSPACE, CHAT, PROJECT, ARTIFACT]) {
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
		expect(roundTripBlock('<referenced_artifact name="x" />')).toBeNull();
	});

	// An artifact is the one kind addressed by a path, so it is the one kind whose
	// id carries a separator — and the only one where a link the agent wrote could
	// try to walk out of the directory the preview resolves it against.
	it('refuses an artifact path that leaves the artifacts directory', () => {
		for (const path of [
			'../memory/secrets.md',
			'nested/../../escape.md',
			'/etc/passwd',
			'./plan.md',
		]) {
			expect(
				parseConciergeReferenceHref(
					formatConciergeReferenceHref('artifact', path),
				),
			).toBeNull();
			expect(
				roundTripBlock(
					formatConciergeReferenceBlock({
						kind: 'artifact',
						label: 'x',
						path,
					}),
				),
			).toBeNull();
		}
	});

	// A markdown destination cannot carry a space, so an artifact whose name has
	// one is linked percent-encoded and has to come back as the path on disk.
	it('reads a percent-encoded artifact path back as it was written', () => {
		expect(
			parseConciergeReferenceHref('ensemblr:artifact/Q3%20report.md'),
		).toEqual({ id: 'Q3 report.md', kind: 'artifact' });
	});

	// The block is the one form an agent reads back, and its working directory is
	// the Concierge home rather than `artifacts/` — so a chip carrying the bare
	// address would send it to a path where no artifact lives.
	it('writes an artifact path the agent can open from its own directory', () => {
		expect(formatConciergeReferenceBlock(ARTIFACT)).toContain(
			'path="artifacts/releases/release-plan.md"',
		);
		expect(roundTripBlock(formatConciergeReferenceBlock(ARTIFACT))).toEqual(
			ARTIFACT,
		);
	});

	// Tolerated rather than refused: a block an agent hand-wrote in the shorter
	// form still names one artifact, and the traversal rules above are what keep
	// the value safe either way.
	it('reads an artifact path written without the directory prefix', () => {
		expect(
			roundTripBlock('<referenced_artifact name="x" path="plan.md" />'),
		).toEqual({ kind: 'artifact', label: 'x', path: 'plan.md' });
	});
});
