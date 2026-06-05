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

export interface SecretLookup {
	key: string;
	scope: SecretScope;
	scopeId?: string;
}

export interface SecretWriteInput extends SecretLookup {
	displayName?: string;
	metadata?: Record<string, unknown>;
	value: string;
}

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

export interface SecretMetadataFilter {
	scope?: SecretScope;
	scopeId?: string;
}

export interface SecretStore {
	create: (input: SecretWriteInput) => Promise<SecretMetadata>;
	delete: (lookup: SecretLookup) => Promise<void>;
	listMetadata: (filter?: SecretMetadataFilter) => Promise<SecretMetadata[]>;
	maskSecret: (value: string) => string;
	read: (lookup: SecretLookup) => Promise<string | null>;
	update: (input: SecretWriteInput) => Promise<SecretMetadata>;
}

export interface MacosKeychainSecretStoreOptions {
	commandPath?: string;
	database: DatabaseSync;
	idFactory?: () => string;
	now?: () => Date;
	serviceName?: string;
}

export interface MockSecretStoreOptions {
	idFactory?: () => string;
	now?: () => Date;
	serviceName?: string;
}

interface NormalizedLookup {
	key: string;
	scope: SecretScope;
	scopeId: string;
}

interface NormalizedWriteInput extends NormalizedLookup {
	displayName: string;
	metadata: Record<string, unknown>;
	value: string;
}

interface KeychainReference {
	account: string;
	service: string;
}

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

export class SecretStoreError extends Error {
	readonly code: SecretStoreErrorCode;
	readonly command?: string;
	readonly exitCode?: number;
	readonly stderr?: string;

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

export function maskSecret(value: string): string {
	if (value.length === 0) {
		return MASK_PREFIX;
	}

	if (value.length <= MASK_VISIBLE_SUFFIX_LENGTH) {
		return MASK_PREFIX;
	}

	return `${MASK_PREFIX}${value.slice(-MASK_VISIBLE_SUFFIX_LENGTH)}`;
}

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

export function createMockSecretStore({
	idFactory = randomUUID,
	now = () => new Date(),
	serviceName = 'mock.ensemble.secret-store',
}: MockSecretStoreOptions = {}): SecretStore {
	const records = new Map<
		string,
		{ metadata: SecretMetadata; value: string }
	>();

	function getRecord(lookup: NormalizedLookup) {
		return records.get(createIdentityKey(lookup));
	}

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

function createSqliteSecretMetadataStore(database: DatabaseSync) {
	return {
		delete(lookup: NormalizedLookup): void {
			database
				.prepare(
					`DELETE FROM secret_metadata
					 WHERE scope = ? AND scope_id = ? AND name = ?`,
				)
				.run(lookup.scope, lookup.scopeId, lookup.key);
		},
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

function normalizeDisplayName(
	displayName: string | undefined,
	fallback: string,
): string {
	const normalized = displayName?.trim();
	return normalized || fallback;
}

function normalizeMetadata(
	metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
	return metadata ? { ...metadata } : {};
}

function createKeychainReference(
	serviceName: string,
	lookup: NormalizedLookup,
): KeychainReference {
	return {
		account: `v1:${lookup.scope}:${encodeURIComponent(lookup.scopeId)}:${encodeURIComponent(lookup.key)}`,
		service: serviceName,
	};
}

function createIdentityKey(lookup: NormalizedLookup): string {
	return `${lookup.scope}\u0000${lookup.scopeId}\u0000${lookup.key}`;
}

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

function isNotFoundError(error: unknown): boolean {
	return error instanceof SecretStoreError && error.code === 'not-found';
}

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

function sanitizeStderr(stderr: string): string {
	return stderr.trim().slice(0, 1000);
}

function formatLookup(lookup: NormalizedLookup): string {
	return `${lookup.scope}:${lookup.scopeId || '<app>'}:${lookup.key}`;
}
