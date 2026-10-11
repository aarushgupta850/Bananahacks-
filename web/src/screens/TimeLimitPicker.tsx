// The time-limit choice for the solo rounds, shown on the Reference screen before the test.
// Native radio inputs inside a fieldset give a labelled group that works with arrow keys, screen readers and
// touch for free; they are styled as pills. "Custom" reveals a number field (10-600 seconds).
import { useState } from 'react'
import {
  choiceLabel, CUSTOM_MAX_SECONDS, CUSTOM_MIN_SECONDS, parseCustomSeconds, PRESET_SECONDS,
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
      <legend>Time for the test and the retest</legend>
      <div className="time-options">
        {PRESET_SECONDS.map((seconds) => (
          <label key={String(seconds)} className={!custom && value === seconds ? 'time-option is-active' : 'time-option'}>
            <input type="radio" name="solo-time" checked={!custom && value === seconds} onChange={() => pickPreset(seconds)} />
            {choiceLabel(seconds)}
          </label>
        ))}
        <label className={custom ? 'time-option is-active' : 'time-option'}>
          <input type="radio" name="solo-time" checked={custom} onChange={pickCustom} />
          Custom
        </label>
      </div>
      {custom && (
        <div className="time-custom">
          <label htmlFor="custom-seconds">Seconds ({CUSTOM_MIN_SECONDS}–{CUSTOM_MAX_SECONDS})</label>
          <input
            id="custom-seconds"
            type="number"
            inputMode="numeric"
            min={CUSTOM_MIN_SECONDS}
            max={CUSTOM_MAX_SECONDS}
            step={1}
            value={customText}
            placeholder="90"
            aria-invalid={customText !== '' && !customValid}
            aria-describedby="custom-seconds-hint"
            onChange={(e) => typeCustom(e.target.value)}
          />
          <span id="custom-seconds-hint" className={customText !== '' && !customValid ? 'time-hint is-problem' : 'time-hint'} role="status">
            {customText === '' ? 'Type a number of seconds.'
              : customValid ? 'Looks good.' : `Pick a whole number from ${CUSTOM_MIN_SECONDS} to ${CUSTOM_MAX_SECONDS}.`}
          </span>
        </div>
      )}
      {locked && <p className="time-hint">Locked after the test, so your retest gets the same time.</p>}
    </fieldset>
  )
}
