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

/** Subcommands whose parent binary alone would say too little. */
const SUBCOMMAND_TITLES: Record<string, string> = {
	'cargo build': 'Building the project',
	'cargo test': 'Running tests',
	'docker build': 'Building an image',
	'docker run': 'Running a container',
	'git add': 'Staging changes',
	'git branch': 'Listing branches',
	'git checkout': 'Switching branches',
	'git commit': 'Committing changes',
	'git diff': 'Reviewing changes',
	'git fetch': 'Fetching from the remote',
	'git log': 'Reading git history',
	'git merge': 'Merging branches',
	'git pull': 'Pulling changes',
	'git push': 'Pushing changes',
	'git rebase': 'Rebasing the branch',
	'git show': 'Reading a commit',
	'git stash': 'Stashing changes',
	'git status': 'Checking git status',
	'git switch': 'Switching branches',
	'go build': 'Building the project',
	'go test': 'Running tests',
};

/** What each known binary is doing, phrased as the step it performs. */
const COMMAND_TITLES: Record<string, string> = {
	ack: 'Searching files',
	ag: 'Searching files',
	awk: 'Transforming text',
	bat: 'Reading a file',
	cat: 'Reading a file',
	cd: 'Changing directory',
	chmod: 'Changing permissions',
	chown: 'Changing permissions',
	cp: 'Copying files',
	curl: 'Fetching a URL',
	deno: 'Running a script',
	df: 'Checking disk usage',
	diff: 'Comparing files',
	du: 'Checking disk usage',
	echo: 'Printing output',
	fd: 'Listing files',
	find: 'Listing files',
	grep: 'Searching files',
	head: 'Reading a file',
	jest: 'Running tests',
	kill: 'Stopping a process',
	less: 'Reading a file',
	ls: 'Listing files',
	mkdir: 'Creating a directory',
	mv: 'Moving files',
	node: 'Running a script',
	open: 'Opening a file',
	pgrep: 'Inspecting processes',
	pkill: 'Stopping a process',
	printf: 'Printing output',
	ps: 'Inspecting processes',
	pwd: 'Checking the directory',
	python: 'Running a script',
	python3: 'Running a script',
	pytest: 'Running tests',
	rg: 'Searching files',
	rm: 'Removing files',
	rmdir: 'Removing files',
	sed: 'Transforming text',
	sleep: 'Waiting',
	tail: 'Reading a file',
	touch: 'Creating a file',
	tree: 'Listing files',
	tsc: 'Type-checking',
	tsx: 'Running a script',
	vitest: 'Running tests',
	wc: 'Counting lines',
	whereis: 'Locating a binary',
	which: 'Locating a binary',
	wget: 'Fetching a URL',
};

/** What each well-known package script does, keyed by its name before any `:`. */
const SCRIPT_TITLES: Record<string, string> = {
	biome: 'Checking the code',
	build: 'Building the project',
	check: 'Checking the code',
	dev: 'Starting the dev server',
	format: 'Checking the code',
	lint: 'Checking the code',
	start: 'Starting the dev server',
	test: 'Running tests',
	tsc: 'Type-checking',
	typecheck: 'Type-checking',
	types: 'Type-checking',
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
			return title;
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
	return SCRIPT_TITLES[base] ?? `Running ${script}`;
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
		return `Running ${manager}`;
	}
	if (INSTALL_ARGUMENTS.has(argument)) {
		return 'Installing dependencies';
	}
	if (!RUN_ARGUMENTS.has(argument)) {
		return scriptTitle(argument);
	}
	const script = firstScriptArgument(args.slice(args.indexOf(argument) + 1));
	return script === null ? `Running ${manager}` : scriptTitle(script);
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
		return invoked.length > 0 ? titleForTokens(invoked) : `Running ${binary}`;
	}
	if (PACKAGE_MANAGERS.has(binary)) {
		return packageManagerTitle(binary, args);
	}
	return (
		subcommandTitle(binary, args) ??
		COMMAND_TITLES[binary] ??
		`Running ${binary}`
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
