import type { WorkspacePathMatch } from './workbench';

/**
 * Where a markdown surface's own relative links and images point.
 *
 * Markdown resolves a relative reference against the directory of the document
 * that wrote it, so rendering one needs to know which document that is; reading
 * the bytes back needs the workspace root the read IPC is scoped to. A chat
 * answer has no document of its own and sits at `baseDirectory: ''`, which makes
 * the paths an agent writes workspace-relative — which is how agents write them.
 */
export interface MarkdownDocumentScope {
	/** Workspace-relative directory the document lives in; empty at the root. */
	baseDirectory: string;
	/** Absolute workspace root every file read is resolved against. */
	workspaceCwd: string;
}

/**
 * What a markdown `href` or `src` turned out to be once weighed against the
 * workspace file tree.
 *
 * The three cases fail differently and must not collapse into one nullable
 * answer: `remote` is handed back to whoever already renders it, `none` names
 * nothing at all, and `local` names a path — which the tree may or may not have
 * been able to place, a distinction the caller still needs.
 */
export type MarkdownReference =
	| { kind: 'remote' }
	| { kind: 'none' }
	| {
			kind: 'local';
			/** The reference anchored on the document's directory, unnormalized. */
			lookupPath: string;
			/** The tree entry, or null for a path the tree does not list. */
			match: WorkspacePathMatch | null;
	  };
