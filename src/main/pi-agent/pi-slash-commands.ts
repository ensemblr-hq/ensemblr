import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { PiExecutableSnapshot } from '../pi-runtime/pi-executable.ts';
import { isExecutableReady } from '../pi-runtime/pi-executable.ts';

/** IPC-safe slash command metadata consumed by renderer autocomplete. */
export interface PiSlashCommandWire {
	autoSubmit: boolean;
	command: string;
	description: string;
	source: 'builtin' | 'extension' | 'prompt' | 'skill';
	sourceScope?: 'project' | 'temporary' | 'user';
}

/** Result of resolving live SDK commands or static fallback commands. */
export interface ResolvePiSlashCommandsResult {
	commands: readonly PiSlashCommandWire[];
	error: string | null;
	source: 'sdk' | 'static';
}

/** Minimal shape of Pi's built-in command metadata. */
interface SdkBuiltinSlashCommand {
	description?: string;
	name?: string;
}

/** Minimal shape returned by the SDK's `pi.getCommands()` implementation. */
interface SdkSlashCommandInfo {
	description?: string;
	name: string;
	source: 'extension' | 'prompt' | 'skill';
	sourceInfo?: {
		scope?: 'project' | 'temporary' | 'user';
	};
}

/** Static factory surface used from SDK classes without importing their types. */
interface SdkStaticFactory {
	create?: (...args: unknown[]) => unknown;
	inMemory?: (...args: unknown[]) => unknown;
}

/** Resource loader surface needed for command discovery. */
interface SdkResourceLoader {
	reload?: (...args: unknown[]) => Promise<unknown> | unknown;
}

/** SDK session surface plus private runtime access used for command metadata. */
interface SdkSession {
	_extensionRunner?: {
		runtime?: {
			getCommands?: () => readonly unknown[];
		};
	};
	bindExtensions?: (...args: unknown[]) => Promise<unknown> | unknown;
	dispose?: () => void;
}

/** Minimal createAgentSession result shape. */
interface SdkCreateAgentSessionResult {
	session?: unknown;
}

/** Public SDK module exports used through dynamic import. */
interface SdkModule {
	AuthStorage?: SdkStaticFactory;
	DefaultResourceLoader?: new (options: {
		agentDir: string;
		cwd: string;
		settingsManager: unknown;
	}) => SdkResourceLoader;
	ModelRegistry?: SdkStaticFactory;
	SessionManager?: SdkStaticFactory;
	SettingsManager?: SdkStaticFactory;
	createAgentSession?: (...args: unknown[]) => Promise<unknown> | unknown;
	getAgentDir?: () => unknown;
}

const AUTO_SUBMIT_NAMES = new Set([
	'changelog',
	'clone',
	'compact',
	'copy',
	'hotkeys',
	'new',
	'quit',
	'reload',
	'session',
	'share',
	'trust',
]);

/**
 * Resolves pi's prompt-invokable slash commands for a workspace. Uses the
 * public SDK to build an in-memory session, then asks the extension runtime for
 * the same command list pi exposes through `pi.getCommands()`: extension
 * commands, prompt templates, and `/skill:name` entries. Built-in TUI-only
 * commands are used only as a static fallback when the SDK cannot be loaded.
 * @param executable - Resolved Pi executable snapshot.
 * @param cwd - Workspace directory whose project-local resources should load.
 * @returns Slash commands plus provenance and fallback errors.
 */
export async function resolvePiSlashCommands(
	executable: PiExecutableSnapshot,
	cwd?: string,
): Promise<ResolvePiSlashCommandsResult> {
	if (!isExecutableReady(executable)) {
		return {
			commands: [],
			error: 'Pi executable is not ready.',
			source: 'static',
		};
	}

	const packageRoot = findSdkPackageRoot(executable.command);
	if (!packageRoot) {
		return {
			commands: [],
			error: "Couldn't locate pi SDK package root.",
			source: 'static',
		};
	}

	try {
		return {
			commands: await resolveLivePiSlashCommands(
				packageRoot,
				normalizeWorkspaceCwd(cwd),
			),
			error: null,
			source: 'sdk',
		};
	} catch (cause) {
		return {
			commands: await resolveStaticPiSlashCommands(packageRoot),
			error:
				cause instanceof Error
					? cause.message
					: 'Failed to resolve pi SDK slash commands.',
			source: 'static',
		};
	}
}

/**
 * Resolves live extension, prompt-template, and skill commands through the SDK.
 * @param packageRoot - Installed Pi package root.
 * @param workspaceCwd - Workspace directory for project resources.
 * @returns Prompt-invokable slash commands.
 */
async function resolveLivePiSlashCommands(
	packageRoot: string,
	workspaceCwd: string,
): Promise<PiSlashCommandWire[]> {
	const sdk = (await import(
		pathToFileURL(path.join(packageRoot, 'dist', 'index.js')).href
	)) as SdkModule;
	const createAgentSession = sdk.createAgentSession;
	if (!createAgentSession) {
		throw new Error('Pi SDK is missing createAgentSession().');
	}
	const settingsManager = createSettingsManager(sdk, workspaceCwd, packageRoot);
	const resourceLoader = createResourceLoader(
		sdk,
		workspaceCwd,
		settingsManager,
		packageRoot,
	);
	await resourceLoader.reload?.();
	const sessionManager = createSessionManager(sdk, workspaceCwd);
	const authStorage = sdk.AuthStorage?.create?.();
	const modelRegistry = sdk.ModelRegistry?.create?.(authStorage);
	const result = (await createAgentSession({
		agentDir: getAgentDir(sdk),
		cwd: workspaceCwd,
		modelRegistry,
		noTools: 'all',
		resourceLoader,
		sessionManager,
		settingsManager,
	})) as SdkCreateAgentSessionResult;
	const session = asSdkSession(result.session);
	try {
		await session.bindExtensions?.({ mode: 'print' });
		return readSessionCommands(session).map((command) => ({
			autoSubmit: false,
			command: command.name,
			description: command.description ?? '',
			source: command.source,
			sourceScope: command.sourceInfo?.scope,
		}));
	} finally {
		session.dispose?.();
	}
}

/**
 * Creates a SettingsManager so SDK discovery follows the user's pi settings.
 * @param sdk - Dynamically imported Pi SDK module.
 * @param workspaceCwd - Workspace directory for settings lookup.
 * @param packageRoot - Installed Pi package root for error messages.
 * @returns SDK settings manager instance.
 */
function createSettingsManager(
	sdk: SdkModule,
	workspaceCwd: string,
	packageRoot: string,
): unknown {
	const settingsManager = sdk.SettingsManager?.create?.(
		workspaceCwd,
		getAgentDir(sdk),
	);
	if (!settingsManager) {
		throw new Error(
			`Pi SDK at ${packageRoot} is missing SettingsManager.create().`,
		);
	}
	return settingsManager;
}

/**
 * Creates a resource loader for workspace-scoped skills, prompts, and extensions.
 * @param sdk - Dynamically imported Pi SDK module.
 * @param workspaceCwd - Workspace directory for project resources.
 * @param settingsManager - Settings manager shared with the loader.
 * @param packageRoot - Installed Pi package root for error messages.
 * @returns SDK resource loader instance.
 */
function createResourceLoader(
	sdk: SdkModule,
	workspaceCwd: string,
	settingsManager: unknown,
	packageRoot: string,
): SdkResourceLoader {
	const Loader = sdk.DefaultResourceLoader;
	if (!Loader) {
		throw new Error(
			`Pi SDK at ${packageRoot} is missing DefaultResourceLoader.`,
		);
	}
	return new Loader({
		agentDir: getAgentDir(sdk),
		cwd: workspaceCwd,
		settingsManager,
	});
}

/**
 * Creates an in-memory SessionManager to avoid mutating the user's sessions.
 * @param sdk - Dynamically imported Pi SDK module.
 * @param workspaceCwd - Workspace directory associated with the temporary session.
 * @returns SDK session manager instance.
 */
function createSessionManager(sdk: SdkModule, workspaceCwd: string): unknown {
	const sessionManager = sdk.SessionManager?.inMemory?.(workspaceCwd);
	if (!sessionManager) {
		throw new Error('Pi SDK is missing SessionManager.inMemory().');
	}
	return sessionManager;
}

/**
 * Returns pi's agent directory, falling back to the documented default path.
 * @param sdk - Dynamically imported Pi SDK module.
 * @returns Absolute agent directory path.
 */
function getAgentDir(sdk: SdkModule): string {
	const agentDir = sdk.getAgentDir?.();
	return typeof agentDir === 'string'
		? agentDir
		: path.join(homedir(), '.pi', 'agent');
}

/**
 * Casts the SDK session after verifying that it is object-like.
 * @param session - Session value returned by the SDK.
 * @returns Narrowed SDK session surface.
 */
function asSdkSession(session: unknown): SdkSession {
	if (!isRecord(session)) {
		throw new Error('Pi SDK did not return a session object.');
	}
	return session as SdkSession;
}

let warnedAboutMissingGetCommands = false;

/**
 * Reads the command list from the SDK session's bound extension runtime.
 *
 * `_extensionRunner` is a private SDK field; if a future Pi release renames
 * or removes it, the chain returns undefined and we would silently surface
 * an empty command list to the renderer. A single warn() per process makes
 * that breakage observable without spamming logs.
 *
 * @param session - Bound SDK session.
 * @returns Live slash command metadata.
 */
function readSessionCommands(session: SdkSession): SdkSlashCommandInfo[] {
	const getCommands = session._extensionRunner?.runtime?.getCommands;
	if (typeof getCommands !== 'function') {
		if (!warnedAboutMissingGetCommands) {
			warnedAboutMissingGetCommands = true;
			console.warn(
				'[pi-slash-commands] Pi SDK session is missing ' +
					'_extensionRunner.runtime.getCommands(); falling back to the static ' +
					'catalogue. The SDK private API may have changed.',
			);
		}
		return [];
	}
	const commands = getCommands.call(session._extensionRunner?.runtime) ?? [];
	return commands.filter(isSdkSlashCommandInfo);
}

/**
 * Narrows SDK command metadata to the fields the renderer needs.
 * @param value - Unknown SDK command value.
 * @returns True when the value is usable command metadata.
 */
function isSdkSlashCommandInfo(value: unknown): value is SdkSlashCommandInfo {
	if (!isRecord(value)) {
		return false;
	}
	const sourceInfo = value.sourceInfo;
	return (
		typeof value.name === 'string' &&
		(value.description === undefined ||
			typeof value.description === 'string') &&
		(value.source === 'extension' ||
			value.source === 'prompt' ||
			value.source === 'skill') &&
		(sourceInfo === undefined ||
			(isRecord(sourceInfo) &&
				(sourceInfo.scope === undefined ||
					sourceInfo.scope === 'project' ||
					sourceInfo.scope === 'temporary' ||
					sourceInfo.scope === 'user')))
	);
}

/**
 * Loads built-in slash commands only when live SDK command discovery fails.
 * @param packageRoot - Installed Pi package root.
 * @returns Static built-in slash commands.
 */
async function resolveStaticPiSlashCommands(
	packageRoot: string,
): Promise<PiSlashCommandWire[]> {
	const modulePath = path.join(
		packageRoot,
		'dist',
		'core',
		'slash-commands.js',
	);
	const mod = (await import(pathToFileURL(modulePath).href)) as {
		BUILTIN_SLASH_COMMANDS?: readonly SdkBuiltinSlashCommand[];
	};
	const builtins = mod.BUILTIN_SLASH_COMMANDS;
	if (!Array.isArray(builtins)) {
		return [];
	}
	return builtins
		.filter(
			(entry): entry is SdkBuiltinSlashCommand & { name: string } =>
				typeof entry.name === 'string' && entry.name.length > 0,
		)
		.map((entry) => ({
			autoSubmit: AUTO_SUBMIT_NAMES.has(entry.name),
			command: entry.name,
			description: entry.description ?? '',
			source: 'builtin' as const,
		}));
}

/**
 * Normalizes the workspace cwd used by Pi resource discovery.
 * @param cwd - Optional cwd from the renderer.
 * @returns Absolute workspace path.
 */
function normalizeWorkspaceCwd(cwd: string | undefined): string {
	const trimmed = cwd?.trim();
	return path.resolve(trimmed && trimmed.length > 0 ? trimmed : process.cwd());
}

/**
 * Locates the installed `@earendil-works/pi-coding-agent` package root.
 * @param command - Resolved Pi executable path.
 * @returns Package root path, or null when unavailable.
 */
function findSdkPackageRoot(command: string): string | null {
	const binPath = resolveExecutablePath(command);
	if (!binPath) {
		return null;
	}

	let current = path.dirname(binPath);
	for (let depth = 0; depth < 10; depth += 1) {
		if (isPiSdkPackageRoot(current)) {
			return current;
		}
		const parent = path.dirname(current);
		if (parent === current) {
			break;
		}
		current = parent;
	}
	return null;
}

/**
 * Resolves a configured executable path through symlinks when possible.
 * @param command - Resolved Pi executable path.
 * @returns Real executable path, or null when unavailable.
 */
function resolveExecutablePath(command: string): string | null {
	if (!command) {
		return null;
	}
	try {
		return existsSync(command) ? realpathSync(command) : null;
	} catch {
		return null;
	}
}

/**
 * Checks whether a directory is the Pi SDK package root.
 * @param directory - Candidate package directory.
 * @returns True when the directory is the Pi SDK package root.
 */
function isPiSdkPackageRoot(directory: string): boolean {
	const packageJsonPath = path.join(directory, 'package.json');
	const distIndexPath = path.join(directory, 'dist', 'index.js');
	if (!existsSync(packageJsonPath) || !existsSync(distIndexPath)) {
		return false;
	}
	try {
		const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
			name?: unknown;
		};
		return packageJson.name === '@earendil-works/pi-coding-agent';
	} catch {
		return false;
	}
}

/**
 * Returns true when a value is a non-null object record.
 * @param value - Unknown value to inspect.
 * @returns True when the value can be treated as a record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
