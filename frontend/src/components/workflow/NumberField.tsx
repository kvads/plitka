import { useEffect, useId, useRef, useState } from "react";
export default function NumberField({
  label,
  value,
  raw,
  onCommit,
  min = -100000,
  max = 100000,
  unit = "мм",
  disabled = false,
  commitUnchanged = false,
}: {
  label: string;
  value: number;
  raw?: string;
  onCommit: (n: number | null, text: string) => void;
  min?: number;
  max?: number;
  unit?: string;
  disabled?: boolean;
  commitUnchanged?: boolean;
}) {
  const [text, setText] = useState(raw ?? String(value));
  const id = useId();
  const skipBlur = useRef(false);
  useEffect(() => setText(raw ?? String(value)), [value, raw]);
  const n = Number(text.replace(",", "."));
  const extraPrecision = /^\s*[+-]?\d+(?:[.,]\d{2,})\s*$/.test(text);
  const invalid = !text.trim() || !Number.isFinite(n) || n < min || n > max || extraPrecision;
  const commit = (force = false) => {
    if (!force && text === (raw ?? String(value))) return;
    if (extraPrecision) return;
    onCommit(text.trim() && Number.isFinite(n) ? n : null, text);
  };
  return (
    <label className="field">
      <span>{label}</span>
      <div>
        <input
          id={id}
          aria-label={label}
          inputMode="decimal"
          maxLength={100}
          value={text}
          disabled={disabled}
          aria-invalid={invalid}
          aria-describedby={invalid ? id + "-error" : undefined}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            if (skipBlur.current) {
              skipBlur.current = false;
              return;
            }
            commit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(commitUnchanged);
              skipBlur.current = true;
              e.currentTarget.blur();
            }
          }}
        />
        <small>{unit}</small>
      </div>
      {invalid && (
        <small id={id + "-error"} className="field-error">
          {extraPrecision ? "Допустим не более одного знака после запятой" : `Введите число от ${min} до ${max} ${unit}`}
        </small>
      )}
    </label>
  );
}
