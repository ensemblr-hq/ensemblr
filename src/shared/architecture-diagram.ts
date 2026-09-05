/**
 * Public entrypoint for the architecture diagram's data model. Import the IR
 * types, the validator, and the delta comparator from here rather than from the
 * `architecture-diagram/` implementation files.
 *
 * The model lives in `shared/` because three processes hold it: the main
 * process builds and stores it, the preload bridge carries it, and the renderer
 * compiles it into SVG. The layout compiler that turns it into geometry is a
 * renderer concern and lives in `renderer/lib/architecture-diagram/`.
 */
export type { ArchitectureCoverage } from './architecture-diagram/coverage.ts';
export { coverChangedPaths } from './architecture-diagram/coverage.ts';
export type {
	ArchitectureDelta,
	ArchitectureDeltaStatus,
	ArchitectureEntityDelta,
} from './architecture-diagram/delta.ts';
export {
	diffArchitectureIr,
	EMPTY_ARCHITECTURE_DELTA,
	toDeltaStatusMap,
} from './architecture-diagram/delta.ts';
export type { ArchitectureIrParse } from './architecture-diagram/schema.ts';
export {
	ARCHITECTURE_DIAGRAM_LIMITS,
	ARCHITECTURE_LAYOUT_MAX_COLS,
	ARCHITECTURE_LAYOUT_MAX_ROWS,
	architectureIrSchema,
	MAX_COMPONENT_SOURCES,
	parseArchitectureIr,
	parseArchitectureIrResult,
} from './architecture-diagram/schema.ts';
export type {
	ArchitectureBoundary,
	ArchitectureCard,
	ArchitectureComponent,
	ArchitectureComponentType,
	ArchitectureConnection,
	ArchitectureConnectionVariant,
	ArchitectureIR,
	ArchitectureLayout,
	ArchitectureMeta,
	ArchitectureRouteMode,
	ArchitectureSide,
	ArchitectureSourceRef,
	DiagramPoint,
	DiagramSize,
} from './architecture-diagram/types.ts';
export {
	ARCHITECTURE_COMPONENT_TYPES,
	ARCHITECTURE_FILE_RELATIVE_PATH,
	ARCHITECTURE_IR_SCHEMA_VERSION,
} from './architecture-diagram/types.ts';
