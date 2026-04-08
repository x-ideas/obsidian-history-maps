import { Plugin } from "obsidian";
import { HistoryMapView } from "./map-view";
import { MapSettings, DEFAULT_SETTINGS, MapSettingTab } from "./settings";

export default class ObsidianHistoryMapsPlugin extends Plugin {
	settings!: MapSettings;

	async onload() {
		await this.loadSettings();

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

	onunload() {
	}
}
