import type { RecentGithubRepo } from '@/renderer/types/workbench';

/**
 * Seed list for the Clone GitHub repo dialog. Mirrors the recents the user
 * would see in the Conductor parity flow; local-only, no telemetry.
 */
export const defaultRecentGithubRepos: RecentGithubRepo[] = [
	{
		description: 'A repository for ensemble',
		fullName: 'psoldunov/ensemble',
		ownerAvatarColor: 'oklch(0.62 0.18 320)',
	},
	{
		fullName: 'the-set-set/website',
		ownerAvatarColor: 'oklch(0.72 0.18 320)',
	},
	{
		fullName: 'boundary-digital/jarrow',
		ownerAvatarColor: 'oklch(0.40 0.04 50)',
	},
];
