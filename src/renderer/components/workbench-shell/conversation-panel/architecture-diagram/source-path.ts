/**
 * True when a source path names a file rather than a folder.
 *
 * Decided from the path rather than from the file tree because the tree only
 * knows the entries it has loaded, and a diagram node may point at a directory
 * nobody has expanded. A leading dot does not count — `.github` is a folder.
 * @param sourcePath - Workspace-relative path from a component's `sources`
 * @returns True when the path should open in the file preview
 */
export function namesAFile(sourcePath: string): boolean {
	const basename = sourcePath.split('/').at(-1) ?? '';
	return basename.slice(1).includes('.');
}
