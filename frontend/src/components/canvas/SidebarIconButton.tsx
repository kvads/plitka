import { forwardRef, useState, type ButtonHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> & {
  icon: LucideIcon;
  label: string;
  tooltip?: string;
};

const SidebarIconButton = forwardRef<HTMLButtonElement, Props>(
  ({ icon: Icon, label, tooltip, className = "", onFocus, onBlur, onMouseEnter, onMouseLeave, ...props }, ref) => {
    const [hint, setHint] = useState<{ top: number; left: number } | null>(null);
    const showHint = (button: HTMLButtonElement) => {
      const bounds = button.getBoundingClientRect();
      setHint({ top: Math.min(window.innerHeight - 20, Math.max(20, bounds.top + bounds.height / 2)), left: bounds.right + 10 });
    };
    return <>
    <button
      {...props}
      ref={(node) => {
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
      type={props.type ?? "button"}
      className={`sidebar-icon-button ${className}`.trim()}
      aria-label={label}
      title={tooltip ?? label}
      onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) showHint(event.currentTarget); onFocus?.(event); }}
      onBlur={(event) => { setHint(null); onBlur?.(event); }}
      onMouseEnter={(event) => {
        if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) showHint(event.currentTarget);
        onMouseEnter?.(event);
      }}
      onMouseLeave={(event) => { setHint(null); onMouseLeave?.(event); }}
    >
      <Icon size={20} strokeWidth={2} aria-hidden="true" focusable="false" />
    </button>
    {hint && createPortal(<span className="sidebar-tooltip" aria-hidden="true" style={{ top: hint.top, left: hint.left }}>
      {tooltip ?? label}
    </span>, document.body)}
    </>;
  },
);

SidebarIconButton.displayName = "SidebarIconButton";
export default SidebarIconButton;
