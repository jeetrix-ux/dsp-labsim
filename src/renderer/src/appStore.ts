import { useStore } from 'zustand'
import { createDebugStore, type DebugState } from './debugStore'
import { createAppStore, type AppState } from './store'

export const appStore = createAppStore(window.labsim)
export const debugStore = createDebugStore(window.labsim, appStore)

/** Select a slice of app state. Return primitives or existing references only (zustand 5 re-renders on new objects). */
export function useApp<T>(selector: (s: AppState) => T): T {
  return useStore(appStore, selector)
}

/** Select a slice of the debug session state (same rule as useApp). */
export function useDebug<T>(selector: (s: DebugState) => T): T {
  return useStore(debugStore, selector)
}
