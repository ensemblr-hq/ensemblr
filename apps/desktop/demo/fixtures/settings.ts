import type { SettingsResolutionGroupSnapshot } from '@/shared/ipc/contracts/settings-resolution';

/** Rich resolved repository settings with committed, defaulted, and ignored candidates. */
export const DEMO_REPOSITORY_SETTINGS: SettingsResolutionGroupSnapshot = {
	diagnostics: [],
	settings: [
		{
			candidates: [
				{
					reason: 'Selected by precedence.',
					source: 'ensemblr-config',
					status: 'selected',
				},
			],
			key: 'scripts.setup',
			locked: false,
			source: 'ensemblr-config',
			value: 'npm install',
		},
		{
			candidates: [
				{
					reason: 'Selected by precedence.',
					source: 'ensemblr-config',
					status: 'selected',
				},
			],
			key: 'scripts.run',
			locked: false,
			source: 'ensemblr-config',
			value: 'npm run dev',
		},
		{
			candidates: [],
			key: 'filesToCopy',
			locked: false,
			source: 'worktreeinclude',
			value: ['.env.local', 'config/*.json'],
		},
		{
			candidates: [],
			key: 'archiveAfterMerge',
			locked: false,
			source: 'user-default',
			value: true,
		},
		{
			candidates: [],
			key: 'setUpstreamOnPush',
			locked: false,
			source: 'user-default',
			value: true,
		},
	],
};
