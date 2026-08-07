import { describe, expect, test } from 'vitest';

import { shellCommandTitle } from '../../src/renderer/lib/agent-timeline/shell-command-title';

describe('shellCommandTitle', () => {
	test('names the action for common file commands', () => {
		expect(shellCommandTitle('ls -la src')).toBe('Listing files');
		expect(shellCommandTitle('cat package.json')).toBe('Reading a file');
		expect(shellCommandTitle('mkdir -p src/lib')).toBe('Creating a directory');
		expect(shellCommandTitle('rm -rf dist')).toBe('Removing files');
	});

	test('names the action for search commands', () => {
		expect(shellCommandTitle('grep -rn "todo" src')).toBe('Searching files');
		expect(shellCommandTitle('rg --files-with-matches foo')).toBe(
			'Searching files',
		);
	});

	test('reads through an absolute binary path', () => {
		expect(shellCommandTitle('/usr/bin/ls -1')).toBe('Listing files');
	});

	test('skips leading directory changes to the real work', () => {
		expect(shellCommandTitle('cd /repo && npm run build')).toBe(
			'Building the project',
		);
		expect(shellCommandTitle('cd /repo; grep -n foo src')).toBe(
			'Searching files',
		);
	});

	test('keeps a bare directory change as its own action', () => {
		expect(shellCommandTitle('cd /repo')).toBe('Changing directory');
	});

	test('names git work by its subcommand', () => {
		expect(shellCommandTitle('git status --short')).toBe('Checking git status');
		expect(shellCommandTitle('git diff origin/master...HEAD')).toBe(
			'Reviewing changes',
		);
		expect(shellCommandTitle('git commit -m "feat: x"')).toBe(
			'Committing changes',
		);
	});

	test('falls back to the binary for an unmapped git subcommand', () => {
		expect(shellCommandTitle('git bisect start')).toBe('Running git');
	});

	test('names package-manager scripts by what they do', () => {
		expect(shellCommandTitle('npm install')).toBe('Installing dependencies');
		expect(shellCommandTitle('npm test')).toBe('Running tests');
		expect(shellCommandTitle('npm run typecheck')).toBe('Type-checking');
		expect(shellCommandTitle('npm run check:fix')).toBe('Checking the code');
		expect(shellCommandTitle('npm run seed')).toBe('Running seed');
	});

	test('looks through npx at the tool it runs', () => {
		expect(shellCommandTitle('npx vitest run tests/a.test.ts')).toBe(
			'Running tests',
		);
		expect(shellCommandTitle('npx tsc --noEmit')).toBe('Type-checking');
	});

	test('ignores environment assignments and privilege prefixes', () => {
		expect(shellCommandTitle('CI=1 npm test')).toBe('Running tests');
		expect(shellCommandTitle('sudo rm -rf /tmp/build')).toBe('Removing files');
		expect(shellCommandTitle('timeout 180 npx vitest run')).toBe(
			'Running tests',
		);
		expect(shellCommandTitle('timeout --preserve-status 180 npm test')).toBe(
			'Running tests',
		);
	});

	test('looks past an executor’s own flags to the tool it runs', () => {
		expect(shellCommandTitle('npx -y prettier --write .')).toBe(
			'Running prettier',
		);
		expect(shellCommandTitle('npx --yes vitest run')).toBe('Running tests');
	});

	test('drops a pinned version but keeps a scoped package’s name', () => {
		expect(shellCommandTitle('npx react-doctor@latest --verbose')).toBe(
			'Running react-doctor',
		);
		expect(shellCommandTitle('npx @biomejs/biome check .')).toBe(
			'Running biome',
		);
	});

	test('reads past a flag’s value to the subcommand behind it', () => {
		expect(shellCommandTitle('git -C /repo status')).toBe(
			'Checking git status',
		);
		expect(shellCommandTitle('git --no-pager log --oneline -5')).toBe(
			'Reading git history',
		);
		expect(shellCommandTitle('npm --prefix ./app run build')).toBe(
			'Building the project',
		);
	});

	test('keeps a binary whose name reads like a duration', () => {
		expect(shellCommandTitle('7z x archive.zip')).toBe('Running 7z');
	});

	test('falls back to the binary name for unknown commands', () => {
		expect(shellCommandTitle('fallow audit --coverage x.json')).toBe(
			'Running fallow',
		);
	});

	test('falls back to the tool label when there is no command', () => {
		expect(shellCommandTitle('')).toBe('Bash');
		expect(shellCommandTitle('   ')).toBe('Bash');
	});
});
