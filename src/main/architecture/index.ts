export type {
	ArchitectureFileContents,
	ArchitectureFileRead,
} from './architecture-file.ts';
export {
	ARCHITECTURE_FILE_RELATIVE_PATH,
	architectureFilePath,
	readArchitectureFile,
} from './architecture-file.ts';
export type {
	ArchitectureFailureCode,
	ArchitectureReadResult,
	ArchitectureScanOutcome,
	ArchitectureScanSkipReason,
	ArchitectureService,
} from './architecture-service.ts';
export {
	ArchitectureServiceError,
	createArchitectureService,
} from './architecture-service.ts';
export { irFromModuleGraph } from './ir-from-graph.ts';
export type {
	ModuleGraph,
	ModuleGraphEdge,
	ModuleGraphNode,
} from './module-graph.ts';
export { scanModuleGraph } from './module-graph.ts';
export { withArchitectureScanOnCreate } from './scan-on-create.ts';
export type {
	ArchitectureScanListener,
	ArchitectureScanPort,
	ArchitectureScanQueue,
} from './scan-queue.ts';
export { createArchitectureScanQueue } from './scan-queue.ts';
