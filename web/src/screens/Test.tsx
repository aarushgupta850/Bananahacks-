// The test: the user copies the reference on their own, before any teaching.
import type { NavProps } from './PlaceholderScreen'
import SoloDrawing from './SoloDrawing'

export default function Test(props: NavProps) {
  return <SoloDrawing round="test" {...props} />
}
