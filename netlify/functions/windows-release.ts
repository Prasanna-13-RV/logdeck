import { latestGithubRelease } from '../../shared/githubRelease'

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })
  try {
    const manifest = await latestGithubRelease()
    return new Response(request.method === 'HEAD' ? null : JSON.stringify(manifest), { headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
      'Netlify-CDN-Cache-Control': 'public, s-maxage=300',
      'X-Content-Type-Options': 'nosniff'
    } })
  } catch (error) {
    console.error('Public release metadata unavailable:', error)
    return new Response(JSON.stringify({ error: 'No verified GitHub release is available right now. Please try again later.' }), {
      status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': '60' }
    })
  }
}
