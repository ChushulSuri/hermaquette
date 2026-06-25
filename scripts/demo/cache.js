/**
 * Artifact cache for demo recording insurance.
 * Caches STL/GLB/concept images/quotes from successful runs.
 * HONESTY: cached artifacts were produced by the real pipeline — not fabricated.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CACHE_DIR = path.join(__dirname, 'cache')

export function getCachePath(key) {
  return path.join(CACHE_DIR, key)
}

export function hasCache(key) {
  return fs.existsSync(getCachePath(key))
}

export function readCache(key) {
  const p = getCachePath(key)
  if (!fs.existsSync(p)) return null
  try {
    const content = fs.readFileSync(p, 'utf-8')
    return JSON.parse(content)
  } catch {
    return fs.readFileSync(p)  // binary (STL/GLB)
  }
}

export function writeCache(key, data) {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  const p = getCachePath(key)
  if (typeof data === 'string' || data instanceof Buffer) {
    fs.writeFileSync(p, data)
  } else {
    fs.writeFileSync(p, JSON.stringify(data, null, 2))
  }
  console.log(`[cache] Written: ${key}`)
}

export function clearCache() {
  if (fs.existsSync(CACHE_DIR)) {
    fs.rmSync(CACHE_DIR, { recursive: true })
    fs.mkdirSync(CACHE_DIR)
    console.log('[cache] Cleared')
  }
}

export function listCache() {
  if (!fs.existsSync(CACHE_DIR)) return []
  return fs.readdirSync(CACHE_DIR).map(f => ({
    key: f,
    size: fs.statSync(path.join(CACHE_DIR, f)).size,
    mtime: fs.statSync(path.join(CACHE_DIR, f)).mtime,
  }))
}
