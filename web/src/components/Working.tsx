import type { ReactNode } from "react";

/** A spinning ring beside text, for anything Claude is still writing. */
export function Working({ children, size = 14 }: { children: ReactNode; size?: number }) {
  return (
    <span className="working">
      <span className="spinner" style={{ width: size, height: size }} aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}
