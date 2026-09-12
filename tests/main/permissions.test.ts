import assert from 'node:assert/strict';
import test from 'node:test';
import {
	IPC_PERMISSION_ACTIONS,
	permissionActionForChannel,
} from '../../src/main/ipc/permission-actions.ts';
import { permissionConfirmStrings } from '../../src/main/ipc/permission-confirm-strings.ts';
import { APP_LANGUAGES } from '../../src/shared/i18n.ts';
import { IPC_CHANNELS } from '../../src/shared/ipc/channels.ts';
import {
	classifyPermissionAction,
	DEFAULT_PERMISSION_MODE,
	getInvalidPermissionModeReason,
	getPermissionBoundaryLabel,
	getPermissionModeLabel,
	isPermissionMode,
	normalizePermissionMode,
} from '../../src/shared/permissions.ts';

test('normalizes permission modes with workspace-trusted as the default', () => {
	assert.equal(isPermissionMode('workspace-trusted'), true);
	assert.equal(isPermissionMode('approval-required'), true);
	assert.equal(isPermissionMode('read-only'), true);
	assert.equal(isPermissionMode('sandboxed'), false);
	assert.equal(normalizePermissionMode('read-only'), 'read-only');
	assert.equal(normalizePermissionMode('sandboxed'), DEFAULT_PERMISSION_MODE);
	assert.equal(normalizePermissionMode(null), DEFAULT_PERMISSION_MODE);
	assert.equal(
		getPermissionModeLabel('approval-required'),
		'Approval required',
	);
});

test('reports invalid permission mode values', () => {
	assert.equal(getInvalidPermissionModeReason('read-only'), null);
	assert.match(
		getInvalidPermissionModeReason('sandboxed') ?? '',
		/Invalid permission mode "sandboxed"/,
	);
	assert.match(
		getInvalidPermissionModeReason(false) ?? '',
		/Invalid permission mode boolean/,
	);
});

test('classifies permission boundaries by mode and action', () => {
	assert.deepEqual(
		classifyPermissionAction({
			action: 'workspace-write',
			mode: 'workspace-trusted',
		}).boundary,
		'allowed',
	);
	assert.deepEqual(
		classifyPermissionAction({
			action: 'workspace-command',
			mode: 'approval-required',
		}).boundary,
		'confirmation-required',
	);
	assert.deepEqual(
		classifyPermissionAction({
			action: 'workspace-write',
			mode: 'read-only',
		}).boundary,
		'blocked',
	);
	assert.deepEqual(
		classifyPermissionAction({
			action: 'pull-request-merge',
			mode: 'workspace-trusted',
		}).boundary,
		'confirmation-required',
	);
	assert.equal(
		getPermissionBoundaryLabel('confirmation-required'),
		'Requires confirmation',
	);
});

test('read-only blocks sensitive actions instead of letting them through confirmation', () => {
	for (const action of [
		'app-settings-change',
		'outside-workspace-write',
		'pi-global-config-change',
		'pull-request-merge',
		'repository-removal',
		'root-directory-change',
		'workspace-archive-delete',
	] as const) {
		assert.equal(
			classifyPermissionAction({ action, mode: 'read-only' }).boundary,
			'blocked',
			`${action} must be blocked under read-only`,
		);
	}
});

test('sensitive actions still require confirmation in the permissive modes', () => {
	assert.equal(
		classifyPermissionAction({
			action: 'outside-workspace-write',
			mode: 'workspace-trusted',
		}).boundary,
		'confirmation-required',
	);
	assert.equal(
		classifyPermissionAction({
			action: 'app-settings-change',
			mode: 'approval-required',
		}).boundary,
		'confirmation-required',
	);
});

test('reads stay allowed in every mode', () => {
	for (const mode of [
		'workspace-trusted',
		'approval-required',
		'read-only',
	] as const) {
		assert.equal(
			classifyPermissionAction({ action: 'workspace-read', mode }).boundary,
			'allowed',
		);
		assert.equal(
			classifyPermissionAction({ action: 'app-control-read', mode }).boundary,
			'allowed',
		);
	}
});

test('every IPC channel is classified as gated or explicitly ungated', () => {
	const classified = Object.keys(IPC_PERMISSION_ACTIONS).sort();
	assert.deepEqual(classified, Object.keys(IPC_CHANNELS).sort());

	for (const value of Object.values(IPC_PERMISSION_ACTIONS)) {
		if (value !== null) {
			assert.equal(
				classifyPermissionAction({ action: value, mode: 'read-only' }).mode,
				'read-only',
			);
		}
	}
});

test('the channels that execute or mutate are gated', () => {
	for (const [channel, action] of [
		['createTerminalSession', 'workspace-command'],
		['writeTerminalSession', 'workspace-command'],
		['runWorkspaceScript', 'workspace-command'],
		['ensureWorkspaceSetup', 'workspace-command'],
		['launchAgentHarness', 'workspace-command'],
		['openAgentSession', 'workspace-command'],
		['submitAgentPrompt', 'workspace-command'],
		['discardWorkspaceChanges', 'workspace-write'],
		['restoreCheckpoint', 'workspace-write'],
		['updateRepositoryScripts', 'workspace-write'],
		['applySettingsPublication', 'workspace-write'],
		['updateAppSettings', 'app-settings-change'],
		['setAgentProviderExecutablePath', 'app-settings-change'],
	] as const) {
		assert.equal(
			permissionActionForChannel(IPC_CHANNELS[channel]),
			action,
			`${channel} must be gated as ${action}`,
		);
	}
});

test('stop-style channels stay ungated so work can always be ended', () => {
	for (const channel of [
		'killTerminalSession',
		'closeTerminalSession',
		'stopWorkspaceScript',
		'stopAgentSession',
		'stopConciergeSession',
	] as const) {
		assert.equal(permissionActionForChannel(IPC_CHANNELS[channel]), null);
	}
});

test('permission confirmation copy is complete in every language', () => {
	const english = Object.keys(permissionConfirmStrings('en')).sort();

	for (const language of APP_LANGUAGES) {
		const strings = permissionConfirmStrings(language);
		assert.deepEqual(Object.keys(strings).sort(), english);
		for (const value of Object.values(strings)) {
			assert.ok(value.length > 0);
		}
		assert.ok(strings.detail.includes('{{action}}'));
	}

	assert.deepEqual(
		permissionConfirmStrings('kl' as never),
		permissionConfirmStrings('en'),
	);
});
