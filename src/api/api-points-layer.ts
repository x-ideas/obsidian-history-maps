import { App, Keymap, TFile } from "obsidian";
import { Map, Popup, MapLayerMouseEvent, GeoJSONSource } from "maplibre-gl";
import {
	createCompositeMarkerImage,
	getMarkerCompositeImageKey,
} from "../map/markers";
import { parseCoordinate, verifyLatLng } from "../map/utils";

const SOURCE_ID = "ohm-api-markers";
const LAYER_ID = "ohm-api-marker-pins";

export interface HistoryMapPoint {
	id?: string;
	/** Same data model as Bases map view: `[lat, lng]` array or `"lat,lng"` string. */
	coordinates: unknown;
	title?: string;
	/** Lucide icon id (same as Bases marker icon property), e.g. `"map-pin"`. */
	icon?: string;
	/** CSS color; defaults to `var(--bases-map-marker-background)`. */
	color?: string;
	/**
	 * When set, only points with this year (or no `year`) show for the active
	 * timeline year — same rule as Bases map marker filtering.
	 */
	year?: number | string | Date | { year?: number; toDate?: () => Date };
	properties?: Record<string, string | number | boolean | null | undefined>;
	/**
	 * If set (and no custom click handler on the layer), default click opens
	 * this note via {@link Workspace.openLinkText} (modifier opens in new leaf).
	 */
	file?: TFile;
	/** If set, used when {@link file} is absent; same open behavior as for files. */
	linkPath?: string;
}

export type HistoryMapPointClickHandler = (
	point: HistoryMapPoint,
	event: MapLayerMouseEvent,
) => void;

function coordinateFromHistoryMapPoint(
	coordinates: unknown,
): [number, number] | null {
	let lat: number | null = null;
	let lng: number | null = null;

	if (Array.isArray(coordinates) && coordinates.length >= 2) {
		lat = parseCoordinate(coordinates[0]);
		lng = parseCoordinate(coordinates[1]);
	} else if (typeof coordinates === "string") {
		const parts = coordinates.trim().split(",");
		if (parts.length >= 2) {
			lat = parseCoordinate(parts[0].trim());
			lng = parseCoordinate(parts[1].trim());
		}
	}

	if (lat != null && lng != null && verifyLatLng(lat, lng)) {
		return [lat, lng];
	}
	return null;
}

function filterPointsByTimelineYear(
	points: HistoryMapPoint[],
	timelineYear: number,
): HistoryMapPoint[] {
	const y = Math.trunc(Number.parseInt(String(timelineYear), 10));
	return points.filter((p) => {
		// When unset, keep points visible (same as Bases behavior).
		if (p.year == null) {
			return true;
		}

		let py: number | null = null;
		// Obsidian's DateTime is typically a Moment-like object with `.year()` or `.toDate()`.
		// We avoid importing moment types here; just duck-type the methods/fields we need.
		if (
			typeof p.year === "object" &&
			p.year != null &&
			"year" in p.year &&
			typeof (p.year as any).year === "number"
		) {
			py = Math.trunc((p.year as any).year);
		} else if (
			typeof p.year === "object" &&
			p.year != null &&
			"year" in p.year &&
			typeof (p.year as any).year === "function"
		) {
			const n = (p.year as any).year();
			py = typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : null;
		} else if (
			typeof p.year === "object" &&
			p.year != null &&
			"toDate" in p.year &&
			typeof (p.year as any).toDate === "function"
		) {
			const d = (p.year as any).toDate();
			if (d instanceof Date) py = d.getFullYear();
		} else if (p.year instanceof Date) {
			py = p.year.getFullYear();
		} else if (typeof p.year === "number") {
			py = Number.isFinite(p.year) ? Math.trunc(p.year) : null;
		} else if (typeof p.year === "string") {
			const s = p.year.trim();
			// Accept "2020" or "2020-01-01" etc.
			const m = s.match(/^(-?\d{1,4})/);
			if (m) {
				const n = Number.parseInt(m[1], 10);
				py = Number.isFinite(n) ? Math.trunc(n) : null;
			}
		}

		if (py == null) {
			return false;
		}
		return py === y;
	});
}

export class ApiPointsLayer {
	private loadedIcons = new Set<string>();
	private rawPoints: HistoryMapPoint[] = [];
	private visiblePoints: HistoryMapPoint[] = [];
	private visibleCoords: Array<[number, number]> = [];
	private popup: Popup | null = null;
	private handlersAttached = false;
	private mapForHandlers: Map | null = null;
	private hideTimer: number | null = null;

	constructor(
		private readonly app: App,
		private readonly onPointClick?: HistoryMapPointClickHandler,
	) {}

	private getPointIndex(e: MapLayerMouseEvent): number | null {
		const feature = e.features?.[0];
		const raw = feature?.properties?.pointIndex;
		if (typeof raw === "number" && Number.isFinite(raw)) {
			return raw;
		}
		if (typeof raw === "string") {
			const n = Number.parseInt(raw, 10);
			return Number.isFinite(n) ? n : null;
		}
		return null;
	}

	private getPoint(e: MapLayerMouseEvent): HistoryMapPoint | null {
		const feature = e.features?.[0];
		const idx = this.getPointIndex(e);
		if (idx == null || !this.visiblePoints[idx]) {
			return null;
		}
		return this.visiblePoints[idx];
	}

	private readonly onPinEnter = (e: MapLayerMouseEvent): void => {
		this.mapForHandlers?.getCanvas().style.setProperty("cursor", "pointer");
		const p = this.getPoint(e);
		const idx = this.getPointIndex(e);
		const coord = idx == null ? null : this.visibleCoords[idx];
		if (p && coord && this.mapForHandlers) {
			this.showPopup(this.mapForHandlers, p, coord);
		}
	};

	private readonly onPinLeave = (): void => {
		this.mapForHandlers?.getCanvas().style.removeProperty("cursor");
		const win = this.mapForHandlers?.getCanvas().ownerDocument.defaultView;
		if (this.hideTimer != null && win) {
			win.clearTimeout(this.hideTimer);
		}
		if (win) {
			this.hideTimer = win.setTimeout(() => {
				this.popup?.remove();
				this.hideTimer = null;
			}, 150);
		}
	};

	private readonly onPinClick = (e: MapLayerMouseEvent): void => {
		const p = this.getPoint(e);
		if (!p) return;

		if (this.onPointClick) {
			this.onPointClick(p, e);
		} else {
			const path = p.file?.path ?? p.linkPath;

			if (path) {
				const newLeaf = Boolean(
					e.originalEvent && Keymap.isModEvent(e.originalEvent),
				);
				void this.app.workspace.openLinkText(path, "", newLeaf);
			}
		}
	};

	private attachHandlers(map: Map): void {
		if (this.handlersAttached) return;
		this.handlersAttached = true;
		this.mapForHandlers = map;
		map.on("mouseenter", LAYER_ID, this.onPinEnter);
		map.on("mouseleave", LAYER_ID, this.onPinLeave);
		map.on("click", LAYER_ID, this.onPinClick);
	}

	private showPopup(
		map: Map,
		point: HistoryMapPoint,
		lngLat: [number, number],
	): void {
		if (this.hideTimer != null) {
			const win = map.getCanvas().ownerDocument.defaultView;
			if (win) win.clearTimeout(this.hideTimer);
			this.hideTimer = null;
		}
		if (!this.popup) {
			this.popup = new Popup({
				closeButton: false,
				closeOnClick: false,
				offset: 25,
			});
			this.popup.on("open", () => {
				const el = this.popup?.getElement();
				el?.addEventListener("mouseenter", () => {
					const w = map.getCanvas().ownerDocument.defaultView;
					if (w && this.hideTimer != null) {
						w.clearTimeout(this.hideTimer);
						this.hideTimer = null;
					}
				});
				el?.addEventListener("mouseleave", () => {
					this.onPinLeave();
				});
			});
		}
		const wrap = document.createElement("div");
		wrap.className = "bases-map-popup";
		const titleEl = document.createElement("div");
		titleEl.className = "bases-map-popup-title";
		const latLng = coordinateFromHistoryMapPoint(point.coordinates);
		const fallbackTitle = latLng
			? `${latLng[0].toFixed(4)}, ${latLng[1].toFixed(4)}`
			: String(point.coordinates);
		titleEl.textContent =
			point.title || point.file?.basename || point.id || fallbackTitle;
		wrap.appendChild(titleEl);

		const props = point.properties;
		if (props && Object.keys(props).length > 0) {
			const list = document.createElement("div");
			list.className = "bases-map-popup-properties";
			for (const [k, v] of Object.entries(props)) {
				if (v === undefined || v === null) continue;
				const row = document.createElement("div");
				row.className = "bases-map-popup-property";
				const lab = document.createElement("div");
				lab.className = "bases-map-popup-property-label";
				lab.textContent = k;
				const val = document.createElement("div");
				val.className = "bases-map-popup-property-value";
				val.textContent = String(v);
				row.appendChild(lab);
				row.appendChild(val);
				list.appendChild(row);
			}
			wrap.appendChild(list);
		}

		this.popup.setDOMContent(wrap).setLngLat(lngLat).addTo(map);
	}

	private async loadImages(map: Map, points: HistoryMapPoint[]): Promise<void> {
		const pending: Array<{ icon: string | null; color: string; key: string }> =
			[];
		const seen = new Set<string>();

		for (const p of points) {
			const icon = p.icon?.trim() || null;
			const color = p.color?.trim() || "var(--bases-map-marker-background)";
			const key = getMarkerCompositeImageKey(icon, color);
			if (this.loadedIcons.has(key) || seen.has(key)) continue;
			seen.add(key);
			pending.push({ icon, color, key });
		}

		for (const { icon, color, key } of pending) {
			try {
				const img = await createCompositeMarkerImage(icon, color);
				if (map.hasImage(key)) {
					map.removeImage(key);
				}
				map.addImage(key, img);
				this.loadedIcons.add(key);
			} catch (e) {
				console.warn("History maps API: marker image failed:", key, e);
			}
		}
	}

	private buildFeatures(points: HistoryMapPoint[]): GeoJSON.Feature[] {
		const normalized: Array<{ p: HistoryMapPoint; coord: [number, number] }> =
			[];
		for (const p of points) {
			const latLng = coordinateFromHistoryMapPoint(p.coordinates);
			if (!latLng) continue;
			normalized.push({ p, coord: [latLng[1], latLng[0]] }); // MapLibre GeoJSON uses [lng, lat]
		}

		this.visiblePoints = normalized.map((x) => x.p);
		this.visibleCoords = normalized.map((x) => x.coord);

		return normalized.map(({ p, coord }, i) => {
			const icon = p.icon?.trim() || null;
			const color = p.color?.trim() || "var(--bases-map-marker-background)";
			return {
				type: "Feature",
				geometry: {
					type: "Point",
					coordinates: coord,
				},
				properties: {
					pointIndex: i,
					icon: getMarkerCompositeImageKey(icon, color),
				},
			};
		});
	}

	private ensureSourceAndLayer(map: Map): void {
		if (map.getSource(SOURCE_ID)) {
			return;
		}

		map.addSource(SOURCE_ID, {
			type: "geojson",
			data: { type: "FeatureCollection", features: [] },
		});

		map.addLayer({
			id: LAYER_ID,
			type: "symbol",
			source: SOURCE_ID,
			maxzoom: 18,
			minzoom: 1,
			layout: {
				"icon-image": ["get", "icon"],
				"icon-size": [
					"interpolate",
					["linear"],
					["zoom"],
					0,
					0.12,
					4,
					0.18,
					14,
					0.22,
					18,
					0.24,
				],
				"icon-allow-overlap": true,
				"icon-ignore-placement": true,
				"icon-padding": 0,
			},
		});

		this.attachHandlers(map);
	}

	async setPoints(
		map: Map,
		points: HistoryMapPoint[],
		timelineYear: number,
	): Promise<void> {
		if (!map.getStyle()?.layers) {
			return;
		}

		this.rawPoints = points;
		const visible = filterPointsByTimelineYear(points, timelineYear);

		this.ensureSourceAndLayer(map);
		await this.loadImages(map, visible);

		const features = this.buildFeatures(visible);
		const src = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
		if (src) {
			src.setData({ type: "FeatureCollection", features });
		}
	}

	async refresh(map: Map, timelineYear: number): Promise<void> {
		return this.setPoints(map, this.rawPoints, timelineYear);
	}

	detach(map: Map): void {
		if (this.hideTimer != null) {
			const win = map.getCanvas().ownerDocument.defaultView;
			if (win) win.clearTimeout(this.hideTimer);
			this.hideTimer = null;
		}
		this.popup?.remove();
		this.popup = null;
		if (this.handlersAttached) {
			map.off("mouseenter", LAYER_ID, this.onPinEnter);
			map.off("mouseleave", LAYER_ID, this.onPinLeave);
			map.off("click", LAYER_ID, this.onPinClick);
			this.handlersAttached = false;
		}
		this.mapForHandlers = null;
		if (map.getLayer(LAYER_ID)) {
			map.removeLayer(LAYER_ID);
		}
		if (map.getSource(SOURCE_ID)) {
			map.removeSource(SOURCE_ID);
		}
		this.loadedIcons.clear();
		this.visiblePoints = [];
		this.rawPoints = [];
	}
}
