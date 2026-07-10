import type { ArchiveLifecycleDiagnostic } from '../../shared/ipc/contracts/archive-lifecycle';

/**
 * Minimal shape every archive/unarchive diagnostic must satisfy. Each service
 * narrows this with its own code / severity union; the shared helpers below
 * stay structural so they work with all of them.
 */
interface ArchiveDiagnosticLike {
	code: string;
	message: string;
	path?: string;
	severity: 'error' | 'info' | 'warning';
}

/**
 * Folds lifecycle-hook diagnostics into the caller's diagnostic list using the
 * canonical `lifecycle-hook-failed` code. The cast to `TDiagnostic` is sound
 * because every diagnostic union in this slice includes
 * `'lifecycle-hook-failed'`, and we copy only fields permitted by
 * {@link ArchiveDiagnosticLike}.
 */
export function pushLifecycleDiagnostics<
	TDiagnostic extends ArchiveDiagnosticLike,
>(diagnostics: TDiagnostic[], lifecycle: ArchiveLifecycleDiagnostic[]): void {
	for (const entry of lifecycle) {
		const folded: ArchiveDiagnosticLike = {
			code: 'lifecycle-hook-failed',
			message: entry.message,
			severity: entry.severity,
			...(entry.path === undefined ? {} : { path: entry.path }),
		};
		diagnostics.push(folded as TDiagnostic);
	}
}

/**
 * Builds a single-diagnostic failure result. Callers pass the diagnostic plus
 * any service-specific fields (e.g. `repository`, `workspacesArchived`); the
 * helper guarantees a uniform `status: 'failure'` shape.
 */
export function failureResult<
	TDiagnostic extends ArchiveDiagnosticLike,
	TExtras extends Record<string, unknown>,
>(
	diagnostic: TDiagnostic,
	extras: TExtras,
): { diagnostics: TDiagnostic[]; status: 'failure' } & TExtras {
	return {
		diagnostics: [diagnostic],
		status: 'failure',
		...extras,
	};
}
