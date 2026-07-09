import { IconAlertTriangle, IconCircleCheck, IconInfoCircle, IconX } from "@tabler/icons-react";
import { useToastStore } from "../toastStore";
import "./Toasts.css";

export default function Toasts() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="toasts" role="region" aria-label="Notifications">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.kind}`} role="alert">
          <span className="toast-icon">
            {t.kind === "error" ? (
              <IconAlertTriangle size={16} />
            ) : t.kind === "success" ? (
              <IconCircleCheck size={16} />
            ) : (
              <IconInfoCircle size={16} />
            )}
          </span>
          <div className="toast-body">
            <div className="toast-title">{t.title}</div>
            {t.message && <div className="toast-message">{t.message}</div>}
          </div>
          <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <IconX size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
