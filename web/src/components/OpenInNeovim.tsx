import { useState } from "react";

import { api, type PrRoute } from "../api.ts";
import { Icon } from "./Icon.tsx";

// - file: one file's diff; unset opens the whole PR.
type OpenProps = { route: PrRoute; file?: string; className?: string; label?: string };

/** Opens the diff in Neovim (diffview) in a new terminal window. */
export function OpenInNeovim({ route, file, className = "btn btn-ghost btn-small btn-quiet", label = "Neovim" }: OpenProps) {
  const [error, setError] = useState<string | null>(null);
  const open = () => {
    setError(null);
    api.openInEditor(route, file).catch((openError: Error) => setError(openError.message));
  };
  return (
    <>
      <button className={className} onClick={open} title={file ? `Open ${file} in Neovim` : "Open the whole PR in Neovim"}>
        <Icon name="code" size={15} /> {label}
      </button>
      {error ? <span className="composer-error">{error}</span> : null}
    </>
  );
}
