import { useStore } from 'zustand'
import { createDebugStore, type DebugState } from './debugStore'
import { createGraphStore, type GraphState, type KeyValueStorage } from './graphStore'
import { createAppStore, type AppState } from './store'

export const appStore = createAppStore(window.labsim)
export const debugStore = createDebugStore(window.labsim, appStore)

/** localStorage, or null where it is unavailable (the graphs then forget their properties). */
function localStore(): KeyValueStorage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export const graphStore = createGraphStore(window.labsim, appStore, debugStore, localStore())

/** Select a slice of app state. Return primitives or existing references only (zustand 5 re-renders on new objects). */
export function useApp<T>(selector: (s: AppState) => T): T {
  return useStore(appStore, selector)
}

/** Select a slice of the debug session state (same rule as useApp). */
export function useDebug<T>(selector: (s: DebugState) => T): T {
  return useStore(debugStore, selector)
}

/** Select a slice of the graphs' state (same rule as useApp). */
export function useGraphs<T>(selector: (s: GraphState) => T): T {
  return useStore(graphStore, selector)
}
