import type {
  DeletionPreviewResponse,
  RoomRecord,
} from "../../domain/plan/types";
import CanvasDialog from "./CanvasDialog";
export default function DeletionPreview({
  preview,
  rooms,
  onCancel,
  onConfirm,
}: {
  preview: DeletionPreviewResponse;
  rooms: RoomRecord[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!preview.impact) return null;
  const p = preview.impact;
  return (
    <CanvasDialog
      title={
        preview.target.kind === "room"
          ? "Удалить помещение"
          : "Удалить отверстие"
      }
      onCancel={onCancel}
    >
      <p>
        Будет удалена вся граница, включая общие стены: {p.segmentIds.length}.
        Связанных условий: {p.constraintIds.length}.
      </p>
      {p.affectedRoomKeys.length > 0 && (
        <p>
          Затронутые помещения:{" "}
          {p.affectedRoomKeys
            .map(
              (k) =>
                rooms.find((r) => r.topologyKey === k)?.name ||
                "Область на плане",
            )
            .join(", ")}
          .
        </p>
      )}
      {p.disappearedRoomKeys.length > 1 && (
        <p>
          Соседние помещения потеряют замкнутую границу. Их настройки сохранятся
          для восстановления.
        </p>
      )}
      <button onClick={onCancel}>Отмена</button>
      <button className="danger" onClick={onConfirm}>
        Удалить со стенами
      </button>
    </CanvasDialog>
  );
}
