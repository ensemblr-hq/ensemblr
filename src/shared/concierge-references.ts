/**
 * Addressing for the three things the Concierge names but cannot open: a
 * project, a workspace, and a chat tab.
 *
 * File paths already had an answer — an absolute path in backticks becomes a
 * chip the user clicks — but a workspace has no path to write, so the Concierge
 * naming one left dead text on screen. This module is the one place the syntax
 * for the other three lives, because it has to survive a full round trip through
 * surfaces that never see each other: the composer serializes a chip into a
 * prompt block, the agent reads that block and writes an `ensemblr:` link back,
 * the renderer parses the link into a chip, and the persisted prompt is parsed
 * back into chips when the transcript replays. A second copy of the grammar
 * anywhere in that loop is a silent break at one of its four seams.
 *
 * The link is a markdown destination rather than a token in backticks so an
 * unresolvable reference degrades to its own label rather than to a raw id, and
 * the scheme is deliberately one the sanitizer must be told about
 * (`src/renderer/lib/markdown-rehype-plugins.ts`) rather than a bare `#`, so
 * nothing but a reference this app minted can reach the chip renderer.
 */

/** What a reference points at. A project has no focusable surface; the other two do. */
export type ConciergeReferenceKind = 'chat' | 'project' | 'workspace';

/** Scheme every Concierge reference link is written on. */
export const CONCIERGE_REFERENCE_SCHEME = 'ensemblr';

/** Whether a chat tab is still open, which decides whether a click restores it first. */
export type ConciergeChatReferenceState = 'closed' | 'open';

/**
 * One reference, in the form both the prompt block and the chip read it. The
 * variants carry exactly the ids their control ops take and the names their
 * chips read — no branch, no board status, no transcript: those are fetched on
 * demand and would go stale pinned into a transcript.
 */
export type ConciergeReference =
	| {
			kind: 'project';
			label: string;
			projectId: string;
	  }
	| {
			/** Absolute worktree root, which is what a read of the workspace resolves against. */
			cwd: string;
			kind: 'workspace';
			label: string;
			/** Name of the project holding the workspace, for the chip's tooltip. */
			project: string;
			projectId: string;
			workspaceId: string;
	  }
	| {
			/** Session behind the tab, or null for a tab that never opened one. */
			agentSessionId: string | null;
			chatTabId: string;
			kind: 'chat';
			label: string;
			state: ConciergeChatReferenceState;
			/** Name of the workspace holding the tab, for the chip's tooltip. */
			workspace: string;
			workspaceId: string;
	  };

/** The id a reference is addressed by, which is what its link and its click both key on. */
export function conciergeReferenceId(reference: ConciergeReference): string {
	if (reference.kind === 'project') {
		return reference.projectId;
	}
	return reference.kind === 'workspace'
		? reference.workspaceId
		: reference.chatTabId;
}

/** Tag prefix every reference block opens with. */
const BLOCK_TAG_PREFIX = 'referenced_';

/** Ids are opaque to this module, so anything that could close a link is refused. */
const REFERENCE_ID = /^[^\s"<>/]{1,128}$/;

/** One `name="value"` pair inside a reference block. */
const BLOCK_ATTRIBUTE = /([a-z][a-zA-Z]*)="([^"]*)"/g;

/**
 * The link destination a reference is written as, which the Concierge puts in an
 * ordinary markdown link so the label stays readable if the id no longer
 * resolves.
 * @param kind - What the reference points at.
 * @param id - The project, workspace, or chat-tab id.
 * @returns The `ensemblr:` destination.
 */
export function formatConciergeReferenceHref(
	kind: ConciergeReferenceKind,
	id: string,
): string {
	return `${CONCIERGE_REFERENCE_SCHEME}:${kind}/${id}`;
}

/**
 * Reads a link destination back as the reference it addresses, refusing anything
 * that is not one — another scheme, an unknown kind, an id carrying characters
 * no id of ours has.
 * @param href - The destination as it was written in markdown.
 * @returns The kind and id, or null when the link is not a reference.
 */
export function parseConciergeReferenceHref(
	href: string,
): { id: string; kind: ConciergeReferenceKind } | null {
	const prefix = `${CONCIERGE_REFERENCE_SCHEME}:`;
	if (!href.startsWith(prefix)) {
		return null;
	}
	const [rawKind, ...rest] = href.slice(prefix.length).split('/');
	const id = rest.join('/');
	return isReferenceKind(rawKind) && REFERENCE_ID.test(id)
		? { id, kind: rawKind }
		: null;
}

/**
 * The prompt block a reference chip serializes to, carrying the ids the
 * Concierge's control ops take so it can act on what the user pointed at without
 * listing the app first.
 * @param reference - The reference behind the chip.
 * @returns The self-closing block, with every value quote-escaped.
 */
export function formatConciergeReferenceBlock(
	reference: ConciergeReference,
): string {
	const attributes = referenceAttributes(reference)
		.map(([name, value]) => `${name}="${escapeAttribute(value)}"`)
		.join(' ');
	return `<${BLOCK_TAG_PREFIX}${reference.kind} ${attributes} />`;
}

/**
 * Fresh global regex matching every reference block, with the kind in capture
 * group 1 and the raw attribute run in group 2. Returned fresh per call so
 * callers never share a stateful `lastIndex`.
 * @returns A new `RegExp` for reference blocks.
 */
export function conciergeReferenceBlockPattern(): RegExp {
	return new RegExp(
		`<${BLOCK_TAG_PREFIX}(chat|project|workspace) ([^>]*?)\\s*/>`,
		'g',
	);
}

/**
 * Rebuilds a reference from a block the pattern matched, refusing one whose
 * required ids are missing — a truncated prompt should read back as prose rather
 * than as a chip that opens nothing.
 * @param kind - Capture group 1 of the block pattern.
 * @param rawAttributes - Capture group 2 of the block pattern.
 * @returns The reference, or null when the block is incomplete.
 */
export function parseConciergeReferenceBlock(
	kind: string,
	rawAttributes: string,
): ConciergeReference | null {
	if (!isReferenceKind(kind)) {
		return null;
	}
	const values = blockAttributes(rawAttributes);
	const label = values.get(labelAttribute(kind)) ?? '';
	if (kind === 'project') {
		const projectId = values.get('projectId');
		return projectId ? { kind, label, projectId } : null;
	}
	if (kind === 'workspace') {
		const projectId = values.get('projectId');
		const workspaceId = values.get('workspaceId');
		return projectId && workspaceId
			? {
					cwd: values.get('cwd') ?? '',
					kind,
					label,
					project: values.get('project') ?? '',
					projectId,
					workspaceId,
				}
			: null;
	}
	const chatTabId = values.get('chatTabId');
	const workspaceId = values.get('workspaceId');
	return chatTabId && workspaceId
		? {
				agentSessionId: values.get('agentSessionId') || null,
				chatTabId,
				kind,
				label,
				state: values.get('state') === 'closed' ? 'closed' : 'open',
				workspace: values.get('workspace') ?? '',
				workspaceId,
			}
		: null;
}

/**
 * The attribute a kind writes its human-readable name under, so a block reads as
 * the thing it names rather than as a generic `label`.
 * @param kind - What the reference points at.
 * @returns The attribute name.
 */
function labelAttribute(kind: ConciergeReferenceKind): string {
	return kind === 'chat' ? 'title' : 'name';
}

/**
 * The block's attributes in a fixed order, so the same reference always
 * serializes to the same bytes.
 * @param reference - The reference being serialized.
 * @returns Name/value pairs, in the order they are written.
 */
function referenceAttributes(
	reference: ConciergeReference,
): readonly (readonly [string, string])[] {
	if (reference.kind === 'project') {
		return [
			['name', reference.label],
			['projectId', reference.projectId],
		];
	}
	if (reference.kind === 'workspace') {
		return [
			['name', reference.label],
			['workspaceId', reference.workspaceId],
			['projectId', reference.projectId],
			['project', reference.project],
			['cwd', reference.cwd],
		];
	}
	return [
		['title', reference.label],
		['chatTabId', reference.chatTabId],
		['workspaceId', reference.workspaceId],
		['workspace', reference.workspace],
		['agentSessionId', reference.agentSessionId ?? ''],
		['state', reference.state],
	];
}

/**
 * Reads a block's `name="value"` run back into a lookup, unescaping the quotes
 * {@link escapeAttribute} put in.
 * @param rawAttributes - The block's attribute run.
 * @returns Attribute name to value.
 */
function blockAttributes(rawAttributes: string): ReadonlyMap<string, string> {
	const values = new Map<string, string>();
	for (const match of rawAttributes.matchAll(BLOCK_ATTRIBUTE)) {
		values.set(match[1] ?? '', unescapeAttribute(match[2] ?? ''));
	}
	return values;
}

/**
 * Escapes every character that could end an attribute — or the whole block —
 * early. `>` matters as much as `"`: {@link conciergeReferenceBlockPattern}
 * scans the attribute run as `[^>]*?`, so one in an agent-written chat title
 * leaves the block unmatched and the prompt renders its own markup as prose.
 * @param value - The raw attribute value.
 * @returns The value with its structural characters entity-escaped.
 */
function escapeAttribute(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('"', '&quot;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;');
}

/**
 * Reads an attribute value back, undoing {@link escapeAttribute}. `&amp;` is
 * undone last so a value that spelled out `&quot;` comes back as those six
 * characters rather than as a quote.
 * @param value - The escaped attribute value.
 * @returns The original text.
 */
function unescapeAttribute(value: string): string {
	return value
		.replaceAll('&quot;', '"')
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>')
		.replaceAll('&amp;', '&');
}

/** Narrows a raw string to a reference kind. */
function isReferenceKind(value: unknown): value is ConciergeReferenceKind {
	return value === 'chat' || value === 'project' || value === 'workspace';
}
