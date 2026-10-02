import { i18n } from '@/renderer/lib/i18n';
import type { WorkbenchHealth } from '@/renderer/types/workbench-shell';
import type { HealthSnapshot } from '@/shared/ipc/contracts/health';
import type { SetupDiagnosticsSnapshot } from '@/shared/ipc/contracts/setup';

/**
 * Reduces the loaded shell data into a single {@link WorkbenchHealth} value
 * suitable for the header status badge.
 * @param input - Shell data subset (bridge state, health, setup).
 * @returns A workbench health summary.
 */
export function getWorkbenchHealth({
	hasPreloadBridge,
	healthError,
	healthSnapshot,
	setupError,
	setupSnapshot,
}: {
	hasPreloadBridge: boolean;
	healthError: string | null;
	healthSnapshot: HealthSnapshot | null;
	setupError: string | null;
	setupSnapshot: SetupDiagnosticsSnapshot | null;
}): WorkbenchHealth {
	if (!hasPreloadBridge) {
		return {
			detail: i18n.t(
				'workbench:health.no-bridge.detail',
				'Electron preload bridge is unavailable in this context.',
			),
			label: i18n.t('workbench:health.unavailable.label', 'IPC unavailable'),
			state: 'unavailable',
		};
	}

	if (healthSnapshot) {
		return resolveReachableHealth({
			healthSnapshot,
			setupError,
			setupSnapshot,
		});
	}

	if (healthError) {
		return {
			detail: healthError,
			label: i18n.t('workbench:health.unavailable.label', 'IPC unavailable'),
			state: 'unavailable',
		};
	}

	return {
		detail: i18n.t(
			'workbench:health.checking.detail',
			'Renderer is calling the typed preload bridge through TanStack Query.',
		),
		label: i18n.t('workbench:health.checking.label', 'Checking IPC'),
		state: 'pending',
	};
}

/**
 * Reduces a reachable main process to its health summary, reporting the first
 * blocker it finds across the database, declarative config, and setup checks.
 * @param healthSnapshot - Health the main process reported
 * @param setupError - Error raised while collecting setup diagnostics, if any
 * @param setupSnapshot - Setup readiness snapshot, or null while it is loading
 * @returns The workbench health summary
 */
function resolveReachableHealth({
	healthSnapshot,
	setupError,
	setupSnapshot,
}: {
	healthSnapshot: HealthSnapshot;
	setupError: string | null;
	setupSnapshot: SetupDiagnosticsSnapshot | null;
}): WorkbenchHealth {
	if (healthSnapshot.database.status === 'error') {
		return {
			detail:
				healthSnapshot.database.error ??
				i18n.t(
					'workbench:health.database-error.detail',
					'Database failed to open.',
				),
			label: i18n.t(
				'workbench:health.database-error.label',
				'{{appName}} database unavailable',
				{ appName: healthSnapshot.appName },
			),
			state: 'unavailable',
		};
	}

	if (healthSnapshot.config.blocksReadiness) {
		return {
			detail:
				healthSnapshot.config.diagnostics[0]?.message ??
				i18n.t(
					'workbench:health.config-blocked.detail',
					'Declarative config blocks readiness.',
				),
			label: i18n.t(
				'workbench:health.config-blocked.label',
				'{{appName}} config requires attention',
				{ appName: healthSnapshot.appName },
			),
			state: 'unavailable',
		};
	}

	if (setupError) {
		return {
			detail: setupError,
			label: i18n.t(
				'workbench:health.setup-error.label',
				'Setup diagnostics unavailable',
			),
			state: 'unavailable',
		};
	}

	if (!setupSnapshot) {
		return {
			detail: i18n.t(
				'workbench:health.setup-loading.detail',
				'Ensemblr is collecting setup readiness checks.',
			),
			label: i18n.t('workbench:health.setup-loading.label', 'Checking setup'),
			state: 'pending',
		};
	}

	if (setupSnapshot.status !== 'ready') {
		return {
			detail: i18n.t('workbench:health.setup-blocked.detail', {
				count: setupSnapshot.blockedCount,
				defaultValue_one: '{{count}} required setup check needs attention.',
				defaultValue_other: '{{count}} required setup checks need attention.',
			}),
			label:
				setupSnapshot.status === 'checking'
					? i18n.t(
							'workbench:health.setup-checking.label',
							'Setup checks pending',
						)
					: i18n.t('workbench:health.setup-blocked.label', 'Setup blocked'),
			state: setupSnapshot.status === 'checking' ? 'pending' : 'unavailable',
		};
	}

	return {
		detail: i18n.t(
			'workbench:health.online.detail',
			'Electron {{electronVersion}} on {{platform}}. Database schema v{{schemaVersion}}.',
			{
				electronVersion: healthSnapshot.versions.electron,
				platform: healthSnapshot.platform,
				schemaVersion: healthSnapshot.database.schemaVersion,
			},
		),
		label: i18n.t('workbench:health.online.label', '{{appName}} IPC online', {
			appName: healthSnapshot.appName,
		}),
		state: 'online',
	};
}
