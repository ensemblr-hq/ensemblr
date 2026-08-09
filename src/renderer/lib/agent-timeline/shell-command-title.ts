import { i18n } from '@/renderer/lib/i18n';

/** Splits a command line into the separate commands it chains together. */
const SEGMENT_SEPARATOR = /\s*(?:&&|\|\||[;|\n])\s*/;

/** Matches a leading `FOO=bar` environment assignment. */
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Matches a bare count or duration argument, as `timeout 180` carries. */
const DURATION_ARGUMENT = /^\d+[a-z]*$/;

/** Wrappers that take a bare duration before the command they run. */
const DURATION_PREFIXES = new Set(['timeout']);

/** Wrappers that run another command without changing what it does. */
const TRANSPARENT_PREFIXES = new Set([
	'command',
	'env',
	'exec',
	'nice',
	'nohup',
	'sudo',
	'time',
	'timeout',
	'xargs',
]);

/** Leading segments that only prepare the shell for the command that follows. */
const SETUP_BINARIES = new Set(['.', 'cd', 'export', 'set', 'source']);

/** Package managers whose real action is named by the script they run. */
const PACKAGE_MANAGERS = new Set(['bun', 'npm', 'pnpm', 'yarn']);

/** Runners that stand in front of the tool actually being invoked. */
const PACKAGE_EXECUTORS = new Set(['bunx', 'npx', 'pnpx']);

/**
 * Every action a command row can be titled with, each resolving its own text in
 * the active language. Held apart from the lookup tables below because the same
 * action is reached by many commands — `go build` and `cargo build` are one
 * title — and a locale should translate it once.
 */
const TITLES = {
	buildImage: () =>
		i18n.t('workbench:shell-title.build-image', 'Building an image'),
	buildProject: () =>
		i18n.t('workbench:shell-title.build-project', 'Building the project'),
	changeDirectory: () =>
		i18n.t('workbench:shell-title.change-directory', 'Changing directory'),
	changePermissions: () =>
		i18n.t('workbench:shell-title.change-permissions', 'Changing permissions'),
	checkCode: () =>
		i18n.t('workbench:shell-title.check-code', 'Checking the code'),
	checkDirectory: () =>
		i18n.t('workbench:shell-title.check-directory', 'Checking the directory'),
	checkDiskUsage: () =>
		i18n.t('workbench:shell-title.check-disk-usage', 'Checking disk usage'),
	checkGitStatus: () =>
		i18n.t('workbench:shell-title.check-git-status', 'Checking git status'),
	commitChanges: () =>
		i18n.t('workbench:shell-title.commit-changes', 'Committing changes'),
	compareFiles: () =>
		i18n.t('workbench:shell-title.compare-files', 'Comparing files'),
	copyFiles: () => i18n.t('workbench:shell-title.copy-files', 'Copying files'),
	countLines: () =>
		i18n.t('workbench:shell-title.count-lines', 'Counting lines'),
	createDirectory: () =>
		i18n.t('workbench:shell-title.create-directory', 'Creating a directory'),
	createFile: () =>
		i18n.t('workbench:shell-title.create-file', 'Creating a file'),
	fetchRemote: () =>
		i18n.t('workbench:shell-title.fetch-remote', 'Fetching from the remote'),
	fetchUrl: () => i18n.t('workbench:shell-title.fetch-url', 'Fetching a URL'),
	inspectProcesses: () =>
		i18n.t('workbench:shell-title.inspect-processes', 'Inspecting processes'),
	installDependencies: () =>
		i18n.t(
			'workbench:shell-title.install-dependencies',
			'Installing dependencies',
		),
	listBranches: () =>
		i18n.t('workbench:shell-title.list-branches', 'Listing branches'),
	listFiles: () => i18n.t('workbench:shell-title.list-files', 'Listing files'),
	locateBinary: () =>
		i18n.t('workbench:shell-title.locate-binary', 'Locating a binary'),
	mergeBranches: () =>
		i18n.t('workbench:shell-title.merge-branches', 'Merging branches'),
	moveFiles: () => i18n.t('workbench:shell-title.move-files', 'Moving files'),
	openFile: () => i18n.t('workbench:shell-title.open-file', 'Opening a file'),
	printOutput: () =>
		i18n.t('workbench:shell-title.print-output', 'Printing output'),
	pullChanges: () =>
		i18n.t('workbench:shell-title.pull-changes', 'Pulling changes'),
	pushChanges: () =>
		i18n.t('workbench:shell-title.push-changes', 'Pushing changes'),
	readCommit: () =>
		i18n.t('workbench:shell-title.read-commit', 'Reading a commit'),
	readFile: () => i18n.t('workbench:shell-title.read-file', 'Reading a file'),
	readGitHistory: () =>
		i18n.t('workbench:shell-title.read-git-history', 'Reading git history'),
	rebaseBranch: () =>
		i18n.t('workbench:shell-title.rebase-branch', 'Rebasing the branch'),
	removeFiles: () =>
		i18n.t('workbench:shell-title.remove-files', 'Removing files'),
	reviewChanges: () =>
		i18n.t('workbench:shell-title.review-changes', 'Reviewing changes'),
	runContainer: () =>
		i18n.t('workbench:shell-title.run-container', 'Running a container'),
	runScript: () =>
		i18n.t('workbench:shell-title.run-script', 'Running a script'),
	runTests: () => i18n.t('workbench:shell-title.run-tests', 'Running tests'),
	searchFiles: () =>
		i18n.t('workbench:shell-title.search-files', 'Searching files'),
	stageChanges: () =>
		i18n.t('workbench:shell-title.stage-changes', 'Staging changes'),
	startDevServer: () =>
		i18n.t('workbench:shell-title.start-dev-server', 'Starting the dev server'),
	stashChanges: () =>
		i18n.t('workbench:shell-title.stash-changes', 'Stashing changes'),
	stopProcess: () =>
		i18n.t('workbench:shell-title.stop-process', 'Stopping a process'),
	switchBranches: () =>
		i18n.t('workbench:shell-title.switch-branches', 'Switching branches'),
	transformText: () =>
		i18n.t('workbench:shell-title.transform-text', 'Transforming text'),
	typeCheck: () => i18n.t('workbench:shell-title.type-check', 'Type-checking'),
	waiting: () => i18n.t('workbench:shell-title.waiting', 'Waiting'),
} satisfies Record<string, () => string>;

/**
 * Names an invocation the tables have no title for, by the binary or script it
 * ran.
 * @param name - The binary or script that was invoked
 * @returns The fallback title
 */
function runningNamed(name: string): string {
	return i18n.t('workbench:shell-title.run-named', 'Running {{name}}', {
		name,
	});
}

/** Subcommands whose parent binary alone would say too little. */
const SUBCOMMAND_TITLES: Record<string, () => string> = {
	'cargo build': TITLES.buildProject,
	'cargo test': TITLES.runTests,
	'docker build': TITLES.buildImage,
	'docker run': TITLES.runContainer,
	'git add': TITLES.stageChanges,
	'git branch': TITLES.listBranches,
	'git checkout': TITLES.switchBranches,
	'git commit': TITLES.commitChanges,
	'git diff': TITLES.reviewChanges,
	'git fetch': TITLES.fetchRemote,
	'git log': TITLES.readGitHistory,
	'git merge': TITLES.mergeBranches,
	'git pull': TITLES.pullChanges,
	'git push': TITLES.pushChanges,
	'git rebase': TITLES.rebaseBranch,
	'git show': TITLES.readCommit,
	'git stash': TITLES.stashChanges,
	'git status': TITLES.checkGitStatus,
	'git switch': TITLES.switchBranches,
	'go build': TITLES.buildProject,
	'go test': TITLES.runTests,
};

/** What each known binary is doing, phrased as the step it performs. */
const COMMAND_TITLES: Record<string, () => string> = {
	ack: TITLES.searchFiles,
	ag: TITLES.searchFiles,
	awk: TITLES.transformText,
	bat: TITLES.readFile,
	cat: TITLES.readFile,
	cd: TITLES.changeDirectory,
	chmod: TITLES.changePermissions,
	chown: TITLES.changePermissions,
	cp: TITLES.copyFiles,
	curl: TITLES.fetchUrl,
	deno: TITLES.runScript,
	df: TITLES.checkDiskUsage,
	diff: TITLES.compareFiles,
	du: TITLES.checkDiskUsage,
	echo: TITLES.printOutput,
	fd: TITLES.listFiles,
	find: TITLES.listFiles,
	grep: TITLES.searchFiles,
	head: TITLES.readFile,
	jest: TITLES.runTests,
	kill: TITLES.stopProcess,
	less: TITLES.readFile,
	ls: TITLES.listFiles,
	mkdir: TITLES.createDirectory,
	mv: TITLES.moveFiles,
	node: TITLES.runScript,
	open: TITLES.openFile,
	pgrep: TITLES.inspectProcesses,
	pkill: TITLES.stopProcess,
	printf: TITLES.printOutput,
	ps: TITLES.inspectProcesses,
	pwd: TITLES.checkDirectory,
	python: TITLES.runScript,
	python3: TITLES.runScript,
	pytest: TITLES.runTests,
	rg: TITLES.searchFiles,
	rm: TITLES.removeFiles,
	rmdir: TITLES.removeFiles,
	sed: TITLES.transformText,
	sleep: TITLES.waiting,
	tail: TITLES.readFile,
	touch: TITLES.createFile,
	tree: TITLES.listFiles,
	tsc: TITLES.typeCheck,
	tsx: TITLES.runScript,
	vitest: TITLES.runTests,
	wc: TITLES.countLines,
	whereis: TITLES.locateBinary,
	which: TITLES.locateBinary,
	wget: TITLES.fetchUrl,
};

/** What each well-known package script does, keyed by its name before any `:`. */
const SCRIPT_TITLES: Record<string, () => string> = {
	biome: TITLES.checkCode,
	build: TITLES.buildProject,
	check: TITLES.checkCode,
	dev: TITLES.startDevServer,
	format: TITLES.checkCode,
	lint: TITLES.checkCode,
	start: TITLES.startDevServer,
	test: TITLES.runTests,
	tsc: TITLES.typeCheck,
	typecheck: TITLES.typeCheck,
	types: TITLES.typeCheck,
};

/** Package-manager arguments that install rather than run something. */
const INSTALL_ARGUMENTS = new Set(['add', 'ci', 'i', 'install']);

/** Package-manager arguments that hand the rest of the line to a script. */
const RUN_ARGUMENTS = new Set(['exec', 'run', 'run-script']);

/**
 * Reduces an invocation to the binary's own name, dropping any path it was
 * called through and any `@version` an executor pinned it to. Only a `@` inside
 * the name counts, so a scoped package keeps the name after its scope.
 * @param token - The token holding the invoked binary
 * @returns The bare binary name
 */
function binaryName(token: string): string {
	const name = token.split('/').at(-1) ?? token;
	const version = name.lastIndexOf('@');
	return version > 0 ? name.slice(0, version) : name;
}

/**
 * Decides whether a token stands in front of the binary rather than being it.
 * @param token - The token to classify
 * @returns True when the token can be skipped while looking for the binary
 */
function precedesBinary(token: string): boolean {
	return (
		TRANSPARENT_PREFIXES.has(binaryName(token)) ||
		ENV_ASSIGNMENT.test(token) ||
		token.startsWith('-')
	);
}

/**
 * Splits one chained command into its tokens, dropping the wrappers and
 * environment assignments that precede the binary. A bare duration is dropped
 * only once a wrapper that takes one has been seen, so a binary whose name reads
 * like a duration — `7z` — is not mistaken for `timeout`'s argument.
 * @param segment - One command from a chained command line
 * @returns The tokens from the binary onward
 */
function tokensOf(segment: string): readonly string[] {
	const tokens = segment.trim().split(/\s+/).filter(Boolean);
	let index = 0;
	let expectsDuration = false;
	while (index < tokens.length) {
		const token = tokens[index] ?? '';
		if (expectsDuration && DURATION_ARGUMENT.test(token)) {
			expectsDuration = false;
		} else if (precedesBinary(token)) {
			expectsDuration ||= DURATION_PREFIXES.has(binaryName(token));
		} else {
			break;
		}
		index += 1;
	}
	return tokens.slice(index);
}

/**
 * Picks the chained command that carries the intent, skipping the `cd` and
 * `export` steps that only set the stage for it.
 * @param command - The whole command line
 * @returns The tokens of the command worth naming, empty when there are none
 */
function primaryTokens(command: string): readonly string[] {
	const segments = command
		.split(SEGMENT_SEPARATOR)
		.map(tokensOf)
		.filter((tokens) => tokens.length > 0);
	const acting = segments.find(
		(tokens) => !SETUP_BINARIES.has(binaryName(tokens[0] ?? '')),
	);
	return acting ?? segments[0] ?? [];
}

/**
 * Drops the flags a wrapper consumed for itself, so what follows starts at the
 * command it wraps rather than at its own `-y`.
 * @param tokens - Arguments following the wrapper
 * @returns The tokens from the first non-flag onward
 */
function afterFlags(tokens: readonly string[]): readonly string[] {
	const start = tokens.findIndex((token) => !token.startsWith('-'));
	return start === -1 ? [] : tokens.slice(start);
}

/**
 * Reads the first argument that can name a script, skipping both flags and the
 * paths they carry as values, so `--prefix ./app` is not read as the script.
 * @param tokens - Arguments to search
 * @returns The first script-shaped argument, or null when there is none
 */
function firstScriptArgument(tokens: readonly string[]): string | null {
	return (
		tokens.find(
			(token) =>
				!token.startsWith('-') &&
				!token.startsWith('.') &&
				!token.includes('/'),
		) ?? null
	);
}

/**
 * Looks the binary's subcommand up among the titles worth spelling out, scanning
 * past any flag values that sit between the binary and its subcommand.
 * @param binary - The invoked binary's bare name
 * @param args - Arguments following the binary
 * @returns The subcommand's title, or undefined when none is mapped
 */
function subcommandTitle(
	binary: string,
	args: readonly string[],
): string | undefined {
	for (const token of args) {
		const title = SUBCOMMAND_TITLES[`${binary} ${token}`];
		if (title !== undefined) {
			return title();
		}
	}
	return undefined;
}

/**
 * Names what a package script does, falling back to the script's own name so an
 * unmapped script still reads as an action.
 * @param script - The script name, possibly namespaced as `check:fix`
 * @returns The title for running that script
 */
function scriptTitle(script: string): string {
	const base = script.split(':')[0] ?? script;
	const title = SCRIPT_TITLES[base];
	return title ? title() : runningNamed(script);
}

/**
 * Names a package-manager invocation by the script or install it performs.
 * @param manager - The package manager binary
 * @param args - Arguments following the manager
 * @returns The title for the invocation
 */
function packageManagerTitle(manager: string, args: readonly string[]): string {
	const argument = firstScriptArgument(args);
	if (argument === null) {
		return runningNamed(manager);
	}
	if (INSTALL_ARGUMENTS.has(argument)) {
		return TITLES.installDependencies();
	}
	if (!RUN_ARGUMENTS.has(argument)) {
		return scriptTitle(argument);
	}
	const script = firstScriptArgument(args.slice(args.indexOf(argument) + 1));
	return script === null ? runningNamed(manager) : scriptTitle(script);
}

/**
 * Names the action a tokenized command performs, looking through package
 * executors such as `npx` to the tool they invoke.
 * @param tokens - Tokens from the binary onward
 * @returns The title for the command
 */
function titleForTokens(tokens: readonly string[]): string {
	const binary = binaryName(tokens[0] ?? '');
	if (binary.length === 0) {
		return 'Bash';
	}
	const args = tokens.slice(1);
	if (PACKAGE_EXECUTORS.has(binary)) {
		const invoked = afterFlags(args);
		return invoked.length > 0 ? titleForTokens(invoked) : runningNamed(binary);
	}
	if (PACKAGE_MANAGERS.has(binary)) {
		return packageManagerTitle(binary, args);
	}
	return (
		subcommandTitle(binary, args) ??
		COMMAND_TITLES[binary]?.() ??
		runningNamed(binary)
	);
}

/**
 * Names in a few words what a shell command is doing, so a tool row can say
 * "Listing files" where the command line itself stays in the preview.
 * @param command - The command line the tool was asked to run
 * @returns A short action title, or `'Bash'` when there is no command to read
 */
export function shellCommandTitle(command: string): string {
	return titleForTokens(primaryTokens(command));
}
