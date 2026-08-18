import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import { DialogFooter } from '@/renderer/components/ui/dialog';
import { ArchiveDiagnosticsList } from '@/renderer/components/workbench-shell/archive-diagnostics-list';

/** The minimum every archive and delete diagnostic satisfies. */
interface LifecycleDialogDiagnostic {
	code: string;
	message: string;
	path?: string;
}

/** Props for the shared footer of the four archive and delete dialogs. */
interface LifecycleDialogActionsProps {
	actionLabel: string;
	/** `destructive` whenever confirming would drop work that is not on a remote. */
	actionVariant: 'default' | 'destructive';
	busyLabel: string;
	canAct: boolean;
	diagnostics: LifecycleDialogDiagnostic[];
	diagnosticsTestId: string;
	isBusy: boolean;
	onAct: () => void;
	onClose: () => void;
}

/**
 * Failure diagnostics plus the confirm/dismiss footer shared by every lifecycle
 * dialog, so the four of them cannot drift in how a run in flight is presented.
 *
 * The dismiss button stays enabled throughout: Escape, the overlay, and the
 * corner close button all dismiss a busy dialog already, and an IPC that never
 * answers would otherwise trap the user behind the overlay. It reads "Close"
 * rather than "Cancel" while the run is in flight because dismissing the dialog
 * does not call the removal back — the operation has already committed.
 */
export function LifecycleDialogActions({
	actionLabel,
	actionVariant,
	busyLabel,
	canAct,
	diagnostics,
	diagnosticsTestId,
	isBusy,
	onAct,
	onClose,
}: LifecycleDialogActionsProps) {
	const { t } = useTranslation();

	return (
		<>
			{diagnostics.length > 0 ? (
				<ArchiveDiagnosticsList
					diagnostics={diagnostics}
					testId={diagnosticsTestId}
				/>
			) : null}

			<DialogFooter>
				<Button onClick={onClose} type='button' variant='ghost'>
					{isBusy
						? t('common:actions.close', 'Close')
						: t('common:actions.cancel', 'Cancel')}
				</Button>
				<Button
					disabled={!canAct}
					onClick={onAct}
					type='button'
					variant={actionVariant}
				>
					{isBusy ? busyLabel : actionLabel}
				</Button>
			</DialogFooter>
		</>
	);
}
