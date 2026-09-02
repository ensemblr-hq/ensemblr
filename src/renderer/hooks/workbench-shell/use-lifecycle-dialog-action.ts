import { useState } from 'react';
// react-doctor-disable-next-line -- The forced commit is the fix; startTransition would restore the batching. See the call below.
import { flushSync } from 'react-dom';

import { getErrorMessage } from '@/renderer/lib/error';
import {
	claimLifecycleRun,
	releaseLifecycleRun,
} from '@/renderer/lib/workbench/lifecycle-run-latch';
import { useWorkspaceLifecycleRunActions } from '@/renderer/state/workspace';
import type { WorkspaceLifecycleRun } from '@/renderer/types/components';

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
 * The envelope this hook synthesizes for a rejected IPC. Its `status` is the
 * literal `'failure'` rather than the wider union, which is what lets the
 * success guard below narrow the run's own richer result back out of it.
 */
interface LifecycleThrewResult<TDiagnostic extends LifecycleDiagnostic> {
	diagnostics: TDiagnostic[];
	status: 'failure';
}

/** Which destructive run to show against which workspace for the action's whole span. */
interface LifecycleRunMark {
	kind: WorkspaceLifecycleRun;
	workspaceId: string;
}

/**
 * Drives one archive or delete confirmation dialog: runs the IPC, keeps the
 * failure diagnostics it reports, and takes the modal down before the caller's
 * post-removal work begins.
 *
 * A rejected IPC — a denied permission gate, a wedged main process — is folded
 * into the same failure diagnostics as a reported one, so the dialog can never
 * sit on "Deleting…" with nothing to show and no way forward.
 *
 * The visual run mark is set here rather than by the caller because it has to
 * be paired with the re-entrancy claim below. Marking outside this hook meant a
 * second confirm that the claim *refused* still ran its own `finally` and
 * cleared the mark the first, still-running teardown owned — dropping the row's
 * "Deleting…" and re-opening every action against a workspace whose worktree
 * was still coming apart.
 * @param options - The IPC to run, how to word an unexpected error, the key that identifies this run, the run to mark on the workspace, the dialog's open setter, and the post-removal work, which receives the result the IPC answered with
 * @returns The diagnostics to render, whether the IPC is still in flight, and the action to fire
 */
export function useLifecycleDialogAction<
	TDiagnostic extends LifecycleDiagnostic,
	TResult extends LifecycleResult<TDiagnostic> = LifecycleResult<TDiagnostic>,
>({
	failure,
	lifecycleRun,
	onOpenChange,
	onSucceeded,
	operationKey,
	run,
}: {
	failure: (message: string) => TDiagnostic;
	lifecycleRun?: LifecycleRunMark;
	onOpenChange: (open: boolean) => void;
	onSucceeded: (result: TResult) => Promise<void> | void;
	operationKey: string;
	run: () => Promise<TResult>;
}): {
	diagnostics: TDiagnostic[];
	isBusy: boolean;
	start: () => Promise<void>;
} {
	const [isBusy, setIsBusy] = useState(false);
	const [diagnostics, setDiagnostics] = useState<TDiagnostic[]>([]);
	const { clearLifecycleRun, markLifecycleRun } =
		useWorkspaceLifecycleRunActions();

	const start = async (): Promise<void> => {
		if (!claimLifecycleRun(operationKey)) {
			// An earlier run of this exact operation is still waiting on its IPC.
			// Returning silently left the action button dead with nothing on screen
			// to explain why, so render the failure headline instead — there is no
			// detail to add beyond the code the dialog already translates.
			setDiagnostics([failure('')]);
			return;
		}
		if (lifecycleRun) {
			markLifecycleRun(lifecycleRun.workspaceId, lifecycleRun.kind);
		}
		setIsBusy(true);
		setDiagnostics([]);

		let result: LifecycleThrewResult<TDiagnostic> | TResult;
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
			await onSucceeded(result);
		} catch (error) {
			console.error(
				'Post-removal work failed after a lifecycle action:',
				error,
			);
		} finally {
			setIsBusy(false);
			// Held until here rather than released with the latch above: the row has
			// to keep saying "Archiving…" / "Deleting…" until the workspace has
			// actually left the list, which is the post-removal work `onSucceeded`
			// just did.
			if (lifecycleRun) {
				clearLifecycleRun(lifecycleRun.workspaceId);
			}
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
async function reportedOutcome<
	TDiagnostic extends LifecycleDiagnostic,
	TResult extends LifecycleResult<TDiagnostic>,
>(
	run: () => Promise<TResult>,
	failure: (message: string) => TDiagnostic,
): Promise<LifecycleThrewResult<TDiagnostic> | TResult> {
	try {
		return await run();
	} catch (error) {
		return {
			diagnostics: [failure(getErrorMessage(error) ?? '')],
			status: 'failure',
		};
	}
}
