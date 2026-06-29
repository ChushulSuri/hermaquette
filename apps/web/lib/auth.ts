import { cookies } from 'next/headers'
import { NextRequest } from 'next/server'
import crypto from 'crypto'

const COOKIE_NAME = 'hm_access_code'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7 // 7 days

function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

export function getAccessCode(): string | undefined {
  return process.env.ACCESS_CODE
}

export async function hasValidAccessCookie(req: NextRequest): Promise<boolean> {
  const accessCode = getAccessCode()
  // Fail CLOSED: if ACCESS_CODE is unset, deny (plan U1 / D5). A missing env var
  // must not silently disable the only budget gate. ACCESS_CODE must be set in prod.
  if (!accessCode) {
    console.warn('[auth] ACCESS_CODE not set — denying order creation (fail-closed)')
    return false
  }

  const cookieStore = await cookies()
  const cookieVal = cookieStore.get(COOKIE_NAME)?.value
  if (!cookieVal) return false

  // The cookie stores a constant-time-safe hash, not the raw code
  return constantTimeCompare(cookieVal, hashAccessCode(accessCode))
}

export function hashAccessCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex')
}

export function makeAccessCookie(code: string): string {
  return `${COOKIE_NAME}=${hashAccessCode(code)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`
}

export function clearAccessCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}
