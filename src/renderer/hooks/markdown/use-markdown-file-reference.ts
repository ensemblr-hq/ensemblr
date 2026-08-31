import { useMemo } from 'react';

import { useMarkdownDocumentScope } from '@/renderer/components/markdown/markdown-document-scope-context';
import { useWorkspacePathResolver } from '@/renderer/components/workbench-shell/conversation-panel/file-preview-context';
import {
	documentReferenceLookupPath,
	isLocalFileReference,
} from '@/renderer/lib/markdown-references';
import type { MarkdownReference } from '@/renderer/types/markdown';

/**
 * Places a link or image destination a markdown document wrote against the
 * workspace file tree, reading the destination the way markdown means it:
 * relative to the document's own directory.
 *
 * The answer keeps the three outcomes apart rather than folding them into one
 * nullable match, because they are opposite instructions to the caller: a
 * `remote` destination is handed back to whoever already renders it, a `none`
 * names nothing, and a `local` one names a path the tree may still not list —
 * an asset the repository ignores is missing from the tree but present on disk.
 * @param reference - The `href` or `src` exactly as the document wrote it.
 * @returns What the destination turned out to be.
 */
export function useMarkdownFileReference(reference: string): MarkdownReference {
	const scope = useMarkdownDocumentScope();
	const resolveWorkspacePath = useWorkspacePathResolver();
	const baseDirectory = scope?.baseDirectory ?? '';
	return useMemo(() => {
		if (!isLocalFileReference(reference)) {
			return { kind: 'remote' };
		}
		const lookupPath = documentReferenceLookupPath(reference, baseDirectory);
		if (!lookupPath) {
			return { kind: 'none' };
		}
		return {
			kind: 'local',
			lookupPath,
			match: resolveWorkspacePath?.(lookupPath) ?? null,
		};
	}, [baseDirectory, reference, resolveWorkspacePath]);
}
