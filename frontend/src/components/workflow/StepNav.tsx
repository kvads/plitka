import type { Stage } from "../../domain/project/schema";
export const stages: Stage[] = ["object", "tile", "rules", "variants"];
export const names = ["Объект", "Плитка", "Правила", "Варианты"];
export default function StepNav({
  active,
  allowed,
  onChange,
}: {
  active: Stage;
  allowed: boolean[];
  onChange: (s: Stage) => void;
}) {
  return (
    <>
      <nav className="step-nav" aria-label="Этапы проекта">
        {stages.map((s, i) => (
          <button
            key={s}
            aria-current={s === active ? "step" : undefined}
            disabled={!allowed[i]}
            title={allowed[i] ? names[i] : "Сначала завершите предыдущие этапы"}
            onClick={() => onChange(s)}
          >
            <span>{String(i + 1).padStart(2, "0")}</span>
            {names[i]}
            {i < 3 && allowed[i + 1] && (
              <small className="step-done">Готово</small>
            )}
          </button>
        ))}
      </nav>
      {!allowed[1] && (
        <p className="step-help">
          Чтобы перейти к плитке, исправьте ошибки и подтвердите помещение.
        </p>
      )}
      {allowed[1] && !allowed[2] && (
        <p className="step-help">
          Чтобы перейти к правилам, исправьте параметры плитки.
        </p>
      )}
      {allowed[2] && !allowed[3] && (
        <p className="step-help">
          Варианты появятся после подбора на этапе правил.
        </p>
      )}
    </>
  );
}
