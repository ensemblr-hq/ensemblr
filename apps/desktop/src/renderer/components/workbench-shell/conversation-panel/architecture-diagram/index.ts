/**
 * Public surface of the architecture diagram pane.
 *
 * Deliberately has no importers: this is a renderer barrel, so the two
 * consumers reach `architecture-diagram-panel` and `architecture-diagram-button`
 * directly to keep the startup bundle from pulling one through the other. It is
 * declared as an entry in `knip.jsonc` and `.fallowrc.jsonc` for that reason —
 * removing it makes the dead-code pass resolve a glob to a file that is gone.
 */
export { ArchitectureDiagramButton } from './architecture-diagram-button';
export { ArchitectureDiagramPanel } from './architecture-diagram-panel';
