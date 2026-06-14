import type { ArchiveLifecycleContext, ArchiveLifecycleDiagnostic, ArchiveLifecycleOutcome, ArchiveLifecycleStage } from '../../shared/ipc/contracts/archive-lifecycle';

export type ArchiveLifecycleHandler = (
	context: ArchiveLifecycleContext,
) => Promise<ArchiveLifecycleOutcome> | ArchiveLifecycleOutcome;

interface RegisteredHandler {
	handler: ArchiveLifecycleHandler;
	priority: number;
	registrationIndex: number;
}

/** Public surface of the archive lifecycle hook registry. */
export interface ArchiveLifecycleService {
	subscribe: (
		stage: ArchiveLifecycleStage,
		handler: ArchiveLifecycleHandler,
		priority?: number,
	) => () => void;
	invoke: (
		stage: ArchiveLifecycleStage,
		context: Omit<ArchiveLifecycleContext, 'stage'>,
	) => Promise<{
		aborted: { code: string; message: string } | null;
		diagnostics: ArchiveLifecycleDiagnostic[];
	}>;
	clear: () => void;
}

const DEFAULT_PRIORITY = 100;

/**
 * Builds the archive lifecycle hook registry. Pre-stage handlers may abort the
 * lifecycle; post-stage handlers may only record diagnostics. Handlers run in
 * priority order (lower numbers first); ties fall back to registration order
 * so behavior is deterministic across runs.
 */
export function createArchiveLifecycleService(): ArchiveLifecycleService {
	const registry = new Map<ArchiveLifecycleStage, RegisteredHandler[]>();
	let registrationCounter = 0;

	return {
		subscribe: (stage, handler, priority = DEFAULT_PRIORITY) => {
			const list = registry.get(stage) ?? [];
			const entry: RegisteredHandler = {
				handler,
				priority,
				registrationIndex: registrationCounter,
			};
			registrationCounter += 1;
			const next = [...list, entry].sort((a, b) =>
				a.priority === b.priority
					? a.registrationIndex - b.registrationIndex
					: a.priority - b.priority,
			);
			registry.set(stage, next);
			return () => {
				const current = registry.get(stage);
				if (!current) {
					return;
				}
				registry.set(
					stage,
					current.filter((candidate) => candidate !== entry),
				);
			};
		},

		invoke: async (stage, baseContext) => {
			const handlers = registry.get(stage) ?? [];
			const diagnostics: ArchiveLifecycleDiagnostic[] = [];
			const context: ArchiveLifecycleContext = { ...baseContext, stage };
			const isPreStage = stage.startsWith('pre-');

			for (const entry of handlers) {
				let outcome: ArchiveLifecycleOutcome;
				try {
					outcome = await entry.handler(context);
				} catch (error) {
					diagnostics.push({
						code: 'lifecycle-hook-failed',
						message:
							error instanceof Error
								? error.message
								: 'Archive lifecycle hook threw unexpectedly.',
						severity: 'warning',
						stage,
					});
					continue;
				}

				if (outcome.diagnostics?.length) {
					for (const diagnostic of outcome.diagnostics) {
						diagnostics.push({ ...diagnostic, stage });
					}
				}

				if (isPreStage && outcome.abort) {
					return {
						aborted: outcome.abort,
						diagnostics,
					};
				}
			}

			return { aborted: null, diagnostics };
		},

		clear: () => {
			registry.clear();
			registrationCounter = 0;
		},
	};
}
