import { randomUUID } from 'node:crypto';
import {
	chmodSync,
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';

import type { SettingsPublicationRecoverySnapshot } from '../../shared/ipc/contracts/settings-publication.ts';

/** Captured file bytes, including deliberate absence. */
export interface CapturedSettingsFile {
	bytesBase64: string | null;
	exists: boolean;
	hash: string;
}

/**
 * Git inputs that must remain stable between preview, apply, and cleanup.
 * `indexEntry` is the staged entry for the settings path rather than a hash of
 * the whole index file, which any concurrent `git status` rewrites on a stat
 * refresh without the staged content having changed.
 */
export interface SettingsGitFingerprint {
	fileHash: string;
	head: string;
	indexEntry: string;
	status: string;
}

/** Durable transfer record stored outside the user's repository. */
export interface StoredSettingsPublicationRecovery {
	appliedAt: string | null;
	base: CapturedSettingsFile;
	cleanedAt: string | null;
	destination: CapturedSettingsFile;
	destinationApplied: CapturedSettingsFile | null;
	destinationGit: SettingsGitFingerprint;
	id: string;
	repositoryId: string;
	source: CapturedSettingsFile;
	sourceAfterCleanup: CapturedSettingsFile | null;
	sourceGit: SettingsGitFingerprint;
	version: 1;
	workspaceId: string;
}

/** Durable recovery store rooted in app-owned storage. */
export interface SettingsPublicationRecoveryStore {
	list: (repositoryId: string) => SettingsPublicationRecoverySnapshot[];
	read: (id: string) => StoredSettingsPublicationRecovery | null;
	write: (record: StoredSettingsPublicationRecovery) => void;
}

const RECORD_SUFFIX = '.json';
const SUMMARY_SUFFIX = '.summary.json';
const RECOVERY_ID_PATTERN = /^[0-9a-f-]+$/;
const RECOVERY_STRING_FIELDS = ['id', 'repositoryId', 'workspaceId'] as const;
const RECOVERY_FILE_FIELDS = ['base', 'destination', 'source'] as const;
const RECOVERY_FINGERPRINT_FIELDS = ['destinationGit', 'sourceGit'] as const;
const SNAPSHOT_TIMESTAMP_FIELDS = ['appliedAt', 'cleanedAt'] as const;

/**
 * Creates a permission-restricted JSON recovery store. Each record is written
 * as a full document plus a small summary sibling, because the records hold up
 * to three megabyte-scale payloads and are never pruned — listing them must not
 * depend on parsing content the caller discards.
 * @param directory - App-owned directory outside repositories and workspaces.
 * @returns Recovery persistence operations.
 */
export function createSettingsPublicationRecoveryStore(
	directory: string,
): SettingsPublicationRecoveryStore {
	/** Ensures the app-owned directory exists with user-only permissions. */
	function ensureDirectory(): void {
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		chmodSync(directory, 0o700);
	}

	/**
	 * Resolves a validated recovery id to one of its two file paths.
	 * @param id - Recovery id taken from a record or a directory entry.
	 * @param suffix - Which of the record's files to address.
	 * @returns The absolute path, or null for an unusable id.
	 */
	function recoveryPath(id: string, suffix: string): string | null {
		return RECOVERY_ID_PATTERN.test(id)
			? path.join(directory, `${id}${suffix}`)
			: null;
	}

	/**
	 * Parses one JSON document written by this store.
	 * @param filePath - Path to read, or null when the id was unusable.
	 * @returns The parsed value, or null when it is missing or malformed.
	 */
	function readJson(filePath: string | null): unknown {
		if (!filePath || !existsSync(filePath)) {
			return null;
		}
		try {
			return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
		} catch {
			return null;
		}
	}

	/** Parses one recovery record and rejects unknown or malformed versions. */
	function read(id: string): StoredSettingsPublicationRecovery | null {
		const value = readJson(recoveryPath(id, RECORD_SUFFIX));
		return isStoredRecovery(value) ? value : null;
	}

	/**
	 * Writes one JSON document atomically with user-only permissions.
	 * @param filePath - Destination path, or null when the id was unusable.
	 * @param value - Document to serialize.
	 */
	function writeJson(filePath: string | null, value: unknown): void {
		if (!filePath) {
			throw new Error('Invalid settings recovery id.');
		}
		const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
		const descriptor = openSync(temporaryPath, 'wx', 0o600);
		try {
			writeFileSync(descriptor, JSON.stringify(value), 'utf8');
		} finally {
			closeSync(descriptor);
		}
		renameSync(temporaryPath, filePath);
	}

	/**
	 * Reads every summary document in the directory.
	 * @param names - Directory entries to inspect.
	 * @returns Usable summaries, keyed by the recovery id they describe.
	 */
	function readSummaries(
		names: string[],
	): Map<string, SettingsPublicationRecoverySnapshot> {
		const summaries = new Map<string, SettingsPublicationRecoverySnapshot>();
		for (const name of names) {
			const id = name.endsWith(SUMMARY_SUFFIX)
				? recoveryIdFromFileName(name)
				: null;
			const summary = id ? readJson(path.join(directory, name)) : null;
			if (id && isRecoverySnapshot(summary)) {
				summaries.set(id, summary);
			}
		}
		return summaries;
	}

	/**
	 * Collects the records that predate summaries and must be parsed in full.
	 * @param names - Directory entries to inspect.
	 * @param summaries - Summaries already read from the same listing.
	 * @returns Ids whose record file has no usable summary beside it.
	 */
	function unsummarizedIds(
		names: string[],
		summaries: ReadonlyMap<string, unknown>,
	): string[] {
		const ids: string[] = [];
		for (const name of names) {
			const id = name.endsWith(SUMMARY_SUFFIX)
				? null
				: recoveryIdFromFileName(name);
			if (id && !summaries.has(id)) {
				ids.push(id);
			}
		}
		return ids;
	}

	return {
		list: (repositoryId) => {
			ensureDirectory();
			const names = readdirSync(directory);
			const summaries = readSummaries(names);
			const snapshots = [...summaries.values()].filter(
				(summary) => summary.repositoryId === repositoryId,
			);
			for (const id of unsummarizedIds(names, summaries)) {
				const record = read(id);
				if (record?.repositoryId === repositoryId) {
					snapshots.push(toSnapshot(record));
				}
			}
			return snapshots.sort((left, right) =>
				(right.appliedAt ?? '').localeCompare(left.appliedAt ?? ''),
			);
		},
		read,
		write: (record) => {
			ensureDirectory();
			writeJson(recoveryPath(record.id, RECORD_SUFFIX), record);
			writeJson(recoveryPath(record.id, SUMMARY_SUFFIX), toSnapshot(record));
		},
	};
}

/**
 * Extracts the recovery id one of this store's file names belongs to.
 * @param name - Directory entry name.
 * @returns The owning recovery id, or null for an unrelated entry.
 */
function recoveryIdFromFileName(name: string): string | null {
	const suffix = name.endsWith(SUMMARY_SUFFIX) ? SUMMARY_SUFFIX : RECORD_SUFFIX;
	if (!name.endsWith(suffix)) {
		return null;
	}
	const id = name.slice(0, -suffix.length);
	return RECOVERY_ID_PATTERN.test(id) ? id : null;
}

/** Converts a durable record into its content-free IPC summary. */
function toSnapshot(
	record: StoredSettingsPublicationRecovery,
): SettingsPublicationRecoverySnapshot {
	return {
		appliedAt: record.appliedAt,
		cleanedAt: record.cleanedAt,
		id: record.id,
		repositoryId: record.repositoryId,
		workspaceId: record.workspaceId,
	};
}

/** Reads a parsed JSON value as a plain object. */
function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === 'object' && value !== null
		? (value as Record<string, unknown>)
		: null;
}

/** Validates the stable identity fields of a parsed recovery document. */
function isStoredRecovery(
	value: unknown,
): value is StoredSettingsPublicationRecovery {
	const record = asRecord(value);
	if (record?.version !== 1) {
		return false;
	}
	return (
		RECOVERY_STRING_FIELDS.every(
			(field) => typeof record[field] === 'string',
		) &&
		RECOVERY_FILE_FIELDS.every((field) => isCapturedFile(record[field])) &&
		RECOVERY_FINGERPRINT_FIELDS.every((field) =>
			isGitFingerprint(record[field]),
		)
	);
}

/** Validates one content-free summary document read from app storage. */
function isRecoverySnapshot(
	value: unknown,
): value is SettingsPublicationRecoverySnapshot {
	const record = asRecord(value);
	if (!record) {
		return false;
	}
	return (
		RECOVERY_STRING_FIELDS.every(
			(field) => typeof record[field] === 'string',
		) &&
		SNAPSHOT_TIMESTAMP_FIELDS.every(
			(field) => record[field] === null || typeof record[field] === 'string',
		)
	);
}

/** Validates one captured-file object read from app storage. */
function isCapturedFile(value: unknown): value is CapturedSettingsFile {
	const record = asRecord(value);
	if (!record) {
		return false;
	}
	return (
		typeof record.exists === 'boolean' &&
		typeof record.hash === 'string' &&
		(record.bytesBase64 === null || typeof record.bytesBase64 === 'string')
	);
}

/** Validates one Git fingerprint read from app storage. */
function isGitFingerprint(value: unknown): value is SettingsGitFingerprint {
	const record = asRecord(value);
	if (!record) {
		return false;
	}
	return (
		typeof record.fileHash === 'string' &&
		typeof record.head === 'string' &&
		typeof record.indexEntry === 'string' &&
		typeof record.status === 'string'
	);
}
