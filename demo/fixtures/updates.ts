import type { UpdateStatusSnapshot } from '@/shared/ipc/contracts/update';

/** Update-found state for the navigation update panel. */
export const DEMO_UPDATE_AVAILABLE: UpdateStatusSnapshot = {
	availableVersion: '0.2.0',
	channel: 'release',
	currentVersion: '0.1.12',
	failure: null,
	notes:
		'New workspace history, architecture, and environment settings screens.',
	releaseUrl: 'https://github.com/ensemblr-hq/ensemblr/releases/tag/v0.2.0',
	state: 'available',
};

/** Failed download keeps the known release visible in the navigation sidebar. */
export const DEMO_UPDATE_FAILURE: UpdateStatusSnapshot = {
	...DEMO_UPDATE_AVAILABLE,
	failure: {
		code: 'update-download-failed',
		message: 'Could not finish downloading the release.',
	},
	state: 'error',
};
