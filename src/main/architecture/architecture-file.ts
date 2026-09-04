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
 * and letting the next scan settle it.
 */
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
	type ArchitectureIR,
	parseArchitectureIrResult,
} from '../../shared/architecture-diagram.ts';

/** Directory in a repository that holds Ensemblr's committed files. */
const ENSEMBLR_DIRECTORY = '.ensemblr';

/** Filename the diagram is stored under, inside {@link ENSEMBLR_DIRECTORY}. */
const DIAGRAM_FILENAME = 'architecture.json';

/**
 * How the stored document wraps the IR with the provenance a rebuild needs.
 *
 * Deliberately does NOT carry the working-tree hash the rebuild gate compares
 * against. That hash is a machine-local cache key: committing it would put a
 * line of churn in every diff, and — because writing this file changes the
 * working tree — a hash taken before the write is stale the moment it lands, so
 * the gate would re-scan forever. It lives in memory in the service instead.
 */
interface StoredDiagram {
	/** ISO timestamp of the write. */
	generatedAt: string;
	/** Hash of the module graph's topology when this was written. */
	graphFingerprint: string;
	/** The diagram itself. */
	ir: ArchitectureIR;
	/** `scan` for the deterministic seed, `agent` once one has refined it. */
	source: 'agent' | 'scan';
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
	return path.join(workspaceCwd, ENSEMBLR_DIRECTORY, DIAGRAM_FILENAME);
}

/** Workspace-relative path of the diagram file, for display and for `sources`. */
export const ARCHITECTURE_FILE_RELATIVE_PATH = `${ENSEMBLR_DIRECTORY}/${DIAGRAM_FILENAME}`;

/**
 * What a read of the stored file found.
 *
 * `absent` and `unreadable` are deliberately different answers. Absent means
 * scan one. Unreadable means a document *is* there and this build cannot make
 * sense of it — a hand edit, a merge conflict, a refinement with one bad field
 * — and the file is tracked, so overwriting it would silently destroy work the
 * user can see in their diff. Every caller stops on it instead.
 */
export type ArchitectureFileRead =
	| { contents: ArchitectureFileContents; status: 'stored' }
	| { status: 'absent' }
	| { problem: string; status: 'unreadable' };

/**
 * Reads a workspace's stored diagram.
 * @param workspaceCwd - Absolute path of the workspace root
 * @returns What the read found: a diagram, nothing, or a file it cannot use
 */
export async function readArchitectureFile(
	workspaceCwd: string,
): Promise<ArchitectureFileRead> {
	let raw: string;
	try {
		raw = await readFile(architectureFilePath(workspaceCwd), 'utf8');
	} catch {
		return { status: 'absent' };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		return {
			problem: error instanceof Error ? error.message : 'It is not valid JSON.',
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
			graphFingerprint:
				typeof document.graphFingerprint === 'string'
					? document.graphFingerprint
					: '',
			ir: result.ir,
			relativePath: ARCHITECTURE_FILE_RELATIVE_PATH,
			source: document.source === 'agent' ? 'agent' : 'scan',
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
 * @param contents - The diagram and its provenance
 * @param workspaceCwd - Absolute path of the workspace root
 */
export function writeArchitectureFile({
	contents,
	workspaceCwd,
}: {
	contents: StoredDiagram;
	workspaceCwd: string;
}): void {
	const filePath = architectureFilePath(workspaceCwd);
	const temporaryPath = `${filePath}.tmp`;
	mkdirSync(path.dirname(filePath), { recursive: true });
	writeFileSync(
		temporaryPath,
		`${JSON.stringify(contents, null, '\t')}\n`,
		'utf8',
	);
	renameSync(temporaryPath, filePath);
}
