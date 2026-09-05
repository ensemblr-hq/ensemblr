/**
 * Reads and writes a workspace's architecture diagram as a file in the
 * repository, at `.ensemblr/architecture.json`.
 *
 * In the repository rather than in SQLite so the diagram travels with the code
 * it describes: it shows up in a pull request the way any other file does, a
 * clone arrives with the architecture already drawn, and the refinement an
 * agent made is reviewable rather than hidden in application state. The cost is
 * that parallel workspaces cut from one repository can conflict on it, the same
 * way they conflict on any committed file — resolve it by taking either side
 * and letting the next agent update settle it.
 */
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import {
	ARCHITECTURE_FILE_RELATIVE_PATH,
	type ArchitectureIR,
	parseArchitectureIrResult,
} from '../../shared/architecture-diagram.ts';

export { ARCHITECTURE_FILE_RELATIVE_PATH };

/**
 * Largest stored document read at all. A diagram is bounded — at most a few
 * dozen components with short labels — so anything past this is a mistake or a
 * hostile file, and reading it means allocating and `JSON.parse`ing it on the
 * main thread before anything can decide it is too big.
 */
const MAX_DIAGRAM_BYTES = 4 * 1024 * 1024;

/** How the stored document wraps the IR with the time it was authored. */
interface StoredDiagram {
	/** ISO timestamp of the write. */
	generatedAt: string;
	/** The diagram itself. */
	ir: ArchitectureIR;
}

/** A diagram read back off disk. */
export interface ArchitectureFileContents extends StoredDiagram {
	/** Workspace-relative path it was read from, for the renderer to name. */
	relativePath: string;
}

/**
 * The diagram's path inside a workspace.
 * @param workspaceCwd - Absolute path of the workspace root
 * @returns Absolute path of the diagram file
 */
export function architectureFilePath(workspaceCwd: string): string {
	return path.join(workspaceCwd, ...ARCHITECTURE_FILE_RELATIVE_PATH.split('/'));
}

/**
 * What a read of the stored file found.
 *
 * `absent` and `unreadable` are deliberately different answers. Absent means
 * nobody has drawn this workspace yet. Unreadable means a document *is* there
 * and this build cannot make sense of it — a hand edit, a merge conflict, an
 * update with one bad field — and the file is tracked, so overwriting it would
 * silently destroy work the user can see in their diff. Every caller stops on
 * it instead.
 */
export type ArchitectureFileRead =
	| { contents: ArchitectureFileContents; status: 'stored' }
	| { status: 'absent' }
	| { problem: string; status: 'unreadable' };

/**
 * The `code` a Node filesystem rejection carries, when it carries one.
 * @param error - Whatever the filesystem call rejected with
 * @returns The error code, or null for anything that is not a system error
 */
function errorCodeOf(error: unknown): string | null {
	return typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		typeof (error as { code: unknown }).code === 'string'
		? (error as { code: string }).code
		: null;
}

/**
 * Reads the raw file, keeping "there is none" apart from "there is one and this
 * build could not get at it".
 *
 * Only `ENOENT` means absent. A permission denial, a directory where the file
 * should be, an exhausted descriptor table — each of those is a document that
 * exists and that a caller must not write over, so they answer `unreadable`
 * with the code that stopped them.
 * @param filePath - Absolute path of the diagram file
 * @returns The file's text, or why it could not be had
 */
async function readDiagramText(
	filePath: string,
): Promise<{ raw: string } | ArchitectureFileRead> {
	try {
		const stats = await stat(filePath);
		if (stats.size > MAX_DIAGRAM_BYTES) {
			return {
				problem: `It is ${stats.size} bytes, past the ${MAX_DIAGRAM_BYTES}-byte ceiling for a diagram.`,
				status: 'unreadable',
			};
		}
		return { raw: await readFile(filePath, 'utf8') };
	} catch (error) {
		if (errorCodeOf(error) === 'ENOENT') {
			return { status: 'absent' };
		}
		return {
			problem:
				errorCodeOf(error) ??
				(error instanceof Error ? error.message : 'It could not be read.'),
			status: 'unreadable',
		};
	}
}

/**
 * Reads a workspace's stored diagram.
 * @param workspaceCwd - Absolute path of the workspace root
 * @returns What the read found: a diagram, nothing, or a file it cannot use
 */
export async function readArchitectureFile(
	workspaceCwd: string,
): Promise<ArchitectureFileRead> {
	const read = await readDiagramText(architectureFilePath(workspaceCwd));
	if (!('raw' in read)) {
		return read;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(read.raw);
	} catch (error) {
		return {
			problem: error instanceof Error ? error.message : 'It is not valid JSON.',
			status: 'unreadable',
		};
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		return {
			problem: 'The document is not a JSON object.',
			status: 'unreadable',
		};
	}
	const document = parsed as Partial<StoredDiagram>;
	const result = parseArchitectureIrResult(document.ir);
	if (!result.ok) {
		return { problem: result.problems.join('; '), status: 'unreadable' };
	}
	return {
		contents: {
			generatedAt:
				typeof document.generatedAt === 'string' ? document.generatedAt : '',
			ir: result.ir,
			relativePath: ARCHITECTURE_FILE_RELATIVE_PATH,
		},
		status: 'stored',
	};
}

/**
 * Writes a workspace's diagram, replacing whatever was there.
 *
 * Written through a temporary file and renamed, so a crash mid-write cannot
 * leave a half-written document in the repository — the same discipline the
 * committed `settings.toml` writer uses. Trailing newline included, because
 * this file is meant to be read in a diff.
 *
 * The IR is validated against the schema that reads it back first. A producer
 * emitting a document this build then refuses leaves the workspace with a
 * diagram every path reports as unreadable and none will write over, which the
 * user can only escape by deleting the file outside the app — so a bad document
 * fails its own write instead.
 * @param contents - The diagram and the time it was authored
 * @param workspaceCwd - Absolute path of the workspace root
 */
export function writeArchitectureFile({
	contents,
	workspaceCwd,
}: {
	contents: StoredDiagram;
	workspaceCwd: string;
}): void {
	const validated = parseArchitectureIrResult(contents.ir);
	if (!validated.ok) {
		throw new Error(
			`Refusing to write ${ARCHITECTURE_FILE_RELATIVE_PATH}: the diagram would not load back. ${validated.problems.join('; ')}`,
		);
	}
	const filePath = architectureFilePath(workspaceCwd);
	const temporaryPath = `${filePath}.tmp`;
	mkdirSync(path.dirname(filePath), { recursive: true });
	try {
		writeFileSync(
			temporaryPath,
			`${JSON.stringify(contents, null, '\t')}\n`,
			'utf8',
		);
		renameSync(temporaryPath, filePath);
	} finally {
		rmSync(temporaryPath, { force: true });
	}
}
