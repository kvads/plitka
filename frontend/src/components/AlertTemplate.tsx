import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import type { AlertTemplateProps } from "react-alert";

export default function AlertTemplate({
  style,
  options,
  message,
  close,
}: AlertTemplateProps) {
  const type = options.type ?? "info";
  const Icon =
    type === "success" ? CircleCheck : type === "error" ? CircleAlert : Info;

  return (
    <div
      className={`app-alert app-alert--${type}`}
      style={style}
      role={type === "error" ? "alert" : "status"}
    >
      <Icon aria-hidden="true" size={20} strokeWidth={2} />
      <span className="app-alert__message">{message}</span>
      <button
        className="app-alert__close"
        type="button"
        aria-label="Закрыть уведомление"
        onClick={close}
      >
        <X aria-hidden="true" size={18} />
      </button>
    </div>
  );
}
