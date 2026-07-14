import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type PropertyViewMode = 'grid' | 'list';
export type LeadsViewMode = 'kanban' | 'table';

interface UiState {
  propertyView: PropertyViewMode;
  setPropertyView: (mode: PropertyViewMode) => void;
  leadsView: LeadsViewMode;
  setLeadsView: (mode: LeadsViewMode) => void;
}

/** Client-only UI preferences, persisted to localStorage. */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      propertyView: 'grid',
      setPropertyView: (propertyView) => set({ propertyView }),
      leadsView: 'kanban',
      setLeadsView: (leadsView) => set({ leadsView }),
    }),
    { name: 'io-ui-prefs' },
  ),
);
