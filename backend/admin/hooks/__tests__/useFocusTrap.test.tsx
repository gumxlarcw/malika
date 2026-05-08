import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { useFocusTrap } from "../useFocusTrap";

function Harness({ active }: { active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, active);
  return (
    <>
      <button>outside-before</button>
      <div ref={ref} data-testid="trap">
        <button>inside-1</button>
        <button>inside-2</button>
        <button>inside-3</button>
      </div>
      <button>outside-after</button>
    </>
  );
}

describe("useFocusTrap", () => {
  it("auto-focuses first focusable when active", () => {
    render(<Harness active={true} />);
    expect(document.activeElement).toHaveTextContent("inside-1");
  });

  it("wraps Tab from last to first focusable", async () => {
    const user = userEvent.setup();
    render(<Harness active={true} />);
    screen.getByText("inside-3").focus();
    await user.tab();
    expect(document.activeElement).toHaveTextContent("inside-1");
  });

  it("wraps Shift+Tab from first to last focusable", async () => {
    const user = userEvent.setup();
    render(<Harness active={true} />);
    screen.getByText("inside-1").focus();
    await user.tab({ shift: true });
    expect(document.activeElement).toHaveTextContent("inside-3");
  });

  it("does nothing when inactive", () => {
    render(<Harness active={false} />);
    expect(document.activeElement).toBe(document.body);
  });
});
