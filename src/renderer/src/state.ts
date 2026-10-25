import { create } from 'zustand'
import type { Theme } from '../../../shared/contracts'

interface WorkspaceState {
  theme: Theme
  setTheme: (theme: Theme) => void
}

export const useWorkspace = create<WorkspaceState>(set => ({
  theme: 'system',
  setTheme: theme => set({ theme })
}))
