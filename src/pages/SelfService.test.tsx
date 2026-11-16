// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
  act,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({ request: vi.fn(), reply: vi.fn() }));
vi.mock("@/lib/api", () => ({
  api: { request: mocks.request, submitSupportReply: mocks.reply },
  downloadBlob: vi.fn(),
  ApiError: class extends Error {
    code?: string;
  },
}));
vi.mock("@/hooks/useSupportProfile", () => ({ useSupportProfile: () => null }));
vi.mock("./PublicTicketForm", () => ({
  PublicTicketForm: () => <div>Formulär</div>,
}));
import SelfService from "./SelfService";
const ticket = {
  id: "owned",
  title: "Skrivaren",
  status: "open",
  updated_at: "2026-11-16T10:00:00Z",
  description: "E04",
  comments: [
    {
      id: "c1",
      author: "IT-support",
      content: "Vilken skrivare?",
      created_at: "2026-11-16T10:00:00Z",
    },
  ],
  attachments: [],
};
function session(
  origin = "https://navet-dev.prefabmastarna.se",
  subject = "alice",
) {
  act(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window.parent,
        origin,
        data: {
          type: "prefabnavet.support-session",
          version: 1,
          token: "local-test-token",
          subject,
          name: "Alice",
          email: "alice@example.test",
        },
      }),
    ),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.request.mockImplementation((url: string) =>
    Promise.resolve(url.includes("?") ? { data: [ticket], total: 1 } : ticket),
  );
  mocks.reply.mockResolvedValue({ id: "reply" });
});
afterEach(cleanup);
describe("requester view", () => {
  it("preserves an unsent reply when cancelling return to the list", async () => {
    render(<SelfService />);
    session();
    fireEvent.click(screen.getByRole("button", { name: "Mina ärenden" }));
    fireEvent.click(await screen.findByRole("button", { name: /Skrivaren/ }));
    await screen.findByText("Vilken skrivare?");
    fireEvent.change(screen.getByLabelText("Ditt svar till IT"), {
      target: { value: "Mitt oskickade svar" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Till mina ärenden" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Behåll innehållet" }),
    );
    expect(screen.getByLabelText("Ditt svar till IT")).toHaveValue(
      "Mitt oskickade svar",
    );
  });

  it("does not load private data for an untrusted parent message", async () => {
    render(<SelfService />);
    session("https://other.example.test");
    expect(screen.getByText("Ansluter till Navet…")).toBeInTheDocument();
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("opens own list/detail and keeps a failed reply for retry", async () => {
    render(<SelfService />);
    session();
    fireEvent.click(screen.getByRole("button", { name: "Mina ärenden" }));
    fireEvent.click(await screen.findByRole("button", { name: /Skrivaren/ }));
    await screen.findByText("Vilken skrivare?");
    fireEvent.change(screen.getByLabelText("Ditt svar till IT"), {
      target: { value: "Kontorets skrivare" },
    });
    mocks.reply.mockRejectedValueOnce(new Error("Nätverksfel"));
    fireEvent.click(screen.getByRole("button", { name: "Skicka svar" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Ditt svar till IT")).toHaveValue(
      "Kontorets skrivare",
    );
    fireEvent.click(screen.getByRole("button", { name: "Skicka svar" }));
    await screen.findByText("Ditt svar är skickat.");
    expect(screen.getByLabelText("Ditt svar till IT")).toHaveValue("");
    expect(mocks.reply.mock.calls[0][2].idempotencyKey).toBe(
      mocks.reply.mock.calls[1][2].idempotencyKey,
    );
  });
  it("clears private detail when the Navet identity changes", async () => {
    render(<SelfService />);
    session();
    fireEvent.click(screen.getByRole("button", { name: "Mina ärenden" }));
    fireEvent.click(await screen.findByRole("button", { name: /Skrivaren/ }));
    await screen.findByText("Vilken skrivare?");
    session("https://navet-dev.prefabmastarna.se", "bob");
    await waitFor(() =>
      expect(screen.queryByText("Vilken skrivare?")).not.toBeInTheDocument(),
    );
  });
});
