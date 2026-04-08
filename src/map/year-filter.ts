import type { FilterSpecification, Map as MaplibreMap } from "maplibre-gl";

export function applyYearFilter(
	map: MaplibreMap,
	year: number | string,
	timeMapSourceName: string = "timemap",
): void {
	const intYear = Number.parseInt(year + "", 10);
	if (!Number.isFinite(intYear)) {
		return;
	}

	// MapLibre: getStyle() delegates to Style.serialize(), which returns undefined
	// until the style has finished loading (_loaded). Same if no style is set yet.
	const styleJson = map.getStyle();
	if (!styleJson?.layers) {
		return;
	}

	const timemapFilter: FilterSpecification = [
		"all",
		[
			"<=",
			["to-number", ["coalesce", ["get", "start_date"], -999999]],
			intYear,
		],
		[">=", ["to-number", ["coalesce", ["get", "end_date"], 999999]], intYear],
	];

	const layers = styleJson.layers;
	for (const l of layers) {
		if (!l || typeof l !== "object") continue;
		const layer = l as { id?: string; source?: unknown };
		if (typeof layer.id !== "string") {
			continue;
		}
		if (typeof layer.source !== "string") {
			continue;
		}

		let filter: FilterSpecification | null = null;
		if (layer.source === timeMapSourceName) {
			filter = timemapFilter;
		}
		if (!filter) {
			continue;
		}
		try {
			map.setFilter(layer.id, filter);
		} catch {
			// ignore: some layers might not accept filter due to style mismatches
		}
	}
}
