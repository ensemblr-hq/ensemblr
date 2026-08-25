import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type {
	ClearConciergeContextResult,
	ConciergeContextPressureWire,
	ListConciergeArtifactsResult,
	ListConciergeEventsResult,
	OpenConciergeSessionResult,
	StopConciergeSessionResult,
	SubmitConciergePromptResult,
} from '../../../shared/ipc/contracts/concierge';
import type { ConciergeHome, ConciergeSessionService } from '../../concierge';
import { listConciergeArtifacts } from '../../concierge/concierge-artifacts.ts';
import {
	clearConciergeContextRequestSchema,
	listConciergeEventsRequestSchema,
	openConciergeSessionRequestSchema,
	stopConciergeSessionRequestSchema,
	submitConciergePromptRequestSchema,
} from '../request-schemas.ts';

/**
 * Coerces a thrown value into the message shape every Concierge result carries.
 * @param cause - Thrown value.
 * @param fallback - Message to use when the throw carried none.
 * @returns A human-readable message.
 */
function toError(cause: unknown, fallback: string): string {
	return cause instanceof Error ? cause.message : fallback;
}

/**
 * Registers the IPC handlers that expose the Concierge to the renderer.
 *
 * None of these run through the permission gate. The gate classifies actions by
 * the workspace they act on, and the Concierge has no workspace — its own
 * boundary is the tool policy that keeps every file write inside the concierge
 * home, which sits behind the runtime rather than in front of this bridge.
 * @param options - The Concierge session service and the home its artifacts live in.
 */
export function registerConciergeHandlers({
	conciergeSessionService,
	resolveConciergeHome,
}: {
	conciergeSessionService: ConciergeSessionService;
	resolveConciergeHome: () => ConciergeHome;
}): void {
	ipcMain.handle(
		IPC_CHANNELS.openConciergeSession,
		async (_event, raw: unknown): Promise<OpenConciergeSessionResult> => {
			try {
				const request = openConciergeSessionRequestSchema.parse(raw ?? {});
				return await conciergeSessionService.openSession(request);
			} catch (cause) {
				return {
					error: toError(cause, 'Failed to open the Concierge session.'),
				};
			}
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.submitConciergePrompt,
		async (_event, raw: unknown): Promise<SubmitConciergePromptResult> => {
			try {
				const request = submitConciergePromptRequestSchema.parse(raw);
				return await conciergeSessionService.submitPrompt(request);
			} catch (cause) {
				return {
					error: toError(cause, 'Failed to submit the Concierge prompt.'),
				};
			}
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.stopConciergeSession,
		async (_event, raw: unknown): Promise<StopConciergeSessionResult> => {
			try {
				const request = stopConciergeSessionRequestSchema.parse(raw);
				return await conciergeSessionService.stopSession(request);
			} catch (cause) {
				return {
					error: toError(cause, 'Failed to stop the Concierge session.'),
					ok: false,
				};
			}
		},
	);

	// Alone among these, this one lets the throw reach the renderer: its result
	// carries no error field, so a caught failure would come back as an empty
	// transcript — indistinguishable from a session that has said nothing yet,
	// and the panel would render the silence as fact.
	ipcMain.handle(
		IPC_CHANNELS.listConciergeEvents,
		(_event, raw: unknown): ListConciergeEventsResult =>
			conciergeSessionService.listEvents(
				listConciergeEventsRequestSchema.parse(raw),
			),
	);

	ipcMain.handle(
		IPC_CHANNELS.clearConciergeContext,
		async (_event, raw: unknown): Promise<ClearConciergeContextResult> => {
			try {
				const request = clearConciergeContextRequestSchema.parse(raw);
				return await conciergeSessionService.clearContext(request);
			} catch (cause) {
				return {
					error: toError(cause, 'Failed to clear the Concierge context.'),
					memoryPassStarted: false,
				};
			}
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.conciergeContextPressure,
		(): ConciergeContextPressureWire =>
			conciergeSessionService.contextPressure(),
	);

	// The home is re-read per call rather than captured, so a root the user moved
	// lists the artifacts that are there now. An unreadable directory lists as
	// empty: the `@` menu offering nothing reads as "no artifacts yet", which is
	// the truth, where a rejected promise would take the menu down with it.
	ipcMain.handle(
		IPC_CHANNELS.listConciergeArtifacts,
		async (): Promise<ListConciergeArtifactsResult> => ({
			artifacts: await listConciergeArtifacts(resolveConciergeHome()),
		}),
	);
}
