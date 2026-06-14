import { toast } from 'sonner';

import type { GithubFailure } from '@/shared/ipc';

/** Error wrapper preserving the typed gh failure for toast remediation. */
export class ReviewActionError extends Error {
	readonly failure?: GithubFailure;

	constructor(failure?: GithubFailure) {
		super(failure?.message ?? 'GitHub action failed.');
		this.failure = failure;
	}
}

export function showReviewActionError(title: string, error: unknown): void {
	const failure =
		error instanceof ReviewActionError ? error.failure : undefined;
	toast.error(title, {
		description: failure
			? [failure.message, failure.remediation].filter(Boolean).join(' — ')
			: error instanceof Error
				? error.message
				: undefined,
	});
}
