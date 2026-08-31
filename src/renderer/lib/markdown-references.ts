/** Matches a reference that opens with a URI scheme, such as `https:` or `data:`. */
const REFERENCE_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Reports whether a markdown `href` or `src` names something the workspace could
 * hold, rather than a remote destination or a spot inside the same document.
 *
 * Everything carrying a scheme is somebody else's to fetch — `https:` and
 * `mailto:` obviously, but also the app's own `ensemblr:` and
 * `ensemblr-linear-asset:`, both of which already have a renderer. A `#` opens
 * an in-document anchor and a leading `//` is a protocol-relative URL, which
 * reads as a path but is not one.
 * @param reference - The destination exactly as the document wrote it.
 * @returns True when the reference should be resolved against the file tree.
 */
export function isLocalFileReference(reference: string): boolean {
	const trimmed = reference.trim();
	return (
		trimmed.length > 0 &&
		!trimmed.startsWith('#') &&
		!trimmed.startsWith('//') &&
		!REFERENCE_SCHEME.test(trimmed)
	);
}

/**
 * Reduces a reference to the path part alone, dropping the query and fragment a
 * link may carry and decoding the percent-escapes an author writes for spaces.
 * A malformed escape is left as written rather than throwing.
 * @param reference - The destination exactly as the document wrote it.
 * @returns The decoded path, which is empty when the reference was only a query
 *   or a fragment.
 */
function referencePath(reference: string): string {
	const path = reference.trim().split(/[?#]/).at(0) ?? '';
	try {
		return decodeURIComponent(path);
	} catch {
		return path;
	}
}

/**
 * Anchors a markdown reference on the directory of the document that wrote it,
 * which is what a relative destination means in markdown: `./images/a.png` in
 * `docs/guide/03-first-run.md` is `docs/guide/images/a.png`, not a path from the
 * workspace root. An absolute or home-relative reference already names its own
 * location, and a document rendered from the workspace root has nothing to join.
 *
 * The `./` and `../` segments survive into the joined path; the workspace path
 * resolver normalizes them away, including a climb that escapes the root.
 * @param reference - The destination exactly as the document wrote it.
 * @param baseDirectory - Workspace-relative directory the document lives in.
 * @returns The path to hand the workspace path resolver.
 */
export function documentReferenceLookupPath(
	reference: string,
	baseDirectory: string,
): string {
	const path = referencePath(reference);
	if (
		!path ||
		!baseDirectory ||
		path.startsWith('/') ||
		path.startsWith('~/')
	) {
		return path;
	}
	return `${baseDirectory}/${path}`;
}

/**
 * Reports whether a lookup path still names something under the workspace root
 * once its `.` and `..` segments are applied.
 *
 * The preview IPC reads an escaping path perfectly happily — that is what lets a
 * file tab open `/tmp` or `~/.claude` — so a destination has to be weighed
 * before it is handed over unprompted. Markdown is not always the reader's own:
 * a pull-request comment renders through the same surface as a repository
 * document, and an image in one is fetched the moment it is drawn.
 * @param lookupPath - A reference already anchored on the document's directory.
 * @returns True when the path resolves to a file inside the workspace.
 */
export function staysInsideWorkspace(lookupPath: string): boolean {
	if (lookupPath.startsWith('/') || lookupPath.startsWith('~/')) {
		return false;
	}
	let depth = 0;
	for (const segment of lookupPath.split('/')) {
		if (segment === '' || segment === '.') {
			continue;
		}
		if (segment !== '..') {
			depth += 1;
			continue;
		}
		depth -= 1;
		if (depth < 0) {
			return false;
		}
	}
	return depth > 0;
}

/**
 * The directory a document's own relative references resolve against.
 * @param filePath - Path of the document being rendered.
 * @returns The parent directory, empty for a document at the workspace root.
 */
export function documentBaseDirectory(filePath: string): string {
	const lastSlash = filePath.lastIndexOf('/');
	return lastSlash === -1 ? '' : filePath.slice(0, lastSlash);
}
