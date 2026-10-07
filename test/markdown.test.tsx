import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Markdown } from "../web/src/components/basics.tsx";

describe("Markdown", () => {
  it("renders tables", () => {
    const html = renderToStaticMarkup(<Markdown text={"| Timer | Covers |\n|---|---|\n| Timer 1 `detached` | stop, wait |"} />);
    expect(html).toContain("<table>");
    expect(html).toContain("<th>Timer</th>");
    expect(html).toContain("<code>detached</code>");
  });
});
