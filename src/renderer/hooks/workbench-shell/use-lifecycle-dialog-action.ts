import { useState } from 'react';
// react-doctor-disable-next-line -- The forced commit is the fix; startTransition would restore the batching. See the call below.
import { flushSync } from 'react-dom';

import { getErrorMessage } from '@/renderer/lib/error';
import {
	claimLifecycleRun,
	releaseLifecycleRun,
} from '@/renderer/lib/workbench/lifecycle-run-latch';

/**
 * The diagnostic shape every lifecycle result carries: a code the renderer
 * translates through `failure-text`, main's English sentence for the support
 * bundle, and how badly it went.
 */
interface LifecycleDiagnostic {
	code: string;
	message: string;
	severity: 'error' | 'info' | 'warning';
}

/**
 * Every outcome an archive or delete IPC reports. The delete contracts answer
 * only `'failure'` or `'success'`; the archive pair adds `'aborted'` for a
 * lifecycle hook that vetoed the run. Only `'success'` takes the modal down.
 */
type LifecycleStatus = 'aborted' | 'failure' | 'success';

/** The envelope every archive and delete IPC answers with. */
interface LifecycleResult<TDiagnostic extends LifecycleDiagnostic> {
	diagnostics: TDiagnostic[];
	status: LifecycleStatus;
}

/**
 * Drives one archive or delete confirmation dialog: runs the IPC, keeps the
 * failure diagnostics it reports, and takes the modal down before the caller's
 * post-removal work begins.
 *
 * A rejected IPC — a denied permission gate, a wedged main process — is folded
 * into the same failure diagnostics as a reported one, so the dialog can never
 * sit on "Deleting…" with nothing to show and no way forward.
 * @param options - The IPC to run, how to word an unexpected error, the key that identifies this run, the dialog's open setter, and the post-removal work
 * @returns The diagnostics to render, whether the IPC is still in flight, and the action to fire
 */
export function useLifecycleDialogAction<
	TDiagnostic extends LifecycleDiagnostic,
>({
	failure,
	onOpenChange,
	onSucceeded,
	operationKey,
	run,
}: {
	failure: (message: string) => TDiagnostic;
	onOpenChange: (open: boolean) => void;
	onSucceeded: () => Promise<void> | void;
	operationKey: string;
	run: () => Promise<LifecycleResult<TDiagnostic>>;
}): {
	diagnostics: TDiagnostic[];
	isBusy: boolean;
	start: () => Promise<void>;
} {
	const [isBusy, setIsBusy] = useState(false);
	const [diagnostics, setDiagnostics] = useState<TDiagnostic[]>([]);

	const start = async (): Promise<void> => {
		if (!claimLifecycleRun(operationKey)) {
			// An earlier run of this exact operation is still waiting on its IPC.
			// Returning silently left the action button dead with nothing on screen
			// to explain why, so render the failure headline instead — there is no
			// detail to add beyond the code the dialog already translates.
			setDiagnostics([failure('')]);
			return;
		}
		setIsBusy(true);
		setDiagnostics([]);

		let result: LifecycleResult<TDiagnostic>;
		try {
			result = await reportedOutcome(run, failure);
		} finally {
			releaseLifecycleRun(operationKey);
		}

		try {
			if (result.status !== 'success') {
				setDiagnostics(result.diagnostics);
				return;
			}

			// React batches a plain close with everything `onSucceeded` then does —
			// the navigation, the cache invalidation — into one commit, so the modal
			// stays on screen until that whole render lands, and a navigation that
			// stalls holds it up for good. Flushing detaches the close from that
			// render.
			flushSync(() => {
				onOpenChange(false);
			});
			await onSucceeded();
		} catch (error) {
			console.error(
				'Post-removal work failed after a lifecycle action:',
				error,
			);
		} finally {
			setIsBusy(false);
		}
	};

	return { diagnostics, isBusy, start };
}

/**
 * Runs the IPC, turning a rejection into the failure envelope the caller
 * already knows how to render.
 * @param run - The IPC call
 * @param failure - Builds the dialog's own diagnostic from an error message
 * @returns The reported result, or a failure carrying the thrown error
 */
async function reportedOutcome<TDiagnostic extends LifecycleDiagnostic>(
	run: () => Promise<LifecycleResult<TDiagnostic>>,
	failure: (message: string) => TDiagnostic,
): Promise<LifecycleResult<TDiagnostic>> {
	try {
		return await run();
	} catch (error) {
		return {
			diagnostics: [failure(getErrorMessage(error) ?? '')],
			status: 'failure',
		};
	}
}
