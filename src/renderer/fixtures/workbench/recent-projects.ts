import type { RecentProject } from '@/renderer/types/workbench';

/**
 * Seed recents for the fixture-backed shell. Persisted recents (see
 * `state/recents`) start from this list until live local-open registration
 * lands. These are local-only placeholder paths and carry no telemetry.
 */
export const defaultRecentProjects: RecentProject[] = [
	{
		lastOpenedAt: '2026-06-06T18:00:00.000Z',
		name: 'haartz-next',
		path: '~/Projects/Boundary/haartz-next',
	},
	{
		lastOpenedAt: '2026-06-06T16:30:00.000Z',
		name: 'weho-pride',
		path: '~/Projects/Boundary/weho-pride',
	},
	{
		lastOpenedAt: '2026-06-06T12:15:00.000Z',
		name: 'viteflow',
		path: '~/Projects/Personal/viteflow',
	},
	{
		lastOpenedAt: '2026-06-05T20:45:00.000Z',
		name: 'nixfiles',
		path: '~/Projects/Personal/nixfiles',
	},
	{
		lastOpenedAt: '2026-06-05T11:05:00.000Z',
		name: 'plated',
		path: '~/Projects/Freelance/plated',
	},
	{
		lastOpenedAt: '2026-06-04T09:20:00.000Z',
		name: 'insane-forms',
		path: '~/Projects/Personal/insane-forms',
	},
	{
		lastOpenedAt: '2026-06-03T15:40:00.000Z',
		name: 'fullsteam-portal',
		path: '~/Projects/Boundary/fullsteam-portal',
	},
];
