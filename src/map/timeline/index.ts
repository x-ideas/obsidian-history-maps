/** Removes timeline DOM under `container` (Bases map / API embed cleanup). */
export function disposeMapTimeline(container: HTMLElement): void {
	for (const el of container.querySelectorAll(".bases-map-timeline")) {
		el.remove();
	}
}
