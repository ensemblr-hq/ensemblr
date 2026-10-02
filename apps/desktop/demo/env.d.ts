/** Controls the demo preload exposes for composing and capturing a scenario. */
interface EnsemblrDemoApi {
	capture: (scenarioId: string, theme: string) => Promise<string | null>;
	setContentSize: (size: { height: number; width: number }) => Promise<void>;
}

interface Window {
	/** Present only in the demo window; undefined in the shipped app. */
	ensemblrDemo?: EnsemblrDemoApi;
}
