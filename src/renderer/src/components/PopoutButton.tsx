import type { JSX } from 'react'
import { appStore } from '../appStore'
import type { PopoutView } from '../store'

const NAMES: Record<PopoutView, string> = { editor: 'Editor', graphs: 'Graphs' }

/** The small button at the end of a tab bar: moves the view into its own window, or back. */
export function PopoutButton({ view, popped }: { view: PopoutView; popped: boolean }): JSX.Element {
  const title = popped ? `Dock ${NAMES[view]} (back into the main window)` : `Pop Out ${NAMES[view]} (into its own window)`
  return (
    <button className="popout-btn" title={title} aria-label={title} onClick={() => appStore.getState().setPopout(view, !popped)}>
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        {popped ? (
          <path d="M9 2h5v5M14 2 8 8M7 3H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9" fill="none" stroke="currentColor" strokeWidth="1.4" transform="rotate(180 8 8)" />
        ) : (
          <path d="M9 2h5v5M14 2 8 8M7 3H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9" fill="none" stroke="currentColor" strokeWidth="1.4" />
        )}
      </svg>
    </button>
  )
}
