/**
 * Filesystem primitives for writers whose destination sits inside a repository
 * checkout, where the path's own components are attacker-supplied content.
 *
 * A repository can commit a symlink anywhere Ensemblr writes — `.context`,
 * `.ensemblr/settings.toml`, a `.tmp` sibling — and both `mkdir -p` and
 * `writeFile` follow one silently. Every guarantee against that lives here so a
 * new writer inherits it instead of re-deriving it: per-level realpath
 * containment on the way down, and an exclusive staged write plus `rename` at
 * the leaf.
 */
export { writeFileAtomicExclusive } from './atomic-write.ts';
export {
	ensureContainedDirectory,
	isInside,
	isSingleSegment,
	isSymbolicLinkPath,
	realPathOrNull,
} from './containment.ts';
