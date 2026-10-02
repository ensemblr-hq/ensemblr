export type {
	DatabaseHealthSnapshot,
	DatabaseStatus,
} from '../../shared/ipc/contracts/health.ts';
export type {
	EnsemblrDatabaseConnection,
	EnsemblrDatabaseService,
	OpenDatabaseOptions,
} from './database.ts';
export {
	createEnsemblrDatabaseService,
	getCurrentSchemaVersion,
	LATEST_SCHEMA_VERSION,
	listAppliedMigrationIds,
	openEnsemblrDatabase,
	resolveDefaultDatabasePath,
} from './database.ts';
