import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { stripLaunchContextEnv } from '../environment/launch-env.ts';
import {
	createKeychainReference,
	formatLookup,
	maskSecret,
	normalizeFilter,
	normalizeLookup,
	normalizeWriteInput,
} from './normalize.ts';
import {
	type KeychainReference,
	type MacosKeychainSecretStoreOptions,
	type NormalizedWriteInput,
	type SecretStore,
	SecretStoreError,
} from './secret-store-types.ts';
import {
	createSqliteSecretMetadataStore,
	type MetadataStore,
} from './sqlite-metadata-store.ts';

/** Internal: captured output of `/usr/bin/security` command. */
interface SecurityCommandResult {
	stderr: string;
	stdout: string;
}

const DEFAULT_KEYCHAIN_SERVICE_NAME = 'dev.ensemblr.app.secret-store';
const SECURITY_COMMAND_PATH = '/usr/bin/security';

/**
 * Builds a macOS Keychain-backed secret store, persisting non-sensitive metadata
 * via a {@link MetadataStore} while holding the encrypted values inside the
 * user's Keychain.
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

	return buildKeychainSecretStore({
		commandPath,
		idFactory,
		metadataStore,
		now,
		serviceName,
	});
}

/** Injected dependencies for {@link buildKeychainSecretStore}. */
interface KeychainBackendDependencies {
	commandPath: string;
	idFactory: () => string;
	metadataStore: MetadataStore;
	now: () => Date;
	serviceName: string;
}

/**
 * Composes a {@link SecretStore} from an injected {@link MetadataStore}, so
 * callers (and tests) can swap the metadata backing without touching the
 * Keychain plumbing.
 */
function buildKeychainSecretStore({
	commandPath,
	idFactory,
	metadataStore,
	now,
	serviceName,
}: KeychainBackendDependencies): SecretStore {
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
			`Ensemblr ${input.scope} secret metadata entry`,
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
			// Strip launch-context vars so a keychain read can't be attributed to
			// (or relaunch) Ensemblr by LaunchServices.
			env: stripLaunchContextEnv(process.env),
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
