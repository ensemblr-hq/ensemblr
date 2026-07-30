/**
 * Fits a whole-workspace diff into the payload budget an agent can afford to
 * read. A workspace diff has no natural ceiling — one refactor can run to
 * megabytes — so the concatenation is capped the same way a brief child report
 * is: a char budget, a boundary-aware cut, and a prose marker naming the exact
 * call that recovers what was dropped.
 *
 * The cut lands on whole-file boundaries only. A patch severed mid-hunk is
 * unparseable, so dropping trailing files is what leaves every emitted patch
 * valid; the dropped paths come back as data, because a model acts on a list of
 * names far more reliably than on a sentence about how much is missing.
 */

/**
 * Ceiling on any single payload the control layer hands an agent, shared by the
 * workspace diff and the joined final-turn report. One cap rather than two,
 * because they are the same trade: how much of one tool result an agent's
 * context can carry before reading it costs more than the answer is worth.
 */
export const MAX_AGENT_PAYLOAD_CHARS = 32_000;

/** Separator between two files' patches in a concatenated workspace diff. */
const PATCH_SEPARATOR = '\n';

/**
 * Start of a unified-diff hunk header, the only place a single file's patch can
 * be cut and still parse. Matched with the leading newline so a `@@` inside a
 * context line cannot pass for a header.
 */
const HUNK_BOUNDARY = '\n@@ ';

/** Blank line separating a shortened payload from the marker explaining the cut. */
const POINTER_GAP = '\n\n';

/** One changed file's unified patch, as git produced it. */
export interface DiffFilePatch {
	path: string;
	patch: string;
}

/** A budgeted workspace diff plus the files that did not fit. */
export interface BudgetedDiff {
	diff: string;
	truncated: boolean;
	omittedFiles: readonly string[];
}

/**
 * Renders the pointer that tells the model how to recover the dropped files. A
 * `truncated` flag alone is not enough — models act on the wording, and the
 * per-file call is the only route back to a patch this cut away.
 * @param omittedCount - How many files were dropped from the diff.
 * @returns The sentence appended to the shortened diff.
 */
function recoveryPointer(omittedCount: number): string {
	return `… diff shortened. ${omittedCount} file(s) omitted. Re-request each with ensemblr_get_workspace_diff({ file: "<path>" }).`;
}

/**
 * Renders the marker closing a single file's patch that was cut to the budget.
 * Unlike the whole-diff pointer there is no further call that recovers the rest
 * — the file is simply larger than one tool result can carry — so the wording
 * names the reading tool instead of pretending a retry would help.
 * @param path - The file whose patch was cut.
 * @returns The sentence appended to the shortened patch.
 */
function clampPointer(path: string): string {
	return `… patch shortened at a hunk boundary: ${path} is larger than one tool result can carry. Read the rest of the file directly.`;
}

/**
 * Fits one file's patch into the budget, cutting on a hunk boundary so what
 * survives still parses. The whole-diff budget drops a file wholesale and points
 * at the per-file call to recover it, which leaves that call as the one route
 * into a patch big enough to have been dropped — so it needs a ceiling of its
 * own or the recovery pointer becomes an instruction to blow the context.
 *
 * A patch whose very first hunk overruns the budget keeps its file header alone:
 * half a hunk is unparseable, and the header still tells the model which file it
 * failed to read. The marker itself is a floor rather than part of the budget —
 * a truncated instruction is worse than a slightly over-budget one — so a budget
 * smaller than the marker returns the marker.
 * @param input - The file's path and patch, and the char budget to fit it into.
 * @returns The patch at or under budget, and whether anything was cut.
 */
export function clampFilePatch({
	path,
	patch,
	budget = MAX_AGENT_PAYLOAD_CHARS,
}: {
	path: string;
	patch: string;
	budget?: number;
}): { patch: string; truncated: boolean } {
	if (patch.length <= budget) {
		return { patch, truncated: false };
	}
	const pointer = clampPointer(path);
	const room = budget - pointer.length - POINTER_GAP.length;
	const boundary = room > 0 ? patch.lastIndexOf(HUNK_BOUNDARY, room) : -1;
	const headerOnly = Math.max(patch.indexOf(HUNK_BOUNDARY), 0);
	const kept = patch.slice(0, boundary > 0 ? boundary : headerOnly);
	return {
		patch: kept ? `${kept.trimEnd()}${POINTER_GAP}${pointer}` : pointer,
		truncated: true,
	};
}

/**
 * Concatenates per-file patches up to the budget, dropping the trailing files
 * that do not fit and naming them so each can be re-requested on its own.
 * @param input - The patches read so far, the paths never read, and the char budget.
 * @returns The joined diff, whether anything was dropped, and the dropped paths.
 */
export function budgetWorkspaceDiff({
	patches,
	unread = [],
	budget = MAX_AGENT_PAYLOAD_CHARS,
}: {
	patches: readonly DiffFilePatch[];
	/** Paths whose patch was never fetched because the budget was already spent. */
	unread?: readonly string[];
	budget?: number;
}): BudgetedDiff {
	const kept: string[] = [];
	const dropped: string[] = [];
	let size = 0;
	for (const file of patches) {
		const cost =
			file.patch.length + (kept.length > 0 ? PATCH_SEPARATOR.length : 0);
		if (dropped.length > 0 || size + cost > budget) {
			dropped.push(file.path);
			continue;
		}
		kept.push(file.patch);
		size += cost;
	}
	const omittedFiles = [...dropped, ...unread];
	const body = kept.join(PATCH_SEPARATOR);
	if (omittedFiles.length === 0) {
		return { diff: body, omittedFiles, truncated: false };
	}
	const pointer = recoveryPointer(omittedFiles.length);
	return {
		diff: body ? `${body.trimEnd()}${POINTER_GAP}${pointer}` : pointer,
		omittedFiles,
		truncated: true,
	};
}
