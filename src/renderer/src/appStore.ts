import { useStore } from 'zustand'
import { createAppStore, type AppState } from './store'

export const appStore = createAppStore(window.labsim)

/** Select a slice of app state. Return primitives or existing references only (zustand 5 re-renders on new objects). */
export function useApp<T>(selector: (s: AppState) => T): T {
  return useStore(appStore, selector)
}
