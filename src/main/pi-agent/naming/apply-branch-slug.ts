/**
 * One-shot workspace + git-branch naming from a slug.
 *
 * Two callers reach it: the agent, through `ensemblr_set_branch_name`, and the
 * deterministic namer that runs when a session opens. Both go through the same
 * gate, so whichever lands first wins and the other reports "already named"
 * rather than clobbering it. The gate is deliberately conservative — a
 * workspace is nameable only while it still carries the generated placeholder
 * name, has never been renamed, and the user has left the "Let agents name the
 * workspace and branch" setting on — because the name is the user's the moment
 * they touch it, and turning the setting off means they never wanted the app to
 * touch it at all.
 */

import type { DatabaseSync } from 'node:sqlite';

import type { SetBranchNameResult } from '../../../shared/agent-control.ts';
import type { RenameWorkspaceService } from '../../repository';
import { parseMetadata } from '../../repository/metadata.ts';
import { selectWorkspaceWithRepositoryById } from '../../storage/repositories/workspace-repository.ts';
import {
	composeRenamedBranch,
	isWorkspaceNameable,
	sanitizeBranchSlug,
} from '../branch-name-slug.ts';

/** The workspace branch + metadata consulted by the rename gate. */
interface WorkspaceRenameTarget {
	branchName: string | null;
	metadataJson: string;
	name: string;
}

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
 * Names a workspace and its git branch from one slug, keeping any `prefix/`
 * segment of the current branch. `namingEnabled` carries the user's resolved
 * `git.renameWorkspaceOnBranch` setting and is a hard gate: when it is off
 * nothing is renamed and the caller is told to stop, whatever the workspace's
 * placeholder state — the always-on agent preamble asks every agent to name its
 * branch, so this is the only thing standing between an opted-out user and a
 * renamed workspace.
 * @param input - The workspace to name, the raw slug, the user's naming setting, and the rename service.
 * @returns Whether the name was applied, plus the resulting name and branch.
 * @throws {BranchSlugRejected} When the workspace is unknown, the slug is unusable, or the branch collides with an existing one.
 */
export async function applyBranchSlug({
	database,
	name,
	namingEnabled,
	renameWorkspace,
	workspaceId,
}: {
	database: DatabaseSync;
	name: string;
	namingEnabled: boolean;
	renameWorkspace: RenameWorkspaceService['rename'];
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
			`"${name}" has no usable branch-name characters. Use a kebab-case slug such as "add-dark-mode".`,
		);
	}
	if (!isNameable(target)) {
		return alreadyNamed(target);
	}

	const result = await renameWorkspace({
		branchName: composeRenamedBranch(target.branchName ?? '', slug),
		name: slug,
		requirePlaceholderName: true,
		workspaceId,
	});
	if (result.status !== 'success') {
		throw new BranchSlugRejected(
			'collision',
			`Could not name the workspace "${slug}": ${result.diagnostics?.at(0)?.message ?? result.status}. Try a different slug.`,
		);
	}
	// The rename service returns the unchanged workspace when its own placeholder
	// re-check blocks the write, so a raced-out attempt is indistinguishable from
	// success by status alone.
	if (result.workspace?.name !== slug) {
		return alreadyNamed(readRenameTarget(database, workspaceId) ?? target);
	}
	return {
		applied: true,
		branchName: result.workspace.branchName ?? null,
		message: `Named the workspace "${slug}" and its git branch "${result.workspace.branchName ?? slug}". Naming is one-shot — a further call will report the workspace as already named.`,
		name: slug,
	};
}

/**
 * Builds the no-op result telling an agent the name is settled and to stop
 * retrying.
 * @param target - The workspace as it stands, whose name and branch the message quotes.
 * @returns An unapplied result naming the workspace's existing state.
 */
function alreadyNamed(target: WorkspaceRenameTarget): SetBranchNameResult {
	const branch = target.branchName ? ` on branch \`${target.branchName}\`` : '';
	return {
		applied: false,
		branchName: target.branchName,
		message: `This workspace is already named "${target.name}"${branch}, and the name is the user's to change. Nothing was changed — do not call this tool again in this session.`,
		name: target.name,
	};
}

/**
 * Builds the no-op result for a user who turned workspace/branch naming off.
 * Worded so an agent following the standing "name the branch on your first
 * turn" instruction learns the instruction does not apply here.
 * @param target - The workspace as it stands, left untouched.
 * @returns An unapplied result naming the workspace's existing state.
 */
function namingTurnedOff(target: WorkspaceRenameTarget): SetBranchNameResult {
	const branch = target.branchName ? ` on branch \`${target.branchName}\`` : '';
	return {
		applied: false,
		branchName: target.branchName,
		message: `The user has turned off "Let agents name the workspace and branch", so this workspace keeps the name "${target.name}"${branch}. Nothing was changed — do not call this tool again in this session.`,
		name: target.name,
	};
}

/**
 * Applies the placeholder-name gate to a target read from the database.
 * @param target - The workspace's current name, branch, and metadata.
 * @returns True while the workspace still carries an untouched placeholder name.
 */
function isNameable(target: WorkspaceRenameTarget): boolean {
	return isWorkspaceNameable(parseMetadata(target.metadataJson));
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
