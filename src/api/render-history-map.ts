import type ObsidianHistoryMapsPlugin from "../main";
import { StyleManager } from "../map/style";
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from "../map/constants";
import { applyYearFilter } from "../map/year-filter";
import { rtlPluginCode } from "../map/rtl-plugin-code";
import { disposeMapTimeline } from "../map/timeline";
import maplibregl, { Map, setRTLTextPlugin } from "maplibre-gl";
import { Protocol } from "pmtiles";
import {
	ApiPointsLayer,
	type HistoryMapPoint,
	type HistoryMapPointClickHandler,
} from "./api-points-layer";
import {
	mountHistoryMapConfigPane,
	type HistoryMapConfigBinding,
} from "./history-map-config-pane";

export interface RenderHistoryMapOptions {
	/** `[latitude, longitude]` — same as Bases map view. */
	center?: [number, number];
	zoom?: number;
	minZoom?: number;
	maxZoom?: number;
	/** Pixel height of the map region; default `400`. */
	height?: number;
	/** Applied to vector layers whose `source` matches `timeMapSourceName` after style loads. */
	year?: number;
	timeMapSourceName?: string;
	/**
	 * Raster / style URLs; when omitted, uses the first tile set from plugin settings,
	 * then the same defaults as {@link StyleManager.getMapStyle}.
	 */
	mapTiles?: string[];
	mapTilesDark?: string[];

	/** Point markers (same visual model as Bases map pins). */
	points?: HistoryMapPoint[];
	/** If set, receives clicks on pins instead of default `openLinkText(point.path, …)`. */
	onPointClick?: HistoryMapPointClickHandler;

	/**
	 * When true (default), show a Tweakpane panel for map options (zoom / center sync live).
	 */
	showTweakpane?: boolean;

	/**
	 * When true, show the year timeline strip (Bases “Show Timeline”).
	 * Not implemented for this API yet; value is ignored.
	 */
	showTimeline?: boolean;
	/** Reserved; not used until timeline UI is implemented for this API. */
	onYearChange?: (year: number) => void;
	/** Reserved; not used until timeline UI is implemented for this API. */
	timelineMinYear?: number;
	/** Reserved; not used until timeline UI is implemented for this API. */
	timelineMaxYear?: number;
}

export interface RenderHistoryMapResult {
	map: Map;
	destroy: () => void;
	/** Updates the active year filter and markers. No-op if map was destroyed. */
	setYear: (year: number) => void;
	/** Current year after clamping to the configured range. */
	getYear: () => number;
	/** Replace marker data and re-filter by the current year. */
	setPoints: (points: HistoryMapPoint[]) => Promise<void>;
}

let pmtilesProtocolRegistered = false;
let rtlPluginInitialized = false;

/** API embed uses a fixed year span until timeline options are implemented. */
const API_YEAR_RANGE_LO = -3000;

function apiYearRangeHi(): number {
	return new Date().getFullYear();
}

function getYearFallback(): number {
	return new Date().getFullYear();
}

function clampYear(y: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, y));
}

function clampConfigurableYear(
	year: number | string | null | undefined,
	lo: number,
	hi: number,
	fallback?: number,
): number {
	const fb = fallback ?? getYearFallback();
	const n = year == null ? Number.NaN : Number.parseInt(String(year), 10);
	const base = Number.isFinite(n) ? n : fb;
	return clampYear(base, lo, hi);
}

function ensureMaplibreProtocol(): void {
	if (pmtilesProtocolRegistered) return;
	maplibregl.addProtocol("pmtiles", new Protocol().tile);
	pmtilesProtocolRegistered = true;
}

function ensureRtlPlugin(): void {
	if (rtlPluginInitialized) return;
	try {
		const blob = new Blob([rtlPluginCode], {
			type: "application/javascript",
		});
		const blobURL = URL.createObjectURL(blob);
		setRTLTextPlugin(blobURL, false);
		rtlPluginInitialized = true;
	} catch (e) {
		console.warn("History maps API: RTL plugin init failed:", e);
	}
}

function tileUrlsFromPlugin(plugin: ObsidianHistoryMapsPlugin): {
	mapTiles: string[];
	mapTilesDark: string[];
} {
	const ts = plugin.settings.tileSets[0];
	if (!ts) {
		return { mapTiles: [], mapTilesDark: [] };
	}
	return {
		mapTiles: ts.lightTiles ? [ts.lightTiles] : [],
		mapTilesDark: ts.darkTiles
			? [ts.darkTiles]
			: ts.lightTiles
				? [ts.lightTiles]
				: [],
	};
}

/**
 * Embeds a MapLibre map in `container` using this plugin’s styling / defaults.
 * For use from other plugins: `app.plugins.plugins['obsidian-history-maps']?.api.renderHistoryMap(...)`.
 */
export async function renderHistoryMap(
	plugin: ObsidianHistoryMapsPlugin,
	container: HTMLElement,
	options: RenderHistoryMapOptions = {},
): Promise<RenderHistoryMapResult> {
	ensureMaplibreProtocol();
	ensureRtlPlugin();

	const center = options.center ?? DEFAULT_MAP_CENTER;
	const zoom = options.zoom ?? DEFAULT_MAP_ZOOM;
	const minZ = options.minZoom ?? 1;
	const maxZ = options.maxZoom ?? 18;
	const heightPx = options.height ?? 600;
	let timeSrc = options.timeMapSourceName?.trim() || "timemap";
	const showTweakpane = options.showTweakpane !== false;

	const tLo = API_YEAR_RANGE_LO;
	const tHi = apiYearRangeHi();

	let currentYear = clampConfigurableYear(
		options.year ?? getYearFallback(),
		tLo,
		tHi,
	);
	let destroyed = false;
	let apiPoints: HistoryMapPoint[] = [...(options.points ?? [])];

	const pointsLayer = new ApiPointsLayer(plugin.app, options.onPointClick);

	const resolved =
		options.mapTiles != null || options.mapTilesDark != null
			? {
					mapTiles: options.mapTiles ?? [],
					mapTilesDark: options.mapTilesDark ?? [],
				}
			: tileUrlsFromPlugin(plugin);

	const styleManager = new StyleManager(plugin.app);
	const style = await styleManager.getMapStyle(
		resolved.mapTiles,
		resolved.mapTilesDark,
	);

	const root = container.createDiv({ cls: "ohm-api-history-map-root" });
	const wrap = root.createDiv({
		cls: showTweakpane
			? "bases-map-container ohm-api-history-map-wrap"
			: "bases-map-container",
	});
	const mapEl = wrap.createDiv({ cls: "bases-map ohm-api-history-map" });
	mapEl.style.height = `${heightPx}px`;

	const map = new Map({
		container: mapEl,
		style,
		center: [center[1], center[0]],
		zoom,
		minZoom: minZ,
		maxZoom: maxZ,
	});

	const refreshPoints = (): void => {
		if (destroyed) {
			return;
		}
		void pointsLayer.setPoints(map, apiPoints, currentYear);
	};

	const applyYearToMap = (): void => {
		if (destroyed) return;
		applyYearFilter(map, currentYear, timeSrc);
		refreshPoints();
	};

	let configPane: ReturnType<typeof mountHistoryMapConfigPane> | null = null;
	let tweakBinding: HistoryMapConfigBinding | null = null;

	if (showTweakpane) {
		const paneHost = wrap.createDiv({ cls: "ohm-api-tweakpane-host" });
		const binding: HistoryMapConfigBinding = {
			latitude: center[0],
			longitude: center[1],
			zoom,
			minZoom: minZ,
			maxZoom: maxZ,
			heightPx,
			year: currentYear,
			timeMapSourceName: timeSrc,
		};

		tweakBinding = binding;
		configPane = mountHistoryMapConfigPane({
			host: paneHost,
			map,
			mapElement: mapEl,
			binding,
			onYearChange: (y) => {
				currentYear = clampConfigurableYear(y, tLo, tHi);
				binding.year = currentYear;
				applyYearToMap();
			},
			onTimeMapSourceChange: (name) => {
				timeSrc = name;
				binding.timeMapSourceName = timeSrc;
				applyYearToMap();
			},
		});
	}

	map.on("error", (e) => {
		console.warn("History maps API map error:", e);
	});

	map.on("load", () => {
		applyYearToMap();
		queueMicrotask(() => map.resize());
	});

	const destroy = (): void => {
		destroyed = true;
		configPane?.dispose();
		configPane = null;
		disposeMapTimeline(wrap);
		pointsLayer.detach(map);
		map.remove();
		root.remove();
	};

	const setYear = (year: number): void => {
		if (destroyed) return;
		currentYear = clampConfigurableYear(year, tLo, tHi);
		if (tweakBinding) {
			tweakBinding.year = currentYear;
			configPane?.refreshPanel();
		}
		applyYearToMap();
	};

	const getYear = (): number => currentYear;

	const setPoints = async (points: HistoryMapPoint[]): Promise<void> => {
		if (destroyed) return;
		apiPoints = [...points];
		await pointsLayer.setPoints(map, apiPoints, currentYear);
	};

	return { map, destroy, setYear, getYear, setPoints };
}
