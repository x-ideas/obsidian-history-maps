/** Removes timeline DOM under `container` (Bases map / API embed cleanup). */
export function disposeMapTimeline(container: HTMLElement): void {
	container.querySelectorAll(".bases-map-timeline").forEach((el) => el.remove());
}
