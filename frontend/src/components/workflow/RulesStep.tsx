import type { ProjectDocument } from "../../domain/project/schema";
import NumberField from "./NumberField";
export default function RulesStep({
  doc,
  onField,
  busy,
  ready,
  onSearch,
}: {
  doc: ProjectDocument;
  onField: (
    group: "material" | "rules",
    key: string,
    n: number | null,
    text: string,
  ) => void;
  busy: boolean;
  ready: boolean;
  onSearch: () => void;
}) {
  return (
    <div className="form-stage">
      <p>Отступы и направление плитки не меняют размеры помещения.</p>
      {(["gap", "threshold", "angle"] as const).map((k, i) => (
        <NumberField
          key={k}
          label={
            [
              "Отступ от стен",
              "Минимальная ширина детали",
              "Угол сетки плитки",
            ][i]
          }
          value={doc.rules[k]}
          raw={doc.fieldInputs["rules." + k]}
          min={i === 1 ? 1 : 0}
          max={[100, 1000, 89.9][i]}
          unit={i === 2 ? "°" : "мм"}
          onCommit={(n, t) => onField("rules", k, n, t)}
        />
      ))}
      <button className="dark" disabled={busy || !ready} onClick={onSearch}>
        {busy ? "Подбираем…" : "Подобрать раскладку"}
      </button>
      <p className="muted">
        Допустимость отступа проверяется при подборе. Расход — без повторного
        использования обрезков.
      </p>
    </div>
  );
}
