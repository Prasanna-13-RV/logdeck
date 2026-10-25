import { useEffect, useState } from 'react'
import type { SearchFilters } from '../../../shared/contracts'

export const columnIds = ['line', 'time', 'pid', 'tid', 'level', 'tag', 'message'] as const
export type ColumnId = typeof columnIds[number]
export interface Column { id: ColumnId; width: number; visible: boolean }
export const defaultColumns: Column[] = columnIds.map((id, index) => ({ id, width: [64, 245, 60, 60, 55, 150, 650][index], visible: true }))
export interface Preset { id: string; name: string; query: string; filters: SearchFilters; caseSensitive: boolean; mode: 'expression' | 'regex' }
export interface DisplaySettings { fontSize: number; defaultWrap: boolean }
export type SeverityStyle = 'background' | 'text'
export function validSeverityStyle(value: unknown): value is SeverityStyle { return value === 'background' || value === 'text' }

export function validColumns(value: unknown): value is Column[] {
  return Array.isArray(value) && value.length === 7 && new Set(value.map(item => item?.id)).size === 7 &&
    value.every(item => item && columnIds.includes(item.id) && Number.isInteger(item.width) && item.width >= 40 && item.width <= 4000 && typeof item.visible === 'boolean') &&
    value.some(item => item.id === 'message' && item.visible)
}
export function validPresets(value: unknown): value is Preset[] {
  return Array.isArray(value) && value.length <= 50 && new Set(value.map(item => item?.id)).size === value.length &&
    value.every(item => item && typeof item.id === 'string' && item.id.length <= 100 &&
      typeof item.name === 'string' && item.name.trim().length > 0 && item.name.length <= 80 &&
      typeof item.query === 'string' && item.query.length <= 2000 && typeof item.caseSensitive === 'boolean' &&
      ['expression', 'regex'].includes(item.mode) && item.filters && typeof item.filters === 'object' &&
      !Array.isArray(item.filters) && Object.entries(item.filters).every(([key, field]) =>
        key === 'levels' ? Array.isArray(field) && field.length <= 7 && field.every(level => ['V', 'D', 'I', 'W', 'E', 'F', 'A'].includes(level)) :
          ['tag', 'pid', 'tid', 'application', 'include', 'exclude', 'from', 'to'].includes(key) && typeof field === 'string' && field.length <= 256))
}
export function validDisplay(value: unknown): value is DisplaySettings {
  return typeof value === 'object' && value !== null && 'fontSize' in value && 'defaultWrap' in value &&
    Number.isInteger(value.fontSize) && Number(value.fontSize) >= 10 && Number(value.fontSize) <= 18 && typeof value.defaultWrap === 'boolean'
}

export function usePreference<T>(key: string, fallback: T, valid: (value: unknown) => value is T, onError: (message: string) => void) {
  const [value, setValue] = useState(fallback)
  useEffect(() => {
    const read = () => {
      try {
        const raw = localStorage.getItem(key)
        if (raw === null) { setValue(fallback); return }
        const parsed: unknown = JSON.parse(raw)
        if (!valid(parsed)) throw new Error('Stored value has an unsupported format.')
        setValue(parsed)
      } catch (error) { onError(`Could not load ${key}: ${String(error)}. Defaults remain available.`) }
    }
    read()
    const storage = (event: StorageEvent) => { if (event.key === key || event.key === null) read() }
    window.addEventListener('storage', storage)
    window.addEventListener(key, read)
    return () => { window.removeEventListener('storage', storage); window.removeEventListener(key, read) }
  }, [key])
  const update = (next: T) => {
    try {
      if (!valid(next)) throw new Error('Invalid preference.')
      localStorage.setItem(key, JSON.stringify(next))
      setValue(next)
      window.dispatchEvent(new Event(key))
      return true
    } catch (error) { onError(`Could not save ${key}: ${String(error)}`); return false }
  }
  return [value, update] as const
}
