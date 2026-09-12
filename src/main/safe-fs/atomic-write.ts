import { randomUUID } from 'node:crypto';
import {
	closeSync,
	openSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';

/** Permissions the staged temporary file is created with. */
const TEMPORARY_FILE_MODE = 0o600;

/**
 * Replaces a file by staging its bytes in a uniquely named sibling opened
 * `wx` and renaming that over the destination.
 *
 * Two properties matter and neither survives a plain `writeFileSync`. `wx`
 * fails outright on an existing entry, so a symlink planted at a predictable
 * `<file>.tmp` path cannot be written through, and the random name means two
 * concurrent writers never share a staging path. `rename` replaces the
 * destination entry itself rather than following a symlink sitting there, so a
 * committed link at the destination is unlinked rather than overwritten.
 * @param filePath - Absolute path to replace.
 * @param contents - Bytes to write.
 */
export function writeFileAtomicExclusive(
	filePath: string,
	contents: Buffer | string,
): void {
	const temporaryPath = path.join(
		path.dirname(filePath),
		`.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
	);
	const descriptor = openSync(temporaryPath, 'wx', TEMPORARY_FILE_MODE);

	try {
		writeFileSync(descriptor, contents);
	} catch (error) {
		closeSync(descriptor);
		rmSync(temporaryPath, { force: true });
		throw error;
	}

	closeSync(descriptor);
	renameSync(temporaryPath, filePath);
}
