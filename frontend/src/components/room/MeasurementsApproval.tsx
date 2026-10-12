import type { Acknowledgment } from "../../domain/project/schema";
import type { GeometrySnapshot } from "../../domain/room/types";
export default function MeasurementsApproval({
  value,
  geometry,
  approved,
  onApprove,
}: {
  value: Acknowledgment;
  geometry: GeometrySnapshot;
  approved: boolean;
  onApprove: () => void;
}) {
  return (
    <div className="approval">
      <h3>Вычисленные размеры</h3>
      <p>Проверьте размеры по рисунку. Подтверждение не фиксирует стены.</p>
      <div className="measurement-list">
        {[...value.entries]
          .sort((a, b) => {
            const walls = [geometry.outer, ...geometry.holes].flatMap((c) =>
              c.walls.map((w) => w.id),
            );
            return (
              walls.indexOf(a.wallId) - walls.indexOf(b.wallId) ||
              a.kind.localeCompare(b.kind)
            );
          })
          .map((e) => (
            <span key={e.wallId + e.kind}>
              {[geometry.outer, ...geometry.holes]
                .map((c, i) => {
                  const index = c.walls.findIndex((w) => w.id === e.wallId);
                  return index < 0
                    ? ""
                    : `${i === 0 ? "Комната" : `Отверстие ${i}`} · стена ${index + 1}`;
                })
                .join("")}
              . {e.kind === "length" ? "Длина" : "Угол"}: {e.displayedValue}{" "}
              {e.kind === "length" ? "мм" : "°"}
            </span>
          ))}
      </div>
      {value.entries.length > 0 && (
        <button disabled={approved} onClick={onApprove}>
          {approved ? "Размеры подтверждены" : "Подтверждаю показанные размеры"}
        </button>
      )}
    </div>
  );
}
