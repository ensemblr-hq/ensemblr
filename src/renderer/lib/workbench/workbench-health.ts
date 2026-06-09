import type { WorkbenchHealth } from '@/renderer/types/workbench-shell';
import type { HealthSnapshot, SetupDiagnosticsSnapshot } from '@/shared/ipc';

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
			detail: 'Electron preload bridge is unavailable in this context.',
			label: 'IPC unavailable',
			state: 'unavailable',
		};
	}

	if (healthSnapshot) {
		if (healthSnapshot.database.status === 'error') {
			return {
				detail: healthSnapshot.database.error ?? 'Database failed to open.',
				label: `${healthSnapshot.appName} database unavailable`,
				state: 'unavailable',
			};
		}

		if (healthSnapshot.config.blocksReadiness) {
			return {
				detail:
					healthSnapshot.config.diagnostics[0]?.message ??
					'Declarative config blocks readiness.',
				label: `${healthSnapshot.appName} config requires attention`,
				state: 'unavailable',
			};
		}

		if (setupError) {
			return {
				detail: setupError,
				label: 'Setup diagnostics unavailable',
				state: 'unavailable',
			};
		}

		if (!setupSnapshot) {
			return {
				detail: 'Ensemble is collecting setup readiness checks.',
				label: 'Checking setup',
				state: 'pending',
			};
		}

		if (setupSnapshot.status !== 'ready') {
			return {
				detail: `${setupSnapshot.blockedCount} required setup checks need attention.`,
				label:
					setupSnapshot.status === 'checking'
						? 'Setup checks pending'
						: 'Setup blocked',
				state: setupSnapshot.status === 'checking' ? 'pending' : 'unavailable',
			};
		}

		return {
			detail: `Electron ${healthSnapshot.versions.electron} on ${healthSnapshot.platform}. Database schema v${healthSnapshot.database.schemaVersion}.`,
			label: `${healthSnapshot.appName} IPC online`,
			state: 'online',
		};
	}

	if (healthError) {
		return {
			detail: healthError,
			label: 'IPC unavailable',
			state: 'unavailable',
		};
	}

	return {
		detail:
			'Renderer is calling the typed preload bridge through TanStack Query.',
		label: 'Checking IPC',
		state: 'pending',
	};
}
