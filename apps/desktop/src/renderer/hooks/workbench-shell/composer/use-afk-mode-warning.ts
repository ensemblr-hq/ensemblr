import { useAtom } from 'jotai';
import { useCallback, useState } from 'react';

import { hasAcknowledgedAfkModeWarningAtom } from '@/renderer/state/preferences';

/** Controls the first-use AFK warning and the mode change it protects. */
interface AfkModeWarningState {
	acknowledge: () => void;
	goBack: () => void;
	open: boolean;
	requestChange: (afkMode: boolean) => void;
}

/**
 * Gates the first AFK activation behind a persistent warning acknowledgment.
 * @param onChange - Applies an accepted AFK mode change to the active chat.
 * @param enabled - Whether the composer currently permits mode changes.
 * @returns Warning state and actions for every AFK activation surface.
 */
export function useAfkModeWarning(
	onChange: (afkMode: boolean) => void,
	enabled: boolean,
): AfkModeWarningState {
	const [hasAcknowledged, setHasAcknowledged] = useAtom(
		hasAcknowledgedAfkModeWarningAtom,
	);
	const [open, setOpen] = useState(false);

	/** Routes an allowed mode change through the first-use acknowledgment. */
	const requestChange = useCallback(
		(afkMode: boolean) => {
			if (!enabled) {
				return;
			}
			if (!afkMode || hasAcknowledged) {
				onChange(afkMode);
				return;
			}
			setOpen(true);
		},
		[enabled, hasAcknowledged, onChange],
	);

	/** Closes the warning without recording an acknowledgment. */
	const goBack = useCallback(() => {
		setOpen(false);
	}, []);

	/** Records consent and enables AFK only while mode changes remain allowed. */
	const acknowledge = useCallback(() => {
		setOpen(false);
		if (!enabled) {
			return;
		}
		setHasAcknowledged(true);
		onChange(true);
	}, [enabled, onChange, setHasAcknowledged]);

	return { acknowledge, goBack, open, requestChange };
}
