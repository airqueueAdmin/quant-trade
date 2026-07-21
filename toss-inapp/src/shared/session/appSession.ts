const SESSION_STORAGE_KEY = 'quant.toss_inapp.app_session'

export type AppSession = {
  accountId: string
  sessionToken: string
  identitySource?: 'toss_user' | 'device'
}

function isValidSession(value: unknown): value is AppSession {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.accountId === 'string' &&
    candidate.accountId.length >= 3 &&
    typeof candidate.sessionToken === 'string' &&
    candidate.sessionToken.length >= 10 &&
    (candidate.identitySource === undefined ||
      candidate.identitySource === 'toss_user' ||
      candidate.identitySource === 'device')
  )
}

export function readStoredSession() {
  if (typeof window === 'undefined') {
    return null
  }

  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY)
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    return isValidSession(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function writeStoredSession(session: AppSession) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
  }
}

export function clearStoredSession() {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(SESSION_STORAGE_KEY)
  }
}
