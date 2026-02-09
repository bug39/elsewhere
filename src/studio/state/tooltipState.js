import { signal } from '@preact/signals'

/**
 * Global tooltip dismiss counter.
 * Incrementing this value causes all open tooltips to hide.
 * Using a counter (not boolean) avoids stale closure issues.
 */
export const tooltipDismissCounter = signal(0)

/**
 * Dismiss all open tooltips.
 * Call this when opening modals or dialogs.
 */
export function dismissAllTooltips() {
  tooltipDismissCounter.value++
}
