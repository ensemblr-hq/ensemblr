import type { useRepoSettings } from '@/renderer/hooks/use-repo-settings';

/** The variable a sheet opens for: a brand-new entry or an existing key. */
export interface EnvironmentVariableSheetTarget {
	/** Pre-filled key (documented add or edit); empty for a blank add. */
	key: string;
	/** True when editing an existing variable (loads the current value). */
	isEdit: boolean;
}

/** Settings scope toggle: User-wide preferences vs. per-repository overrides. */
export type SettingsScope = 'user' | 'repo';

/** Run-script concurrency mode (values match the resolver's `runScriptMode`). */
export type RunMode = 'concurrent' | 'nonconcurrent';

/** Editable Scripts-screen form state, mirrored to a ref for debounced saves. */
export interface ScriptsForm {
	archive: string;
	autoRun: boolean;
	run: string;
	runMode: RunMode;
	setup: string;
}

/** Repo project descriptor (or `undefined` for an unknown repo route param). */
export type RepoProject = ReturnType<typeof useRepoSettings>['project'];

/** Repository policy flags controlling what happens after a review is merged. */
export interface ReviewMergeSettings {
	archiveAfterMerge: boolean;
	deleteLocalBranchOnArchive: boolean;
	setUpstreamOnPush: boolean;
}
