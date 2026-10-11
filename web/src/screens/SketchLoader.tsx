// A loading animation of lines sketching themselves (used while live AI makes a lesson).
// Under prefers-reduced-motion the lines are simply shown, with the text doing the work.
export default function SketchLoader({ text }: { text: string }) {
  return (
    <div className="sketch-loader" role="status">
      <svg viewBox="0 0 120 80" aria-hidden="true">
        <path pathLength={1} d="M20 60 Q40 15 60 40 T100 25" />
        <path pathLength={1} d="M25 68 L95 68" />
        <circle pathLength={1} cx="60" cy="40" r="14" />
      </svg>
      <p>{text}</p>
    </div>
  )
}
