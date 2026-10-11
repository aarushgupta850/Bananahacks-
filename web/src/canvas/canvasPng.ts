// The user's drawing as a PNG (768 x 768, black ink on white), for the live server's "Happy accidents".
// The strokes are drawn with the same ink shapes as the canvas (strokeToPath), so the AI sees what the user saw.
import type { UserStroke } from '../engine/types'
import { PEN_SIZES, strokeToPath, TARGET_SIZE } from './geometry'

// Base64 PNG without the "data:image/png;base64," prefix (what the server expects).
export function strokesToPngBase64(strokes: UserStroke[]): string {
  const canvas = document.createElement('canvas')
  canvas.width = TARGET_SIZE
  canvas.height = TARGET_SIZE
  const context = canvas.getContext('2d')
  if (!context) return ''
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, TARGET_SIZE, TARGET_SIZE)
  context.fillStyle = '#000000'
  for (const stroke of strokes) {
    const path = strokeToPath(stroke.points, true, PEN_SIZES.medium)
    if (path) context.fill(new Path2D(path))
  }
  return canvas.toDataURL('image/png').replace(/^data:[^,]*,/, '')
}
