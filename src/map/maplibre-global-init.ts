import maplibregl, { setRTLTextPlugin } from "maplibre-gl";
import { Protocol } from "pmtiles";
import { rtlPluginCode } from "./rtl-plugin-code";

/**
 * MapLibre global hooks must run at most once per app context.
 * {@link setRTLTextPlugin} throws if called again after a successful registration.
 */
/** `addProtocol("pmtiles", …)` should run at most once. */
let pmtilesProtocolSetupDone = false;
/** After the first {@link setRTLTextPlugin} attempt, MapLibre must not be called again. */
let rtlTextPluginSetupDone = false;

function ensurePmtilesProtocol(): void {
	if (pmtilesProtocolSetupDone) return;
	pmtilesProtocolSetupDone = true;
	try {
		maplibregl.addProtocol("pmtiles", new Protocol().tile);
	} catch (e) {
		console.warn("History maps: pmtiles protocol registration failed:", e);
	}
}

function ensureRtlTextPlugin(): void {
	if (rtlTextPluginSetupDone) return;
	rtlTextPluginSetupDone = true;
	try {
		const blob = new Blob([rtlPluginCode], {
			type: "application/javascript",
		});
		const blobURL = URL.createObjectURL(blob);
		setRTLTextPlugin(blobURL, false);
	} catch (e) {
		console.warn("History maps: RTL text plugin init failed:", e);
	}
}

/**
 * Registers the `pmtiles` URL protocol and the bundled RTL text plugin on MapLibre.
 * Safe to call from any code path; subsequent calls are no-ops.
 */
export function ensureMaplibreGlobalInit(): void {
	ensurePmtilesProtocol();
	ensureRtlTextPlugin();
}
