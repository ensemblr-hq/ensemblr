import type { TFunction } from 'i18next';

import type { CheckpointFailureCode } from '@/shared/ipc/contracts/checkpoint';
import type { CloneGithubRepositoryDiagnosticCode } from '@/shared/ipc/contracts/clone';
import type { GithubFailureCode } from '@/shared/ipc/contracts/github';
import type { QuickStartProjectDiagnosticCode } from '@/shared/ipc/contracts/quick-start';
import type {
	ArchiveRepositoryDiagnosticCode,
	DeleteRepositoryDiagnosticCode,
	RegisterLocalRepositoryDiagnosticCode,
} from '@/shared/ipc/contracts/repository';
import type { RootDirectoryDiagnosticCode } from '@/shared/ipc/contracts/root-directory';
import type { SharedRootAdoptionDiagnosticCode } from '@/shared/ipc/contracts/shared-root-adoption';
import type {
	ArchiveWorkspaceDiagnosticCode,
	ContinueWorkspaceBranchDiagnosticCode,
	CreateWorkspaceDiagnosticCode,
	DeleteArchivedWorkspaceDiagnosticCode,
	DeleteWorkspaceDiagnosticCode,
	FilesToCopyDiagnosticCode,
	RenameWorkspaceDiagnosticCode,
	SetWorkspaceBaseBranchDiagnosticCode,
	UnarchiveWorkspaceDiagnosticCode,
} from '@/shared/ipc/contracts/workspace';
import type {
	ListWorkspaceFilesFailureCode,
	ReadWorkspaceDirectoryFailureCode,
	ReadWorkspaceFileFailureCode,
	WriteWorkspaceFileAttachmentFailureCode,
	WriteWorkspaceImageAttachmentFailureCode,
} from '@/shared/ipc/contracts/workspace-files';
import type { WorkspaceGitFailureCode } from '@/shared/ipc/contracts/workspace-git';

/**
 * Every failure and diagnostic code the main process can hand the renderer to
 * display. The unions overlap heavily — a dozen of them raise
 * `database-unavailable` — so they share one text table rather than one per
 * union, which is what keeps the same failure worded the same way everywhere.
 */
export type AppFailureCode =
	| ArchiveRepositoryDiagnosticCode
	| ArchiveWorkspaceDiagnosticCode
	| CheckpointFailureCode
	| CloneGithubRepositoryDiagnosticCode
	| ContinueWorkspaceBranchDiagnosticCode
	| CreateWorkspaceDiagnosticCode
	| DeleteArchivedWorkspaceDiagnosticCode
	| DeleteRepositoryDiagnosticCode
	| DeleteWorkspaceDiagnosticCode
	| FilesToCopyDiagnosticCode
	| GithubFailureCode
	| ListWorkspaceFilesFailureCode
	| QuickStartProjectDiagnosticCode
	| ReadWorkspaceDirectoryFailureCode
	| ReadWorkspaceFileFailureCode
	| RegisterLocalRepositoryDiagnosticCode
	| RenameWorkspaceDiagnosticCode
	| RootDirectoryDiagnosticCode
	| SetWorkspaceBaseBranchDiagnosticCode
	| SharedRootAdoptionDiagnosticCode
	| UnarchiveWorkspaceDiagnosticCode
	| WorkspaceGitFailureCode
	| WriteWorkspaceFileAttachmentFailureCode
	| WriteWorkspaceImageAttachmentFailureCode;

/**
 * The headline each code renders as. A `Record` over the union rather than a
 * `switch`, so a code added in main or shared is a missing-key compile error
 * here instead of an English sentence leaking into a translated surface.
 *
 * The text says what went wrong, not which path it happened to; main's own
 * message keeps the runtime specifics and the diagnostic rows show it beneath
 * this line.
 */
export const APP_FAILURE_TEXT: Record<
	AppFailureCode,
	(t: TFunction) => string
> = {
	'archive-aborted-by-hook': (t) =>
		t(
			'errors:failure.archive-aborted-by-hook',
			'An archive hook stopped the operation.',
		),
	'archive-record-missing': (t) =>
		t(
			'errors:failure.archive-record-missing',
			'No archive record was found for this workspace.',
		),
	'archived-context-already-exists': (t) =>
		t(
			'errors:failure.archived-context-already-exists',
			'An archived context already exists at the destination.',
		),
	'archived-context-cleanup-failed': (t) =>
		t(
			'errors:failure.archived-context-cleanup-failed',
			'The archived context could not be removed.',
		),
	'archived-context-copy-failed': (t) =>
		t(
			'errors:failure.archived-context-copy-failed',
			'The context directory could not be copied into the archive.',
		),
	'archived-context-missing': (t) =>
		t(
			'errors:failure.archived-context-missing',
			'No archived context was found, so the restore was skipped.',
		),
	'archived-context-restore-failed': (t) =>
		t(
			'errors:failure.archived-context-restore-failed',
			'The archived context could not be restored.',
		),
	'archived-contexts-directory-missing': (t) =>
		t(
			'errors:failure.archived-contexts-directory-missing',
			'The managed root has no archived-contexts directory. Configure the root directory first.',
		),
	auth: (t) =>
		t(
			'errors:failure.auth',
			'GitHub authentication failed. Sign in again, then retry.',
		),
	'base-branch-invalid': (t) =>
		t(
			'errors:failure.base-branch-invalid',
			'That base branch name is not valid.',
		),
	'base-branch-missing': (t) =>
		t(
			'errors:failure.base-branch-missing',
			'The base branch was not preserved, so the worktree cannot be recreated.',
		),
	'base-branch-unresolvable': (t) =>
		t(
			'errors:failure.base-branch-unresolvable',
			'That base branch could not be resolved in this repository, even after fetching.',
		),
	'base-branch-unsynced': (t) =>
		t(
			'errors:failure.base-branch-unsynced',
			'The base branch is out of sync with its remote.',
		),
	'branch-adopted': (t) =>
		t(
			'errors:failure.branch-adopted',
			'This workspace took over an existing branch, which may already back a pull request, so the branch cannot be renamed here.',
		),
	'branch-already-checked-out': (t) =>
		t(
			'errors:failure.branch-already-checked-out',
			'That branch is already checked out in another worktree.',
		),
	'branch-already-exists': (t) =>
		t('errors:failure.branch-already-exists', 'That branch already exists.'),
	'branch-checkout-failed': (t) =>
		t(
			'errors:failure.branch-checkout-failed',
			'The branch could not be checked out.',
		),
	'branch-cleanup-failed': (t) =>
		t(
			'errors:failure.branch-cleanup-failed',
			'The branch could not be cleaned up.',
		),
	'branch-name-invalid': (t) =>
		t('errors:failure.branch-name-invalid', 'That branch name is not valid.'),
	'branch-not-found': (t) =>
		t(
			'errors:failure.branch-not-found',
			'That branch was not found locally or on origin.',
		),
	'branch-rename-failed': (t) =>
		t(
			'errors:failure.branch-rename-failed',
			'The branch could not be renamed.',
		),
	'branch-rollback-failed': (t) =>
		t(
			'errors:failure.branch-rollback-failed',
			'The branch change failed and could not be rolled back.',
		),
	'branch-unresolved': (t) =>
		t(
			'errors:failure.branch-unresolved',
			'Could not determine which branch this workspace is on.',
		),
	'command-failed': (t) =>
		t('errors:failure.command-failed', 'The command failed.'),
	'copy-failed': (t) =>
		t('errors:failure.copy-failed', 'The files could not be copied.'),
	'database-unavailable': (t) =>
		t(
			'errors:failure.database-unavailable',
			'The local database is unavailable, so nothing was changed.',
		),
	'destination-exists': (t) =>
		t(
			'errors:failure.destination-exists',
			'Something already exists at the destination. Remove it or pick another location.',
		),
	'destination-not-writable': (t) =>
		t(
			'errors:failure.destination-not-writable',
			'Ensemblr cannot write to that location. Pick a writable one.',
		),
	'destination-path-relative': (t) =>
		t(
			'errors:failure.destination-path-relative',
			'The destination path must be absolute.',
		),
	'destination-required': (t) =>
		t(
			'errors:failure.destination-required',
			'No destination was provided and the managed root has none to fall back on.',
		),
	'diff-failed': (t) =>
		t('errors:failure.diff-failed', 'The diff could not be produced.'),
	'dirty-state': (t) =>
		t(
			'errors:failure.dirty-state',
			'The working tree has uncommitted changes.',
		),
	'gh-not-authenticated': (t) =>
		t(
			'errors:failure.gh-not-authenticated',
			'GitHub CLI is not signed in. Run gh auth login, then retry.',
		),
	'gh-not-installed': (t) =>
		t(
			'errors:failure.gh-not-installed',
			'GitHub CLI was not found in PATH. Install it, then retry.',
		),
	'git-failed': (t) =>
		t('errors:failure.git-failed', 'The git command failed.'),
	'git-init-failed': (t) =>
		t(
			'errors:failure.git-init-failed',
			'The repository could not be initialized.',
		),
	'git-not-installed': (t) =>
		t(
			'errors:failure.git-not-installed',
			'git was not found in PATH. Install git, then retry.',
		),
	'git-worktree-failed': (t) =>
		t(
			'errors:failure.git-worktree-failed',
			'The worktree could not be created.',
		),
	'invalid-attachment': (t) =>
		t(
			'errors:failure.invalid-attachment',
			'That attachment could not be read.',
		),
	'invalid-cwd': (t) =>
		t(
			'errors:failure.invalid-cwd',
			'The workspace path must be an absolute directory.',
		),
	'invalid-image': (t) =>
		t('errors:failure.invalid-image', 'That attachment is not a valid image.'),
	'invalid-path': (t) =>
		t(
			'errors:failure.invalid-path',
			'That path must stay inside the workspace.',
		),
	'invalid-pattern': (t) =>
		t('errors:failure.invalid-pattern', 'That pattern is not valid.'),
	'invalid-repository': (t) =>
		t('errors:failure.invalid-repository', 'That is not a usable repository.'),
	'invalid-worktree': (t) =>
		t(
			'errors:failure.invalid-worktree',
			'The worktree does not belong to this repository.',
		),
	'job-unknown': (t) =>
		t(
			'errors:failure.job-unknown',
			'The clone job has expired or was never prepared. Start a new clone.',
		),
	'lifecycle-hook-failed': (t) =>
		t('errors:failure.lifecycle-hook-failed', 'A lifecycle hook failed.'),
	'managed-repositories-path-missing': (t) =>
		t(
			'errors:failure.managed-repositories-path-missing',
			'The managed root has no repositories directory. Configure the root directory first.',
		),
	'managed-directory-create-failed': (t) =>
		t(
			'errors:failure.managed-directory-create-failed',
			'A managed directory could not be created under the root.',
		),
	'managed-directory-missing': (t) =>
		t(
			'errors:failure.managed-directory-missing',
			'A managed directory is missing from the root.',
		),
	'managed-directory-read-failed': (t) =>
		t(
			'errors:failure.managed-directory-read-failed',
			'A managed directory could not be read.',
		),
	'managed-directory-stat-failed': (t) =>
		t(
			'errors:failure.managed-directory-stat-failed',
			'A managed directory could not be inspected.',
		),
	'managed-directory-unwritable': (t) =>
		t(
			'errors:failure.managed-directory-unwritable',
			'A managed directory is not writable.',
		),
	'managed-path-not-directory': (t) =>
		t(
			'errors:failure.managed-path-not-directory',
			'A managed path exists but is not a directory.',
		),
	'reconcile-child-not-directory': (t) =>
		t(
			'errors:failure.reconcile-child-not-directory',
			'An entry under the root is not a directory and was skipped.',
		),
	'reconcile-directory-read-failed': (t) =>
		t(
			'errors:failure.reconcile-directory-read-failed',
			'A directory under the root could not be read during the scan.',
		),
	'reconcile-path-stat-failed': (t) =>
		t(
			'errors:failure.reconcile-path-stat-failed',
			'A path under the root could not be inspected during the scan.',
		),
	'reconcile-workspace-repository-not-directory': (t) =>
		t(
			'errors:failure.reconcile-workspace-repository-not-directory',
			"A workspace's repository folder is not a directory.",
		),
	'root-create-failed': (t) =>
		t(
			'errors:failure.root-create-failed',
			'The root directory could not be created.',
		),
	'root-missing': (t) =>
		t(
			'errors:failure.root-missing',
			'The configured root directory does not exist.',
		),
	'root-not-directory': (t) =>
		t(
			'errors:failure.root-not-directory',
			'The configured root path exists but is not a directory.',
		),
	'root-read-failed': (t) =>
		t(
			'errors:failure.root-read-failed',
			'The root directory could not be read.',
		),
	'root-setting-empty': (t) =>
		t(
			'errors:failure.root-setting-empty',
			'The root directory setting is empty.',
		),
	'root-setting-invalid-type': (t) =>
		t(
			'errors:failure.root-setting-invalid-type',
			'The root directory setting must be a path.',
		),
	'root-setting-locked': (t) =>
		t(
			'errors:failure.root-setting-locked',
			'The root directory is pinned by configuration and cannot be changed here.',
		),
	'root-setting-missing': (t) =>
		t(
			'errors:failure.root-setting-missing',
			'The root directory setting could not be resolved.',
		),
	'root-setting-relative': (t) =>
		t(
			'errors:failure.root-setting-relative',
			'The root directory must be an absolute path.',
		),
	'root-stat-failed': (t) =>
		t(
			'errors:failure.root-stat-failed',
			'The root directory could not be inspected.',
		),
	'root-unwritable': (t) =>
		t('errors:failure.root-unwritable', 'The root directory is not writable.'),
	'shared-root-content': (t) =>
		t(
			'errors:failure.shared-root-content',
			'The root directory holds files Ensemblr does not manage.',
		),
	'unsafe-root-content': (t) =>
		t(
			'errors:failure.unsafe-root-content',
			'The root directory holds content that is unsafe to manage.',
		),
	'merge-blocked': (t) =>
		t(
			'errors:failure.merge-blocked',
			'GitHub refused the merge for this pull request.',
		),
	'mkdir-failed': (t) =>
		t('errors:failure.mkdir-failed', 'The directory could not be created.'),
	'name-already-in-use': (t) =>
		t('errors:failure.name-already-in-use', 'That name is already taken.'),
	'name-invalid': (t) =>
		t('errors:failure.name-invalid', 'That name is not valid.'),
	'name-required': (t) => t('errors:failure.name-required', 'Enter a name.'),
	network: (t) =>
		t(
			'errors:failure.network',
			'GitHub is unreachable. Check your connection and retry.',
		),
	'no-checkpoint': (t) =>
		t(
			'errors:failure.no-checkpoint',
			'No checkpoint was captured for this turn.',
		),
	'no-pull-request': (t) =>
		t('errors:failure.no-pull-request', 'This branch has no pull request.'),
	'no-remote': (t) =>
		t('errors:failure.no-remote', 'This repository has no remote configured.'),
	'not-a-git-repo': (t) =>
		t('errors:failure.not-a-git-repo', 'That folder is not a git repository.'),
	'not-directory': (t) =>
		t('errors:failure.not-directory', 'That path is not a directory.'),
	'not-file': (t) => t('errors:failure.not-file', 'That path is not a file.'),
	'not-found': (t) => t('errors:failure.not-found', 'That path was not found.'),
	'nothing-to-commit': (t) =>
		t(
			'errors:failure.nothing-to-commit',
			'Nothing to commit — the working tree is clean.',
		),
	'parse-failed': (t) =>
		t('errors:failure.parse-failed', 'The command output could not be parsed.'),
	'path-not-a-git-repository': (t) =>
		t(
			'errors:failure.path-not-a-git-repository',
			'That path is not a git repository.',
		),
	'pattern-listing-failed': (t) =>
		t(
			'errors:failure.pattern-listing-failed',
			'The files matching that pattern could not be listed.',
		),
	permission: (t) =>
		t('errors:failure.permission', 'Permission was denied for that location.'),
	'permission-denied': (t) =>
		t('errors:failure.permission-denied', 'Permission was denied.'),
	'publish-failed': (t) =>
		t(
			'errors:failure.publish-failed',
			'The project was created locally, but publishing it to GitHub failed.',
		),
	'read-failed': (t) =>
		t('errors:failure.read-failed', 'That file could not be read.'),
	'register-failed': (t) =>
		t(
			'errors:failure.register-failed',
			'The repository could not be registered.',
		),
	'remote-already-registered': (t) =>
		t(
			'errors:failure.remote-already-registered',
			'This repository is already registered with Ensemblr.',
		),
	'repositories-path-missing': (t) =>
		t(
			'errors:failure.repositories-path-missing',
			'The managed root has no workspaces directory. Configure the root directory first.',
		),
	'repository-already-archived': (t) =>
		t(
			'errors:failure.repository-already-archived',
			'That repository is already archived.',
		),
	'repository-already-registered': (t) =>
		t(
			'errors:failure.repository-already-registered',
			'This repository is already registered with Ensemblr.',
		),
	'repository-copy-failed': (t) =>
		t(
			'errors:failure.repository-copy-failed',
			'The repository could not be copied.',
		),
	'repository-copy-target-inside-source': (t) =>
		t(
			'errors:failure.repository-copy-target-inside-source',
			'Choose a project outside the managed root — the destination would be inside the folder you picked.',
		),
	'repository-delete-failed': (t) =>
		t(
			'errors:failure.repository-delete-failed',
			'The repository could not be deleted.',
		),
	'repository-id-required': (t) =>
		t('errors:failure.repository-id-required', 'A repository is required.'),
	'repository-insert-failed': (t) =>
		t(
			'errors:failure.repository-insert-failed',
			'The repository could not be saved.',
		),
	'repository-not-found': (t) =>
		t('errors:failure.repository-not-found', 'That repository was not found.'),
	'repository-path-is-workspace': (t) =>
		t(
			'errors:failure.repository-path-is-workspace',
			'That path is already tracked as a workspace. Pick the parent repository instead.',
		),
	'repository-path-missing': (t) =>
		t(
			'errors:failure.repository-path-missing',
			'No repository path was provided.',
		),
	'repository-path-not-directory': (t) =>
		t(
			'errors:failure.repository-path-not-directory',
			'That repository path is not a directory.',
		),
	'repository-path-relative': (t) =>
		t(
			'errors:failure.repository-path-relative',
			'The repository path must be absolute.',
		),
	'repository-path-unreadable': (t) =>
		t(
			'errors:failure.repository-path-unreadable',
			'That repository path could not be read.',
		),
	'repository-permission-denied': (t) =>
		t(
			'errors:failure.repository-permission-denied',
			'Permission was denied for that repository.',
		),
	'repository-remote-already-registered': (t) =>
		t(
			'errors:failure.repository-remote-already-registered',
			'Another registered repository already tracks this remote. Remove it before re-adding.',
		),
	'repository-scan-failed': (t) =>
		t(
			'errors:failure.repository-scan-failed',
			'The repository could not be scanned.',
		),
	'repository-update-failed': (t) =>
		t(
			'errors:failure.repository-update-failed',
			'The repository record could not be updated.',
		),
	'restore-failed': (t) =>
		t('errors:failure.restore-failed', 'The restore failed.'),
	'root-unavailable': (t) =>
		t(
			'errors:failure.root-unavailable',
			'The managed root is unavailable, so the operation was skipped.',
		),
	'source-path-missing': (t) =>
		t(
			'errors:failure.source-path-missing',
			'A source path no longer exists, so it was skipped.',
		),
	'spawn-error': (t) =>
		t('errors:failure.spawn-error', 'The process could not be started.'),
	'too-large': (t) => t('errors:failure.too-large', 'That file is too large.'),
	'tracked-skipped': (t) =>
		t(
			'errors:failure.tracked-skipped',
			'That path is tracked by git, so it was skipped.',
		),
	'unarchive-aborted-by-hook': (t) =>
		t(
			'errors:failure.unarchive-aborted-by-hook',
			'An unarchive hook stopped the operation.',
		),
	'unsupported-host': (t) =>
		t('errors:failure.unsupported-host', 'That host is not supported.'),
	'url-invalid': (t) =>
		t('errors:failure.url-invalid', 'That repository URL is not valid.'),
	'url-required': (t) =>
		t('errors:failure.url-required', 'Enter a repository URL.'),
	'workspace-already-archived': (t) =>
		t(
			'errors:failure.workspace-already-archived',
			'That workspace is already archived.',
		),
	'workspace-archive-failed': (t) =>
		t(
			'errors:failure.workspace-archive-failed',
			'A workspace could not be archived.',
		),
	'workspace-branch-collision': (t) =>
		t(
			'errors:failure.workspace-branch-collision',
			'Several workspaces in this repository share one branch.',
		),
	'workspace-cleanup-failed': (t) =>
		t(
			'errors:failure.workspace-cleanup-failed',
			'The workspace could not be cleaned up.',
		),
	'workspace-delete-failed': (t) =>
		t(
			'errors:failure.workspace-delete-failed',
			'The workspace could not be deleted.',
		),
	'workspace-id-required': (t) =>
		t('errors:failure.workspace-id-required', 'A workspace is required.'),
	'workspace-insert-failed': (t) =>
		t(
			'errors:failure.workspace-insert-failed',
			'The workspace could not be saved.',
		),
	'workspace-missing': (t) =>
		t('errors:failure.workspace-missing', 'That workspace no longer exists.'),
	'workspace-not-archived': (t) =>
		t(
			'errors:failure.workspace-not-archived',
			'That workspace is not archived.',
		),
	'workspace-not-found': (t) =>
		t('errors:failure.workspace-not-found', 'That workspace no longer exists.'),
	'workspace-orphaned': (t) =>
		t(
			'errors:failure.workspace-orphaned',
			'Workspaces exist for a repository Ensemblr does not know.',
		),
	'workspace-scan-failed': (t) =>
		t(
			'errors:failure.workspace-scan-failed',
			'The workspace could not be scanned.',
		),
	'workspace-update-failed': (t) =>
		t(
			'errors:failure.workspace-update-failed',
			'The workspace record could not be updated.',
		),
	'worktree-cleanup-failed': (t) =>
		t(
			'errors:failure.worktree-cleanup-failed',
			'The worktree could not be removed.',
		),
	'worktree-move-failed': (t) =>
		t(
			'errors:failure.worktree-move-failed',
			'The worktree could not be moved.',
		),
	'worktree-recreate-failed': (t) =>
		t(
			'errors:failure.worktree-recreate-failed',
			'The worktree could not be recreated.',
		),
	'worktree-repository-mismatch': (t) =>
		t(
			'errors:failure.worktree-repository-mismatch',
			'That worktree belongs to a different repository.',
		),
	'write-failed': (t) =>
		t('errors:failure.write-failed', 'That file could not be written.'),
};
