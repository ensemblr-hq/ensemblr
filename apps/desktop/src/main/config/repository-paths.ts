/**
 * Where a repository's committed Ensemblr config lives, as two names and
 * nothing else.
 *
 * A leaf module on purpose. These were declared in `repository-config.ts`, which
 * is also the module that parses what they point at — so the writer that had to
 * refuse a symlinked settings path imported the parser to learn the path, and
 * the parser imported the writer's loaders, closing a cycle. Names have no
 * dependencies; keeping them here is what lets every layer read them without
 * reaching across.
 */

/** Directory that holds the committed repository config. */
export const ENSEMBLR_DIRECTORY = '.ensemblr';

/** Filename of the sole on-disk repository config, inside {@link ENSEMBLR_DIRECTORY}. */
export const ENSEMBLR_SETTINGS_FILENAME = 'settings.toml';
