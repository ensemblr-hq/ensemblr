/**
 * Field-level Zod primitives shared by more than one IPC request schema.
 *
 * Each one encodes a legacy hand-rolled normalizer's exact coercion semantics,
 * so changing them changes the contract of every schema that composes them.
 */
import { z } from 'zod';

/**
 * Matches the legacy `optionalNullableString` helper: `null` survives as
 * `null`, missing/undefined collapses to `undefined`, non-string values throw.
 */
export const optionalNullableString = z.string().nullable().optional();

/**
 * Matches the legacy `optionalString` helper: `null` is coerced to
 * `undefined`, missing/undefined stays `undefined`, non-string values throw.
 *
 * Preserves the historical quirk that explicit `null` is silently collapsed
 * rather than rejected — chat-tab callers rely on this when forwarding
 * partially-filled forms.
 */
export const optionalStringCoerceNullToUndefined = z
	.string()
	.nullish()
	.transform((value) => value ?? undefined);

/**
 * Optional string that is trimmed and then collapsed to `undefined` when it is
 * empty, so whitespace-only renderer input reaches services as an absent field
 * rather than a blank one.
 */
export const optionalTrimmedString = z
	.string()
	.optional()
	.transform((value) => (value === undefined ? undefined : value.trim()))
	.transform((value) =>
		value === undefined || value.length === 0 ? undefined : value,
	);

/** Optional boolean flag: absent stays `undefined`, non-booleans are rejected. */
export const optionalBoolean = z.boolean().optional();
