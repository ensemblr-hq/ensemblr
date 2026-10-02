import { useCallback } from 'react';

import { useHotkey } from '@/renderer/hooks/use-hotkey';
import { getNextThinkingId } from '@/renderer/lib/workbench/thinking-strength';
import {
	useMenuCommand,
	useMenuCommandChecked,
} from '@/renderer/state/menu-commands';
import type { ComposerShellState } from '@/renderer/types/workbench';

/**
 * Registers every composer chord alongside its native menu-item twin, so the
 * two surfaces enable and disable together rather than drifting apart.
 *
 * Each pair shares one enablement expression: a chord that fires while its menu
 * item reads as unavailable is the failure this hook exists to make impossible.
 * @param options - The composer's shell state, plus the actions the chords fire
 */
export function useComposerShortcuts({
	composer,
	focusEditor,
	isStreaming,
	pickersDisabled,
	submit,
	toggleModelPicker,
}: {
	composer: ComposerShellState;
	focusEditor: () => void;
	isStreaming: boolean;
	pickersDisabled: boolean;
	submit: () => void;
	toggleModelPicker: () => void;
}): void {
	const cycleThinking = useCallback(() => {
		const nextId = getNextThinkingId(
			composer.availableThinkingLevels,
			composer.thinkingLevel,
		);
		if (nextId) {
			composer.onThinkingChange(nextId);
		}
	}, [
		composer.availableThinkingLevels,
		composer.onThinkingChange,
		composer.thinkingLevel,
	]);
	const togglePlanMode = useCallback(() => {
		composer.onPlanModeChange(!composer.planMode);
	}, [composer.onPlanModeChange, composer.planMode]);
	const toggleAfkMode = useCallback(() => {
		composer.onAfkModeChange(!composer.afkMode);
	}, [composer.afkMode, composer.onAfkModeChange]);

	const canPickModel = !pickersDisabled && composer.availableModels.length > 0;
	const canCycleThinking =
		!pickersDisabled && composer.availableThinkingLevels.length > 0;
	const canSubmit = !composer.disabled && !isStreaming;

	useHotkey('composer.focus', focusEditor);
	useHotkey('composer.toggleModelPicker', toggleModelPicker, {
		enabled: canPickModel,
	});
	useHotkey('composer.cycleThinking', cycleThinking, {
		enabled: canCycleThinking,
	});
	useHotkey('composer.togglePlanMode', togglePlanMode, {
		enabled: !pickersDisabled,
	});
	useHotkey('composer.toggleAfkMode', toggleAfkMode, {
		enabled: !pickersDisabled,
	});

	useMenuCommand('composer.focus', focusEditor);
	useMenuCommand('composer.toggleModelPicker', toggleModelPicker, canPickModel);
	useMenuCommand('composer.cycleThinking', cycleThinking, canCycleThinking);
	useMenuCommand('composer.togglePlanMode', togglePlanMode, !pickersDisabled);
	useMenuCommandChecked('composer.togglePlanMode', composer.planMode);
	useMenuCommand('composer.toggleAfkMode', toggleAfkMode, !pickersDisabled);
	useMenuCommandChecked('composer.toggleAfkMode', composer.afkMode);
	useMenuCommand('composer.submit', submit, canSubmit);
}
