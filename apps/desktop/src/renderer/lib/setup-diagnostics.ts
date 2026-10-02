import type { AgentProviderId } from '@/shared/agent-provider';
import type {
	SetupCheckId,
	SetupCheckSnapshot,
	SetupRemediationAction,
} from '@/shared/ipc/contracts/setup';

/**
 * The executable-picker action each agent runtime's check offers, keyed by the
 * `settings` table key the action targets. Both runtimes ship the same action
 * shape, so the handler resolves the provider from the target rather than
 * carrying one predicate per runtime.
 */
const EXECUTABLE_PICKER_PROVIDERS: Record<
	string,
	{ checkId: SetupCheckId; provider: AgentProviderId }
> = {
	'claude.executablePath': {
		checkId: 'claude-executable',
		provider: 'claude',
	},
	'pi.executablePath': { checkId: 'pi-executable', provider: 'pi' },
};

/**
 * Resolves which agent runtime an executable-picker remediation belongs to.
 * @param action - The remediation the user activated.
 * @param check - The check the action was offered on.
 * @returns The runtime whose picker to open, or null when this is not one.
 */
export function resolveExecutablePickerProvider(
	action: SetupRemediationAction,
	check: SetupCheckSnapshot,
): AgentProviderId | null {
	if (action.kind !== 'select-path' || !action.target) {
		return null;
	}

	const candidate = EXECUTABLE_PICKER_PROVIDERS[action.target];

	return candidate?.checkId === check.id ? candidate.provider : null;
}

/** Type guard for the root-directory picker remediation action. */
export function isRootDirectoryPickerAction(
	action: SetupRemediationAction,
	check: SetupCheckSnapshot,
): boolean {
	return (
		check.id === 'root-directory' &&
		action.kind === 'select-path' &&
		(action.target === 'rootDirectory' || action.id === 'choose-root-directory')
	);
}
