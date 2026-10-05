import { toast } from 'sonner';

/**
 * Settles an action on one compute-queue job, toasting when the call throws or
 * the queue declines it because the job had already moved on. Shared by every
 * surface that offers Start now or Cancel on a job — the sidebar's queue rows
 * and the dock's queued Setup and Run panels — so a declined action reads the
 * same wherever it was clicked.
 * @param applied - Resolves whether the queue carried the action out.
 * @param failureMessage - The toast shown when it did not.
 */
export function toastUnlessApplied(
	applied: Promise<boolean>,
	failureMessage: string,
): void {
	applied
		.then((done) => {
			if (!done) {
				toast.error(failureMessage);
			}
		})
		.catch((error: unknown) => {
			console.error('Compute queue action failed:', error);
			toast.error(failureMessage);
		});
}
