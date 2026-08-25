import type { ProjectShellModel } from '@/renderer/types/workbench';
import {
	type ConciergeReference,
	type ConciergeReferenceKind,
	conciergeReferenceId,
} from '@/shared/concierge-references';
import type { ChatTabWire } from '@/shared/ipc/contracts/chat-tab';
import type { ConciergeArtifactWire } from '@/shared/ipc/contracts/concierge';

/**
 * Every project, workspace, and chat the Concierge can be pointed at, flattened
 * out of the shell's project tree and the app-wide chat-tab listing.
 *
 * Built as one list rather than four because both surfaces that read it want it
 * that way: the `@` menu ranks every kind against one query, and the timeline
 * resolves a link by kind and id without caring which shelf it came off. Chats
 * are limited to tabs of kind `chat` — a file or terminal tab is a view of
 * something, not a conversation to point at, and a file tab already has the path
 * chip.
 *
 * Artifacts are here; memory files are not. A memory is the Concierge's own note
 * to itself, which it reads by name without being pointed at, so offering the
 * whole `memory/` directory in the menu would bury the reports the user actually
 * wants to hand back. A memory file stays previewable through the path chip in
 * an answer.
 * @param artifacts - Files under the Concierge's `artifacts/` directory.
 * @param projects - Every project the shell knows, with their workspaces.
 * @param chatTabs - Every workspace's chat tabs, open and recently closed.
 * @returns The references, in the order the menu prefers before ranking.
 */
export function buildConciergeReferences({
	artifacts = [],
	chatTabs,
	projects,
}: {
	artifacts?: readonly ConciergeArtifactWire[];
	chatTabs: { closed: readonly ChatTabWire[]; open: readonly ChatTabWire[] };
	projects: readonly ProjectShellModel[];
}): readonly ConciergeReference[] {
	const workspaceNames = new Map<string, string>();
	const workspaces: ConciergeReference[] = [];
	const projectRefs: ConciergeReference[] = [];

	for (const project of projects) {
		projectRefs.push({
			kind: 'project',
			label: project.name,
			projectId: project.id,
		});
		for (const workspace of project.workspaces) {
			if (workspace.isPendingCreation) {
				continue;
			}
			workspaceNames.set(workspace.id, workspace.name);
			workspaces.push({
				cwd: workspace.pathLabel,
				kind: 'workspace',
				label: workspace.name,
				project: project.name,
				projectId: project.id,
				workspaceId: workspace.id,
			});
		}
	}

	const chats = [
		...chatReferences(chatTabs.open, 'open', workspaceNames),
		...chatReferences(chatTabs.closed, 'closed', workspaceNames),
	];

	const artifactRefs = artifacts.map(
		(artifact): ConciergeReference => ({
			kind: 'artifact',
			label: artifact.name,
			path: artifact.relativePath,
		}),
	);

	return [...workspaces, ...artifactRefs, ...chats, ...projectRefs];
}

/**
 * Looks a reference up by what a link addresses it with.
 *
 * A chat answers to its agent session id as well as its tab id. The two are the
 * same conversation named from either end, and the control surface names it from
 * the far end: `ensemblr_send_follow_up`, `ensemblr_get_conversation_status`,
 * `ensemblr_get_last_message`, and `ensemblr_read_conversation` all take an
 * `agentSessionId`, so a timeline row for one of them has no tab id to look up.
 * The two id spaces never collide, so accepting both cannot resolve the wrong
 * chat.
 * @param references - The catalogue.
 * @param kind - Kind parsed out of the link.
 * @param id - Id parsed out of the link.
 * @returns The reference, or null when the app no longer holds it.
 */
export function findConciergeReference(
	references: readonly ConciergeReference[],
	kind: ConciergeReferenceKind,
	id: string,
): ConciergeReference | null {
	return (
		references.find(
			(reference) =>
				reference.kind === kind &&
				(conciergeReferenceId(reference) === id ||
					(reference.kind === 'chat' && reference.agentSessionId === id)),
		) ?? null
	);
}

/**
 * The composer attachment a picked reference becomes. `id` is what dedupes the
 * chip and targets its removal, so it is namespaced by kind — a project and the
 * workspace under it are different rows that may share nothing but a name.
 * @param reference - The reference the user picked.
 * @returns The attachment to insert at the caret.
 */
export function conciergeReferenceAttachment(reference: ConciergeReference): {
	id: string;
	kind: 'artifact-ref' | 'chat-ref' | 'project-ref' | 'workspace-ref';
	label: string;
	reference: ConciergeReference;
} {
	return {
		id: `${reference.kind}-ref:${conciergeReferenceId(reference)}`,
		kind: `${reference.kind}-ref`,
		label: reference.label,
		reference,
	};
}

/**
 * The chip glyph a reference wears, which is its own kind for the three app
 * surfaces and a file for an artifact — a document on disk, so the file tree's
 * own icon set reads it by extension and a `.md` report looks like one.
 *
 * Returned as a literal union rather than typed against `ChatAttachmentChipKind`
 * so this module stays clear of the component tree it feeds.
 * @param reference - The reference being rendered.
 * @returns The chip kind.
 */
export function conciergeReferenceChipKind(
	reference: ConciergeReference,
): 'chat' | 'file' | 'project' | 'workspace' {
	return reference.kind === 'artifact' ? 'file' : reference.kind;
}

/**
 * What a reference chip's tooltip says, qualifying a name that repeats across
 * the app — two projects each hold a `main` workspace, and two workspaces each
 * hold an untitled chat.
 * @param reference - The reference being rendered.
 * @returns The tooltip text.
 */
export function conciergeReferenceTitle(reference: ConciergeReference): string {
	if (reference.kind === 'artifact') {
		return reference.path;
	}
	if (reference.kind === 'workspace') {
		return `${reference.project} › ${reference.label}`;
	}
	if (reference.kind === 'chat') {
		return `${reference.workspace} › ${reference.label}`;
	}
	return reference.label;
}

/**
 * The chat references one half of the listing contributes.
 *
 * Three kinds of row are left out. A tab that is not a conversation — a file, a
 * diff, a terminal — is a view of something rather than something to point at,
 * and a file tab already has the path chip. A tab whose workspace the shell does
 * not show belongs to an archived one, which still has rows in the database and
 * would navigate nowhere. And a chat nobody has named yet carries a blank title
 * by design, so the row would read as an empty line: the menu exists to be
 * recognized by name, and a run of nameless rows is worse than none, since the
 * tab is still one click away in its own workspace.
 * @param tabs - Chat tabs from one half of the listing.
 * @param state - Whether these tabs are open or closed.
 * @param workspaceNames - Workspace id to name, for the chip's tooltip.
 * @returns The chat references.
 */
function chatReferences(
	tabs: readonly ChatTabWire[],
	state: 'closed' | 'open',
	workspaceNames: ReadonlyMap<string, string>,
): readonly ConciergeReference[] {
	return tabs.flatMap((tab) => {
		const workspace = workspaceNames.get(tab.workspaceId);
		const label = tab.fullTitle || tab.title;
		return tab.kind === 'chat' && workspace !== undefined && label
			? [
					{
						agentSessionId: tab.agentSessionId,
						chatTabId: tab.id,
						kind: 'chat' as const,
						label,
						state,
						workspace,
						workspaceId: tab.workspaceId,
					},
				]
			: [];
	});
}
