import type {
	SetupCheckSnapshot,
	SetupRemediationAction,
} from '@/shared/ipc/contracts/setup';

/** Type guard for the Pi-executable picker remediation action. */
export function isPiExecutablePickerAction(
	action: SetupRemediationAction,
	check: SetupCheckSnapshot,
): boolean {
	return (
		check.id === 'pi-executable' &&
		action.kind === 'select-path' &&
		action.target === 'pi.executablePath'
	);
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
