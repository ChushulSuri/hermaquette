export function validateEnv() {
  const required = ['SQLITE_PATH', 'DEMO_TOKEN', 'PUBLIC_BASE_URL'] as const
  const missing = required.filter(k => !process.env[k])
  if (missing.length > 0) {
    throw new Error(`[hermaquette] Missing required env vars: ${missing.join(', ')}`)
  }
}
