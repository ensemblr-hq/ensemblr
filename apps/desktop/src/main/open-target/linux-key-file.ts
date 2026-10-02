import { readFileSync, statSync } from 'node:fs';

/** A parsed freedesktop key-file: group name to its key/value pairs. */
export type KeyFileGroups = ReadonlyMap<string, ReadonlyMap<string, string>>;

/**
 * Largest key-file read. Real ones are a few kilobytes (hicolor's
 * `index.theme`, the biggest, is ~20 KB); anything past this is not one.
 */
const MAX_KEY_FILE_BYTES = 256 * 1024;

const GROUP_HEADER = /^\[(.+)\]$/;

/**
 * Reads a freedesktop key-file — a `.desktop` entry, an icon theme's
 * `index.theme`, `kdeglobals`, or GTK's `settings.ini` — so a malformed or
 * missing host file costs one icon rather than the detection pass.
 * @param filePath - Absolute path to the key-file.
 * @returns The parsed groups, or `null` when the file is absent, unreadable,
 * or too large to be a key-file.
 */
export function readKeyFile(filePath: string): KeyFileGroups | null {
	try {
		if (statSync(filePath).size > MAX_KEY_FILE_BYTES) {
			return null;
		}
		return parseKeyFile(readFileSync(filePath, 'utf8'));
	} catch {
		return null;
	}
}

/**
 * Parses key-file text into its groups. Comments, blank lines, and entries
 * before the first header are skipped, and the first value a group gives a key
 * wins.
 * @param text - The key-file contents.
 * @returns The parsed groups.
 */
function parseKeyFile(text: string): KeyFileGroups {
	const groups = new Map<string, Map<string, string>>();
	let current: Map<string, string> | null = null;

	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line === '' || line.startsWith('#') || line.startsWith(';')) {
			continue;
		}
		const header = GROUP_HEADER.exec(line);
		if (header) {
			const name = header[1];
			current = groups.get(name) ?? new Map();
			groups.set(name, current);
			continue;
		}
		const separator = line.indexOf('=');
		if (!current || separator <= 0) {
			continue;
		}
		const key = line.slice(0, separator).trim();
		if (!current.has(key)) {
			current.set(key, line.slice(separator + 1).trim());
		}
	}

	return groups;
}
