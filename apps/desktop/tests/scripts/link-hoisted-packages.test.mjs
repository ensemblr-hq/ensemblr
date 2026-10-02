import {
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readlinkSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
	findInstalledBinary,
	findInstalledPackage,
} from '../../scripts/installed-packages.mjs';
import { linkHoistedPackage } from '../../scripts/link-hoisted-packages.mjs';

let repoRoot;
let appRoot;

function installPackage(nodeModules, name) {
	const directory = join(nodeModules, name);
	mkdirSync(directory, { recursive: true });
	writeFileSync(join(directory, 'package.json'), JSON.stringify({ name }));
	return directory;
}

function installBinary(nodeModules, name) {
	const bin = join(nodeModules, '.bin');
	mkdirSync(bin, { recursive: true });
	writeFileSync(join(bin, name), '#!/bin/sh\n');
	return join(bin, name);
}

beforeEach(() => {
	repoRoot = realpathSync(mkdtempSync(join(tmpdir(), 'ensemblr-hoist-')));
	appRoot = join(repoRoot, 'apps', 'desktop');
	mkdirSync(appRoot, { recursive: true });
	writeFileSync(join(appRoot, 'package.json'), '{}');
});

afterEach(() => {
	rmSync(repoRoot, { recursive: true, force: true });
});

describe('findInstalledPackage', () => {
	test('finds a package hoisted to the repository root', () => {
		const hoisted = installPackage(join(repoRoot, 'node_modules'), 'node-pty');

		expect(findInstalledPackage('node-pty', appRoot)).toBe(hoisted);
	});

	test('prefers the nearest install over the hoisted one', () => {
		installPackage(join(repoRoot, 'node_modules'), 'electron');
		const local = installPackage(join(appRoot, 'node_modules'), 'electron');

		expect(findInstalledPackage('electron', appRoot)).toBe(local);
	});

	test('finds a scoped package', () => {
		const hoisted = installPackage(
			join(repoRoot, 'node_modules'),
			'@anthropic-ai/claude-agent-sdk',
		);

		expect(
			findInstalledPackage('@anthropic-ai/claude-agent-sdk', appRoot),
		).toBe(hoisted);
	});

	test('ignores a directory that holds no package.json', () => {
		mkdirSync(join(repoRoot, 'node_modules', 'half-installed'), {
			recursive: true,
		});

		expect(findInstalledPackage('half-installed', appRoot)).toBeNull();
	});
});

describe('findInstalledBinary', () => {
	test('finds an executable hoisted to the repository root', () => {
		const tsc = installBinary(join(repoRoot, 'node_modules'), 'tsc');

		expect(findInstalledBinary('tsc', appRoot)).toBe(tsc);
	});

	test('returns null when nothing installed the executable', () => {
		expect(findInstalledBinary('not-a-real-binary', appRoot)).toBeNull();
	});
});

describe('linkHoistedPackage', () => {
	test('links a hoisted package into the app with a relative target', () => {
		installPackage(join(repoRoot, 'node_modules'), 'electron');

		expect(linkHoistedPackage('electron', appRoot)).toBe(true);

		const linkPath = join(appRoot, 'node_modules', 'electron');
		expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
		expect(readlinkSync(linkPath)).toBe('../../../node_modules/electron');
		expect(realpathSync(linkPath)).toBe(
			join(repoRoot, 'node_modules', 'electron'),
		);
	});

	test('creates the scope directory for a scoped package', () => {
		installPackage(
			join(repoRoot, 'node_modules'),
			'@anthropic-ai/claude-agent-sdk',
		);

		expect(linkHoistedPackage('@anthropic-ai/claude-agent-sdk', appRoot)).toBe(
			true,
		);
		expect(
			readlinkSync(
				join(appRoot, 'node_modules', '@anthropic-ai', 'claude-agent-sdk'),
			),
		).toBe('../../../../node_modules/@anthropic-ai/claude-agent-sdk');
	});

	test('leaves a link that already points at the hoisted package', () => {
		installPackage(join(repoRoot, 'node_modules'), 'node-pty');
		linkHoistedPackage('node-pty', appRoot);

		expect(linkHoistedPackage('node-pty', appRoot)).toBe(false);
	});

	test('replaces a link that points somewhere else', () => {
		installPackage(join(repoRoot, 'node_modules'), 'node-pty');
		mkdirSync(join(appRoot, 'node_modules'), { recursive: true });
		symlinkSync(
			'../../elsewhere/node-pty',
			join(appRoot, 'node_modules', 'node-pty'),
		);

		expect(linkHoistedPackage('node-pty', appRoot)).toBe(true);
		expect(readlinkSync(join(appRoot, 'node_modules', 'node-pty'))).toBe(
			'../../../node_modules/node-pty',
		);
	});

	test('leaves a real install in the app directory alone', () => {
		installPackage(join(repoRoot, 'node_modules'), 'node-addon-api');
		installPackage(join(appRoot, 'node_modules'), 'node-addon-api');

		expect(linkHoistedPackage('node-addon-api', appRoot)).toBe(false);
		expect(
			lstatSync(
				join(appRoot, 'node_modules', 'node-addon-api'),
			).isSymbolicLink(),
		).toBe(false);
	});

	test('fails naming the package when nothing installed it', () => {
		expect(() => linkHoistedPackage('electron', appRoot)).toThrow(
			/electron is not installed/,
		);
	});
});
