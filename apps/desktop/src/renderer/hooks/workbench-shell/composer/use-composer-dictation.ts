import { useQuery } from '@tanstack/react-query';
import { useAtomValue } from 'jotai';

import { dictationKeyStatusQuery } from '@/renderer/api/ensemblr';
import { useHotkey } from '@/renderer/hooks/use-hotkey';
import {
	type DictationControl,
	useDictation,
} from '@/renderer/hooks/workbench-shell/composer/use-dictation';
import { dictationEnabledAtom } from '@/renderer/state/preferences';

/**
 * Resolves whether the composer offers dictation at all, then wires the mic and
 * its chord.
 *
 * The mic is hidden rather than disabled when dictation is off or has no key: a
 * permanently dead control in the row teaches nothing, while its absence sends
 * the user to the settings row that can actually turn it on.
 * @param options - Whether the composer is refusing input, and where a transcript goes
 * @returns The control the mic button binds to; `available` is false while it should stay hidden
 */
export function useComposerDictation({
	disabled,
	onTranscript,
}: {
	disabled: boolean;
	onTranscript: (text: string) => void;
}): DictationControl {
	const dictationEnabled = useAtomValue(dictationEnabledAtom);
	const { data: dictationKeyStatus } = useQuery({
		...dictationKeyStatusQuery,
		enabled: dictationEnabled,
	});
	const offered =
		dictationEnabled && (dictationKeyStatus?.configured ?? false) && !disabled;

	const dictation = useDictation({ enabled: offered, onTranscript });
	useHotkey('composer.toggleDictation', dictation.toggle, {
		enabled: offered,
	});

	return dictation;
}
