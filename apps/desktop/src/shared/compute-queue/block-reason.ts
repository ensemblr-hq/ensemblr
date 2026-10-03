/**
 * Builds the refusal an agent reads when it tries to run a compute-heavy
 * command in its own shell. Every runtime's gate hands the model the same
 * paragraph, spelled with the tool names that runtime's tool list carries.
 * @param args - The refused command, the pattern it matched, and the queue tools' names as the agent sees them.
 * @returns One paragraph telling the agent what to call instead.
 */
export function heavyCommandBlockReason({
	command,
	matched,
	queueToolName,
	waitToolName,
}: {
	command: string;
	matched: string;
	queueToolName: string;
	waitToolName: string;
}): string {
	const input = JSON.stringify({ command });
	return `This command matched the compute-heavy pattern \`${matched}\`. Ensemblr runs heavy commands through one queue shared by every agent in every workspace, so the machine stays usable. Call \`${queueToolName}\` with ${input} instead: it waits for a free slot, runs the command in this workspace with its full Ensemblr environment (secrets included), and returns the exit code and the end of the output. If it reports \`timedOut\`, call \`${waitToolName}\` with the \`jobId\` it returned — the job keeps its place and keeps running. Do not retry it in your shell, an Ensemblr terminal, or a script: those are gated too.`;
}
