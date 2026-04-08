import "./app.css";
import { Plugin } from "obsidian";
import { ensureMaplibreGlobalInit } from "./map/maplibre-global-init";
import { HistoryMapView } from "./map-view";
import { MapSettings, DEFAULT_SETTINGS, MapSettingTab } from "./settings";
import {
	renderHistoryMap,
	type RenderHistoryMapOptions,
} from "./api/render-history-map";

export default class ObsidianHistoryMapsPlugin extends Plugin {
	settings!: MapSettings;

	/** Exposed for other plugins or custom code (see {@link renderHistoryMap}). */
	api = {
		renderHistoryMap: (
			container: HTMLElement,
			options?: RenderHistoryMapOptions,
		) => renderHistoryMap(this, container, options),
	};

	async onload() {
		await this.loadSettings();
		ensureMaplibreGlobalInit();

		this.registerBasesView("history-map", {
			name: "History Map",
			icon: "lucide-map",
			factory: (controller, containerEl) =>
				new HistoryMapView(controller, containerEl, this),
			options: HistoryMapView.getViewOptions,
		});

		this.addSettingTab(new MapSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	onunload() {}
}
