/**
 * Pure parsers for git's porcelain/diff/log output. Kept separate from the
 * service so the invocation orchestration (`workspace-git-status.ts`) stays
 * focused and these stay trivially unit-testable — they take a raw stdout
 * string and return structured rows, with no I/O.
 */
import type {
	WorkspaceCommitWire,
	WorkspaceGitFileStatus,
} from '../../shared/ipc/contracts/workspace-git';

/** Unit/record separators keep commit subjects (which may hold anything) safe. */
const COMMIT_FIELD_SEP = '\x1f';
const COMMIT_RECORD_SEP = '\x1e';

export interface PorcelainEntry {
	path: string;
	renamedFrom?: string;
	status: WorkspaceGitFileStatus;
}

/**
 * Parses the unit/record-separated `git log` output into commit rows. Each
 * record is `hash␟short␟author␟isoDate␟relative␟subject␞`; the trailing record
 * separator yields one empty chunk that is skipped.
 */
export function parseWorkspaceCommits(stdout: string): WorkspaceCommitWire[] {
	const commits: WorkspaceCommitWire[] = [];
	for (const record of stdout.split(COMMIT_RECORD_SEP)) {
		// Records are newline-joined by `--pretty=format`; drop the leading break.
		const trimmed = record.replace(/^\s+/, '');
		if (!trimmed) {
			continue;
		}
		const fields = trimmed.split(COMMIT_FIELD_SEP);
		const [hash, shortHash, author, isoDate, relativeTime, subject] = fields;
		if (fields.length < 6 || !hash) {
			continue;
		}
		commits.push({
			author: author ?? '',
			hash,
			isoDate: isoDate ?? '',
			relativeTime: relativeTime ?? '',
			shortHash: shortHash ?? '',
			subject: subject ?? '',
		});
	}
	return commits;
}

/**
 * Parses `git status --porcelain -z` output. Rename entries emit a second
 * NUL-separated token holding the original path.
 */
export function parsePorcelainStatus(
	stdout: string,
): readonly PorcelainEntry[] {
	const tokens = stdout.split('\0');
	const entries: PorcelainEntry[] = [];
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (!token || token.length < 4) {
			continue;
		}
		const stagedCode = token[0];
		const unstagedCode = token[1];
		const filePath = token.slice(3);
		const status = classifyPorcelainCodes(stagedCode, unstagedCode);
		if (status === 'renamed') {
			const renamedFrom = tokens[index + 1];
			index += 1;
			entries.push({
				path: filePath,
				...(renamedFrom ? { renamedFrom } : {}),
				status,
			});
			continue;
		}
		entries.push({ path: filePath, status });
	}
	return entries;
}

/** Maps porcelain XY codes to a renderer-facing file status. */
function classifyPorcelainCodes(
	staged: string,
	unstaged: string,
): WorkspaceGitFileStatus {
	if (staged === '?' || unstaged === '?') {
		return 'untracked';
	}
	if (staged === '!' || unstaged === '!') {
		return 'ignored';
	}
	if (
		staged === 'U' ||
		unstaged === 'U' ||
		(staged === 'A' && unstaged === 'A') ||
		(staged === 'D' && unstaged === 'D')
	) {
		return 'conflicted';
	}
	if (staged === 'R' || unstaged === 'R') {
		return 'renamed';
	}
	if (staged === 'A') {
		return 'added';
	}
	if (staged === 'D' || unstaged === 'D') {
		return 'deleted';
	}
	return 'modified';
}

/**
 * Parses `git diff --name-status -z` output. Each record is `STATUS\0PATH`;
 * renames and copies emit a similarity-scored code plus two paths
 * (`R100\0OLD\0NEW`). Status codes map to the same vocabulary as the
 * working-tree porcelain status.
 */
export function parseNameStatus(stdout: string): readonly PorcelainEntry[] {
	const tokens = stdout.split('\0');
	const entries: PorcelainEntry[] = [];
	for (let index = 0; index < tokens.length; index += 1) {
		const code = tokens[index];
		if (!code) {
			continue;
		}
		const letter = code[0];
		if (letter === 'R' || letter === 'C') {
			const from = tokens[index + 1];
			const to = tokens[index + 2];
			index += 2;
			if (!to) {
				continue;
			}
			entries.push(
				letter === 'R'
					? {
							path: to,
							...(from ? { renamedFrom: from } : {}),
							status: 'renamed',
						}
					: { path: to, status: 'added' },
			);
			continue;
		}
		const filePath = tokens[index + 1];
		index += 1;
		if (!filePath) {
			continue;
		}
		entries.push({ path: filePath, status: mapNameStatusCode(letter) });
	}
	return entries;
}

/** Maps a `git diff --name-status` single-letter code to a file status. */
function mapNameStatusCode(code: string | undefined): WorkspaceGitFileStatus {
	switch (code) {
		case 'A':
			return 'added';
		case 'D':
			return 'deleted';
		case 'U':
			return 'conflicted';
		default:
			// M (modified), T (type change), and anything unexpected.
			return 'modified';
	}
}

/**
 * Parses `git diff --numstat -z` output into path → counts. Binary files use
 * `-` for both counts and map to `null`. Renames emit
 * `added\tdeleted\t\0old\0new\0`.
 */
export function parseNumstat(
	stdout: string,
): Map<string, { additions: number | null; deletions: number | null }> {
	const counts = new Map<
		string,
		{ additions: number | null; deletions: number | null }
	>();
	const tokens = stdout.split('\0');
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (!token) {
			continue;
		}
		const parts = token.split('\t');
		if (parts.length < 3) {
			continue;
		}
		const additions = parts[0] === '-' ? null : Number.parseInt(parts[0], 10);
		const deletions = parts[1] === '-' ? null : Number.parseInt(parts[1], 10);
		let filePath = parts[2];
		if (!filePath) {
			// Rename form: counts token ends with an empty path, followed by
			// old-path and new-path tokens.
			index += 2;
			filePath = tokens[index] ?? '';
		}
		if (!filePath) {
			continue;
		}
		counts.set(filePath, {
			additions: Number.isNaN(additions) ? null : additions,
			deletions: Number.isNaN(deletions) ? null : deletions,
		});
	}
	return counts;
}
