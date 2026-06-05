import { randomUUID } from 'node:crypto';
import {
	accessSync,
	constants,
	existsSync,
	type Stats,
	statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import type {
	ResolvedSettingSnapshot,
	SettingsResolutionSnapshot,
	SettingsResolutionSource,
} from '../../shared/ipc';
import type {
	LocalCommandResult,
	LocalCommandService,
} from '../commands/local-command';
import type { EnsembleConfigResolutionService } from '../config/config-resolution';
import type { EnsembleDatabaseService } from '../storage/database';

export type PiExecutableStatus = 'error' | 'ok' | 'warning';
export type PiExecutableDiagnosticSeverity = 'error' | 'info' | 'warning';
export type PiExecutableSource =
	| SettingsResolutionSource
	| 'common-location'
	| 'path';
export type PiExecutableProbeKind = 'help' | 'version';
export type PiExecutableProbeStatus = 'failure' | 'success';

export interface PiExecutableDiagnostic {
	code: string;
	message: string;
	path?: string;
	severity: PiExecutableDiagnosticSeverity;
	source?: PiExecutableSource;
}

export interface PiExecutableProbeSnapshot {
	args: string[];
	detail: string;
	kind: PiExecutableProbeKind;
	status: PiExecutableProbeStatus;
}

export interface PiExecutableSnapshot {
	command: string;
	diagnostics: PiExecutableDiagnostic[];
	displayPath: string;
	path: string;
	probe: PiExecutableProbeSnapshot | null;
	setting: ResolvedSettingSnapshot | null;
	source: PiExecutableSource | null;
	status: PiExecutableStatus;
	updatedAt: string;
}

export interface PiExecutableSelectionResult {
	canceled: boolean;
	error?: string;
	selectedPath?: string;
}

export interface PiExecutableService {
	getSnapshot: () => Promise<PiExecutableSnapshot>;
	saveOverride: (executablePath: string) => PiExecutableSelectionResult;
}

export interface ResolvePiExecutableOptions {
	commonCandidatePaths?: readonly string[];
	homeDirectory?: string;
	localCommandService: LocalCommandService;
	now?: () => Date;
	probeTimeoutMs?: number;
	settingsSnapshot: SettingsResolutionSnapshot;
}

interface CreatePiExecutableServiceOptions {
	commonCandidatePaths?: readonly string[];
	databaseService: EnsembleDatabaseService;
	homeDirectory?: string;
	localCommandService: LocalCommandService;
	now?: () => Date;
	probeTimeoutMs?: number;
	settingsResolutionService: EnsembleConfigResolutionService;
}

interface Candidate {
	path: string;
	source: PiExecutableSource;
}

interface ValidatedCandidate extends Candidate {
	displayPath: string;
}

const PI_EXECUTABLE_SETTING_KEY = 'pi.executablePath';
const PI_EXECUTABLE_COMMAND = 'pi';
const DEFAULT_PROBE_TIMEOUT_MS = 3000;
const COMMON_PI_CANDIDATE_PATHS = [
	'~/.local/bin/pi',
	'~/bin/pi',
	'/opt/homebrew/bin/pi',
	'/usr/local/bin/pi',
	'/usr/bin/pi',
	'/bin/pi',
] as const;

export function createPiExecutableService({
	commonCandidatePaths,
	databaseService,
	homeDirectory,
	localCommandService,
	now,
	probeTimeoutMs,
	settingsResolutionService,
}: CreatePiExecutableServiceOptions): PiExecutableService {
	return {
		getSnapshot: () =>
			resolvePiExecutable({
				commonCandidatePaths,
				homeDirectory,
				localCommandService,
				now,
				probeTimeoutMs,
				settingsSnapshot: settingsResolutionService.resolve(),
			}),
		saveOverride: (executablePath) =>
			savePiExecutableOverride({
				database: databaseService.getConnection()?.database ?? null,
				executablePath,
			}),
	};
}

export async function resolvePiExecutable({
	commonCandidatePaths = COMMON_PI_CANDIDATE_PATHS,
	homeDirectory = homedir(),
	localCommandService,
	now = () => new Date(),
	probeTimeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
	settingsSnapshot,
}: ResolvePiExecutableOptions): Promise<PiExecutableSnapshot> {
	const diagnostics: PiExecutableDiagnostic[] = [];
	const setting = findPiExecutableSetting(settingsSnapshot);
	const updatedAt = now().toISOString();

	if (setting) {
		const candidate = await createExplicitCandidate({
			diagnostics,
			homeDirectory,
			localCommandService,
			setting,
		});

		return candidate
			? createSnapshotForCandidate({
					candidate,
					diagnostics,
					localCommandService,
					probeTimeoutMs,
					setting,
					updatedAt,
				})
			: createFailureSnapshot({ diagnostics, setting, updatedAt });
	}

	const environment = await localCommandService.getEnvironment();

	diagnostics.push(
		...environment.diagnostics.map((diagnostic) => ({
			code: diagnostic.code,
			message: diagnostic.message,
			severity: diagnostic.severity,
		})),
	);

	const pathCandidate = findExecutableInPath({
		command: PI_EXECUTABLE_COMMAND,
		diagnostics,
		executablePath: environment.path,
		source: 'path',
	});

	if (pathCandidate) {
		return createSnapshotForCandidate({
			candidate: pathCandidate,
			diagnostics,
			localCommandService,
			probeTimeoutMs,
			setting: null,
			updatedAt,
		});
	}

	for (const candidatePath of commonCandidatePaths) {
		const normalizedPath = normalizeConfiguredPath(
			candidatePath,
			homeDirectory,
		);
		const candidate = validateExecutableCandidate({
			diagnostics,
			path: normalizedPath,
			source: 'common-location',
		});

		if (candidate) {
			return createSnapshotForCandidate({
				candidate,
				diagnostics,
				localCommandService,
				probeTimeoutMs,
				setting: null,
				updatedAt,
			});
		}
	}

	diagnostics.push({
		code: 'pi-executable-not-found',
		message:
			'Pi was not found in the shell-derived PATH or common local binary locations.',
		severity: 'error',
	});

	return createFailureSnapshot({ diagnostics, setting: null, updatedAt });
}

export function savePiExecutableOverride({
	database,
	executablePath,
}: {
	database: DatabaseSync | null;
	executablePath: string;
}): PiExecutableSelectionResult {
	const selectedPath = executablePath.trim();

	if (!selectedPath) {
		return {
			canceled: false,
			error: 'No Pi executable path was selected.',
		};
	}

	if (!database) {
		return {
			canceled: false,
			error:
				'SQLite is unavailable; the Pi executable selection was not saved.',
		};
	}

	const timestamp = new Date().toISOString();

	try {
		database
			.prepare(
				`INSERT INTO settings (
					id,
					scope,
					scope_id,
					key,
					value_json,
					source,
					locked,
					updated_at
				)
				VALUES (?, 'app', '', ?, ?, 'sqlite', 0, ?)
				ON CONFLICT(scope, scope_id, key) DO UPDATE SET
					value_json = excluded.value_json,
					source = 'sqlite',
					locked = 0,
					updated_at = excluded.updated_at`,
			)
			.run(
				`setting-${randomUUID()}`,
				PI_EXECUTABLE_SETTING_KEY,
				JSON.stringify(path.resolve(selectedPath)),
				timestamp,
			);

		return {
			canceled: false,
			selectedPath: path.resolve(selectedPath),
		};
	} catch (error) {
		return {
			canceled: false,
			error:
				error instanceof Error
					? error.message
					: 'Failed to save Pi executable selection.',
		};
	}
}

function findPiExecutableSetting(
	settingsSnapshot: SettingsResolutionSnapshot,
): ResolvedSettingSnapshot | null {
	return (
		settingsSnapshot.app.settings.find(
			(setting) => setting.key === PI_EXECUTABLE_SETTING_KEY,
		) ?? null
	);
}

async function createExplicitCandidate({
	diagnostics,
	homeDirectory,
	localCommandService,
	setting,
}: {
	diagnostics: PiExecutableDiagnostic[];
	homeDirectory: string;
	localCommandService: LocalCommandService;
	setting: ResolvedSettingSnapshot;
}): Promise<ValidatedCandidate | null> {
	if (typeof setting.value !== 'string') {
		diagnostics.push({
			code: 'pi-executable-setting-invalid-type',
			message: 'The pi.executablePath setting must be a string.',
			severity: 'error',
			source: setting.source,
		});

		return null;
	}

	const rawPath = setting.value.trim();

	if (!rawPath) {
		diagnostics.push({
			code: 'pi-executable-setting-empty',
			message: 'The pi.executablePath setting cannot be empty.',
			severity: 'error',
			source: setting.source,
		});

		return null;
	}

	if (isBareCommand(rawPath)) {
		const environment = await localCommandService.getEnvironment();
		const pathCandidate = findExecutableInPath({
			command: rawPath,
			diagnostics,
			executablePath: environment.path,
			source: setting.source,
		});

		if (!pathCandidate) {
			diagnostics.push({
				code: 'pi-executable-bare-command-not-found',
				message: `Configured Pi executable "${rawPath}" was not found in the shell-derived PATH.`,
				path: rawPath,
				severity: 'error',
				source: setting.source,
			});
		}

		return pathCandidate;
	}

	if (
		rawPath !== '~' &&
		!rawPath.startsWith('~/') &&
		!path.isAbsolute(rawPath)
	) {
		diagnostics.push({
			code: 'pi-executable-relative-path',
			message:
				'The pi.executablePath setting must be absolute, start with ~/, or be a bare command name.',
			path: rawPath,
			severity: 'error',
			source: setting.source,
		});

		return null;
	}

	const normalizedPath = normalizeConfiguredPath(rawPath, homeDirectory);

	return validateExecutableCandidate({
		diagnostics,
		path: normalizedPath,
		source: setting.source,
	});
}

function normalizeConfiguredPath(
	rawPath: string,
	homeDirectory: string,
): string {
	if (rawPath === '~') {
		return path.resolve(homeDirectory);
	}

	if (rawPath.startsWith('~/')) {
		return path.resolve(homeDirectory, rawPath.slice(2));
	}

	return path.resolve(rawPath);
}

function isBareCommand(rawPath: string): boolean {
	return !rawPath.includes('/') && !rawPath.includes(path.sep);
}

function findExecutableInPath({
	command,
	diagnostics,
	executablePath,
	source,
}: {
	command: string;
	diagnostics: PiExecutableDiagnostic[];
	executablePath: string;
	source: PiExecutableSource;
}): ValidatedCandidate | null {
	for (const directory of executablePath.split(path.delimiter)) {
		if (!directory) {
			continue;
		}

		const candidatePath = path.join(directory, command);
		const candidate = validateExecutableCandidate({
			diagnostics,
			path: candidatePath,
			source,
			silentMissing: true,
		});

		if (candidate) {
			return candidate;
		}
	}

	return null;
}

function validateExecutableCandidate({
	diagnostics,
	path: candidatePath,
	silentMissing = false,
	source,
}: {
	diagnostics: PiExecutableDiagnostic[];
	path: string;
	silentMissing?: boolean;
	source: PiExecutableSource;
}): ValidatedCandidate | null {
	if (!existsSync(candidatePath)) {
		if (!silentMissing) {
			diagnostics.push({
				code: 'pi-executable-missing',
				message: 'Pi executable candidate does not exist.',
				path: candidatePath,
				severity: source === 'common-location' ? 'info' : 'error',
				source,
			});
		}

		return null;
	}

	const stats = getCandidateStats(candidatePath, diagnostics, source);

	if (!stats) {
		return null;
	}

	if (stats.isDirectory()) {
		diagnostics.push({
			code: 'pi-executable-is-directory',
			message: 'Pi executable candidate is a directory.',
			path: candidatePath,
			severity: 'error',
			source,
		});

		return null;
	}

	try {
		accessSync(candidatePath, constants.X_OK);
	} catch (error) {
		diagnostics.push({
			code: 'pi-executable-not-executable',
			message:
				error instanceof Error
					? error.message
					: 'Pi executable candidate is not executable.',
			path: candidatePath,
			severity: 'error',
			source,
		});

		return null;
	}

	return {
		displayPath: candidatePath,
		path: candidatePath,
		source,
	};
}

function getCandidateStats(
	candidatePath: string,
	diagnostics: PiExecutableDiagnostic[],
	source: PiExecutableSource,
): Stats | null {
	try {
		return statSync(candidatePath);
	} catch (error) {
		diagnostics.push({
			code: 'pi-executable-stat-failed',
			message:
				error instanceof Error
					? error.message
					: 'Failed to inspect Pi executable candidate.',
			path: candidatePath,
			severity: 'error',
			source,
		});

		return null;
	}
}

async function createSnapshotForCandidate({
	candidate,
	diagnostics,
	localCommandService,
	probeTimeoutMs,
	setting,
	updatedAt,
}: {
	candidate: ValidatedCandidate;
	diagnostics: PiExecutableDiagnostic[];
	localCommandService: LocalCommandService;
	probeTimeoutMs: number;
	setting: ResolvedSettingSnapshot | null;
	updatedAt: string;
}): Promise<PiExecutableSnapshot> {
	const probe = await probeExecutable({
		executablePath: candidate.path,
		localCommandService,
		probeTimeoutMs,
	});
	const status = probe.status === 'success' ? 'ok' : 'warning';

	if (probe.status === 'failure') {
		diagnostics.push({
			code: 'pi-executable-probe-unsupported',
			message:
				'Pi executable is runnable, but --version and --help did not complete successfully.',
			path: candidate.path,
			severity: 'warning',
			source: candidate.source,
		});
	}

	return {
		command: candidate.path,
		diagnostics,
		displayPath: candidate.displayPath,
		path: candidate.path,
		probe,
		setting,
		source: candidate.source,
		status,
		updatedAt,
	};
}

async function probeExecutable({
	executablePath,
	localCommandService,
	probeTimeoutMs,
}: {
	executablePath: string;
	localCommandService: LocalCommandService;
	probeTimeoutMs: number;
}): Promise<PiExecutableProbeSnapshot> {
	const versionResult = await localCommandService.run({
		args: ['--version'],
		command: executablePath,
		maxOutputBytes: 4096,
		timeoutMs: probeTimeoutMs,
	});

	if (versionResult.status === 'success') {
		return createProbeSnapshot('version', versionResult);
	}

	const helpResult = await localCommandService.run({
		args: ['--help'],
		command: executablePath,
		maxOutputBytes: 4096,
		timeoutMs: probeTimeoutMs,
	});

	return createProbeSnapshot('help', helpResult);
}

function createProbeSnapshot(
	kind: PiExecutableProbeKind,
	result: LocalCommandResult,
): PiExecutableProbeSnapshot {
	const outputLine =
		getFirstOutputLine(result.stdout) ??
		getFirstOutputLine(result.stderr) ??
		result.failure?.message ??
		(result.status === 'success'
			? 'Pi executable probe completed.'
			: 'Pi executable probe failed.');

	return {
		args: result.args,
		detail: outputLine,
		kind,
		status: result.status === 'success' ? 'success' : 'failure',
	};
}

function createFailureSnapshot({
	diagnostics,
	setting,
	updatedAt,
}: {
	diagnostics: PiExecutableDiagnostic[];
	setting: ResolvedSettingSnapshot | null;
	updatedAt: string;
}): PiExecutableSnapshot {
	return {
		command: '',
		diagnostics,
		displayPath: '',
		path: '',
		probe: null,
		setting,
		source: setting?.source ?? null,
		status: 'error',
		updatedAt,
	};
}

function getFirstOutputLine(output: string): string | null {
	const line = output
		.split(/\r?\n/)
		.map((part) => part.trim())
		.find(Boolean);

	return line ?? null;
}
