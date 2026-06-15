import { useNavigate } from '@tanstack/react-router';

import { openAppConfigFile } from '@/renderer/api/ensemble';
import { isPiExecutablePickerAction } from '@/renderer/lib/setup-diagnostics';
import type {
	SetupCheckSnapshot,
	SetupRemediationAction,
} from '@/shared/ipc/contracts/setup';

interface UseGenericRemediationOptions {
	onRetry?: () => void;
}

/**
 * Handles the stateless setup remediation actions — everything except the
 * root-directory picker, whose preview/confirm dialog state lives in
 * {@link useRootDirectoryChange}:
 *
 * - `retry` re-runs the setup checks
 * - `open-settings` navigates to the relevant settings screen (or opens
 *   `config.json` for the declarative-config check)
 * - `open-external` opens a vetted docs URL in the default browser
 * - `select-path` (Pi executable only) drives the native picker, then retries
 *
 * `run-command` is intentionally absent: clipboard copy + its transient
 * confirmation are owned by the originating row button.
 */
export function useGenericRemediation({
	onRetry,
}: UseGenericRemediationOptions = {}) {
	const navigate = useNavigate();

	const handle = async (
		action: SetupRemediationAction,
		check: SetupCheckSnapshot,
	) => {
		switch (action.kind) {
			case 'retry':
				onRetry?.();
				return;
			case 'open-settings':
				await openSettingsTarget(action.target, navigate);
				return;
			case 'open-external':
				if (action.target) {
					try {
						await window.ensemble?.openExternal(action.target);
					} catch (error) {
						console.error('Failed to open external URL:', error);
					}
				}
				return;
			case 'select-path':
				if (isPiExecutablePickerAction(action, check)) {
					await window.ensemble?.selectPiExecutable();
					onRetry?.();
				}
				return;
			default:
				return;
		}
	};

	return { handle };
}

/** Routes an `open-settings` remediation target to its destination. */
async function openSettingsTarget(
	target: string | undefined,
	navigate: ReturnType<typeof useNavigate>,
): Promise<void> {
	switch (target) {
		case 'config':
			await openAppConfigFile();
			return;
		case 'environment':
			navigate({ to: '/settings/environment' });
			return;
		case 'linear':
		case 'pi.providers':
			navigate({ to: '/settings/integrations' });
			return;
		default:
			return;
	}
}
