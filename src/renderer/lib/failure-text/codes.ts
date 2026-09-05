import type { TFunction } from 'i18next';

import type { ArchitectureFailureCode } from '@/shared/ipc/contracts/architecture';
import type { CheckpointFailureCode } from '@/shared/ipc/contracts/checkpoint';
import type { CloneGithubRepositoryDiagnosticCode } from '@/shared/ipc/contracts/clone';
import type { DictationFailureCode } from '@/shared/ipc/contracts/dictation';
import type { GithubFailureCode } from '@/shared/ipc/contracts/github';
import type { InfisicalFailureCode } from '@/shared/ipc/contracts/infisical';
import type { LinearAuthFailureCode } from '@/shared/ipc/contracts/linear';
import type { OpenTargetFailureCode } from '@/shared/ipc/contracts/open-target';
import type { QuickStartProjectDiagnosticCode } from '@/shared/ipc/contracts/quick-start';
import type {
	DeleteRepositoryDiagnosticCode,
	RegisterLocalRepositoryDiagnosticCode,
} from '@/shared/ipc/contracts/repository';
import type { RootDirectoryDiagnosticCode } from '@/shared/ipc/contracts/root-directory';
import type { SharedRootAdoptionDiagnosticCode } from '@/shared/ipc/contracts/shared-root-adoption';
import type { UpdateFailureCode } from '@/shared/ipc/contracts/update';
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
	| ArchitectureFailureCode
	| ArchiveWorkspaceDiagnosticCode
	| CheckpointFailureCode
	| CloneGithubRepositoryDiagnosticCode
	| ContinueWorkspaceBranchDiagnosticCode
	| CreateWorkspaceDiagnosticCode
	| DeleteArchivedWorkspaceDiagnosticCode
	| DeleteRepositoryDiagnosticCode
	| DeleteWorkspaceDiagnosticCode
	| DictationFailureCode
	| FilesToCopyDiagnosticCode
	| GithubFailureCode
	| InfisicalFailureCode
	| LinearAuthFailureCode
	| ListWorkspaceFilesFailureCode
	| OpenTargetFailureCode
	| QuickStartProjectDiagnosticCode
	| ReadWorkspaceDirectoryFailureCode
	| ReadWorkspaceFileFailureCode
	| RegisterLocalRepositoryDiagnosticCode
	| RenameWorkspaceDiagnosticCode
	| RootDirectoryDiagnosticCode
	| SetWorkspaceBaseBranchDiagnosticCode
	| SharedRootAdoptionDiagnosticCode
	| UnarchiveWorkspaceDiagnosticCode
	| UpdateFailureCode
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
	'infisical-account-exists': (t) =>
		t(
			'errors:failure.infisical-account-exists',
			'That Client ID is already configured for this Infisical instance.',
		),
	'infisical-account-not-found': (t) =>
		t(
			'errors:failure.infisical-account-not-found',
			'That Infisical account is no longer configured.',
		),
	'infisical-config-write-failed': (t) =>
		t(
			'errors:failure.infisical-config-write-failed',
			'The link works on this machine, but .ensemblr/settings.toml could not be updated, so nobody who clones this repository will inherit it.',
		),
	'infisical-invalid-credentials': (t) =>
		t(
			'errors:failure.infisical-invalid-credentials',
			'Infisical rejected these credentials. Check the Client ID and Client Secret, then retry.',
		),
	'infisical-invalid-request': (t) =>
		t(
			'errors:failure.infisical-invalid-request',
			'Infisical rejected the request. Check the instance URL and the selected project.',
		),
	'infisical-network': (t) =>
		t(
			'errors:failure.infisical-network',
			'Infisical could not be reached. Check your connection, then retry.',
		),
	'infisical-not-linked': (t) =>
		t(
			'errors:failure.infisical-not-linked',
			'This repository is not linked to an Infisical project yet.',
		),
	'infisical-permission-denied': (t) =>
		t(
			'errors:failure.infisical-permission-denied',
			'This machine identity may not read that project. Grant it access in Infisical, then retry.',
		),
	'infisical-project-not-found': (t) =>
		t(
			'errors:failure.infisical-project-not-found',
			'That Infisical project or environment no longer exists.',
		),
	'infisical-rate-limited': (t) =>
		t(
			'errors:failure.infisical-rate-limited',
			'Infisical is rate limiting requests. Wait a moment, then retry.',
		),
	'infisical-secret-store-unavailable': (t) =>
		t(
			'errors:failure.infisical-secret-store-unavailable',
			'The macOS Keychain is unavailable, so the Infisical client secret could not be read.',
		),
	'infisical-server-error': (t) =>
		t(
			'errors:failure.infisical-server-error',
			'Infisical returned an unexpected error. Try again shortly.',
		),
	'infisical-unknown': (t) =>
		t('errors:failure.infisical-unknown', 'The Infisical operation failed.'),
	'callback-failed': (t) =>
		t(
			'errors:failure.callback-failed',
			'Ensemblr could not open the local port Linear sends you back to. Close other Ensemblr windows, then retry.',
		),
	'linear-unknown': (t) =>
		t('errors:failure.linear-unknown', 'The Linear operation failed.'),
	'callback-timeout': (t) =>
		t(
			'errors:failure.callback-timeout',
			'Linear did not answer in time. Try signing in again.',
		),
	'database-error': (t) =>
		t(
			'errors:failure.database-error',
			'The local database is unavailable, so the Linear account was not saved.',
		),
	'exchange-failed': (t) =>
		t(
			'errors:failure.exchange-failed',
			'Linear rejected the sign-in. Try again.',
		),
	'login-canceled': (t) =>
		t('errors:failure.login-canceled', 'The Linear sign-in was canceled.'),
	'login-in-progress': (t) =>
		t(
			'errors:failure.login-in-progress',
			'A Linear sign-in is already waiting for the browser.',
		),
	'network-error': (t) =>
		t(
			'errors:failure.network-error',
			'Linear could not be reached. Check your connection, then retry.',
		),
	'not-configured': (t) =>
		t(
			'errors:failure.not-configured',
			'Linear sign-in is not configured on this machine.',
		),
	'not-connected': (t) =>
		t('errors:failure.not-connected', 'No Linear account is connected.'),
	'refresh-failed': (t) =>
		t(
			'errors:failure.refresh-failed',
			'The Linear token expired and could not be refreshed. Reconnect the account.',
		),
	'secret-store-error': (t) =>
		t(
			'errors:failure.secret-store-error',
			'The macOS Keychain is unavailable, so the Linear token could not be read.',
		),
	'state-mismatch': (t) =>
		t(
			'errors:failure.state-mismatch',
			'The Linear sign-in reply did not match this attempt, so it was rejected.',
		),
	'open-target-app-not-installed': (t) =>
		t(
			'errors:failure.open-target-app-not-installed',
			'That app is not installed on this machine.',
		),
	'open-target-no-desktop-launcher': (t) =>
		t(
			'errors:failure.open-target-no-desktop-launcher',
			'That app is only installed as a desktop entry, and neither gio nor gtk-launch is available to start it. Install glib or gtk3.',
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
	'detached-head': (t) =>
		t(
			'errors:failure.detached-head',
			'This workspace is not on a branch, so GitHub has nothing to match it against. Check out a branch, then retry.',
		),
	'diagram-unreadable': (t) =>
		t(
			'errors:failure.diagram-unreadable',
			'The stored architecture diagram cannot be read. Repair or delete the file, then ask an agent to draw a new one.',
		),
	'dictation-disabled': (t) =>
		t(
			'errors:failure.dictation-disabled',
			'Dictation is turned off in Settings.',
		),
	'dictation-empty-transcript': (t) =>
		t(
			'errors:failure.dictation-empty-transcript',
			'No speech was detected in the recording.',
		),
	'dictation-invalid-endpoint': (t) =>
		t(
			'errors:failure.dictation-invalid-endpoint',
			'The transcription endpoint must be a full http:// or https:// address.',
		),
	'dictation-key-store-unavailable': (t) =>
		t(
			'errors:failure.dictation-key-store-unavailable',
			'The stored transcription API key could not be read from the Keychain.',
		),
	'dictation-microphone-denied': (t) =>
		t(
			'errors:failure.dictation-microphone-denied',
			'Ensemblr needs microphone access. Grant it in System Settings › Privacy & Security › Microphone.',
		),
	'dictation-microphone-missing': (t) =>
		t(
			'errors:failure.dictation-microphone-missing',
			'No microphone was found.',
		),
	'dictation-network': (t) =>
		t(
			'errors:failure.dictation-network',
			'The transcription provider could not be reached.',
		),
	'dictation-no-api-key': (t) =>
		t(
			'errors:failure.dictation-no-api-key',
			'Add a transcription API key in Settings to dictate.',
		),
	'dictation-not-configured': (t) =>
		t(
			'errors:failure.dictation-not-configured',
			'Dictation has no transcription endpoint configured.',
		),
	'dictation-provider-error': (t) =>
		t(
			'errors:failure.dictation-provider-error',
			'The transcription provider rejected the recording.',
		),
	'dictation-rate-limited': (t) =>
		t(
			'errors:failure.dictation-rate-limited',
			'The transcription provider is rate-limiting requests.',
		),
	'dictation-recorder-unavailable': (t) =>
		t(
			'errors:failure.dictation-recorder-unavailable',
			'Audio recording is not available in this build.',
		),
	'dictation-timeout': (t) =>
		t(
			'errors:failure.dictation-timeout',
			'The transcription request timed out.',
		),
	'dictation-too-large': (t) =>
		t(
			'errors:failure.dictation-too-large',
			'The recording is too long to transcribe in one request.',
		),
	'dictation-unauthorized': (t) =>
		t(
			'errors:failure.dictation-unauthorized',
			'The transcription API key was rejected.',
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
	'issues-disabled': (t) =>
		t(
			'errors:failure.issues-disabled',
			'Issues are turned off for this repository on GitHub.',
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
	'pruned-branch-missing': (t) =>
		t(
			'errors:failure.pruned-branch-missing',
			'The branch this workspace was archived on no longer exists, so its files could not be restored.',
		),
	'pruned-snapshot-missing': (t) =>
		t(
			'errors:failure.pruned-snapshot-missing',
			'The commit this workspace was archived at is no longer in the repository, so its files could not be restored.',
		),
	'pruned-snapshot-restore-failed': (t) =>
		t(
			'errors:failure.pruned-snapshot-restore-failed',
			'The branch was checked out, but the uncommitted changes saved when the workspace was archived could not be restored.',
		),
	'owner-invalid': (t) =>
		t(
			'errors:failure.owner-invalid',
			'That GitHub owner is not a valid login.',
		),
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
	'repository-folder-delete-failed': (t) =>
		t(
			'errors:failure.repository-folder-delete-failed',
			'The repository folder could not be removed from disk.',
		),
	'repository-folder-external': (t) =>
		t(
			'errors:failure.repository-folder-external',
			'The repository folder was left on disk because it lives outside the folder Ensemblr manages.',
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
	'update-download-failed': (t) =>
		t(
			'errors:failure.update-download-failed',
			'The update could not be downloaded. Ensemblr will try again later.',
		),
	'update-feed-malformed': (t) =>
		t(
			'errors:failure.update-feed-malformed',
			'The update information could not be read.',
		),
	'update-feed-rate-limited': (t) =>
		t(
			'errors:failure.update-feed-rate-limited',
			'GitHub is rate-limiting update checks. Ensemblr will try again later.',
		),
	'update-feed-unreachable': (t) =>
		t(
			'errors:failure.update-feed-unreachable',
			'Ensemblr could not reach GitHub to check for updates.',
		),
	'update-install-failed': (t) =>
		t(
			'errors:failure.update-install-failed',
			'Ensemblr could not restart into the update.',
		),
	'update-not-in-applications': (t) =>
		t(
			'errors:failure.update-not-in-applications',
			'Ensemblr updates itself only from the Applications folder. Move it there and reopen it.',
		),
	'update-unsupported-build': (t) =>
		t(
			'errors:failure.update-unsupported-build',
			'This build cannot update itself.',
		),
	'url-invalid': (t) =>
		t('errors:failure.url-invalid', 'That repository URL is not valid.'),
	'url-required': (t) =>
		t('errors:failure.url-required', 'Enter a repository URL.'),
	'workspace-already-archived': (t) =>
		t(
			'errors:failure.workspace-already-archived',
			'That workspace is already archived.',
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
	'worktree-prune-failed': (t) =>
		t(
			'errors:failure.worktree-prune-failed',
			'The worktree folder could not be removed, so its disk was not reclaimed.',
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
	'worktree-residue-swept': (t) =>
		t(
			'errors:failure.worktree-residue-swept',
			'The worktree was removed, but something wrote files back into its folder. Ensemblr reclaims them on the next launch.',
		),
	'write-failed': (t) =>
		t('errors:failure.write-failed', 'That file could not be written.'),
};
