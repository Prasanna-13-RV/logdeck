import { publicRelease } from '../../shared/publicRelease'

export default async (request: Request): Promise<Response> => {
  const response = await publicRelease(request)
  if (response.ok) response.headers.set('Netlify-CDN-Cache-Control', 'public, s-maxage=300')
  return response
}
