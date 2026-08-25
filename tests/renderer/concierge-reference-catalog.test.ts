import { describe, expect, it, vi } from 'vitest';

import {
	buildConciergeReferences,
	conciergeReferenceAttachment,
	conciergeReferenceChipKind,
	findConciergeReference,
} from '@/renderer/lib/concierge';
import { getWorkspaceFileIconNameForPath } from '@/renderer/lib/workbench';
import { serializeComposerDraft } from '@/renderer/lib/workbench/mention-payload';
import type { ProjectShellModel } from '@/renderer/types/workbench';
import type { ChatTabWire } from '@/shared/ipc/contracts/chat-tab';

vi.mock('@/renderer/api/ensemblr-queries', () => ({
	readWorkspaceFile: vi.fn(),
}));

/** A project shell row carrying only what the catalogue reads off it. */
function project(
	id: string,
	name: string,
	workspaces: readonly {
		id: string;
		isPendingCreation?: boolean;
		name: string;
	}[],
): ProjectShellModel {
	return {
		id,
		name,
		owner: { name: 'me' },
		pathLabel: `/repos/${name}`,
		workspaces: workspaces.map((workspace) => ({
			...workspace,
			pathLabel: `/workspaces/${name}/${workspace.name}`,
		})),
	} as unknown as ProjectShellModel;
}

/** A chat-tab row carrying only what the catalogue reads off it. */
function tab(overrides: Partial<ChatTabWire> & { id: string }): ChatTabWire {
	return {
		agentSessionId: null,
		closedAt: null,
		fullTitle: overrides.title ?? overrides.id,
		isPreview: false,
		kind: 'chat',
		metadata: {},
		openedAt: '2026-08-24T00:00:00.000Z',
		position: 0,
		title: overrides.id,
		workspaceId: 'ws-1',
		...overrides,
	} as ChatTabWire;
}

const PROJECTS = [
	project('repo-1', 'ensemblr', [
		{ id: 'ws-1', name: 'khachaturian' },
		{ id: 'ws-pending', isPendingCreation: true, name: 'not-yet' },
	]),
];

describe('the Concierge reference catalogue', () => {
	it('offers workspaces first, then chats, then projects', () => {
		const references = buildConciergeReferences({
			chatTabs: { closed: [], open: [tab({ id: 'tab-1', title: 'a chat' })] },
			projects: PROJECTS,
		});
		expect(references.map((reference) => reference.kind)).toEqual([
			'workspace',
			'chat',
			'project',
		]);
	});

	it('leaves out a workspace that does not exist on disk yet', () => {
		const references = buildConciergeReferences({
			chatTabs: { closed: [], open: [] },
			projects: PROJECTS,
		});
		expect(references.some((reference) => reference.label === 'not-yet')).toBe(
			false,
		);
	});

	it('leaves out tabs that are not conversations, and tabs from workspaces the shell does not show', () => {
		const references = buildConciergeReferences({
			chatTabs: {
				closed: [],
				open: [
					tab({ id: 'file-tab', kind: 'file' }),
					tab({ id: 'orphan-tab', workspaceId: 'ws-archived' }),
					tab({ id: 'chat-tab' }),
				],
			},
			projects: PROJECTS,
		});
		expect(
			references.filter((reference) => reference.kind === 'chat'),
		).toHaveLength(1);
	});

	it('leaves out a chat nobody has named, which would render as a blank row', () => {
		const references = buildConciergeReferences({
			chatTabs: {
				closed: [tab({ fullTitle: '', id: 'old', title: '' })],
				open: [
					tab({ fullTitle: '', id: 'live', title: '' }),
					tab({ id: 'named', title: 'howdy' }),
				],
			},
			projects: PROJECTS,
		}).filter((reference) => reference.kind === 'chat');
		expect(references.map((reference) => reference.label)).toEqual(['howdy']);
	});

	it('marks a closed chat as closed and names the workspace holding it', () => {
		const [chat] = buildConciergeReferences({
			chatTabs: { closed: [tab({ id: 'old', title: 'yesterday' })], open: [] },
			projects: PROJECTS,
		}).filter((reference) => reference.kind === 'chat');
		expect(chat).toMatchObject({
			label: 'yesterday',
			state: 'closed',
			workspace: 'khachaturian',
		});
	});

	it('looks a reference up by the id its link carries', () => {
		const references = buildConciergeReferences({
			chatTabs: { closed: [], open: [] },
			projects: PROJECTS,
		});
		expect(
			findConciergeReference(references, 'workspace', 'ws-1'),
		).toMatchObject({ label: 'khachaturian' });
		expect(findConciergeReference(references, 'workspace', 'gone')).toBeNull();
		expect(findConciergeReference(references, 'chat', 'ws-1')).toBeNull();
	});

	// The control surface names a conversation from the far end: every op that
	// steers, checks, or reads one takes an `agentSessionId`, so a timeline row
	// for one of them has no tab id to look a chip up by.
	it('looks a chat up by its agent session as well as its tab', () => {
		const references = buildConciergeReferences({
			chatTabs: {
				closed: [],
				open: [
					tab({ agentSessionId: 'session-1', id: 'tab-1', title: 'a chat' }),
				],
			},
			projects: PROJECTS,
		});

		expect(findConciergeReference(references, 'chat', 'tab-1')).toMatchObject({
			label: 'a chat',
		});
		expect(
			findConciergeReference(references, 'chat', 'session-1'),
		).toMatchObject({ label: 'a chat' });
		expect(findConciergeReference(references, 'chat', 'session-9')).toBeNull();
	});
});

describe('sending a reference chip', () => {
	it('serializes it as a block of ids, in the place the chip sat', async () => {
		const [workspace] = buildConciergeReferences({
			chatTabs: { closed: [], open: [] },
			projects: PROJECTS,
		});
		if (!workspace) {
			throw new Error('expected a workspace reference');
		}

		const prompt = await serializeComposerDraft({
			segments: [
				{ kind: 'text', text: 'what changed in' },
				{
					attachment: conciergeReferenceAttachment(workspace),
					kind: 'attachment',
				},
				{ kind: 'text', text: 'today?' },
			],
			workspaceCwd: '/concierge',
		});

		expect(prompt).toBe(
			[
				'what changed in',
				'<referenced_workspace name="khachaturian" workspaceId="ws-1" projectId="repo-1" project="ensemblr" cwd="/workspaces/ensemblr/khachaturian" />',
				'today?',
			].join('\n\n'),
		);
	});

	it('offers the Concierge’s artifacts alongside the app’s own surfaces', () => {
		const references = buildConciergeReferences({
			artifacts: [
				{
					modifiedAt: '2026-08-25T10:00:00.000Z',
					name: 'release-plan.md',
					relativePath: 'releases/release-plan.md',
					size: 120,
				},
			],
			chatTabs: { closed: [], open: [] },
			projects: [],
		});

		expect(references).toEqual([
			{
				kind: 'artifact',
				label: 'release-plan.md',
				path: 'releases/release-plan.md',
			},
		]);
		expect(conciergeReferenceAttachment(references[0]!).kind).toBe(
			'artifact-ref',
		);
	});

	// An artifact is a document on disk, so it wears the file tree's own icon set
	// and is read by extension rather than getting a generic page glyph.
	it('draws an artifact with the file tree’s own icon', () => {
		const chipKind = conciergeReferenceChipKind({
			kind: 'artifact',
			label: 'release-plan.md',
			path: 'releases/release-plan.md',
		});

		expect(chipKind).toBe('file');
		expect(getWorkspaceFileIconNameForPath('releases/release-plan.md')).toBe(
			getWorkspaceFileIconNameForPath('any/other/note.md'),
		);
		expect(
			getWorkspaceFileIconNameForPath('releases/release-plan.md'),
		).not.toBe(getWorkspaceFileIconNameForPath('releases/release-plan.json'));
	});

	it('namespaces a chip id by kind, so a project and its workspace never collide', () => {
		const references = buildConciergeReferences({
			chatTabs: { closed: [], open: [] },
			projects: [
				project('same-id', 'ensemblr', [{ id: 'same-id', name: 'w' }]),
			],
		});
		const ids = references.map(
			(reference) => conciergeReferenceAttachment(reference).id,
		);
		expect(new Set(ids).size).toBe(ids.length);
	});
});
