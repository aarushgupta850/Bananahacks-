// The time-limit choice for the solo rounds, shown on the Reference screen before the test.
// Native radio inputs inside a fieldset give a labelled group that works with arrow keys, screen readers and
// touch for free; they are styled as pills. "Custom" reveals a number field (10-600 seconds).
import { useState } from 'react'
import {
  choiceLabel, CUSTOM_MAX_SECONDS, CUSTOM_MIN_SECONDS, parseCustomSeconds, PRESET_SECONDS, withinPhrase,
} from './timeLimit'

interface TimeLimitPickerProps {
  value: number | null                                // the current limit in seconds; null = no limit
  onChange: (seconds: number | null) => void          // called with every valid choice
  onValidityChange: (valid: boolean) => void          // false while a custom value is being typed and isn't valid
  locked?: boolean                                    // true once the test is done: the retest must use the same limit
}

export default function TimeLimitPicker({ value, onChange, onValidityChange, locked = false }: TimeLimitPickerProps) {
  // A value that isn't one of the presets (from an earlier custom choice) starts with Custom selected.
  const [custom, setCustom] = useState(() => !PRESET_SECONDS.includes(value))
  const [customText, setCustomText] = useState(() => (value !== null && !PRESET_SECONDS.includes(value) ? String(value) : ''))
  const customValid = parseCustomSeconds(customText) !== null

  function pickPreset(seconds: number | null) {
    setCustom(false)
    onChange(seconds)
    onValidityChange(true)
  }

  function pickCustom() {
    setCustom(true)
    const parsed = parseCustomSeconds(customText)
    if (parsed !== null) onChange(parsed)
    onValidityChange(parsed !== null)
  }

  function typeCustom(text: string) {
    setCustomText(text)
    const parsed = parseCustomSeconds(text)
    if (parsed !== null) onChange(parsed)
    onValidityChange(parsed !== null)
  }

  return (
    <fieldset className="time-picker" disabled={locked}>
      <legend>How much time do you get?</legend>
      {/* One row of choices, like the difficulty buttons. The radios are hidden but still there for the keyboard
          (arrow keys) and screen readers; the chosen one is filled dark AND bold, never shown by color alone. */}
      <div className="time-options">
        {PRESET_SECONDS.map((seconds) => (
          <label key={String(seconds)} className={!custom && value === seconds ? 'time-option is-active' : 'time-option'}>
            <input type="radio" name="solo-time" checked={!custom && value === seconds} onChange={() => pickPreset(seconds)} />
            {shortLabel(seconds)}
          </label>
        ))}
        <label className={custom ? 'time-option is-active' : 'time-option'}>
          <input type="radio" name="solo-time" checked={custom} onChange={pickCustom} />
          Custom
        </label>
      </div>
      {custom && (
        <div className="time-custom">
          {/* A plain text field (no browser spinner) with "seconds" written inside it. */}
          <span className={customText !== '' && !customValid ? 'time-custom-field is-problem' : 'time-custom-field'}>
            <input
              id="custom-seconds"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={3}
              value={customText}
              placeholder="90"
              aria-label={`Seconds, from ${CUSTOM_MIN_SECONDS} to ${CUSTOM_MAX_SECONDS}`}
              aria-invalid={customText !== '' && !customValid}
              aria-describedby="custom-seconds-hint"
              onChange={(e) => typeCustom(e.target.value)}
            />
            <span aria-hidden="true">seconds</span>
          </span>
          <span id="custom-seconds-hint" className={customText !== '' && !customValid ? 'time-hint is-problem' : 'time-hint'} role="status">
            {customText !== '' && !customValid ? `Pick a whole number from ${CUSTOM_MIN_SECONDS} to ${CUSTOM_MAX_SECONDS}.` : `${CUSTOM_MIN_SECONDS} to ${CUSTOM_MAX_SECONDS} seconds`}
          </span>
        </div>
      )}
      {/* What the choice means, in words, for both rounds. */}
      <p className="time-summary">
        {locked
          ? 'Locked: your retest gets the same time as your test, so it stays fair.'
          : custom && !customValid
            ? 'Type how many seconds you want.'
            : value === null
              ? 'No clock: take as long as you like, in the test and the retest.'
              : `You copy it ${withinPhrase(value)}, and get the same time again in the retest.`}
      </p>
    </fieldset>
  )
}

// Short words for the buttons: "30 s", "1 min", "No limit".
const shortLabel = (seconds: number | null) => (seconds === null ? 'No limit' : choiceLabel(seconds))
