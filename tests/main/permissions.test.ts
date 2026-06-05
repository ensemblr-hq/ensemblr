import assert from 'node:assert/strict';
import test from 'node:test';

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
