export function companyFeaturesEnabled(value: unknown): boolean {
  if (value === undefined || value === '' || value === 'false') return false
  if (value === 'true') return true
  throw new Error('VITE_ENABLE_COMPANY_TAGS must be true or false.')
}

export const logdeckTagline = { first: 'Your logs.', second: 'One powerful deck.' }
export const officialWebsiteUrl = 'https://logdeck.netlify.app'
