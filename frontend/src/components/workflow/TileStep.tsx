import type { ProjectDocument } from "../../domain/project/schema";
import NumberField from "./NumberField";
export default function TileStep({
  doc,
  onField,
}: {
  doc: ProjectDocument;
  onField: (
    group: "material" | "rules",
    key: string,
    n: number | null,
    text: string,
  ) => void;
}) {
  return (
    <div className="form-stage">
      <p>Размер квадратной плитки и шов между соседними плитками.</p>
      {(["tile", "grout"] as const).map((k, i) => (
        <NumberField
          key={k}
          label={i ? "Ширина шва" : "Сторона квадратной плитки"}
          value={doc.material[k]}
          raw={doc.fieldInputs["material." + k]}
          min={i ? 0 : 50}
          max={i ? 20 : 2000}
          onCommit={(n, t) => onField("material", k, n, t)}
        />
      ))}
    </div>
  );
}
