import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type PropertyViewMode = 'grid' | 'list';

interface UiState {
  propertyView: PropertyViewMode;
  setPropertyView: (mode: PropertyViewMode) => void;
}

/** Client-only UI preferences, persisted to localStorage. */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      propertyView: 'grid',
      setPropertyView: (propertyView) => set({ propertyView }),
    }),
    { name: 'io-ui-prefs' },
  ),
);
