import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type {
	DictationKeyMutationResult,
	TranscribeAudioRequest,
	TranscribeAudioResult,
} from '@/shared/ipc/contracts/dictation';

import { ensemblrQueryKeys, getEnsemblrApi } from './query-keys';

/**
 * Query options for whether a dictation API key is stored. The key itself never
 * crosses the bridge — only whether one exists and its masked tail.
 */
export const dictationKeyStatusQuery = queryOptions({
	/** Fetches the stored-key status over IPC with call profiling. */
	queryFn: () =>
		profileElectronIpcCall(
			{ channel: 'ensemblr:dictation-key-status', usesDatabase: true },
			() => getEnsemblrApi().dictationKeyStatus(),
		),
	queryKey: ensemblrQueryKeys.dictationKeyStatus(),
	staleTime: 2000,
});

/** Transcribes one recorded clip into text. */
export function transcribeAudio(
	request: TranscribeAudioRequest,
): Promise<TranscribeAudioResult> {
	return getEnsemblrApi().transcribeAudio(request);
}

/** Stores the transcription provider's API key in the platform secret store. */
export function setDictationApiKey(
	value: string,
): Promise<DictationKeyMutationResult> {
	return getEnsemblrApi().setDictationApiKey({ value });
}

/** Removes the stored transcription provider API key. */
export function clearDictationApiKey(): Promise<DictationKeyMutationResult> {
	return getEnsemblrApi().clearDictationApiKey();
}
