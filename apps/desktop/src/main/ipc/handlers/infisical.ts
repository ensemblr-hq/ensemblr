import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type {
	InfisicalAccountMutationResult,
	InfisicalAccountsResult,
	InfisicalLinkResult,
	InfisicalProjectsResult,
	InfisicalSyncResult,
} from '../../../shared/ipc/contracts/infisical';
import type { InfisicalService } from '../../infisical';
import {
	addInfisicalAccountRequestSchema,
	infisicalAccountRequestSchema,
	infisicalLinkScopeRequestSchema,
	setInfisicalLinkRequestSchema,
} from '../request-schemas.ts';

/** Failure returned when the database is not open, so no account can be read. */
const UNAVAILABLE_FAILURE = {
	code: 'database-unavailable',
	message: 'Ensemblr storage is not available yet.',
	retryAfterSeconds: null,
} as const;

/**
 * Registers the IPC handlers for Infisical accounts, project links, and manual
 * syncs. Every handler resolves the service lazily, because it is rebuilt
 * whenever the underlying database connection changes.
 * @param options - Resolver for the current Infisical service.
 */
export function registerInfisicalHandlers({
	getInfisicalService,
}: {
	getInfisicalService: () => InfisicalService | null;
}): void {
	ipcMain.handle(
		IPC_CHANNELS.infisicalAccounts,
		async (): Promise<InfisicalAccountsResult> => {
			const service = getInfisicalService();

			if (!service) {
				return { accounts: [], failure: UNAVAILABLE_FAILURE };
			}

			return service.listAccounts();
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.infisicalAddAccount,
		async (_event, raw: unknown): Promise<InfisicalAccountMutationResult> => {
			const request = addInfisicalAccountRequestSchema.parse(raw);
			const service = getInfisicalService();

			if (!service) {
				return { account: null, failure: UNAVAILABLE_FAILURE };
			}

			return service.addAccount(request);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.infisicalTestAccount,
		async (_event, raw: unknown): Promise<InfisicalAccountMutationResult> => {
			const request = infisicalAccountRequestSchema.parse(raw);
			const service = getInfisicalService();

			if (!service) {
				return { account: null, failure: UNAVAILABLE_FAILURE };
			}

			return service.testAccount(request);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.infisicalRemoveAccount,
		async (_event, raw: unknown): Promise<InfisicalAccountMutationResult> => {
			const request = infisicalAccountRequestSchema.parse(raw);
			const service = getInfisicalService();

			if (!service) {
				return { account: null, failure: UNAVAILABLE_FAILURE };
			}

			return service.removeAccount(request);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.infisicalProjects,
		async (): Promise<InfisicalProjectsResult> => {
			const service = getInfisicalService();

			if (!service) {
				return {
					accountFailures: [],
					failure: UNAVAILABLE_FAILURE,
					projects: [],
				};
			}

			return service.listProjects();
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.infisicalLink,
		async (_event, raw: unknown): Promise<InfisicalLinkResult> => {
			const request = infisicalLinkScopeRequestSchema.parse(raw);
			const service = getInfisicalService();

			if (!service) {
				return { failure: UNAVAILABLE_FAILURE, link: null };
			}

			return service.getLink(request);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.infisicalSetLink,
		async (_event, raw: unknown): Promise<InfisicalLinkResult> => {
			const request = setInfisicalLinkRequestSchema.parse(raw);
			const service = getInfisicalService();

			if (!service) {
				return { failure: UNAVAILABLE_FAILURE, link: null };
			}

			return service.setLink(request);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.infisicalClearLink,
		async (_event, raw: unknown): Promise<InfisicalLinkResult> => {
			const request = infisicalLinkScopeRequestSchema.parse(raw);
			const service = getInfisicalService();

			if (!service) {
				return { failure: UNAVAILABLE_FAILURE, link: null };
			}

			return service.clearLink(request);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.infisicalSync,
		async (_event, raw: unknown): Promise<InfisicalSyncResult> => {
			const request = infisicalLinkScopeRequestSchema.parse(raw);
			const service = getInfisicalService();

			if (!service) {
				return { failure: UNAVAILABLE_FAILURE, keys: [], syncedAt: null };
			}

			return service.syncNow(request);
		},
	);
}
