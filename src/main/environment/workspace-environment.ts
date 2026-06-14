import type { DatabaseSync } from 'node:sqlite';

import type { EnvironmentVariableDiagnostic } from '../../shared/ipc/contracts/environment';
import type { EnsembleConfigResolutionService } from '../config/config-resolution';
import { isRecord, isString } from '../repository/row-guards.ts';
import type { EnsembleRootDirectoryService } from '../root';
import {
	type EnsembleDatabaseService,
	requireDatabase,
} from '../storage/database.ts';
import {
	listActiveWorkspaceMetadataRows,
	selectWorkspaceEnvironmentJoinById,
	updateWorkspaceMetadataJson,
} from '../storage/repositories/workspace-repository.ts';
import type { EnvironmentVariablesService } from './environment-variables.ts';
import {
	isWorkspacePort,
	pickWorkspacePort,
	WORKSPACE_PORT_METADATA_KEY,
} from './workspace-ports.ts';

/** Native runtime variables injected into every workspace process. */
export const ENSEMBLE_RUNTIME_VARIABLE_KEYS = [
	'ENSEMBLE_WORKSPACE_NAME',
	'ENSEMBLE_WORKSPACE_PATH',
	'ENSEMBLE_ROOT_PATH',
	'ENSEMBLE_DEFAULT_BRANCH',
	'ENSEMBLE_PORT',
] as const;

/** Conductor-compatible mirrors of {@link ENSEMBLE_RUNTIME_VARIABLE_KEYS}. */
export const CONDUCTOR_COMPATIBILITY_VARIABLE_MAP: ReadonlyMap<string, string> =
	new Map([
		['ENSEMBLE_WORKSPACE_NAME', 'CONDUCTOR_WORKSPACE_NAME'],
		['ENSEMBLE_WORKSPACE_PATH', 'CONDUCTOR_WORKSPACE_PATH'],
		['ENSEMBLE_ROOT_PATH', 'CONDUCTOR_ROOT_PATH'],
		['ENSEMBLE_DEFAULT_BRANCH', 'CONDUCTOR_DEFAULT_BRANCH'],
		['ENSEMBLE_PORT', 'CONDUCTOR_PORT'],
	]);

export type WorkspaceEnvironmentErrorCode =
	| 'database-unavailable'
	| 'workspace-not-found';

/** Domain-specific error thrown by the workspace-environment service. */
export class WorkspaceEnvironmentError extends Error {
	readonly code: WorkspaceEnvironmentErrorCode;

	/**
	 * @param code - Machine-readable failure category.
	 * @param message - Human-readable failure description.
	 */
	constructor(code: WorkspaceEnvironmentErrorCode, message: string) {
		super(message);
		this.name = 'WorkspaceEnvironmentError';
		this.code = code;
	}
}

/** Options for {@link WorkspaceEnvironmentService.assemble}. */
export interface WorkspaceEnvironmentAssemblyOptions {
	includeSecrets?: boolean;
	workspaceId: string;
}

/** Assembled workspace environment for process execution. */
export interface WorkspaceEnvironmentAssembly {
	conductorCompatibility: boolean;
	cwd: string;
	diagnostics: EnvironmentVariableDiagnostic[];
	/**
	 * Overlay of configured + runtime variables. Callers merge this on top of
	 * the inherited process environment when spawning.
	 */
	env: Record<string, string>;
	port: number;
	redactValues: string[];
	workspaceId: string;
	workspaceName: string;
	workspacePath: string;
}

/** Public surface of the workspace-environment service. */
export interface WorkspaceEnvironmentService {
	/**
	 * Assembles the workspace process environment. Not a pure read: the first
	 * call per workspace allocates its stable port and persists it to the
	 * workspace metadata row when it changed.
	 */
	assemble: (
		options: WorkspaceEnvironmentAssemblyOptions,
	) => Promise<WorkspaceEnvironmentAssembly>;
}

/** Options for {@link createWorkspaceEnvironmentService}. */
export interface CreateWorkspaceEnvironmentServiceOptions {
	databaseService: EnsembleDatabaseService;
	environmentVariablesService: EnvironmentVariablesService;
	rootDirectoryService: EnsembleRootDirectoryService;
	settingsResolutionService: EnsembleConfigResolutionService;
}

/** Internal: row shape returned by the env-join selector. */
interface WorkspaceEnvironmentRow {
	archivedAt: string | null;
	baseBranch: string | null;
	branchName: string | null;
	id: string;
	metadataJson: string | null;
	name: string;
	path: string;
	repositoryDefaultBranch: string | null;
	repositoryId: string;
	repositoryName: string;
	repositoryPath: string;
	repositorySlug: string;
	slug: string;
}

/**
 * Builds the service that assembles the full per-workspace process environment:
 * configured variables across app/repository/workspace scopes, native
 * `ENSEMBLE_*` runtime variables, optional `CONDUCTOR_*` compatibility mirrors,
 * and the stable allocated workspace port.
 *
 * The returned overlay is reusable by terminal, script, Pi, and GitHub flows;
 * runtime variables always win over configured values because their catalog
 * entries are reserved.
 * @param options - Service dependencies.
 * @returns A fresh {@link WorkspaceEnvironmentService}.
 */
export function createWorkspaceEnvironmentService({
	databaseService,
	environmentVariablesService,
	rootDirectoryService,
	settingsResolutionService,
}: CreateWorkspaceEnvironmentServiceOptions): WorkspaceEnvironmentService {
	// Ports are stable once persisted; memoizing avoids re-scanning every
	// active workspace row (and re-writing metadata) on each spawn.
	const allocatedPorts = new Map<string, number>();

	async function assemble({
		includeSecrets = true,
		workspaceId,
	}: WorkspaceEnvironmentAssemblyOptions): Promise<WorkspaceEnvironmentAssembly> {
		const database = requireWorkspaceEnvironmentDatabase(
			databaseService.getConnection()?.database ?? null,
		);
		const workspace = readWorkspaceRow(database, workspaceId);

		const diagnostics: EnvironmentVariableDiagnostic[] = [];
		const env: Record<string, string> = {};
		const redactValues = new Set<string>();

		// Configured variables, least- to most-specific scope.
		const layers = [
			{ scope: 'app' as const, scopeId: undefined },
			{ scope: 'repository' as const, scopeId: workspace.repositoryId },
			{ scope: 'workspace' as const, scopeId: workspace.id },
		];

		for (const layer of layers) {
			const assembly = await environmentVariablesService.assembleEnvironment({
				includeSecrets,
				scope: layer.scope,
				scopeId: layer.scopeId,
			});
			diagnostics.push(...assembly.diagnostics);

			for (const [key, value] of Object.entries(assembly.env)) {
				env[key] = value;
			}

			for (const value of assembly.redactValues) {
				redactValues.add(value);
			}
		}

		const rootSnapshot =
			rootDirectoryService.getSnapshot() ?? rootDirectoryService.ensure();
		let port = allocatedPorts.get(workspace.id);

		if (port === undefined) {
			port = ensureWorkspacePort({ database, workspace });
			allocatedPorts.set(workspace.id, port);
		}
		const defaultBranch =
			workspace.baseBranch ?? workspace.repositoryDefaultBranch;

		env.ENSEMBLE_WORKSPACE_NAME = workspace.name;
		env.ENSEMBLE_WORKSPACE_PATH = workspace.path;
		env.ENSEMBLE_ROOT_PATH = rootSnapshot.path;
		env.ENSEMBLE_PORT = String(port);

		if (defaultBranch) {
			env.ENSEMBLE_DEFAULT_BRANCH = defaultBranch;
		} else {
			diagnostics.push({
				code: 'default-branch-unknown',
				key: 'ENSEMBLE_DEFAULT_BRANCH',
				message:
					'No base branch or repository default branch is recorded; ENSEMBLE_DEFAULT_BRANCH was not set.',
				severity: 'warning',
			});
		}

		const conductorCompatibility = resolveConductorCompatibility({
			repositoryId: workspace.repositoryId,
			repositoryPath: workspace.repositoryPath,
			settingsResolutionService,
		});

		if (conductorCompatibility) {
			for (const [
				ensembleKey,
				conductorKey,
			] of CONDUCTOR_COMPATIBILITY_VARIABLE_MAP) {
				const value = env[ensembleKey];

				if (value !== undefined) {
					env[conductorKey] = value;
				}
			}
		}

		return {
			conductorCompatibility,
			cwd: workspace.path,
			diagnostics,
			env,
			port,
			redactValues: Array.from(redactValues),
			workspaceId: workspace.id,
			workspaceName: workspace.name,
			workspacePath: workspace.path,
		};
	}

	return { assemble };
}

/**
 * Returns the workspace's stable port, allocating and persisting one when the
 * row has no valid persisted port or its port collides with an active sibling.
 * @param input - Open database plus the workspace row.
 * @returns The allocated port.
 */
function ensureWorkspacePort({
	database,
	workspace,
}: {
	database: DatabaseSync;
	workspace: WorkspaceEnvironmentRow;
}): number {
	const metadata = parseMetadataRecord(workspace.metadataJson);
	const persistedPort = metadata[WORKSPACE_PORT_METADATA_KEY];
	const usedPorts = collectActiveSiblingPorts({
		database,
		excludeWorkspaceId: workspace.id,
	});
	const port = pickWorkspacePort({
		preferredPort: isWorkspacePort(persistedPort) ? persistedPort : null,
		usedPorts,
		workspaceId: workspace.id,
	});

	if (persistedPort !== port) {
		updateWorkspaceMetadataJson({
			database,
			id: workspace.id,
			metadataJson: JSON.stringify({
				...metadata,
				[WORKSPACE_PORT_METADATA_KEY]: port,
			}),
		});
	}

	return port;
}

/**
 * Collects the ports persisted by every other active workspace.
 * @param input - Open database and the workspace id to exclude.
 * @returns Set of in-use ports.
 */
function collectActiveSiblingPorts({
	database,
	excludeWorkspaceId,
}: {
	database: DatabaseSync;
	excludeWorkspaceId: string;
}): Set<number> {
	const usedPorts = new Set<number>();

	for (const row of listActiveWorkspaceMetadataRows({ database })) {
		if (!isMetadataRow(row) || row.id === excludeWorkspaceId) {
			continue;
		}

		const port = parseMetadataRecord(row.metadataJson)[
			WORKSPACE_PORT_METADATA_KEY
		];

		if (isWorkspacePort(port)) {
			usedPorts.add(port);
		}
	}

	return usedPorts;
}

/**
 * Resolves the effective `conductorCompatibility` repository setting.
 * @param input - Repository identity plus the settings-resolution service.
 * @returns True when CONDUCTOR_* mirrors should be exposed.
 */
function resolveConductorCompatibility({
	repositoryId,
	repositoryPath,
	settingsResolutionService,
}: {
	repositoryId: string;
	repositoryPath: string;
	settingsResolutionService: EnsembleConfigResolutionService;
}): boolean {
	const snapshot = settingsResolutionService.resolve({
		repository: { repositoryId, repositoryPath },
	});
	const setting = snapshot.repository?.settings.find(
		(candidate) => candidate.key === 'conductorCompatibility',
	);

	return setting?.value === true;
}

/**
 * Loads and validates the workspace + repository join row.
 * @param database - Open SQLite handle.
 * @param workspaceId - Workspace identifier.
 * @returns The typed row.
 */
function readWorkspaceRow(
	database: DatabaseSync,
	workspaceId: string,
): WorkspaceEnvironmentRow {
	const normalizedId = workspaceId.trim();

	if (!normalizedId) {
		throw new WorkspaceEnvironmentError(
			'workspace-not-found',
			'A workspace id is required to assemble a workspace environment.',
		);
	}

	const row = selectWorkspaceEnvironmentJoinById({
		database,
		workspaceId: normalizedId,
	});

	if (!isWorkspaceEnvironmentRow(row)) {
		throw new WorkspaceEnvironmentError(
			'workspace-not-found',
			`No workspace is registered with id ${normalizedId}.`,
		);
	}

	return row;
}

/** Parses a metadata JSON blob, returning an empty record on failure. */
function parseMetadataRecord(
	metadataJson: string | null | undefined,
): Record<string, unknown> {
	if (!metadataJson) {
		return {};
	}

	try {
		const parsed = JSON.parse(metadataJson);

		if (
			typeof parsed === 'object' &&
			parsed !== null &&
			!Array.isArray(parsed)
		) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		// Treat malformed metadata as empty; the port allocator re-persists it.
	}

	return {};
}

/** Type guard for the env-join row shape. */
function isWorkspaceEnvironmentRow(
	row: unknown,
): row is WorkspaceEnvironmentRow {
	return (
		isRecord(row) &&
		isString(row.id) &&
		isString(row.name) &&
		isString(row.path) &&
		isString(row.repositoryId) &&
		isString(row.repositoryPath)
	);
}

/** Type guard for `id` + `metadataJson` rows. */
function isMetadataRow(
	row: unknown,
): row is { id: string; metadataJson: string | null } {
	return isRecord(row) && isString(row.id);
}

/**
 * Asserts a database handle is available, throwing a typed error otherwise.
 * @param database - Candidate database handle.
 * @returns The handle.
 */
function requireWorkspaceEnvironmentDatabase(
	database: DatabaseSync | null,
): DatabaseSync {
	return requireDatabase(
		database,
		() =>
			new WorkspaceEnvironmentError(
				'database-unavailable',
				'SQLite is unavailable; the workspace environment cannot be assembled.',
			),
	);
}
