import type { AgentProviderId } from './agent-provider.ts';

/** Fixed advisory roles users can assign to each runtime-and-model pair. */
export const MODEL_ROLES = [
	'sage',
	'coder',
	'builder',
	'grunt',
	'explorer',
] as const;

/** Advisory task category describing a model's user-configured strengths. */
export type ModelRole = (typeof MODEL_ROLES)[number];

/**
 * Narrows an untrusted role value to the fixed role vocabulary.
 * @param value - Candidate role identifier.
 * @returns True when the value is a supported model role.
 */
export function isModelRole(value: string): value is ModelRole {
	return MODEL_ROLES.some((role) => role === value);
}

/** Saved role preferences for one model on one native agent runtime. */
export interface ModelRoleAssignment {
	modelId: string;
	roles: ModelRole[];
	runtime: AgentProviderId;
}

/**
 * Resolves one runtime-and-model pair's assigned roles in the fixed display order.
 * @param assignments - Saved role preferences, including unavailable models.
 * @param runtime - Native runtime that owns the model row.
 * @param modelId - Runtime-local model identifier.
 * @returns The pair's deduplicated advisory roles.
 */
export function assignedRolesFor(
	assignments: readonly ModelRoleAssignment[],
	runtime: AgentProviderId,
	modelId: string,
): readonly ModelRole[] {
	const assigned = new Set<ModelRole>();
	for (const assignment of assignments) {
		if (assignment.runtime !== runtime || assignment.modelId !== modelId)
			continue;
		for (const role of assignment.roles) assigned.add(role);
	}
	return MODEL_ROLES.filter((role) => assigned.has(role));
}
