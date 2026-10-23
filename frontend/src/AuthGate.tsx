import { useEffect, useRef, useState } from "react";
import Projects from "./Projects";

type State = "checking" | "locked" | "open";

export default function AuthGate() {
  const [state, setState] = useState<State>("checking");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [visible, setVisible] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/auth/status", { signal: AbortSignal.timeout(10000) })
      .then(async response => {
        if (!response.ok) throw new Error();
        const value = await response.json() as { authenticated?: unknown };
        setState(value.authenticated === true ? "open" : "locked");
      })
      .catch(() => {
        setError("Не удалось проверить доступ к приложению.");
        setState("locked");
      });
  }, []);

  if (state === "open") return <Projects onLogout={async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setPassword("");
    setState("locked");
  }} />;
  if (state === "checking")
    return <main className="auth-page"><p>Проверяем доступ…</p></main>;

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={async event => {
        event.preventDefault();
        setSending(true);
        setError("");
        try {
          const response = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password }),
          });
          if (response.status === 401) {
            setError("Неверный пароль.");
            setPassword("");
            requestAnimationFrame(() => input.current?.focus());
          } else if (!response.ok) {
            setError("Не удалось выполнить вход.");
          } else {
            setState("open");
          }
        } catch {
          setError("Нет связи с сервером.");
        } finally {
          setSending(false);
        }
      }}>
        <a className="brand" href="#">плитка.</a>
        <h1>Вход</h1>
        <p>Введите пароль для доступа к проектам.</p>
        <label>
          Пароль
          <span className="auth-password-field">
            <input
              ref={input}
              autoFocus
              autoComplete="current-password"
              type={visible ? "text" : "password"}
              minLength={8}
              maxLength={8}
              required
              aria-invalid={!!error}
              aria-describedby={error ? "auth-error" : "auth-password-hint"}
              value={password}
              onChange={event => setPassword(event.target.value)}
            />
            <button type="button" onClick={() => setVisible(value => !value)}>
              {visible ? "Скрыть" : "Показать"}
            </button>
          </span>
          <small id="auth-password-hint">Ровно 8 символов</small>
        </label>
        {error && <div id="auth-error" className="error" role="alert">{error}</div>}
        <button className="dark" disabled={sending || password.length !== 8}>
          {sending ? "Входим…" : "Войти"}
        </button>
      </form>
    </main>
  );
}
