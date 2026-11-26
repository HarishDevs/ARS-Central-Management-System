import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ListFooter } from "@/features/ui/ListFooter";

// v1.91.3 (D-437): the count and pager below the table on Sent back for changes and
// Approved by me, the Waiting for me layout (D-435 point 3).
const html = (page: number, pages: number) => renderToStaticMarkup(<ListFooter count="60 sent back" page={page} pages={pages} earlierHref="/x?page=1" laterHref="/x?page=3" />);

describe("ListFooter", () => {
  it("one page: the count only, no page part and no pager", () => {
    const out = html(1, 1);
    expect(out).toContain('data-testid="list-footer"');
    expect(out).toContain(">60 sent back</p>");
    expect(out).not.toContain("Pages");
    expect(out).not.toContain("Earlier");
  });
  it("first of two: 'page 1 of 2' and Later only", () => {
    const out = html(1, 2);
    expect(out).toContain("60 sent back · page 1 of 2");
    expect(out).toContain('aria-label="Pages"');
    expect(out).toContain("Later →");
    expect(out).not.toContain("Earlier");
  });
  it("a middle page has Earlier and Later, with their links", () => {
    const out = html(2, 3);
    expect(out).toContain("← Earlier");
    expect(out).toContain('href="/x?page=1"');
    expect(out).toContain("Later →");
    expect(out).toContain('href="/x?page=3"');
  });
  it("the last page has Earlier only", () => {
    const out = html(3, 3);
    expect(out).toContain("← Earlier");
    expect(out).not.toContain("Later");
  });
});
