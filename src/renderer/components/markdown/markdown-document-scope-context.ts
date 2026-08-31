import { createContext, use } from 'react';

import type { MarkdownDocumentScope } from '@/renderer/types/markdown';

const MarkdownDocumentScopeContext =
	createContext<MarkdownDocumentScope | null>(null);

export const MarkdownDocumentScopeProvider =
	MarkdownDocumentScopeContext.Provider;

/**
 * Read the markdown document scope from context.
 * @returns The scope, or null where markdown renders outside a workspace and
 *   its local references have no tree to resolve against.
 */
export function useMarkdownDocumentScope(): MarkdownDocumentScope | null {
	return use(MarkdownDocumentScopeContext);
}
