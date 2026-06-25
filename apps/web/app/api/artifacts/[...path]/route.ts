import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function GET(
  req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const artifactsDir = process.env.ARTIFACTS_DIR || '/artifacts'
  const filePath = path.join(artifactsDir, ...params.path)

  // Security: prevent path traversal
  const resolvedPath = path.resolve(filePath)
  const resolvedArtifacts = path.resolve(artifactsDir)
  if (!resolvedPath.startsWith(resolvedArtifacts)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  if (!fs.existsSync(resolvedPath)) {
    return new NextResponse('Not found', { status: 404 })
  }

  const ext = path.extname(resolvedPath).toLowerCase()
  const contentType =
    ext === '.glb' ? 'model/gltf-binary' :
    ext === '.stl' ? 'model/stl' :
    'application/octet-stream'

  const buffer = fs.readFileSync(resolvedPath)
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
