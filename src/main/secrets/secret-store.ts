import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export type SecretScope = 'app' | 'repository' | 'workspace';
export type SecretBackend = 'macos-keychain' | 'mock';

export type SecretStoreErrorCode =
	| 'already-exists'
	| 'invalid-input'
	| 'keychain-error'
	| 'metadata-error'
	| 'not-found'
	| 'unsupported-platform';

/** Identifies a secret entry by `(scope, scopeId, key)`. */
export interface SecretLookup {
	key: string;
	scope: SecretScope;
	scopeId?: string;
}

/** Secret write payload: identity plus value and optional metadata. */
export interface SecretWriteInput extends SecretLookup {
	displayName?: string;
	metadata?: Record<string, unknown>;
	value: string;
}

/** Persistable, non-sensitive view of a secret entry. */
export interface SecretMetadata {
	account: string;
	backend: SecretBackend;
	characterCount: number;
	createdAt: string;
	displayName: string;
	id: string;
	key: string;
	maskedDisplay: string;
	metadata: Record<string, unknown>;
	scope: SecretScope;
	scopeId: string;
	service: string;
	updatedAt: string;
}

/** Optional filter for {@link SecretStore.listMetadata}. */
export interface SecretMetadataFilter {
	scope?: SecretScope;
	scopeId?: string;
}

/** Public interface of every secret-store backend. */
export interface SecretStore {
	create: (input: SecretWriteInput) => Promise<SecretMetadata>;
	delete: (lookup: SecretLookup) => Promise<void>;
	listMetadata: (filter?: SecretMetadataFilter) => Promise<SecretMetadata[]>;
	maskSecret: (value: string) => string;
	read: (lookup: SecretLookup) => Promise<string | null>;
	update: (input: SecretWriteInput) => Promise<SecretMetadata>;
}

/** Options for {@link createMacosKeychainSecretStore}. */
export interface MacosKeychainSecretStoreOptions {
	commandPath?: string;
	database: DatabaseSync;
	idFactory?: () => string;
	now?: () => Date;
	serviceName?: string;
}

/** Options for {@link createMockSecretStore}. */
export interface MockSecretStoreOptions {
	idFactory?: () => string;
	now?: () => Date;
	serviceName?: string;
}

/** Internal: normalised secret lookup with non-optional `scopeId`. */
interface NormalizedLookup {
	key: string;
	scope: SecretScope;
	scopeId: string;
}

/** Internal: normalised write input with defaults applied. */
interface NormalizedWriteInput extends NormalizedLookup {
	displayName: string;
	metadata: Record<string, unknown>;
	value: string;
}

/** Internal: Keychain identity `(service, account)` pair. */
interface KeychainReference {
	account: string;
	service: string;
}

/** Internal: raw row shape stored in the `secret_metadata` table. */
interface SecretMetadataRow {
	account: string;
	backend: SecretBackend;
	character_count: number;
	created_at: string;
	display_name: string;
	id: string;
	masked_display: string;
	metadata_json: string;
	name: string;
	scope: SecretScope;
	scope_id: string;
	service: string;
	updated_at: string;
}

/** Internal: captured output of `/usr/bin/security` command. */
interface SecurityCommandResult {
	stderr: string;
	stdout: string;
}

const DEFAULT_KEYCHAIN_SERVICE_NAME = 'com.ensemble.app.secret-store';
const SECURITY_COMMAND_PATH = '/usr/bin/security';
const MASK_VISIBLE_SUFFIX_LENGTH = 4;
const MASK_PREFIX = '****';
const SECRET_SCOPES: readonly SecretScope[] = [
	'app',
	'repository',
	'workspace',
];

/** Typed error thrown by every secret-store operation. */
export class SecretStoreError extends Error {
	readonly code: SecretStoreErrorCode;
	readonly command?: string;
	readonly exitCode?: number;
	readonly stderr?: string;

	/**
	 * @param code - Machine-readable failure category.
	 * @param message - Human-readable description.
	 * @param options - Optional command, exit code, stderr and cause for diagnostics.
	 */
	constructor(
		code: SecretStoreErrorCode,
		message: string,
		options: {
			cause?: unknown;
			command?: string;
			exitCode?: number;
			stderr?: string;
		} = {},
	) {
		super(message, { cause: options.cause });
		this.name = 'SecretStoreError';
		this.code = code;
		this.command = options.command;
		this.exitCode = options.exitCode;
		this.stderr = options.stderr;
	}
}

/**
 * Renders a masked preview of a secret value, exposing only the last few characters.
 * @param value - Secret value.
 * @returns Masked display string.
 */
export function maskSecret(value: string): string {
	if (value.length === 0) {
		return MASK_PREFIX;
	}

	if (value.length <= MASK_VISIBLE_SUFFIX_LENGTH) {
		return MASK_PREFIX;
	}

	return `${MASK_PREFIX}${value.slice(-MASK_VISIBLE_SUFFIX_LENGTH)}`;
}

/**
 * Builds a macOS Keychain-backed secret store, persisting non-sensitive metadata
 * in SQLite while holding the encrypted values inside the user's Keychain.
 * @param options - Service dependencies and tuning.
 * @returns A {@link SecretStore} implementation. Throws on non-darwin platforms.
 */
export function createMacosKeychainSecretStore({
	commandPath = SECURITY_COMMAND_PATH,
	database,
	idFactory = randomUUID,
	now = () => new Date(),
	serviceName = DEFAULT_KEYCHAIN_SERVICE_NAME,
}: MacosKeychainSecretStoreOptions): SecretStore {
	if (process.platform !== 'darwin') {
		throw new SecretStoreError(
			'unsupported-platform',
			'The macOS Keychain secret store is only available on darwin.',
		);
	}

	const metadataStore = createSqliteSecretMetadataStore(database);

	/**
	 * Adds or replaces a Keychain item via `/usr/bin/security add-generic-password`.
	 * @param reference - Keychain identity pair.
	 * @param input - Normalised write input.
	 */
	async function writeKeychainItem(
		reference: KeychainReference,
		input: NormalizedWriteInput,
	): Promise<void> {
		const encodedValue = Buffer.from(input.value, 'utf8').toString('hex');

		await runSecurityCommand(commandPath, [
			'add-generic-password',
			'-a',
			reference.account,
			'-s',
			reference.service,
			'-l',
			input.displayName,
			'-j',
			`Ensemble ${input.scope} secret metadata entry`,
			'-U',
			'-X',
			encodedValue,
		]);
	}

	/**
	 * Removes a Keychain item, optionally suppressing the "not found" error.
	 * @param reference - Keychain identity pair.
	 * @param ignoreMissing - When true, suppresses the not-found error.
	 */
	async function deleteKeychainItem(
		reference: KeychainReference,
		ignoreMissing: boolean,
	): Promise<void> {
		try {
			await runSecurityCommand(commandPath, [
				'delete-generic-password',
				'-a',
				reference.account,
				'-s',
				reference.service,
			]);
		} catch (error) {
			if (ignoreMissing && isNotFoundError(error)) {
				return;
			}

			throw error;
		}
	}

	return {
		async create(input) {
			const normalized = normalizeWriteInput(input);
			const existing = metadataStore.get(normalized);

			if (existing) {
				throw new SecretStoreError(
					'already-exists',
					`A secret metadata entry already exists for ${formatLookup(normalized)}.`,
				);
			}

			const reference = createKeychainReference(serviceName, normalized);
			await writeKeychainItem(reference, normalized);

			try {
				return metadataStore.insert({
					...normalized,
					...reference,
					backend: 'macos-keychain',
					id: idFactory(),
					maskedDisplay: maskSecret(normalized.value),
					now: now().toISOString(),
				});
			} catch (error) {
				await deleteKeychainItem(reference, true);
				throw toMetadataError(error);
			}
		},
		async delete(lookup) {
			const normalized = normalizeLookup(lookup);
			const existing = metadataStore.get(normalized);

			if (!existing) {
				return;
			}

			await deleteKeychainItem(existing, true);
			metadataStore.delete(normalized);
		},
		async listMetadata(filter) {
			return metadataStore.list(normalizeFilter(filter));
		},
		maskSecret,
		async read(lookup) {
			const normalized = normalizeLookup(lookup);
			const existing = metadataStore.get(normalized);

			if (!existing) {
				return null;
			}

			const result = await runSecurityCommand(commandPath, [
				'find-generic-password',
				'-a',
				existing.account,
				'-s',
				existing.service,
				'-w',
			]);

			return result.stdout.endsWith('\n')
				? result.stdout.slice(0, -1)
				: result.stdout;
		},
		async update(input) {
			const normalized = normalizeWriteInput(input);
			const existing = metadataStore.get(normalized);

			if (!existing) {
				throw new SecretStoreError(
					'not-found',
					`No secret metadata entry exists for ${formatLookup(normalized)}.`,
				);
			}

			await writeKeychainItem(existing, normalized);

			try {
				return metadataStore.update({
					...normalized,
					...existing,
					backend: 'macos-keychain',
					maskedDisplay: maskSecret(normalized.value),
					now: now().toISOString(),
				});
			} catch (error) {
				throw toMetadataError(error);
			}
		},
	};
}

/**
 * Builds an in-memory secret store for tests and platforms without a Keychain.
 * @param options - Optional clock, id factory, and service-name overrides.
 * @returns A {@link SecretStore} backed by a private `Map`.
 */
export function createMockSecretStore({
	idFactory = randomUUID,
	now = () => new Date(),
	serviceName = 'mock.ensemble.secret-store',
}: MockSecretStoreOptions = {}): SecretStore {
	const records = new Map<
		string,
		{ metadata: SecretMetadata; value: string }
	>();

	/** Retrieves the in-memory record for a normalised lookup. */
	function getRecord(lookup: NormalizedLookup) {
		return records.get(createIdentityKey(lookup));
	}

	/**
	 * Constructs a metadata object for an in-memory secret.
	 * @param input - Normalised write input.
	 * @param reference - Keychain identity pair (synthetic for the mock).
	 * @param timestamp - ISO timestamp.
	 * @param id - Explicit identifier (default generated by `idFactory`).
	 * @returns A {@link SecretMetadata} value.
	 */
	function createMetadata(
		input: NormalizedWriteInput,
		reference: KeychainReference,
		timestamp: string,
		id = idFactory(),
	): SecretMetadata {
		return {
			...reference,
			backend: 'mock',
			characterCount: input.value.length,
			createdAt: timestamp,
			displayName: input.displayName,
			id,
			key: input.key,
			maskedDisplay: maskSecret(input.value),
			metadata: input.metadata,
			scope: input.scope,
			scopeId: input.scopeId,
			updatedAt: timestamp,
		};
	}

	return {
		async create(input) {
			const normalized = normalizeWriteInput(input);
			const identityKey = createIdentityKey(normalized);

			if (records.has(identityKey)) {
				throw new SecretStoreError(
					'already-exists',
					`A secret metadata entry already exists for ${formatLookup(normalized)}.`,
				);
			}

			const timestamp = now().toISOString();
			const reference = createKeychainReference(serviceName, normalized);
			const metadata = createMetadata(normalized, reference, timestamp);
			records.set(identityKey, { metadata, value: normalized.value });

			return metadata;
		},
		async delete(lookup) {
			records.delete(createIdentityKey(normalizeLookup(lookup)));
		},
		async listMetadata(filter) {
			const normalizedFilter = normalizeFilter(filter);
			const metadata = Array.from(
				records.values(),
				(record) => record.metadata,
			);

			return filterMetadata(metadata, normalizedFilter);
		},
		maskSecret,
		async read(lookup) {
			return getRecord(normalizeLookup(lookup))?.value ?? null;
		},
		async update(input) {
			const normalized = normalizeWriteInput(input);
			const identityKey = createIdentityKey(normalized);
			const existing = records.get(identityKey);

			if (!existing) {
				throw new SecretStoreError(
					'not-found',
					`No secret metadata entry exists for ${formatLookup(normalized)}.`,
				);
			}

			const timestamp = now().toISOString();
			const metadata = createMetadata(
				normalized,
				existing.metadata,
				timestamp,
				existing.metadata.id,
			);

			records.set(identityKey, {
				metadata: {
					...metadata,
					createdAt: existing.metadata.createdAt,
				},
				value: normalized.value,
			});

			return records.get(identityKey)?.metadata ?? metadata;
		},
	};
}

/**
 * Builds the SQLite-backed metadata store used by the Keychain backend.
 * @param database - Open SQLite connection.
 * @returns Object exposing `get/insert/update/delete/list` over `secret_metadata`.
 */
function createSqliteSecretMetadataStore(database: DatabaseSync) {
	return {
		/** Deletes the metadata row matching the lookup. */
		delete(lookup: NormalizedLookup): void {
			database
				.prepare(
					`DELETE FROM secret_metadata
					 WHERE scope = ? AND scope_id = ? AND name = ?`,
				)
				.run(lookup.scope, lookup.scopeId, lookup.key);
		},
		/** Loads the metadata row matching the lookup, or `null`. */
		get(lookup: NormalizedLookup): SecretMetadata | null {
			const row = database
				.prepare(
					`SELECT *
					 FROM secret_metadata
					 WHERE scope = ? AND scope_id = ? AND name = ?`,
				)
				.get(lookup.scope, lookup.scopeId, lookup.key);

			return row ? parseMetadataRow(row) : null;
		},
		/** Inserts a new metadata row, returning the persisted shape. */
		insert(
			input: NormalizedWriteInput &
				KeychainReference & {
					backend: 'macos-keychain';
					id: string;
					maskedDisplay: string;
					now: string;
				},
		): SecretMetadata {
			database
				.prepare(
					`INSERT INTO secret_metadata (
						id,
						scope,
						scope_id,
						name,
						backend,
						service,
						account,
						display_name,
						masked_display,
						character_count,
						metadata_json,
						created_at,
						updated_at
					)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(
					input.id,
					input.scope,
					input.scopeId,
					input.key,
					input.backend,
					input.service,
					input.account,
					input.displayName,
					input.maskedDisplay,
					input.value.length,
					JSON.stringify(input.metadata),
					input.now,
					input.now,
				);

			const inserted = this.get(input);

			if (!inserted) {
				throw new SecretStoreError(
					'metadata-error',
					`Failed to create secret metadata for ${formatLookup(input)}.`,
				);
			}

			return inserted;
		},
		/** Lists every matching metadata row, ordered by `(scope, scope_id, name)`. */
		list(filter: SecretMetadataFilter = {}): SecretMetadata[] {
			if (filter.scope && filter.scopeId !== undefined) {
				const rows = database
					.prepare(
						`SELECT *
						 FROM secret_metadata
						 WHERE scope = ? AND scope_id = ?
						 ORDER BY scope, scope_id, name`,
					)
					.all(filter.scope, filter.scopeId);

				return rows.map(parseMetadataRow);
			}

			if (filter.scope) {
				const rows = database
					.prepare(
						`SELECT *
						 FROM secret_metadata
						 WHERE scope = ?
						 ORDER BY scope, scope_id, name`,
					)
					.all(filter.scope);

				return rows.map(parseMetadataRow);
			}

			const rows = database
				.prepare(
					`SELECT *
					 FROM secret_metadata
					 ORDER BY scope, scope_id, name`,
				)
				.all();

			return rows.map(parseMetadataRow);
		},
		/** Updates an existing metadata row, returning the persisted shape. */
		update(
			input: NormalizedWriteInput &
				KeychainReference & {
					backend: 'macos-keychain';
					id: string;
					maskedDisplay: string;
					now: string;
				},
		): SecretMetadata {
			database
				.prepare(
					`UPDATE secret_metadata
					 SET
						backend = ?,
						service = ?,
						account = ?,
						display_name = ?,
						masked_display = ?,
						character_count = ?,
						metadata_json = ?,
						updated_at = ?
					 WHERE scope = ? AND scope_id = ? AND name = ?`,
				)
				.run(
					input.backend,
					input.service,
					input.account,
					input.displayName,
					input.maskedDisplay,
					input.value.length,
					JSON.stringify(input.metadata),
					input.now,
					input.scope,
					input.scopeId,
					input.key,
				);

			const updated = this.get(input);

			if (!updated) {
				throw new SecretStoreError(
					'metadata-error',
					`Failed to update secret metadata for ${formatLookup(input)}.`,
				);
			}

			return updated;
		},
	};
}

/**
 * Validates a write input, throwing on missing or wrong-typed fields.
 * @param input - Caller-supplied secret write payload.
 * @returns A normalised write input with defaults applied.
 */
function normalizeWriteInput(input: SecretWriteInput): NormalizedWriteInput {
	const lookup = normalizeLookup(input);

	if (typeof input.value !== 'string') {
		throw new SecretStoreError(
			'invalid-input',
			'Secret value must be a string.',
		);
	}

	return {
		...lookup,
		displayName: normalizeDisplayName(input.displayName, lookup.key),
		metadata: normalizeMetadata(input.metadata),
		value: input.value,
	};
}

/**
 * Validates a lookup, requiring a non-empty `scopeId` for non-app scopes.
 * @param input - Caller-supplied secret lookup.
 * @returns A normalised lookup.
 */
function normalizeLookup(input: SecretLookup): NormalizedLookup {
	if (!SECRET_SCOPES.includes(input.scope)) {
		throw new SecretStoreError(
			'invalid-input',
			`Unsupported secret scope: ${String(input.scope)}.`,
		);
	}

	const key = input.key.trim();

	if (!key) {
		throw new SecretStoreError(
			'invalid-input',
			'Secret key must not be empty.',
		);
	}

	const scopeId = input.scope === 'app' ? '' : (input.scopeId ?? '').trim();

	if (input.scope !== 'app' && !scopeId) {
		throw new SecretStoreError(
			'invalid-input',
			`Secret scopeId is required for ${input.scope} secrets.`,
		);
	}

	return {
		key,
		scope: input.scope,
		scopeId,
	};
}

/**
 * Validates an optional filter, defaulting an `app`-scope filter to `scopeId: ''`.
 * @param filter - Caller-supplied filter.
 * @returns The normalised filter.
 */
function normalizeFilter(filter?: SecretMetadataFilter): SecretMetadataFilter {
	if (!filter?.scope) {
		return {};
	}

	if (!SECRET_SCOPES.includes(filter.scope)) {
		throw new SecretStoreError(
			'invalid-input',
			`Unsupported secret scope: ${String(filter.scope)}.`,
		);
	}

	if (filter.scope === 'app') {
		return { scope: filter.scope, scopeId: '' };
	}

	if (filter.scopeId === undefined) {
		return { scope: filter.scope };
	}

	return {
		scope: filter.scope,
		scopeId: filter.scopeId.trim(),
	};
}

/**
 * Trims a display name and falls back to the secret key when empty.
 * @param displayName - Caller value.
 * @param fallback - Fallback display name (usually the key).
 * @returns The chosen display name.
 */
function normalizeDisplayName(
	displayName: string | undefined,
	fallback: string,
): string {
	const normalized = displayName?.trim();
	return normalized || fallback;
}

/**
 * Returns a shallow copy of caller metadata, defaulting to `{}` when omitted.
 * @param metadata - Caller metadata.
 * @returns A safe-to-mutate metadata object.
 */
function normalizeMetadata(
	metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
	return metadata ? { ...metadata } : {};
}

/**
 * Composes the `(service, account)` pair used in the Keychain.
 * @param serviceName - Service identifier.
 * @param lookup - Normalised secret lookup.
 * @returns The Keychain reference.
 */
function createKeychainReference(
	serviceName: string,
	lookup: NormalizedLookup,
): KeychainReference {
	return {
		account: `v1:${lookup.scope}:${encodeURIComponent(lookup.scopeId)}:${encodeURIComponent(lookup.key)}`,
		service: serviceName,
	};
}

/**
 * Builds the in-memory composite key used by the mock store's `Map`.
 * @param lookup - Normalised lookup.
 * @returns A NUL-separated composite key.
 */
function createIdentityKey(lookup: NormalizedLookup): string {
	return `${lookup.scope}\u0000${lookup.scopeId}\u0000${lookup.key}`;
}

/**
 * Applies a filter and stable sort to an in-memory metadata list.
 * @param metadata - Metadata list.
 * @param filter - Filter to apply.
 * @returns A new sorted/filtered array.
 */
function filterMetadata(
	metadata: SecretMetadata[],
	filter: SecretMetadataFilter = {},
): SecretMetadata[] {
	return metadata
		.filter((entry) => {
			if (filter.scope && entry.scope !== filter.scope) {
				return false;
			}

			if (filter.scopeId !== undefined && entry.scopeId !== filter.scopeId) {
				return false;
			}

			return true;
		})
		.sort((left, right) =>
			`${left.scope}:${left.scopeId}:${left.key}`.localeCompare(
				`${right.scope}:${right.scopeId}:${right.key}`,
			),
		);
}

/**
 * Maps a raw SQLite row to the {@link SecretMetadata} shape, validating the row.
 * @param row - Raw row value.
 * @returns The structured metadata.
 */
function parseMetadataRow(row: unknown): SecretMetadata {
	if (!isSecretMetadataRow(row)) {
		throw new SecretStoreError(
			'metadata-error',
			'Secret metadata row had an unexpected shape.',
		);
	}

	return {
		account: row.account,
		backend: row.backend,
		characterCount: row.character_count,
		createdAt: row.created_at,
		displayName: row.display_name,
		id: row.id,
		key: row.name,
		maskedDisplay: row.masked_display,
		metadata: parseMetadataJson(row.metadata_json),
		scope: row.scope,
		scopeId: row.scope_id,
		service: row.service,
		updatedAt: row.updated_at,
	};
}

/**
 * Type guard for the `secret_metadata` table row shape.
 * @param row - Candidate row value.
 * @returns True when every expected column is present and well-typed.
 */
function isSecretMetadataRow(row: unknown): row is SecretMetadataRow {
	if (typeof row !== 'object' || row === null) {
		return false;
	}

	const candidate = row as Partial<SecretMetadataRow>;

	return (
		typeof candidate.account === 'string' &&
		(candidate.backend === 'macos-keychain' || candidate.backend === 'mock') &&
		typeof candidate.character_count === 'number' &&
		typeof candidate.created_at === 'string' &&
		typeof candidate.display_name === 'string' &&
		typeof candidate.id === 'string' &&
		typeof candidate.masked_display === 'string' &&
		typeof candidate.metadata_json === 'string' &&
		typeof candidate.name === 'string' &&
		SECRET_SCOPES.includes(candidate.scope as SecretScope) &&
		typeof candidate.scope_id === 'string' &&
		typeof candidate.service === 'string' &&
		typeof candidate.updated_at === 'string'
	);
}

/**
 * Parses the `metadata_json` column, requiring it to be a JSON object.
 * @param value - Raw `metadata_json` string.
 * @returns The parsed record.
 */
function parseMetadataJson(value: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(value);

		if (
			typeof parsed === 'object' &&
			parsed !== null &&
			!Array.isArray(parsed)
		) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		throw new SecretStoreError(
			'metadata-error',
			'Secret metadata JSON could not be parsed.',
		);
	}

	throw new SecretStoreError(
		'metadata-error',
		'Secret metadata JSON must be an object.',
	);
}

/**
 * Spawns `/usr/bin/security` with the given args and resolves with its output,
 * mapping non-zero exits to {@link SecretStoreError}s.
 * @param commandPath - Path to the `security` binary.
 * @param args - Command-line arguments.
 * @param stdin - Optional stdin payload.
 * @returns Captured stdout/stderr on success.
 */
function runSecurityCommand(
	commandPath: string,
	args: string[],
	stdin?: string,
): Promise<SecurityCommandResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(commandPath, args, {
			stdio: ['pipe', 'pipe', 'pipe'],
		});
		const stderrChunks: string[] = [];
		const stdoutChunks: string[] = [];

		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk: string) => stdoutChunks.push(chunk));
		child.stderr.on('data', (chunk: string) => stderrChunks.push(chunk));
		child.on('error', (error) => {
			reject(
				new SecretStoreError(
					'keychain-error',
					'Failed to start the macOS security command.',
					{ cause: error, command: args[0] },
				),
			);
		});
		child.on('close', (exitCode) => {
			const stderr = stderrChunks.join('');
			const stdout = stdoutChunks.join('');

			if (exitCode === 0) {
				resolve({ stderr, stdout });
				return;
			}

			reject(createSecurityCommandError(args[0], exitCode, stderr));
		});

		child.stdin.end(stdin ?? '');
	});
}

/**
 * Maps a non-zero `security` exit into a typed {@link SecretStoreError}, with
 * special handling for the "item not found" pattern.
 * @param command - Subcommand name.
 * @param exitCode - Observed exit code.
 * @param stderr - Captured stderr.
 * @returns The structured error.
 */
function createSecurityCommandError(
	command: string,
	exitCode: number | null,
	stderr: string,
): SecretStoreError {
	const code = /could not be found|The specified item could not be found/i.test(
		stderr,
	)
		? 'not-found'
		: 'keychain-error';
	const message =
		code === 'not-found'
			? 'The requested Keychain item was not found.'
			: `The macOS security command failed while running ${command}.`;

	return new SecretStoreError(code, message, {
		command,
		exitCode: exitCode ?? undefined,
		stderr: sanitizeStderr(stderr),
	});
}

/**
 * Tests whether an error is a {@link SecretStoreError} with `not-found` code.
 * @param error - Thrown value.
 * @returns True for not-found errors.
 */
function isNotFoundError(error: unknown): boolean {
	return error instanceof SecretStoreError && error.code === 'not-found';
}

/**
 * Wraps an unknown error as a `metadata-error` unless it is already a typed
 * {@link SecretStoreError}.
 * @param error - Thrown value.
 * @returns A typed error.
 */
function toMetadataError(error: unknown): SecretStoreError {
	if (error instanceof SecretStoreError) {
		return error;
	}

	return new SecretStoreError(
		'metadata-error',
		'Failed to persist secret metadata.',
		{ cause: error },
	);
}

/**
 * Trims and length-caps stderr for inclusion in error diagnostics.
 * @param stderr - Raw stderr.
 * @returns A bounded, trimmed copy.
 */
function sanitizeStderr(stderr: string): string {
	return stderr.trim().slice(0, 1000);
}

/**
 * Renders a lookup as a user-facing identifier (e.g. `repository:r1:key`).
 * @param lookup - Normalised lookup.
 * @returns The formatted string.
 */
function formatLookup(lookup: NormalizedLookup): string {
	return `${lookup.scope}:${lookup.scopeId || '<app>'}:${lookup.key}`;
}
