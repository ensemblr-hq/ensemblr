import { createContext, use } from 'react';

import type {
	ConciergeReference,
	ConciergeReferenceKind,
} from '@/shared/concierge-references';

/**
 * What the Concierge's surfaces need to turn a reference into something the user
 * can click: the catalogue lookup that says whether the app still holds it, and
 * the navigation that focuses it.
 *
 * One context rather than a pair, because nothing ever provides half of it — a
 * reference nobody can resolve is one nobody can open either, and splitting them
 * would let a surface offer a control that opens onto nothing.
 */
export interface ConciergeReferenceAccess {
	/** Focuses the reference, restoring a closed chat tab first. */
	openReference: (reference: ConciergeReference) => void;
	/** The reference behind a link, or null when the app no longer holds it. */
	resolveReference: (
		kind: ConciergeReferenceKind,
		id: string,
	) => ConciergeReference | null;
}

const ConciergeReferenceContext =
	createContext<ConciergeReferenceAccess | null>(null);

export const ConciergeReferenceProvider = ConciergeReferenceContext.Provider;

/**
 * Read the reference resolver and opener from context.
 * @returns The pair, or null outside the Concierge, where a reference chip has
 *   nothing to place itself against and renders inert.
 */
export function useConciergeReferenceAccess(): ConciergeReferenceAccess | null {
	return use(ConciergeReferenceContext);
}
