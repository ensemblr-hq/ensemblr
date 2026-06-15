import assert from 'node:assert/strict';
import test from 'node:test';

import {
	collectRegistryValidationErrors,
	findOpenTargetDefinition,
	isValidBundleId,
	OPEN_TARGET_REGISTRY,
} from '../../src/main/open-target/open-target-registry.ts';

test('every bundle id in the curated registry passes the reverse-DNS pattern', () => {
	const errors = collectRegistryValidationErrors();
	assert.deepEqual(errors, []);
});

test('rejects bundle ids with shell metacharacters', () => {
	assert.equal(isValidBundleId('com.example.app'), true);
	assert.equal(isValidBundleId('com.jetbrains.intellij-EAP'), true);
	assert.equal(isValidBundleId('com.example.app; rm -rf /'), false);
	assert.equal(isValidBundleId('com.example.app"'), false);
	assert.equal(isValidBundleId('com.example.app$(whoami)'), false);
	assert.equal(isValidBundleId(''), false);
});

test('collectRegistryValidationErrors reports both detection and dispatch failures', () => {
	const errors = collectRegistryValidationErrors([
		{
			detection: { bundleIds: ['bad id with spaces'], kind: 'bundleId' },
			dispatch: { bundleId: 'bad id with spaces', kind: 'open-bundle' },
			iconName: 'lucide:file-code',
			id: 'broken',
			kind: 'editor',
			label: 'Broken',
		},
	]);

	assert.equal(errors.length, 2);
	assert.match(errors[0] ?? '', /Invalid bundle id .* in target "broken"/);
	assert.match(
		errors[1] ?? '',
		/Invalid dispatch bundle id .* in target "broken"/,
	);
});

test('findOpenTargetDefinition returns null for unknown ids and the entry for known ids', () => {
	assert.equal(findOpenTargetDefinition('not-a-target'), null);
	const finder = findOpenTargetDefinition('finder');
	assert.ok(finder);
	assert.equal(finder.kind, 'file-manager');
});

test('registry exposes exactly one primary target', () => {
	const primaryCount = OPEN_TARGET_REGISTRY.filter(
		(entry) => entry.isPrimary,
	).length;
	assert.equal(primaryCount, 1);
});

test('registry ids are unique', () => {
	const ids = OPEN_TARGET_REGISTRY.map((entry) => entry.id);
	const unique = new Set(ids);
	assert.equal(ids.length, unique.size);
});
