import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
export default function CanvasDialog({
  title,
  onCancel,
  children,
}: {
  title: string;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const origin = document.activeElement as HTMLElement | null;
    const siblings = [...document.body.children].filter(el => el !== ref.current) as HTMLElement[];
    const prior = siblings.map(el => el.inert);
    siblings.forEach(el => { el.inert = true; });
    ref.current?.querySelector<HTMLElement>("button")?.focus();
    return () => {
      siblings.forEach((el, i) => { el.inert = prior[i]; });
      if (origin?.isConnected) origin.focus();
      else (document.querySelector<HTMLElement>("[data-projects-heading]") || document.querySelector<SVGSVGElement>("svg[data-geometry]"))?.focus();
    };
  }, []);
  return createPortal(
    <div
      ref={ref}
      className="canvas-modal"
      data-overlay
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
        if (e.key === "Tab") {
          const els = [
            ...e.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input:not(:disabled),[tabindex="0"]',
            ),
          ];
          const i = els.indexOf(document.activeElement as HTMLElement);
          e.preventDefault();
          els[(i + (e.shiftKey ? -1 : 1) + els.length) % els.length]?.focus();
        }
      }}
    >
      <section>
        <h2>{title}</h2>
        {children}
      </section>
    </div>, document.body
  );
}
