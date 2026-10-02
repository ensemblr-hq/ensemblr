/**
 * The {@link ArchitecturePort} over the workspace architecture service.
 *
 * Kept out of `port-adapters.ts` for the same reason `linear-ports.ts` and
 * `review-ports.ts` are: this is not thin delegation. A stored diagram has no
 * natural ceiling — the file is hand-editable and tracked — so a read fits the
 * document to the agent payload budget by shedding detail in a fixed order and
 * saying what it shed, and a write validates the submission and reports a write
 * that did not land without repeating the host path the error text carries. The
 * size caps live in the IR schema rather than here, so the tracked file and this
 * op refuse the same document.
 *
 * Nothing here throws. Every failure comes back as one `reason` word the
 * dispatcher maps onto a failure code, so a full disk and a malformed document
 * are never told to the agent as the same thing.
 */

import type {
	ArchitectureFailure,
	ReadArchitectureDiagramOutcome,
	UpdateArchitectureDiagramOutcome,
} from '../../shared/agent-control.ts';
import { MAX_AGENT_PAYLOAD_CHARS } from '../../shared/agent-control.ts';
import type { ArchitectureIR } from '../../shared/architecture-diagram.ts';
import { parseArchitectureIrResult } from '../../shared/architecture-diagram.ts';
import type {
	ArchitectureFileContents,
	ArchitectureService,
} from '../architecture/index.ts';
import {
	ARCHITECTURE_FILE_RELATIVE_PATH,
	ArchitectureServiceError,
} from '../architecture/index.ts';
import { fitRows } from './payload-fit.ts';
import type { ArchitecturePort } from './ports.ts';

/** Collaborators the architecture port delegates to. */
export interface ArchitecturePortDeps {
	/**
	 * The workspace architecture service, or null when none is composed in. The
	 * port is then absent entirely and the op is refused a step earlier.
	 */
	architectureService: ArchitectureService | null;
	/** Tells an open diagram pane its workspace's document changed. */
	broadcastArchitectureChanged: (payload: { workspaceId: string }) => void;
}

/**
 * Builds a refusal.
 * @param reason - The word the dispatcher maps onto a failure code.
 * @param message - What the agent reads.
 * @returns The refusal.
 */
function refuse(
	reason: ArchitectureFailure['reason'],
	message: string,
): ArchitectureFailure {
	return { message, ok: false, reason };
}

/**
 * Measures a document the way the agent receives it, which is the only size that
 * matters — the IR is serialized into the tool result verbatim.
 * @param ir - The document to measure.
 * @returns Its serialized length in characters.
 */
function payloadSize(ir: ArchitectureIR): number {
	return JSON.stringify(ir).length;
}

/** A document reduced by one shedding stage, and what that stage removed. */
interface ShedResult {
	ir: ArchitectureIR;
	note: string;
}

/**
 * Shortens one of the document's arrays to whatever the rest of it leaves room
 * for, measuring the remainder rather than guessing at a row budget.
 * @param rows - The array to shorten.
 * @param rebuild - Rebuilds the document around a shortened array.
 * @returns The shortened document and how many rows it dropped.
 */
function shedRows<T>(
	rows: readonly T[],
	rebuild: (kept: readonly T[]) => ArchitectureIR,
): { ir: ArchitectureIR; omitted: number } {
	const withoutRows = rebuild([]);
	const fitted = fitRows(
		rows,
		MAX_AGENT_PAYLOAD_CHARS - payloadSize(withoutRows),
	);
	return { ir: rebuild(fitted.kept), omitted: fitted.omitted };
}

/**
 * Drops the annotation cards, which sit beside the drawing as prose rather than
 * describing any part of its topology.
 * @param ir - The document being fitted.
 * @returns The document without cards.
 */
function shedCards(ir: ArchitectureIR): ShedResult {
	if (!ir.cards || ir.cards.length === 0) {
		return { ir, note: '' };
	}
	const { cards: _cards, ...rest } = ir;
	return { ir: rest, note: 'its annotation cards were dropped' };
}

/**
 * Drops every component's evidence paths. They are the largest optional field on
 * the largest array and they say nothing an agent redrawing the diagram needs —
 * the node's own label and type carry the meaning.
 * @param ir - The document being fitted.
 * @returns The document with no `sources` on any component.
 */
function shedSources(ir: ArchitectureIR): ShedResult {
	if (!ir.components.some((component) => component.sources)) {
		return { ir, note: '' };
	}
	return {
		ir: {
			...ir,
			components: ir.components.map(({ sources: _sources, ...rest }) => rest),
		},
		note: "every component's `sources` paths were dropped",
	};
}

/**
 * Drops a tail of connections. Dropping an edge never breaks a reference — every
 * surviving `from` and `to` still names a component that is still there — so the
 * shortened document is one the schema still accepts.
 * @param ir - The document being fitted.
 * @returns The document with its connections fitted to the remaining budget.
 */
function shedConnections(ir: ArchitectureIR): ShedResult {
	const shed = shedRows(ir.connections ?? [], (kept) => ({
		...ir,
		connections: kept,
	}));
	return {
		ir: shed.ir,
		note:
			shed.omitted === 0 ? '' : `${shed.omitted} connection(s) were dropped`,
	};
}

/**
 * Drops a tail of boundaries, after the connections rather than before them:
 * renaming the boundaries and fixing which node belongs to which is the
 * refinement this surface exists for, so they are the last grouping to go.
 * @param ir - The document being fitted.
 * @returns The document with its boundaries fitted to the remaining budget.
 */
function shedBoundaries(ir: ArchitectureIR): ShedResult {
	const shed = shedRows(ir.boundaries ?? [], (kept) => ({
		...ir,
		boundaries: kept,
	}));
	return {
		ir: shed.ir,
		note:
			shed.omitted === 0
				? ''
				: `${shed.omitted} boundary frame(s) were dropped`,
	};
}

/**
 * Drops a tail of components, which only a hand-written document large enough to
 * blow the budget on nodes alone ever reaches. Last because a missing component
 * is the one loss that would strand an edge or a boundary member — by the time
 * this runs both of those arrays have already been fitted around what remains.
 * @param ir - The document being fitted.
 * @returns The document with its components fitted to the remaining budget.
 */
function shedComponents(ir: ArchitectureIR): ShedResult {
	const shed = shedRows(ir.components, (kept) => ({
		...ir,
		components: kept,
	}));
	return {
		ir: shed.ir,
		note: shed.omitted === 0 ? '' : `${shed.omitted} component(s) were dropped`,
	};
}

/**
 * What a read sheds, in the order it sheds it: annotation first, then evidence,
 * then topology, then the nodes themselves. Each stage runs only while the
 * document is still over budget, so an ordinary diagram pays nothing and an
 * oversized one loses the cheapest thing that gets it under.
 */
const SHED_STAGES: readonly ((ir: ArchitectureIR) => ShedResult)[] = [
	shedCards,
	shedSources,
	shedConnections,
	shedBoundaries,
	shedComponents,
];

const SHED_LEAD =
	'The stored document is larger than one tool result can carry, so this copy is shortened:';

const SHED_WARNING =
	'Do not submit this copy back as it stands — an update replaces the whole document, so storing what you were handed would delete what was cut from the user’s file. Group the detail into fewer, larger nodes and submit that instead.';

/**
 * Fits a stored diagram into {@link MAX_AGENT_PAYLOAD_CHARS}, shedding detail
 * rather than refusing the read. A document that will not fit is still the only
 * diagram the workspace has, and an agent handed nothing has no way to page for
 * the rest — so it gets the topology and a sentence naming what is missing.
 * @param ir - The stored document.
 * @returns The document to return and the sentence owning up to the cut.
 */
function fitDiagramToBudget(ir: ArchitectureIR): ShedResult {
	let fitted = ir;
	const notes: string[] = [];
	for (const shed of SHED_STAGES) {
		if (payloadSize(fitted) <= MAX_AGENT_PAYLOAD_CHARS) {
			break;
		}
		const stage = shed(fitted);
		fitted = stage.ir;
		if (stage.note) {
			notes.push(stage.note);
		}
	}
	if (notes.length === 0) {
		return { ir: fitted, note: '' };
	}
	return {
		ir: fitted,
		note: ` ${SHED_LEAD} ${notes.join('; ')}. ${SHED_WARNING}`,
	};
}

/**
 * Opens a read by naming the file the document came from, so an agent edits
 * that document rather than composing a replacement for it.
 * @param snapshot - The stored document.
 * @returns The sentence the read opens with.
 */
function provenanceMessage(snapshot: ArchitectureFileContents): string {
	return `Read from ${snapshot.relativePath}. Edit it rather than replacing it wholesale.`;
}

/**
 * Reads a submitted diagram, accepting the JSON string a client that could not
 * see the argument's shape may have sent instead of an object.
 *
 * Tolerated here rather than refused because the encoding is the bridge's
 * mistake, not the model's: the document itself is right, and answering
 * "invalid diagram" for a well-formed one sends the caller rewriting content
 * that was never the problem.
 * @param diagram - The submitted value, as an object or as JSON text.
 * @returns The value to validate.
 */
function decodeSubmittedDiagram(diagram: unknown): unknown {
	if (typeof diagram !== 'string') {
		return diagram;
	}
	try {
		return JSON.parse(diagram);
	} catch {
		return diagram;
	}
}

/**
 * Reads the errno an `fs` failure carries, which is the only part of it safe to
 * repeat: the message itself embeds the absolute path of the user's checkout.
 * @param error - Whatever the write threw.
 * @returns The errno string, or null when there is none.
 */
function errnoCode(error: unknown): string | null {
	if (typeof error !== 'object' || error === null || !('code' in error)) {
		return null;
	}
	const code = (error as { code: unknown }).code;
	return typeof code === 'string' ? code : null;
}

/**
 * Names a failed write without repeating the error text. An `EACCES` on a
 * read-only mount reports the file's absolute path, and a host path in an agent's
 * context is both a leak and an invitation to go editing around the app.
 * @param error - Whatever the write threw.
 * @returns The message the agent reads.
 */
function storeFailureMessage(error: unknown): string {
	const code = errnoCode(error);
	const cause = code === null ? '' : ` (${code})`;
	return `${ARCHITECTURE_FILE_RELATIVE_PATH} could not be written${cause}. The document you submitted was valid and nothing is wrong with it — the workspace directory would not take the write, which resubmitting cannot change. Say so in your reply rather than trying again.`;
}

/**
 * Names a read that could not run at all — a workspace the database no longer
 * knows, or a directory that would not open. Reported without the error text for
 * the reason {@link storeFailureMessage} withholds it.
 * @param error - Whatever the read threw.
 * @returns The message the agent reads.
 */
function readFailureMessage(error: unknown): string {
	const code = errnoCode(error);
	const cause = code === null ? '' : ` (${code})`;
	return `This workspace's architecture diagram could not be read${cause}. Nothing you pass will change that; report it rather than retrying.`;
}

/**
 * The refusal both ops answer with over a stored document this build cannot
 * parse. The file is tracked, so the recovery belongs to the user — repairing
 * the hand edit or resolving the merge conflict — and is never an overwrite
 * from here.
 * @param message - What the service said stopped it reading the file.
 * @returns The refusal.
 */
function refuseUnreadable(message: string): ArchitectureFailure {
	return refuse(
		'unreadable',
		`${message} Repair or delete that file — it is tracked, so nothing here will overwrite it for you.`,
	);
}

/**
 * Maps a throw out of {@link ArchitectureService.storeRefinedIr} onto the
 * refusal that names its actual cause.
 *
 * Only a genuine filesystem rejection is `store-failed`, because that refusal
 * tells the agent its document was fine and retrying cannot help. The service
 * also refuses to *start* the write over a stored document it cannot parse or a
 * workspace that has gone — told "the directory would not take the write" an
 * agent reports a full disk to the user and never mentions the conflict marker
 * that is actually sitting in their working tree.
 * @param error - Whatever the store threw.
 * @returns The refusal the agent reads.
 */
function refuseFailedStore(error: unknown): ArchitectureFailure {
	if (!(error instanceof ArchitectureServiceError)) {
		return refuse('store-failed', storeFailureMessage(error));
	}
	return error.code === 'diagram-unreadable'
		? refuseUnreadable(error.message)
		: refuse('unavailable', readFailureMessage(error));
}

/** What a read answers for a workspace no agent has drawn yet. */
const NO_DIAGRAM_MESSAGE = `This workspace has no architecture diagram: ${ARCHITECTURE_FILE_RELATIVE_PATH} does not exist. Nothing derives one, so there is nothing to fetch and nothing to retry — read the codebase, author a diagram, and submit it with the update op.`;

/**
 * Builds the architecture port: fit a stored diagram to what an agent can read,
 * validate a submitted one, and store it against the caller's workspace.
 * @param deps - Port collaborators.
 * @returns The architecture port, or undefined when no service is wired.
 */
export function makeArchitecturePort(
	deps: ArchitecturePortDeps,
): ArchitecturePort | undefined {
	const architectureService = deps.architectureService;
	if (!architectureService) {
		return undefined;
	}
	return {
		readDiagram: async ({
			origin,
		}): Promise<ReadArchitectureDiagramOutcome> => {
			const read = await architectureService
				.readDiagram({ workspaceId: origin.workspaceId })
				.catch((error: unknown) =>
					refuse('unavailable', readFailureMessage(error)),
				);
			if ('ok' in read) {
				return read;
			}
			// A stored document this build cannot parse is never written over: the
			// file is tracked, so replacing it would delete work out of the user's
			// working tree without either of you noticing.
			if (read.error) {
				return refuseUnreadable(read.error.message);
			}
			const snapshot = read.current;
			if (!snapshot) {
				return {
					ok: true,
					result: {
						componentCount: 0,
						connectionCount: 0,
						diagram: null,
						message: NO_DIAGRAM_MESSAGE,
					},
				};
			}
			const fitted = fitDiagramToBudget(snapshot.ir);
			return {
				ok: true,
				result: {
					componentCount: fitted.ir.components.length,
					connectionCount: fitted.ir.connections?.length ?? 0,
					diagram: fitted.ir,
					message: `${provenanceMessage(snapshot)}${fitted.note}`,
				},
			};
		},
		updateDiagram: async ({
			diagram,
			origin,
		}): Promise<UpdateArchitectureDiagramOutcome> => {
			const parsed = parseArchitectureIrResult(decodeSubmittedDiagram(diagram));
			if (!parsed.ok) {
				return refuse(
					'invalid',
					`That document is not a valid architecture diagram. ${parsed.problems.join('; ')}. Fix those fields and resubmit the whole document.`,
				);
			}
			// The size caps are the schema's, not this port's: `.ensemblr/architecture.json`
			// is tracked, so a document also reaches the compiler straight off disk,
			// and a bound only this op enforced would be one the file path skips.
			const ir = parsed.ir;
			const componentCount = ir.components.length;
			const connectionCount = ir.connections?.length ?? 0;
			try {
				await architectureService.storeRefinedIr({
					ir,
					workspaceId: origin.workspaceId,
				});
			} catch (error) {
				return refuseFailedStore(error);
			}
			deps.broadcastArchitectureChanged({ workspaceId: origin.workspaceId });
			return {
				ok: true,
				result: {
					componentCount,
					connectionCount,
					message: `Stored in ${ARCHITECTURE_FILE_RELATIVE_PATH} — a tracked file, so it is part of your diff. It is the diagram from now on: nothing in the app regenerates it, so the next pass starts from what you just wrote.`,
				},
			};
		},
	};
}
