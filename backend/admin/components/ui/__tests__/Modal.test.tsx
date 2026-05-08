import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Modal from "../Modal";

describe("Modal a11y", () => {
  it("renders nothing when closed", () => {
    render(
      <Modal isOpen={false} onClose={() => {}} title="t">
        body
      </Modal>
    );
    expect(screen.queryByText("body")).not.toBeInTheDocument();
  });

  it("auto-focuses first focusable on open", () => {
    render(
      <Modal isOpen onClose={() => {}} title="t">
        <button>first</button>
        <button>second</button>
      </Modal>
    );
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Close");
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal isOpen onClose={onClose}>
        <button>x</button>
      </Modal>
    );
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("traps Tab inside modal", async () => {
    const user = userEvent.setup();
    render(
      <Modal isOpen onClose={() => {}} showCloseButton={false}>
        <button>first</button>
        <button>second</button>
      </Modal>
    );
    screen.getByText("second").focus();
    await user.tab();
    expect(document.activeElement).toHaveTextContent("first");
  });

  it("uses dialog role", () => {
    render(
      <Modal isOpen onClose={() => {}} title="My Modal">
        body
      </Modal>
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
  });
});
