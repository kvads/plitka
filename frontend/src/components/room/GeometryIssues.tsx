import type { ValidationResult } from "../../domain/room/types";
export default function GeometryIssues({
  validation,
  onSelect,
}: {
  validation: ValidationResult | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="geometry-issues" aria-live="polite">
      {validation?.issues.map((x, i) => (
        <button
          key={i}
          className="issue"
          onClick={() => onSelect(x.wallIds[0] || "")}
        >
          ⚠ {x.message}
          {x.actual !== undefined &&
            ` (${x.actual.toFixed(1)} вместо ${x.expected})`}
        </button>
      ))}
    </div>
  );
}
