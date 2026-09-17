import type { ReactElement, ReactNode } from "react";
import { useEffect, useRef } from "react";

export function Modal({
  title,
  role = "dialog",
  open,
  onClose,
  children,
}: {
  title: string;
  role?: "dialog" | "alertdialog";
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;

    if (dialog === null) {
      return;
    }

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog ref={ref} role={role} aria-label={title} onClose={onClose}>
      {open ? (
        <>
          <h2>{title}</h2>
          {children}
        </>
      ) : null}
    </dialog>
  );
}
