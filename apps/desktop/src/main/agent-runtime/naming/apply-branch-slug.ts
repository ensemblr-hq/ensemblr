/**
 * Workspace + git-branch naming from one naming input.
 *
 * The input is rendered twice, for the two surfaces that carry it: the git
 * branch takes the kebab slug, and the workspace takes a human-readable name
 * with words and spaces. Workspace *creation* has always split it that way —
 * `prepareWorkspace` keeps the typed name and slugs it separately for the
 * folder and the branch — and rename does the same here, so a workspace is
 * never titled with its own branch name minus the `prefix/`.
 *
 * Two callers reach it: the agent, through `ensemblr_set_branch_name`, and the
 * deterministic namer that runs when a session opens. Both go through the same
 * gate, so whichever lands first wins and the other reports "already named"
 * rather than clobbering it. The gate is conservative by default — the branch
 * must still carry the name it was cut with, and the user must have left the
 * "Let agents name the workspace and branch" setting on — because turning the
 * setting off means they never wanted the app to touch it at all.
 *
 * The display name and the branch are gated separately, because a workspace can
 * hold a title the user chose over a branch nobody has named — a rename that is
 * handed the branch it already has, or that only moves the title, leaves the
 * branch on the name it was cut with. Such a workspace has its branch moved and
 * its title left alone; the reverse, clobbering a name the user chose, never
 * happens. The rename service re-checks both gates against the freshly-read row,
 * so the decision made here from a pre-flight read cannot outrun a user rename.
 *
 * `userRequested` is the escape hatch for the one case the gate cannot see: the
 * user asking, in so many words, for a different branch name. Without it an
 * agent's only remaining move is `git branch -m`, which renames the branch
 * behind the app's back and desyncs the workspace row from git, so every refusal
 * here says not to.
 */

import type { DatabaseSync } from 'node:sqlite';

import type { SetBranchNameResult } from '../../../shared/agent-control.ts';
import { composeRenamedBranch } from '../../../shared/branch-name.ts';
import type { RenameWorkspaceService } from '../../repository';
import { parseMetadata } from '../../repository/metadata.ts';
import { selectWorkspaceWithRepositoryById } from '../../storage/repositories/workspace-repository.ts';
import {
	isBranchNameable,
	isProvisionallyNameable,
	isWorkspaceNameable,
	sanitizeBranchSlug,
} from '../branch-name-slug.ts';
import { deriveWorkspaceDisplayName } from './workspace-display-name.ts';

/** The workspace branch + metadata consulted by the rename gate. */
interface WorkspaceRenameTarget {
	branchName: string | null;
	metadataJson: string;
	name: string;
}

/** Closing line every no-op carries, so a refusal never reads as "use git". */
const NEVER_USE_GIT =
	'Do NOT rename the branch with `git branch -m`: that moves it behind the app and leaves the workspace pointing at a branch that no longer exists.';

/** Raised when a slug cannot be applied for a reason the agent should act on. */
export class BranchSlugRejected extends Error {
	constructor(
		readonly reason: 'invalid-slug' | 'collision' | 'unknown-workspace',
		message: string,
	) {
		super(message);
		this.name = 'BranchSlugRejected';
	}
}

/**
 * Names a workspace and its git branch from one naming input — the branch as a
 * kebab slug, the workspace as a readable name — keeping any `prefix/` segment
 * of the current branch. `namingEnabled` carries the user's resolved
 * `git.renameWorkspaceOnBranch` setting and is a hard gate that `userRequested`
 * does not lift: when it is off nothing is renamed and the caller is told to
 * stop, whatever the workspace's placeholder state.
 * `provisional` marks a name the app guessed from the user's first prompt rather
 * than one anybody chose. Such a rename deliberately leaves both naming gates
 * open, so it fills the board without spending the agent's one call, and it
 * passes the narrower {@link isProvisionallyNameable} instead: a guess only ever
 * improves on a generated placeholder, so it never runs over a workspace
 * somebody has titled, nor a second time over a name it already guessed.
 * @param input - The workspace to name, the raw naming input, whether the user asked for this rename by name, whether this is the app's own provisional guess, the user's naming setting, and the rename service.
 * @returns Whether the name was applied, plus the resulting name and branch.
 * @throws {BranchSlugRejected} When the workspace is unknown, the input yields no usable slug, or the branch collides with an existing one.
 */
export async function applyBranchSlug({
	database,
	name,
	namingEnabled,
	provisional = false,
	renameWorkspace,
	userRequested = false,
	workspaceId,
}: {
	database: DatabaseSync;
	name: string;
	namingEnabled: boolean;
	provisional?: boolean;
	renameWorkspace: RenameWorkspaceService['rename'];
	userRequested?: boolean;
	workspaceId: string;
}): Promise<SetBranchNameResult> {
	const target = readRenameTarget(database, workspaceId);
	if (!target) {
		throw new BranchSlugRejected(
			'unknown-workspace',
			'This workspace could not be resolved.',
		);
	}
	if (!namingEnabled) {
		return namingTurnedOff(target);
	}
	const slug = sanitizeBranchSlug(name);
	if (!slug) {
		throw new BranchSlugRejected(
			'invalid-slug',
			`"${name}" has no usable branch-name characters. Use a short name for the work, such as "Add dark mode".`,
		);
	}
	const metadata = parseMetadata(target.metadataJson);
	if (metadata.adoptedBranch === true) {
		return branchAdopted(target);
	}
	if (!isBranchNameable(metadata) && !userRequested) {
		return alreadyNamed(target);
	}
	if (provisional && !isProvisionallyNameable(metadata)) {
		return alreadyNamed(target);
	}

	const nextBranch = composeRenamedBranch(target.branchName ?? '', slug);
	const displayName = deriveWorkspaceDisplayName(name) ?? slug;
	const result = await renameWorkspace({
		branchName: nextBranch,
		name: isWorkspaceNameable(metadata) ? displayName : target.name,
		provisional,
		requirePlaceholderName: !userRequested,
		workspaceId,
	});
	if (result.status !== 'success') {
		throw new BranchSlugRejected(
			'collision',
			`Could not name the branch "${nextBranch}": ${result.diagnostics?.at(0)?.message ?? result.status}. Try a different slug.`,
		);
	}
	// The rename service reports success without writing when its own re-check of
	// the naming gates closes them, so a raced-out attempt is indistinguishable
	// from a real rename by status alone.
	const named = result.changed ? result.workspace : null;
	if (!named) {
		return alreadyNamed(readRenameTarget(database, workspaceId) ?? target);
	}
	// Read off the written row rather than this call's pre-flight guess: the
	// service narrows the rename to the branch alone when a user title landed in
	// between, and the message has to describe what was actually written.
	return {
		applied: true,
		branchName: named.branchName,
		message:
			named.name === target.name
				? `Named the git branch "${named.branchName}". The workspace keeps the name "${named.name}", which is the user's to change in the rename dialog.`
				: `Named the workspace "${named.name}" and its git branch "${named.branchName}". Naming is one-shot — a further call will report the branch as already named.`,
		name: named.name,
	};
}

/**
 * Builds the no-op result telling an agent the branch is settled, and how to
 * proceed when the user is the one asking for a different name.
 * @param target - The workspace as it stands, whose name and branch the message quotes.
 * @returns An unapplied result naming the workspace's existing state.
 */
function alreadyNamed(target: WorkspaceRenameTarget): SetBranchNameResult {
	const branch = target.branchName ? ` on branch \`${target.branchName}\`` : '';
	return {
		applied: false,
		branchName: target.branchName,
		message: `This workspace is already named "${target.name}"${branch}, and the name is the user's to change. Nothing was changed — do not call this tool again unprompted. If the USER asked for a different branch name in so many words, call it once more with userRequested: true. ${NEVER_USE_GIT}`,
		name: target.name,
	};
}

/**
 * Builds the no-op result for a workspace that took over a branch it did not
 * cut. Such a branch usually backs a pull request, so nothing may move it.
 * @param target - The workspace as it stands, left untouched.
 * @returns An unapplied result naming the workspace's existing state.
 */
function branchAdopted(target: WorkspaceRenameTarget): SetBranchNameResult {
	return {
		applied: false,
		branchName: target.branchName,
		message: `This workspace took over the existing branch \`${target.branchName}\`, which may already back a pull request, so its branch cannot be renamed — by this tool or any other. Nothing was changed. ${NEVER_USE_GIT}`,
		name: target.name,
	};
}

/**
 * Builds the no-op result for a user who turned workspace/branch naming off.
 * Worded so an agent following the standing "name the branch" instruction learns
 * the instruction does not apply here.
 * @param target - The workspace as it stands, left untouched.
 * @returns An unapplied result naming the workspace's existing state.
 */
function namingTurnedOff(target: WorkspaceRenameTarget): SetBranchNameResult {
	const branch = target.branchName ? ` on branch \`${target.branchName}\`` : '';
	return {
		applied: false,
		branchName: target.branchName,
		message: `The user has turned off "Let agents name the workspace and branch", so this workspace keeps the name "${target.name}"${branch}. Nothing was changed — do not call this tool again in this session, and do not work around it. ${NEVER_USE_GIT}`,
		name: target.name,
	};
}

/**
 * Reads the current name, branch, and metadata for a workspace.
 * @param database - Open SQLite handle.
 * @param workspaceId - The workspace to read.
 * @returns The rename target, or null when the workspace does not exist.
 */
function readRenameTarget(
	database: DatabaseSync,
	workspaceId: string,
): WorkspaceRenameTarget | null {
	const row = selectWorkspaceWithRepositoryById({ database, workspaceId });
	if (!row || typeof row !== 'object') {
		return null;
	}
	const record = row as Record<string, unknown>;
	return {
		branchName:
			typeof record.branchName === 'string' ? record.branchName : null,
		metadataJson:
			typeof record.metadataJson === 'string' ? record.metadataJson : '',
		name: typeof record.name === 'string' ? record.name : workspaceId,
	};
}
