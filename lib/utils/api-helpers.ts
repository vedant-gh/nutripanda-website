import { NextResponse } from 'next/server'

// Standard error response
export function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

// Standard success response
export function successResponse(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

// CORS headers for admin API routes (dashboard is a separate app)
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3003',
  process.env.ADMIN_DASHBOARD_URL,
].filter(Boolean) as string[]

export function corsHeaders(request: Request) {
  const origin = request.headers.get('origin') ?? ''
  const isAllowed = ALLOWED_ORIGINS.includes(origin)

  return {
    ...(isAllowed ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  }
}

export function handleCors(request: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request),
  })
}

// Wrap a NextResponse with CORS headers
export function withCors(response: NextResponse, request: Request) {
  const headers = corsHeaders(request)
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value)
  }
  const vary = new Set(
    (response.headers.get('Vary') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  )
  vary.add('Origin')
  response.headers.set('Vary', Array.from(vary).join(', '))
  if (!response.headers.has('Cache-Control')) {
    response.headers.set('Cache-Control', 'private, no-store')
  }
  return response
}
