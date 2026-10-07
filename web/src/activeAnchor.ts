import { useEffect, useState } from "react";

const READING_LINE_PX = 140;

/** The last of these elements whose top has scrolled past the reading line. */
function findActive(ids: string[]): string | undefined {
  let active: string | undefined;
  for (const id of ids) {
    const top = document.getElementById(id)?.getBoundingClientRect().top;
    if (top !== undefined && top <= READING_LINE_PX) active = id;
  }
  return active;
}

/** Which section or tour stop you are reading, for the side map. */
export function useActiveAnchor(ids: string[]): string | undefined {
  const [active, setActive] = useState<string>();
  const idsKey = ids.join("|");
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setActive(findActive(ids)));
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
    };
  }, [idsKey]);
  return active;
}
