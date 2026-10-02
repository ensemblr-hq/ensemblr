import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type {
	DictationKeyMutationResult,
	DictationKeyStatus,
	TranscribeAudioResult,
} from '../../../shared/ipc/contracts/dictation';
import type { DictationService } from '../../dictation';
import {
	setDictationApiKeyRequestSchema,
	transcribeAudioRequestSchema,
} from '../request-schemas/dictation.ts';

/**
 * Registers the dictation IPC handlers: one transcription call plus the API-key
 * lifecycle the settings screen drives. Each validates its payload and delegates
 * to the service, which owns every failure mapping.
 * @param options - Required services.
 */
export function registerDictationHandlers({
	dictationService,
}: {
	dictationService: DictationService;
}): void {
	ipcMain.handle(
		IPC_CHANNELS.transcribeAudio,
		(_event, raw: unknown): Promise<TranscribeAudioResult> => {
			const request = transcribeAudioRequestSchema.parse(raw);
			return dictationService.transcribe(request);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.dictationKeyStatus,
		(): Promise<DictationKeyStatus> => dictationService.getKeyStatus(),
	);

	ipcMain.handle(
		IPC_CHANNELS.setDictationApiKey,
		(_event, raw: unknown): Promise<DictationKeyMutationResult> => {
			const { value } = setDictationApiKeyRequestSchema.parse(raw);
			return dictationService.setApiKey(value);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.clearDictationApiKey,
		(): Promise<DictationKeyMutationResult> => dictationService.clearApiKey(),
	);
}
