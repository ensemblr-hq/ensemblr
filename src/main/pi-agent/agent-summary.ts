/**
 * The agent-authored session summary recorded on a chat tab.
 *
 * `ensemblr_set_summary` stores the agent's text here rather than writing the
 * `.context/sessions/` file directly: summary files are projected to disk only
 * at turn boundaries, so a first-turn scaffolder still sees an empty workspace
 * root, and keeping one writer per artifact means a mid-turn tool call can
 * never interleave with the queue's drain. This blob is the source text; the
 * tab's separate `summary` marker records where it was last projected.
 */

/** An agent-authored summary and the point in the branch it describes. */
export interface AgentSummaryMarker {
	/** Branch the summary describes, so a reused tab cannot inherit it. */
	branchId: string;
	/** The summary body, in markdown. */
	body: string;
	/** Highest branch event ordinal at the moment the agent recorded it. */
	capturedAtOrdinal: number;
	title: string;
	updatedAt: string;
}

/** Metadata key holding the agent-authored summary on a chat tab. */
const AGENT_SUMMARY_KEY = 'agentSummary';

/**
 * Reads a tab's agent-authored summary, tolerating tabs written before the
 * field existed and blobs missing the fields a reader depends on.
 * @param metadata - The chat tab's untyped metadata blob.
 * @returns The recorded summary, or null when the tab has none usable.
 */
export function readAgentSummaryMarker(
	metadata: Record<string, unknown>,
): AgentSummaryMarker | null {
	const raw = metadata[AGENT_SUMMARY_KEY];
	if (typeof raw !== 'object' || raw === null) {
		return null;
	}
	const marker = raw as Partial<AgentSummaryMarker>;
	if (
		typeof marker.branchId !== 'string' ||
		typeof marker.body !== 'string' ||
		typeof marker.capturedAtOrdinal !== 'number' ||
		typeof marker.title !== 'string'
	) {
		return null;
	}
	return {
		body: marker.body,
		branchId: marker.branchId,
		capturedAtOrdinal: marker.capturedAtOrdinal,
		title: marker.title,
		updatedAt:
			typeof marker.updatedAt === 'string'
				? marker.updatedAt
				: new Date(0).toISOString(),
	};
}

/**
 * Returns the metadata blob with the agent-authored summary replaced.
 * @param metadata - The chat tab's existing metadata blob.
 * @param marker - The summary to record.
 * @returns A new blob carrying the summary alongside every other key.
 */
export function withAgentSummaryMarker(
	metadata: Record<string, unknown>,
	marker: AgentSummaryMarker,
): Record<string, unknown> {
	return { ...metadata, [AGENT_SUMMARY_KEY]: marker };
}
