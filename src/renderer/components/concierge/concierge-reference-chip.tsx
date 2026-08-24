import { ChatAttachmentChip } from '@/renderer/components/chat-attachment-chip';
import {
	CONCIERGE_REFERENCE_ID_ATTRIBUTE,
	CONCIERGE_REFERENCE_KIND_ATTRIBUTE,
} from '@/renderer/lib/markdown-rehype-plugins';
import type { ConciergeReference } from '@/shared/concierge-references';

import { useConciergeReferenceAccess } from './concierge-reference-context';

/** The props the rehype rewrite leaves on the element, as React receives them. */
interface ConciergeReferenceChipProps {
	[CONCIERGE_REFERENCE_ID_ATTRIBUTE]?: string;
	[CONCIERGE_REFERENCE_KIND_ATTRIBUTE]?: string;
	children?: React.ReactNode;
}

/**
 * A project, workspace, or chat the Concierge named in an answer, rendered as
 * the same chip its `@` menu produces.
 *
 * Reached through the `ensemblr-ref` element the rehype chain rewrites a
 * reference link into, so it never has to be threaded down through the markdown
 * renderer. What the Concierge wrote as the link's text is deliberately not what
 * the chip shows: the label comes from the catalogue, so a workspace renamed
 * since the answer was written reads by its current name rather than by the one
 * it had that morning.
 *
 * A reference the app no longer holds — an archived workspace, a deleted project
 * — falls back to the link text as prose. That is the whole reason the syntax is
 * a markdown link rather than a token: what degrades is a readable name, not an
 * id.
 */
export function ConciergeReferenceChip({
	children,
	...props
}: ConciergeReferenceChipProps) {
	const access = useConciergeReferenceAccess();
	const kind = props[CONCIERGE_REFERENCE_KIND_ATTRIBUTE];
	const id = props[CONCIERGE_REFERENCE_ID_ATTRIBUTE];
	const reference =
		access && isReferenceKind(kind) && id
			? access.resolveReference(kind, id)
			: null;

	if (!(access && reference)) {
		return <>{children}</>;
	}
	return (
		<ChatAttachmentChip
			className='ensemblr-answer-chip'
			kind={reference.kind}
			label={reference.label}
			onActivate={
				reference.kind === 'project'
					? undefined
					: () => access.openReference(reference)
			}
			title={referenceTitle(reference)}
		/>
	);
}

/** What the chip's tooltip says, qualifying a name that repeats across the app. */
function referenceTitle(reference: ConciergeReference): string {
	if (reference.kind === 'workspace') {
		return `${reference.project} › ${reference.label}`;
	}
	if (reference.kind === 'chat') {
		return `${reference.workspace} › ${reference.label}`;
	}
	return reference.label;
}

/** Narrows the rewritten element's kind attribute back to a reference kind. */
function isReferenceKind(
	value: string | undefined,
): value is ConciergeReference['kind'] {
	return value === 'chat' || value === 'project' || value === 'workspace';
}
