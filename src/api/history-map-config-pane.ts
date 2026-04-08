import { Pane } from "tweakpane";
import type { Map } from "maplibre-gl";

function refreshTweakpane(pane: Pane): void {
	(pane as unknown as { refresh(): void }).refresh();
}

/** Mutable values bound to Tweakpane (lat/lng like Bases `center`). */
export interface HistoryMapConfigBinding {
	latitude: number;
	longitude: number;
	zoom: number;
	minZoom: number;
	maxZoom: number;
	heightPx: number;
	year: number;
	timeMapSourceName: string;
}

export interface MountHistoryMapConfigPaneOptions {
	host: HTMLElement;
	map: Map;
	mapElement: HTMLElement;
	binding: HistoryMapConfigBinding;
	onYearChange?: (year: number) => void;
	onTimeMapSourceChange?: (name: string) => void;
	/** When false, do not show the `year` control. */
	showYear?: boolean;
	/** When false, do not show the `timeMapSourceName` control. */
	showTimeMapSource?: boolean;
}

export interface HistoryMapConfigPaneHandle {
	dispose: () => void;
	refreshViewFromMap: () => void;
	/** Re-read all bound fields from the underlying object (e.g. after `setYear`). */
	refreshPanel: () => void;
}

/**
 * Tweakpane for {@link renderHistoryMap}: options with live sync of
 * latitude / longitude / zoom from map interaction.
 */
export function mountHistoryMapConfigPane(
	opts: MountHistoryMapConfigPaneOptions,
): HistoryMapConfigPaneHandle {
	const {
		host,
		map,
		mapElement,
		binding,
		onYearChange,
		onTimeMapSourceChange,
		showYear,
		showTimeMapSource,
	} = opts;

	const pane = new Pane({ container: host, title: "Map" });

	const viewFolder = pane.addFolder({ title: "View", expanded: true });
	const zoomBlade = viewFolder.addBinding(binding, "zoom", {
		min: binding.minZoom,
		max: binding.maxZoom,
		step: 0.01,
	});
	viewFolder.addBinding(binding, "latitude", {
		min: -85,
		max: 85,
		step: 0.0001,
		label: "lat",
	}).on("change", () => {
		map.setCenter({ lng: binding.longitude, lat: binding.latitude });
	});
	viewFolder.addBinding(binding, "longitude", {
		min: -180,
		max: 180,
		step: 0.0001,
		label: "lng",
	}).on("change", () => {
		map.setCenter({ lng: binding.longitude, lat: binding.latitude });
	});
	zoomBlade.on("change", () => {
		map.setZoom(binding.zoom);
	});

	const limitsFolder = pane.addFolder({ title: "Limits", expanded: false });
	limitsFolder
		.addBinding(binding, "minZoom", { min: 1, max: 24, step: 1 })
		.on("change", () => {
			map.setMinZoom(binding.minZoom);
			if (map.getZoom() < binding.minZoom) {
				map.setZoom(binding.minZoom);
			}
			refreshTweakpane(pane);
		});
	limitsFolder
		.addBinding(binding, "maxZoom", { min: 1, max: 24, step: 1 })
		.on("change", () => {
			map.setMaxZoom(binding.maxZoom);
			if (map.getZoom() > binding.maxZoom) {
				map.setZoom(binding.maxZoom);
			}
			refreshTweakpane(pane);
		});
	limitsFolder
		.addBinding(binding, "heightPx", {
			min: 120,
			max: 1200,
			step: 10,
			label: "height",
		})
		.on("change", () => {
			mapElement.style.height = `${binding.heightPx}px`;
			queueMicrotask(() => map.resize());
		});

	const dataFolder = pane.addFolder({ title: "Data", expanded: false });
	const shouldShowYear = showYear !== false;
	const shouldShowTimeMapSource = showTimeMapSource !== false;

	if (shouldShowYear) {
		dataFolder
			.addBinding(binding, "year", {
				min: -5000,
				max: new Date().getFullYear() + 100,
				step: 1,
			})
			.on("change", () => {
				onYearChange?.(binding.year);
			});
	}

	if (shouldShowTimeMapSource) {
		dataFolder
			.addBinding(binding, "timeMapSourceName", {
				label: "time source",
			})
			.on("change", () => {
				onTimeMapSourceChange?.(
					binding.timeMapSourceName.trim() || "timemap",
				);
			});
	}

	/**
	 * Sync lat/lng/zoom from the map into the pane.
	 * Do not call `refreshTweakpane` on every `move` — MapLibre fires `move` very
	 * often while dragging; full pane refresh each frame makes panning janky.
	 * Year / time source are only changed from the pane, not from the map.
	 */
	const refreshViewFromMap = (): void => {
		const c = map.getCenter();
		binding.latitude = c.lat;
		binding.longitude = c.lng;
		binding.zoom = map.getZoom();
		refreshTweakpane(pane);
	};

	const onMapSettled = (): void => {
		refreshViewFromMap();
	};

	map.on("moveend", onMapSettled);
	map.on("zoomend", onMapSettled);
	refreshViewFromMap();

	const dispose = (): void => {
		map.off("moveend", onMapSettled);
		map.off("zoomend", onMapSettled);
		pane.dispose();
	};

	return {
		dispose,
		refreshViewFromMap,
		refreshPanel: () => refreshTweakpane(pane),
	};
}
