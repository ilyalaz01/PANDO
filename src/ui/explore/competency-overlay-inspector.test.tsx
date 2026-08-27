import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  saveNote: vi.fn(),
  addActivity: vi.fn(),
  dirtyChange: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("../../app/explore/actions", () => ({
  saveCompetencyNoteAction: mocks.saveNote,
  addCompetencyActivityAction: mocks.addActivity,
}));

import { CompetencyOverlayInspector } from "./competency-overlay-inspector";

const props = {
  readinessGoalKey: "goal:personal-main",
  competencyRef: "competency:python-testing",
  inspectorRef: "inspector:node:competency:python-testing",
  initialOverlayVersion: "4",
  onDirtyChange: mocks.dirtyChange,
};

function detail(competencyRef = props.competencyRef, overlayVersion = "4") {
  return {
    contract: { name: "CompetencyOverlayDetailV1", version: "1.0.0" },
    readinessGoalKey: props.readinessGoalKey,
    competencyRef,
    overlayVersion,
    note: { body: "Keep the feedback loop short.", updatedAt: "2026-08-27T08:00:00Z" },
    customActivities: [
      {
        activityKey: "activity:custom-existing",
        title: "Write a property test",
        activityType: "MANUAL_CODING",
        lifecycle: "active",
        createdAt: "2026-08-27T08:01:00Z",
      },
    ],
  };
}

function ok(value: unknown): Response {
  return { ok: true, json: vi.fn().mockResolvedValue(value) } as unknown as Response;
}

describe("CompetencyOverlayInspector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let request = 0;
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => `10000000-0000-4000-8000-${String(++request).padStart(12, "0")}`),
    });
    mocks.saveNote.mockResolvedValue({ status: "idle", message: "" });
    mocks.addActivity.mockResolvedValue({ status: "idle", message: "" });
  });

  it("loads a private note and activities through the scoped GET boundary", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(detail()));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<CompetencyOverlayInspector {...props} />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading your note and activities");
    expect(await screen.findByDisplayValue("Keep the feedback loop short.")).toBeVisible();
    expect(screen.getByText("Write a property test")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/explore/competency-overlay?goal=goal%3Apersonal-main&competency=competency%3Apython-testing",
      { cache: "no-store", credentials: "same-origin" },
    );
    expect(container.querySelector('[name="workspaceId"]')).toBeNull();
    expect(container.querySelector('[name="profileVersionKey"]')).toBeNull();
    expect(container.querySelector('[name="expectedOverlayVersion"]')).toHaveValue("4");
  });

  it("offers an explicit retry after a safe load failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValueOnce(ok(detail()));
    vi.stubGlobal("fetch", fetchMock);
    render(<CompetencyOverlayInspector {...props} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("could not be loaded");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByDisplayValue("Keep the feedback loop short.")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ignores a late detail response after the selected competency changes", async () => {
    let resolveFirst: ((value: Response) => void) | undefined;
    const first = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(ok({ ...detail("competency:python-types"), note: null }));
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(<CompetencyOverlayInspector {...props} />);

    rerender(
      <CompetencyOverlayInspector
        {...props}
        competencyRef="competency:python-types"
        inspectorRef="inspector:node:competency:python-types"
      />,
    );
    await screen.findByPlaceholderText("What matters about this competency right now?");
    resolveFirst?.(ok(detail()));

    await waitFor(() => {
      expect(screen.queryByDisplayValue("Keep the feedback loop short.")).not.toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps all controls keyboard-reachable and blocks empty mutations", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(ok({ ...detail(), note: null, customActivities: [] })),
    );
    render(<CompetencyOverlayInspector {...props} />);

    const note = await screen.findByLabelText("Private note");
    const noteButton = screen.getByRole("button", { name: "Save note" });
    const title = screen.getByLabelText("New activity");
    const type = screen.getByLabelText("Activity type");
    const activityButton = screen.getByRole("button", { name: "Add activity" });
    expect(note).toBeEnabled();
    expect(type).toBeEnabled();
    expect(noteButton).toBeDisabled();
    expect(activityButton).toBeDisabled();
    fireEvent.change(note, { target: { value: "A useful note" } });
    fireEvent.change(title, { target: { value: "Rehearse the explanation" } });
    expect(noteButton).toBeEnabled();
    expect(activityButton).toBeEnabled();
  });

  it("preserves a conflicted note draft when refresh fails and is retried", async () => {
    const latest = {
      ...detail(),
      overlayVersion: "5",
      note: { body: "Concurrent server edit.", updatedAt: "2026-08-27T08:02:00Z" },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(detail()))
      .mockRejectedValueOnce(new Error("refresh unavailable"))
      .mockResolvedValueOnce(ok(latest));
    vi.stubGlobal("fetch", fetchMock);
    mocks.saveNote.mockResolvedValueOnce({
      status: "conflict",
      message: "This plan changed in another request. Your draft is still here.",
    });
    render(<CompetencyOverlayInspector {...props} />);

    const note = await screen.findByLabelText("Private note");
    fireEvent.change(note, { target: { value: "My unsaved conflict draft." } });
    fireEvent.click(screen.getByRole("button", { name: "Update note" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("could not be loaded");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByDisplayValue("My unsaved conflict draft.")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("keeps a dirty note when adding an activity succeeds", async () => {
    const addedActivity = {
      activityKey: "activity:custom-added",
      title: "Explain the boundary aloud",
      activityType: "EXPLANATION" as const,
      lifecycle: "active" as const,
      createdAt: "2026-08-27T08:03:00Z",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(detail()))
      .mockResolvedValueOnce(
        ok({
          ...detail(),
          overlayVersion: "5",
          customActivities: [...detail().customActivities, addedActivity],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    mocks.addActivity.mockResolvedValueOnce({
      status: "added",
      message: "Activity added.",
      overlayVersion: "5",
      activityKey: addedActivity.activityKey,
    });
    render(<CompetencyOverlayInspector {...props} />);

    const note = await screen.findByLabelText("Private note");
    fireEvent.change(note, { target: { value: "Keep this unsaved note draft." } });
    fireEvent.change(screen.getByLabelText("New activity"), {
      target: { value: addedActivity.title },
    });
    fireEvent.change(screen.getByLabelText("Activity type"), {
      target: { value: addedActivity.activityType },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add activity" }));

    expect(await screen.findByText(addedActivity.title)).toBeVisible();
    expect(screen.getByDisplayValue("Keep this unsaved note draft.")).toBeVisible();
    expect(screen.getByLabelText("New activity")).toHaveValue("");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
