// How DrawingCanvas reaches the ZoomStack around it (a separate file so ZoomStack.tsx only exports a component).
import { createContext, useContext } from 'react'
import type { PinchStart } from './zoom'

export interface ZoomControls {
  // Called with the two fingers' screen positions (clientX, clientY).
  startPinch(a: [number, number], b: [number, number]): PinchStart
  movePinch(start: PinchStart, a: [number, number], b: [number, number]): void
}

export const ZoomContext = createContext<ZoomControls | null>(null)

// The zoom controls of the ZoomStack around a canvas, or null when it isn't in one (the report's small drawings).
export function useZoom(): ZoomControls | null {
  return useContext(ZoomContext)
}
