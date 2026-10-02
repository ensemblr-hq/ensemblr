import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { MAX_AGENT_PAYLOAD_CHARS } from '../../shared/agent-control/workspace-diff.ts';
import type {
	RecalledMemory,
	RecallMemoryResult,
} from '../../shared/agent-control.ts';
import {
	coerceConciergeMemoryKind,
	deleteConciergeMemory,
	listConciergeMemories,
	searchConciergeMemories,
	upsertConciergeMemory,
} from '../storage/repositories/concierge-memory-repository.ts';
import type { ConciergeHome } from './concierge-home.ts';

/** Public surface of the Concierge memory service. */
export interface ConciergeMemoryService {
	/**
	 * Re-reads the memory directory and brings the index in line with it.
	 * `indexed` counts every file the index now covers, whether or not this pass
	 * had to rewrite its row, so a quiet reconcile reports the catalogue's size
	 * rather than zero. An unreadable directory reports nothing on either count
	 * and removes nothing.
	 */
	reconcile: () => { indexed: number; removed: number };
	/** Searches the index, budgeted to the agent payload ceiling. */
	recall: (input: { limit?: number; query: string }) => RecallMemoryResult;
}

/** Dependencies for {@link createConciergeMemoryService}. */
export interface ConciergeMemoryServiceOptions {
	requireDatabase: () => DatabaseSync;
	resolveHome: () => ConciergeHome;
}

/** Frontmatter fields a memory file may declare. */
interface MemoryFrontmatter {
	description?: string;
	kind?: string;
	name?: string;
	projects?: string[];
}

/** A memory file read off disk, parsed into what the index stores. */
interface ParsedMemory {
	body: string;
	frontmatter: MemoryFrontmatter;
}

/**
 * Splits a memory file into its frontmatter and body.
 *
 * Deliberately a small hand-rolled reader rather than a YAML dependency: the
 * frontmatter a memory carries is four scalar fields and one list, and a file
 * the Concierge wrote badly should index with what it can rather than fail.
 * @param source - The markdown file's contents.
 * @returns The parsed frontmatter and the body beneath it.
 */
export function parseMemoryFile(source: string): ParsedMemory {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
	if (!match) {
		return { body: source.trim(), frontmatter: {} };
	}

	const frontmatter: MemoryFrontmatter = {};
	for (const line of (match[1] ?? '').split(/\r?\n/)) {
		const field = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
		if (!field) {
			continue;
		}
		const key = field[1] as keyof MemoryFrontmatter;
		const value = (field[2] ?? '').trim().replace(/^["']|["']$/g, '');
		if (key === 'projects') {
			frontmatter.projects = value
				.replace(/^\[|\]$/g, '')
				.split(',')
				.map((entry) => entry.trim().replace(/^["']|["']$/g, ''))
				.filter((entry) => entry.length > 0);
			continue;
		}
		if (key === 'description' || key === 'kind' || key === 'name') {
			frontmatter[key] = value;
		}
	}

	return { body: source.slice(match[0].length).trim(), frontmatter };
}

/**
 * Reads a memory's title from its frontmatter, its first heading, or its slug —
 * in that order, so a file with no frontmatter still indexes under something a
 * human would recognise.
 * @param slug - The file's basename.
 * @param parsed - The parsed file.
 * @returns The title to index under.
 */
function titleOf(slug: string, parsed: ParsedMemory): string {
	const heading = /^#\s+(.+)$/m.exec(parsed.body);
	return parsed.frontmatter.name ?? heading?.[1]?.trim() ?? slug;
}

/**
 * Reads a memory's summary from its frontmatter, falling back to its first
 * non-heading line so recall always has something to show beside the title.
 * @param parsed - The parsed file.
 * @returns The summary to index.
 */
function summaryOf(parsed: ParsedMemory): string {
	if (parsed.frontmatter.description) {
		return parsed.frontmatter.description;
	}
	const firstProse = parsed.body
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => line.length > 0 && !line.startsWith('#'));
	return firstProse ?? '';
}

/**
 * Owns the Concierge's memory index: the markdown files under the home are the
 * source of truth, and this brings SQLite in line with them.
 *
 * Reconciliation is content-hashed rather than mtime-only, so a file the user
 * edits by hand and one the Concierge rewrote are both picked up, and a file
 * that only had its timestamp touched is not re-indexed for nothing.
 * @param options - Storage handle and the home resolver.
 * @returns The memory service.
 */
export function createConciergeMemoryService({
	requireDatabase,
	resolveHome,
}: ConciergeMemoryServiceOptions): ConciergeMemoryService {
	/**
	 * Lists the memory files on disk, ignoring anything that is not markdown.
	 *
	 * A directory it cannot read is `null` rather than an empty list, because the
	 * two mean opposite things to reconciliation: empty says every indexed memory
	 * was deleted, unreadable says nothing is known. Collapsing them wiped the
	 * whole index the first time a root change pointed at a `memory/` that did
	 * not exist yet.
	 * @param memoryPath - The home's `memory/` directory.
	 * @returns The basenames of the memory files, or null when the directory could not be read.
	 */
	const listMemoryFiles = (memoryPath: string): string[] | null => {
		try {
			return readdirSync(memoryPath).filter((entry) => entry.endsWith('.md'));
		} catch {
			return null;
		}
	};

	/**
	 * Re-indexes one memory file unless the row already carries its content hash.
	 * @param input - Storage handle, the home's `memory/` directory, the file's basename, and the hashes already indexed.
	 * @returns True when the file was read, whether or not its row needed rewriting.
	 */
	const indexMemoryFile = ({
		database,
		file,
		indexedHashes,
		memoryPath,
	}: {
		database: DatabaseSync;
		file: string;
		indexedHashes: ReadonlyMap<string, string>;
		memoryPath: string;
	}): boolean => {
		const absolute = path.join(memoryPath, file);
		let source: string;
		let mtimeMs: number;
		try {
			source = readFileSync(absolute, 'utf8');
			mtimeMs = Math.trunc(statSync(absolute).mtimeMs);
		} catch {
			return false;
		}

		const slug = file.slice(0, -'.md'.length);
		const contentHash = createHash('sha256').update(source).digest('hex');
		if (indexedHashes.get(slug) === contentHash) {
			return true;
		}

		const parsed = parseMemoryFile(source);
		upsertConciergeMemory({
			database,
			input: {
				body: parsed.body,
				contentHash,
				fileMtimeMs: mtimeMs,
				kind: coerceConciergeMemoryKind(parsed.frontmatter.kind),
				projects: parsed.frontmatter.projects ?? [],
				relativePath: path.join('memory', file),
				slug,
				summary: summaryOf(parsed),
				title: titleOf(slug, parsed),
			},
		});
		return true;
	};

	return {
		reconcile: () => {
			const home = resolveHome();
			const files = listMemoryFiles(home.memoryPath);
			if (files === null) {
				return { indexed: 0, removed: 0 };
			}

			const database = requireDatabase();
			const indexedHashes = new Map(
				listConciergeMemories({ database }).map((row) => [
					row.slug,
					row.contentHash,
				]),
			);
			const seen = new Set<string>();
			let indexed = 0;

			for (const file of files) {
				if (
					indexMemoryFile({
						database,
						file,
						indexedHashes,
						memoryPath: home.memoryPath,
					})
				) {
					seen.add(file.slice(0, -'.md'.length));
					indexed += 1;
				}
			}

			let removed = 0;
			for (const slug of indexedHashes.keys()) {
				if (!seen.has(slug)) {
					deleteConciergeMemory({ database, slug });
					removed += 1;
				}
			}

			return { indexed, removed };
		},

		recall: ({ limit, query }) => {
			const hits = searchConciergeMemories({
				database: requireDatabase(),
				...(limit === undefined ? {} : { limit }),
				query,
			});

			const memories: RecalledMemory[] = [];
			const omittedSlugs: string[] = [];
			let spent = 0;

			for (const hit of hits) {
				const entry: RecalledMemory = {
					kind: hit.kind,
					relativePath: hit.relativePath,
					slug: hit.slug,
					snippet: hit.snippet,
					summary: hit.summary,
					title: hit.title,
				};
				const cost = JSON.stringify(entry).length;
				if (spent + cost > MAX_AGENT_PAYLOAD_CHARS) {
					omittedSlugs.push(hit.slug);
					continue;
				}
				spent += cost;
				memories.push(entry);
			}

			return { memories, omittedSlugs };
		},
	};
}
