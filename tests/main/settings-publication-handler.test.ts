import { beforeEach, expect, test, vi } from 'vitest';

import type {
	ApplySettingsPublicationRequest,
	ApplySettingsPublicationResult,
	CleanupSettingsPublicationRequest,
	CleanupSettingsPublicationResult,
	PreviewSettingsPublicationRequest,
	PreviewSettingsPublicationResult,
	RestoreSettingsPublicationRequest,
	RestoreSettingsPublicationResult,
	SettingsPublicationRecoveryStatusRequest,
	SettingsPublicationRecoveryStatusResult,
} from '../../src/shared/ipc/contracts/settings-publication.ts';

const handle = vi.fn();

vi.mock('electron', () => ({ ipcMain: { handle } }));

const { registerSettingsPublicationHandlers } = await import(
	'../../src/main/ipc/handlers/settings-publication.ts'
);

const preview =
	vi.fn<
		(
			request: PreviewSettingsPublicationRequest,
		) => PreviewSettingsPublicationResult
	>();
const apply =
	vi.fn<
		(request: ApplySettingsPublicationRequest) => ApplySettingsPublicationResult
	>();
const cleanup =
	vi.fn<
		(
			request: CleanupSettingsPublicationRequest,
		) => CleanupSettingsPublicationResult
	>();
const restore =
	vi.fn<
		(
			request: RestoreSettingsPublicationRequest,
		) => RestoreSettingsPublicationResult
	>();
const recoveryStatus =
	vi.fn<
		(
			request: SettingsPublicationRecoveryStatusRequest,
		) => SettingsPublicationRecoveryStatusResult
	>();

const fakeService = { apply, cleanup, preview, recoveryStatus, restore };

/** Invokes a registered handler by its Ensemblr channel name. */
function invoke(channel: string, request: unknown): unknown {
	const registration = handle.mock.calls.find(
		([registeredChannel]) => registeredChannel === channel,
	);
	if (!registration) {
		throw new Error(`${channel} handler was not registered`);
	}
	return registration[1](null, request);
}

beforeEach(() => {
	handle.mockClear();
	preview.mockReset();
	apply.mockReset();
	cleanup.mockReset();
	restore.mockReset();
	recoveryStatus.mockReset();
	registerSettingsPublicationHandlers({ service: fakeService });
});

test('preview reaches the service with the parsed request', () => {
	preview.mockReturnValue({
		failure: null,
		preview: {
			hasLegacyScripts: false,
			mergedText: '',
			repositoryId: 'repo-1',
			sourceStatus: 'modified',
			status: 'clean',
			token: 'token-1',
			workspaceId: 'workspace-1',
		},
	});

	const result = invoke('ensemblr:preview-settings-publication', {
		repositoryId: 'repo-1',
		workspaceId: 'workspace-1',
	});

	expect(preview).toHaveBeenCalledWith({
		repositoryId: 'repo-1',
		workspaceId: 'workspace-1',
	});
	expect(result).toEqual({
		failure: null,
		preview: expect.objectContaining({ token: 'token-1' }),
	});
});

test('preview rejects a malformed payload without calling the service', () => {
	const result = invoke('ensemblr:preview-settings-publication', {
		repositoryId: 'repo-1',
	});

	expect(preview).not.toHaveBeenCalled();
	expect(result).toEqual({
		failure: { code: 'invalid-request', message: expect.any(String) },
		preview: null,
	});
});

test('apply reaches the service with the parsed request', () => {
	apply.mockReturnValue({
		failure: null,
		recoveryId: 'recovery-1',
		status: 'applied',
	});

	const result = invoke('ensemblr:apply-settings-publication', {
		previewToken: 'token-1',
		repositoryId: 'repo-1',
		workspaceId: 'workspace-1',
	});

	expect(apply).toHaveBeenCalledWith({
		previewToken: 'token-1',
		repositoryId: 'repo-1',
		workspaceId: 'workspace-1',
	});
	expect(result).toEqual({
		failure: null,
		recoveryId: 'recovery-1',
		status: 'applied',
	});
});

test('apply rejects a malformed payload without calling the service', () => {
	const result = invoke('ensemblr:apply-settings-publication', {
		repositoryId: 'repo-1',
	});

	expect(apply).not.toHaveBeenCalled();
	expect(result).toEqual({
		failure: { code: 'invalid-request', message: expect.any(String) },
		recoveryId: null,
		status: 'failed',
	});
});

test('cleanup reaches the service with the parsed request', () => {
	cleanup.mockReturnValue({ failure: null, status: 'cleaned' });

	const result = invoke('ensemblr:cleanup-settings-publication', {
		recoveryId: 'recovery-1',
	});

	expect(cleanup).toHaveBeenCalledWith({ recoveryId: 'recovery-1' });
	expect(result).toEqual({ failure: null, status: 'cleaned' });
});

test('cleanup rejects a malformed payload without calling the service', () => {
	const result = invoke('ensemblr:cleanup-settings-publication', {});

	expect(cleanup).not.toHaveBeenCalled();
	expect(result).toEqual({
		failure: { code: 'invalid-request', message: expect.any(String) },
		status: 'failed',
	});
});

test('restore reaches the service with the parsed request', () => {
	restore.mockReturnValue({ failure: null, status: 'restored' });

	const result = invoke('ensemblr:restore-settings-publication', {
		copy: 'source',
		recoveryId: 'recovery-1',
	});

	expect(restore).toHaveBeenCalledWith({
		copy: 'source',
		recoveryId: 'recovery-1',
	});
	expect(result).toEqual({ failure: null, status: 'restored' });
});

test('restore rejects a malformed payload without calling the service', () => {
	const result = invoke('ensemblr:restore-settings-publication', {
		copy: 'sideways',
		recoveryId: 'recovery-1',
	});

	expect(restore).not.toHaveBeenCalled();
	expect(result).toEqual({
		failure: { code: 'invalid-request', message: expect.any(String) },
		status: 'failed',
	});
});

test('recoveryStatus reaches the service with the parsed request', () => {
	recoveryStatus.mockReturnValue({ failure: null, recoveries: [] });

	const result = invoke('ensemblr:settings-publication-recovery-status', {
		repositoryId: 'repo-1',
	});

	expect(recoveryStatus).toHaveBeenCalledWith({ repositoryId: 'repo-1' });
	expect(result).toEqual({ failure: null, recoveries: [] });
});

test('recoveryStatus rejects a malformed payload without calling the service', () => {
	const result = invoke('ensemblr:settings-publication-recovery-status', {});

	expect(recoveryStatus).not.toHaveBeenCalled();
	expect(result).toEqual({
		failure: { code: 'invalid-request', message: expect.any(String) },
		recoveries: [],
	});
});
