import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

describe("test infrastructure canary", () => {
  it("renders a div", () => {
    render(<div>hello</div>);
    expect(screen.getByText("hello")).toBeInTheDocument();
  });
});
