/**
 * Files a repository keeps without an extension, which an extension test alone
 * would hand to the directory reveal and lose.
 */
const EXTENSIONLESS_FILENAMES: ReadonlySet<string> = new Set([
	'.gitattributes',
	'.gitignore',
	'.gitmodules',
	'.npmrc',
	'.nvmrc',
	'.prettierignore',
	'AUTHORS',
	'CHANGELOG',
	'CODEOWNERS',
	'CONTRIBUTING',
	'COPYING',
	'Dockerfile',
	'Gemfile',
	'Jenkinsfile',
	'LICENCE',
	'LICENSE',
	'Makefile',
	'NOTICE',
	'Procfile',
	'Rakefile',
	'README',
	'Vagrantfile',
]);

/** A dot followed by at least one non-dot character, at the very end. */
const TRAILING_EXTENSION = /\.[^./]+$/;

/**
 * True when a source path names a file rather than a folder.
 *
 * Decided from the path rather than from the file tree because the tree only
 * knows the entries it has loaded, and a diagram node may point at a directory
 * nobody has expanded. A trailing extension decides it, measured past any
 * leading dot so `.github` still reads as a folder; the extensionless files a
 * repository routinely carries (`Dockerfile`, `LICENSE`, `.gitignore`) are
 * listed, because misreading one sends it to the directory reveal instead.
 * @param sourcePath - Workspace-relative path from a component's `sources`
 * @returns True when the path should open in the file preview
 */
export function namesAFile(sourcePath: string): boolean {
	const basename = sourcePath.split('/').at(-1) ?? '';
	if (EXTENSIONLESS_FILENAMES.has(basename)) {
		return true;
	}
	return TRAILING_EXTENSION.test(basename.replace(/^\./, ''));
}
