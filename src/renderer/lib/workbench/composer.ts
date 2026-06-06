import type {
	ComposerShellState,
	SessionTabModel,
} from '@/renderer/types/workbench';
import type { SetupDiagnosticsSnapshot } from '@/shared/ipc';

export function getComposerState({
	activeSession,
	setupDiagnostics,
	setupError,
}: {
	activeSession: SessionTabModel;
	setupDiagnostics: SetupDiagnosticsSnapshot | null;
	setupError: string | null;
}): ComposerShellState {
	if (setupError) {
		return {
			disabled: true,
			disabledReason: setupError,
			modelLabel: 'Pi model pending',
			placeholder: 'Resolve setup diagnostics before starting a Pi turn.',
			thinkingLabel: 'Thinking pending',
		};
	}

	if (!setupDiagnostics) {
		return {
			disabled: true,
			disabledReason: 'Ensemble is still checking setup readiness.',
			modelLabel: 'Pi model pending',
			placeholder: 'Setup checks are still loading.',
			thinkingLabel: 'Thinking pending',
		};
	}

	if (setupDiagnostics.status !== 'ready') {
		return {
			disabled: true,
			disabledReason: `${setupDiagnostics.blockedCount} required setup checks need attention.`,
			modelLabel: 'Pi model pending',
			placeholder: 'Fix setup blockers before sending a prompt.',
			thinkingLabel: 'Thinking pending',
		};
	}

	return {
		disabled: false,
		disabledReason: null,
		modelLabel: 'GPT-5.5 via Pi',
		placeholder: `Ask Pi to continue ${activeSession.label.toLowerCase()}`,
		thinkingLabel: 'High',
	};
}
