// The retest: the same solo round as the test, after the lesson, so the two can be compared.
import type { NavProps } from './PlaceholderScreen'
import SoloDrawing from './SoloDrawing'

export default function Retest(props: NavProps) {
  return <SoloDrawing round="retest" {...props} />
}
