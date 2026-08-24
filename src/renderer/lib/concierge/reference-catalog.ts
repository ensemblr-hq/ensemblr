import type { ProjectShellModel } from '@/renderer/types/workbench';
import {
	type ConciergeReference,
	type ConciergeReferenceKind,
	conciergeReferenceId,
} from '@/shared/concierge-references';
import type { ChatTabWire } from '@/shared/ipc/contracts/chat-tab';

/**
 * Every project, workspace, and chat the Concierge can be pointed at, flattened
 * out of the shell's project tree and the app-wide chat-tab listing.
 *
 * Built as one list rather than three because both surfaces that read it want it
 * that way: the `@` menu ranks all three kinds against one query, and the
 * timeline resolves a link by kind and id without caring which shelf it came
 * off. Chats are limited to tabs of kind `chat` — a file or terminal tab is a
 * view of something, not a conversation to point at, and a file tab already has
 * the path chip.
 * @param projects - Every project the shell knows, with their workspaces.
 * @param chatTabs - Every workspace's chat tabs, open and recently closed.
 * @returns The references, in the order the menu prefers before ranking.
 */
export function buildConciergeReferences({
	chatTabs,
	projects,
}: {
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

	return [...workspaces, ...chats, ...projectRefs];
}

/**
 * Looks a reference up by what a link addresses it with.
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
				reference.kind === kind && conciergeReferenceId(reference) === id,
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
	kind: 'chat-ref' | 'project-ref' | 'workspace-ref';
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
