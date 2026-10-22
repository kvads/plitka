import DeleteProjectDialog from "./components/canvas/DeleteProjectDialog";
import type { DeleteProjectIntent, DeleteProjectOutcomeFor } from "./domain/plan/types";
import { useEffect, useRef, useState } from "react";
import { useAlert } from "react-alert";
import { AlertContext } from "./alert-context";
import App from "./components/canvas/PhysicalWorkflow";
import {
  KEY_V6 as KEY,
  readV6 as readProjects,
  saveV6 as saveDocument,
  initializeV6,
  importV6 as importDocument,
  deleteV6,
} from "./domain/plan/storage";
import { createV6 as createDocument } from "./domain/plan/migration";
import type { ProjectDocumentV6 as ProjectDocument } from "./domain/plan/types";
const routeId = () =>
  location.hash.startsWith("#project/") ? location.hash.slice(9) : "";
export default function Projects() {
  const alert = useAlert(AlertContext);
  const [loaded, setLoaded] = useState({
    rows: [] as ProjectDocument[],
    error: "",
    ready: false,
  });
  useEffect(() => {
    let active = true;
    initializeV6()
      .then((rows) => {
        if (active) {
          setLoaded({ rows, error: "", ready: true });
          setRows(rows);
        }
      })
      .catch((e) => {
        if (active) {
          setLoaded({ rows: [], error: e.message, ready: true });
          setError(e.message);
        }
      });
    return () => {
      active = false;
    };
  }, []);
  const [rows, setRows] = useState(loaded.rows),
    [error, setError] = useState(loaded.error),
    [id, setId] = useState(routeId),
    [editing, setEditing] = useState<string | null>(null),
    [name, setName] = useState(""),
    [address, setAddress] = useState(""),
    [preview, setPreview] = useState<ProjectDocument | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const [deleteIntent, setDeleteIntent] = useState<DeleteProjectIntent | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  function removed(outcome: DeleteProjectOutcomeFor<ProjectDocument>) {
    if (outcome.status === 'conflict') return;
    setRows(outcome.projects); setDeleteIntent(null); setEditing(null); setPreview(null);
    alert.success(outcome.status === 'alreadyMissing' ? 'Проект уже удалён' : 'Проект удалён');
    setId(''); location.hash = ''; setError('');
    requestAnimationFrame(() => heading.current?.focus());
  }
  useEffect(() => {
    const storage = (event: StorageEvent) => {
      if (event.key !== KEY && event.key !== null) return;
      try {
        const latest = readProjects();
        const active = routeId();
        setRows(latest);
        if (active && !latest.some(p => p.id === active))
          removed({ status: 'alreadyMissing', projectId: active, projects: latest });
      } catch (e) { setError((e as Error).message); }
    };
    window.addEventListener('storage', storage);
    return () => window.removeEventListener('storage', storage);
  }, []);
  useEffect(() => {
    const change = () => {
      setId(routeId());
      try {
        setRows(readProjects());
      } catch (e) {
        setError((e as Error).message);
      }
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const old = rows.find((r) => r.id === editing);
    try {
      const saved = await saveDocument(
        old
          ? { ...old, name: name.trim(), address: address.trim() }
          : await createDocument(name.trim(), address.trim()),
        old?.documentRevision ?? null,
      );
      setRows((r) =>
        old ? r.map((x) => (x.id === old.id ? saved : x)) : [...r, saved],
      );
      setEditing(null);
      setError("");
      if (!old) location.hash = "project/" + saved.id;
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (!loaded.ready)
    return <main className="projects-main">Загружаем проекты…</main>;
  const current = rows.find((r) => r.id === id);
  if (current)
    return (
      <App
        key={current.id}
        initial={current}
        onRemoved={removed}
        onSaved={(d) => setRows((r) => r.map((x) => (x.id === d.id ? d : x)))}
        onBack={() => {
          location.hash = "";
        }}
      />
    );
  return (
    <div className="app projects-page">
      <header className="header">
        <a className="brand" href="#">
          плитка.
        </a>
        <span>Планировщик раскладки</span>
      </header>
      <main className="projects-main">
        <div className="projects-heading">
          <div>
            <div className="eyebrow">ВАШИ ОБЪЕКТЫ</div>
            <h1 ref={heading} tabIndex={-1} data-projects-heading>Проекты</h1>
            <p>Выберите объект, чтобы продолжить.</p>
          </div>
          <button
            className="dark"
            disabled={!!loaded.error}
            onClick={() => {
              setEditing("");
              setName("");
              setAddress("");
            }}
          >
            Новый проект
          </button>
          <button
            disabled={!!loaded.error}
            onClick={() => file.current?.click()}
          >
            Импортировать проект
          </button>
          <input
            hidden
            ref={file}
            type="file"
            accept=".json"
            onChange={async (e) => {
              try {
                if (e.target.files?.[0])
                  setPreview(await importDocument(e.target.files[0]));
              } catch (err) {
                setError((err as Error).message);
              }
              e.target.value = "";
            }}
          />
        </div>
        {deleteIntent && <DeleteProjectDialog<ProjectDocument> key={deleteIntent.requestId} intent={deleteIntent} onCancel={() => setDeleteIntent(null)} onDone={removed}
          onConfirm={intent => deleteV6(intent.projectId, intent.expectedRevision)} />}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {preview && (
          <section className="import-preview" role="dialog">
            <h2>{preview.name}</h2>
            <p>{preview.address}</p>
            <button
              onClick={async () => {
                try {
                  const saved = await saveDocument(
                    {
                      ...preview,
                      id: crypto.randomUUID(),
                      documentRevision: 0,
                    },
                    null,
                  );
                  setRows((r) => [...r, saved]);
                  setPreview(null);
                  location.hash = "project/" + saved.id;
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Создать из файла
            </button>
            <button onClick={() => setPreview(null)}>Отмена</button>
          </section>
        )}
        {editing !== null && (
          <form className="project-form" onSubmit={submit}>
            <h2>{editing ? "Изменить проект" : "Новый проект"}</h2>
            <label>
              Название проекта
              <input
                autoFocus
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Адрес объекта
              <input
                maxLength={300}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </label>
            <button className="dark" disabled={!name.trim()}>
              {editing ? "Сохранить изменения" : "Создать проект"}
            </button>
            <button type="button" onClick={() => setEditing(null)}>
              Отмена
            </button>
          </form>
        )}
        {id && !current && <><p>Проект не найден.</p><a href="#">К списку проектов</a></>}
        <div className="project-list">
          {rows.map((r) => (
            <article className="project-row" key={r.id}>
              <a
                className="project-link"
                href={"#project/" + r.id}
                aria-label={"Открыть проект " + r.name}
              >
                <h2>{r.name}</h2>
                <p>{r.address || "Адрес не указан"}</p>
              </a>
              <button
                aria-label={"Изменить проект " + r.name}
                onClick={() => {
                  setEditing(r.id);
                  setName(r.name);
                  setAddress(r.address);
                }}
              >
                Изменить
              </button>
              <button className="danger" onClick={() => setDeleteIntent({
                projectId: r.id, expectedRevision: r.documentRevision, name: r.name,
                address: r.address, origin: 'list', requestId: crypto.randomUUID(),
              })}>Удалить проект</button>
            </article>
          ))}
        </div>
        {!rows.length && !error && (
          <div className="projects-empty">
            <h2>Здесь будут ваши проекты</h2>
            <p>Создайте первый проект, укажите название и адрес.</p>
          </div>
        )}
        <p className="projects-note">
          Проекты хранятся в этом браузере. Скачивайте файл проекта для
          резервной копии.
        </p>
      </main>
    </div>
  );
}
