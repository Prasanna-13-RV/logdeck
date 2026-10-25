import type { LogRow, SearchFilters } from '../../shared/contracts'

type RecordFields = Pick<LogRow, 'raw' | 'time' | 'pid' | 'tid' | 'level' | 'tag' | 'message'> &
  Partial<Pick<LogRow, 'line' | 'applicationId' | 'processName'>>
type Predicate = (row: RecordFields) => boolean
interface Token { value: string; kind: 'word' | 'literal' | 'symbol' }
const fields = new Set(['raw', 'time', 'pid', 'tid', 'level', 'tag', 'message', 'app', 'process', 'line'])

export function literalHighlightSpans(text: string, terms: string[], caseSensitive: boolean) {
  const haystack = caseSensitive ? text : text.toLowerCase()
  const offsets: { start: number; end: number }[] = []
  if (haystack.length !== text.length) {
    let offset = 0
    for (const char of text) {
      for (let i = 0; i < char.toLowerCase().length; i++) offsets.push({ start: offset, end: offset + char.length })
      offset += char.length
    }
  }
  const spans: { start: number; end: number }[] = []
  for (const term of terms) {
    if (!term) continue
    const needle = caseSensitive ? term : term.toLowerCase()
    let found = haystack.indexOf(needle)
    while (found >= 0 && spans.length < 400) {
      spans.push({ start: offsets[found]?.start ?? found, end: offsets[found + needle.length - 1]?.end ?? found + needle.length })
      found = haystack.indexOf(needle, found + needle.length)
    }
    if (spans.length >= 400) break
  }
  return spans.sort((a, b) => a.start - b.start || a.end - b.end)
}

function tokenize(query: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < query.length) {
    if (/\s/.test(query[i])) { i++; continue }
    if ('():'.includes(query[i])) { tokens.push({ value: query[i++], kind: 'symbol' }); continue }
    if (query[i] === '"') {
      i++
      let value = ''
      let closed = false
      while (i < query.length) {
        const char = query[i++]
        if (char === '"') { closed = true; break }
        if (char === '\\') {
          const escaped = query[i++]
          if (escaped !== '"' && escaped !== '\\') throw new Error('Quoted text supports only \\" and \\\\ escapes.')
          value += escaped
        } else value += char
      }
      if (!closed || !value) throw new Error('A quoted phrase must be nonempty and closed.')
      tokens.push({ value, kind: 'literal' })
    } else {
      const start = i
      while (i < query.length && !/[\s():"]/.test(query[i])) i++
      tokens.push({ value: query.slice(start, i), kind: 'word' })
    }
    if (tokens.length > 256) throw new Error('The query is too complex (maximum 256 tokens).')
  }
  if (tokens.length > 256) throw new Error('The query is too complex (maximum 256 tokens).')
  return tokens
}

export function compileQuery(query: string, caseSensitive: boolean, collect?: (field: string, value: string, negated: boolean) => void): Predicate {
  if (query.length > 2000) throw new Error('Queries are limited to 2,000 characters.')
  const tokens = tokenize(query)
  let at = 0
  const is = (value: string) => tokens[at]?.value === value && tokens[at]?.kind !== 'literal'
  const normalized = (value: string) => caseSensitive ? value : value.toLowerCase()
  function atom(depth: number, negated: boolean): Predicate {
    if (depth > 32) throw new Error('Query nesting exceeds 32 levels.')
    if (is('NOT')) { at++; const next = atom(depth + 1, !negated); return row => !next(row) }
    if (tokens[at]?.kind === 'word' && tokens[at].value.startsWith('-') && tokens[at].value.length > 1 && tokens[at + 1]?.value === ':') {
      tokens[at] = { ...tokens[at], value: tokens[at].value.slice(1) }
      const next = atom(depth + 1, !negated)
      return row => !next(row)
    }
    if (is('(')) {
      at++
      const nested = or(depth + 1, negated)
      if (!is(')')) throw new Error('Missing closing parenthesis.')
      at++
      return nested
    }
    let token = tokens[at++]
    if (!token || token.kind === 'symbol' || (token.kind === 'word' && ['AND', 'OR'].includes(token.value))) {
      throw new Error('Expected text, a field value, or a parenthesized expression.')
    }
    let field = 'raw'
    if (is(':')) {
      field = token.value
      if (token.kind !== 'word' || !fields.has(field)) throw new Error(`Unknown query field: ${field}.`)
      at++
      token = tokens[at++]
      if (!token || token.kind === 'symbol' || (token.kind === 'word' && ['AND', 'OR', 'NOT'].includes(token.value))) {
        throw new Error(`Missing value for ${field}. Quote literal operators.`)
      }
    }
    collect?.(field, token.value, negated)
    const needle = normalized(token.value)
    return row => {
      const value = field === 'app' ? row.applicationId : field === 'process' ? row.processName :
        field === 'line' ? String(row.line) : row[field as keyof RecordFields]
      const haystack = normalized(String(value ?? ''))
      return ['pid', 'tid', 'level', 'line'].includes(field) ? haystack === needle : haystack.includes(needle)
    }
  }
  function and(depth: number, negated: boolean): Predicate {
    let result = atom(depth, negated)
    while (at < tokens.length && !is('OR') && !is(')')) {
      if (is('AND')) at++
      const left = result
      const right = atom(depth, negated)
      result = row => left(row) && right(row)
    }
    return result
  }
  function or(depth: number, negated: boolean): Predicate {
    let result = and(depth, negated)
    while (is('OR')) {
      at++
      const left = result
      const right = and(depth, negated)
      result = row => left(row) || right(row)
    }
    return result
  }
  if (!tokens.length) return () => true
  const result = or(0, false)
  if (at !== tokens.length) throw new Error('Unexpected query token.')
  return result
}

export function queryHighlights(query: string) {
  const terms: { field: string; value: string }[] = []
  compileQuery(query, false, (field, value, negated) => { if (!negated) terms.push({ field, value }) })
  return terms
}

export function matchesFilters(row: RecordFields, filters: SearchFilters, caseSensitive: boolean): boolean {
  const normalize = (text: string) => caseSensitive ? text : text.toLowerCase()
  if (filters.levels?.length && !filters.levels.includes(row.level)) return false
  if (filters.pid && filters.pid !== row.pid || filters.tid && filters.tid !== row.tid) return false
  if (filters.tag && !normalize(row.tag).includes(normalize(filters.tag))) return false
  if (filters.application && !normalize(row.applicationId ?? '').includes(normalize(filters.application))) return false
  if (filters.include && !normalize(row.raw).includes(normalize(filters.include))) return false
  if (filters.exclude && normalize(row.raw).includes(normalize(filters.exclude))) return false
  if ((filters.from || filters.to) && !row.time) return false
  if (filters.from && row.time < filters.from || filters.to && row.time > filters.to) return false
  return true
}
