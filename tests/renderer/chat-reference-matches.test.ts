import { describe, expect, it, vi } from 'vitest';

import {
	CHAT_REFERENCE_MATCH_LIMIT,
	getChatReferenceMatches,
} from '@/renderer/hooks/workbench-shell/composer/use-chat-reference-matches';
import { conciergeReferenceAttachment } from '@/renderer/lib/concierge';
import { serializeComposerDraft } from '@/renderer/lib/workbench/mention-payload';
import type { ConciergeReference } from '@/shared/concierge-references';

vi.mock('@/renderer/api/ensemblr-queries', () => ({
	readWorkspaceFile: vi.fn(),
}));

/** A chat reference carrying only what the ranking reads off it. */
function chat(
	label: string,
	overrides: Partial<Extract<ConciergeReference, { kind: 'chat' }>> = {},
): ConciergeReference {
	return {
		agentSessionId: `session-${label}`,
		chatTabId: `tab-${label}`,
		kind: 'chat',
		label,
		role: 'orchestrator',
		state: 'open',
		workspace: 'khachaturian',
		workspaceId: 'ws-1',
		...overrides,
	};
}

/** The labels a ranking returned, in order. */
function labels(
	matches: readonly { reference: ConciergeReference }[],
): string[] {
	return matches.map((match) => match.reference.label);
}

describe('the composer @ menu ranking a workspace’s chats', () => {
	it('offers every chat in the order it arrived when nothing is typed', () => {
		const matches = getChatReferenceMatches(
			[chat('Reference chats'), chat('Audit the docs'), chat('Ship 0.1.4')],
			'',
		);

		expect(labels(matches)).toEqual([
			'Reference chats',
			'Audit the docs',
			'Ship 0.1.4',
		]);
	});

	it('drops the chats the query does not match', () => {
		const matches = getChatReferenceMatches(
			[chat('Reference chats'), chat('Audit the docs')],
			'audit',
		);

		expect(labels(matches)).toEqual(['Audit the docs']);
	});

	it('ranks a prefix above a subsequence', () => {
		const matches = getChatReferenceMatches(
			[chat('Rebuild the audit trail'), chat('Audit the docs')],
			'audit',
		);

		expect(labels(matches)).toEqual([
			'Audit the docs',
			'Rebuild the audit trail',
		]);
	});

	it('sinks a closed chat below an open one it scores level with', () => {
		const matches = getChatReferenceMatches(
			[
				chat('Audit one', { state: 'closed' }),
				chat('Audit two', { state: 'open' }),
			],
			'audit',
		);

		expect(labels(matches)).toEqual(['Audit two', 'Audit one']);
	});

	it('caps the rows so the first file stays on the same page of the menu', () => {
		const references = Array.from({ length: 12 }, (_, index) =>
			chat(`Chat ${index}`),
		);

		expect(getChatReferenceMatches(references, '')).toHaveLength(
			CHAT_REFERENCE_MATCH_LIMIT,
		);
	});

	it('reports the spans of the label the query matched', () => {
		const [match] = getChatReferenceMatches([chat('Audit the docs')], 'audit');

		expect(match?.labelRanges).toEqual([{ end: 5, start: 0 }]);
	});

	it('offers a chat a bare @ turned up even though nothing scored it', () => {
		const matches = getChatReferenceMatches([chat('Ship the release')], '');

		expect(labels(matches)).toEqual(['Ship the release']);
	});

	it('drops a chat the query only reached by walking a subsequence', () => {
		const matches = getChatReferenceMatches(
			[chat('Ship the release candidate')],
			'src',
		);

		expect(labels(matches)).toEqual([]);
	});

	it('keeps a chat the query matched in one contiguous run', () => {
		const matches = getChatReferenceMatches(
			[chat('Rewrite the src layout')],
			'src',
		);

		expect(labels(matches)).toEqual(['Rewrite the src layout']);
	});
});

describe('a chat picked out of the @ menu', () => {
	it('sends the ids the agent needs to read that conversation', async () => {
		const prompt = await serializeComposerDraft({
			segments: [
				{ kind: 'text', text: 'pick up where' },
				{
					attachment: conciergeReferenceAttachment(chat('Audit the docs')),
					kind: 'attachment',
				},
				{ kind: 'text', text: 'left off' },
			],
			workspaceCwd: '/workspaces/ensemblr/khachaturian',
		});

		expect(prompt).toBe(
			[
				'pick up where',
				'<referenced_chat title="Audit the docs" chatTabId="tab-Audit the docs" workspaceId="ws-1" workspace="khachaturian" agentSessionId="session-Audit the docs" state="open" role="orchestrator" />',
				'left off',
			].join('\n\n'),
		);
	});
});
