// @vitest-environment happy-dom

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CoreSelectionDialog } from "@/components/licenses/assignment/CoreSelectionDialog";
import apiClient from "@/lib/apiClient";
import type { Host, License } from "@/lib/types";

vi.mock("@/lib/apiClient", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const baseHost: Host = {
  id: "host-1",
  name: "Servidor Oracle",
  serverType: "Physical",
  coreCount: 4,
  threadCount: 8,
  cores: 4,
  coreFactor: 0.5,
  coreAssignments: [],
};

const baseLicense: License = {
  id: "lic-1",
  name: "Oracle Database Enterprise",
  licenseType: "Processor",
  edition: "Enterprise",
  quantity: 1,
  product: "Oracle Database",
  metric: "Processor",
};

describe("CoreSelectionDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        physicalHost: null,
        selectedCoreIds: [],
        coreMappings: {},
        maxSelectableCores: 2,
      },
    });
  });

  it("shows the computed processor limit for the host", async () => {
    render(
      <CoreSelectionDialog
        host={baseHost}
        license={baseLicense}
        open={true}
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith(
        `/licenses/${baseLicense.id}/host/${baseHost.id}/assignment-state`,
      );
    });

    expect(screen.getByText("Asignar Licencia a Cores")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Seleccionar 2" })).toBeTruthy();
    expect(screen.getByText(/En este host puedes asignar hasta/i)).toBeTruthy();
    expect(screen.getByText(/2 \(máximo permitido\)/i)).toBeTruthy();
  });

  it("submits the selected cores when the user confirms", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <CoreSelectionDialog
        host={baseHost}
        license={baseLicense}
        open={true}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Seleccionar Todos" })).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "Seleccionar Todos" }));
    await user.click(screen.getByRole("button", { name: "Aceptar" }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith([1, 2], undefined);
    });
  });

  it("skips backend state loading for unsaved licenses", async () => {
    render(
      <CoreSelectionDialog
        host={baseHost}
        license={{ ...baseLicense, id: "temp-license-1" }}
        open={true}
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
        loadAssignmentState={false}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Asignar Licencia a Cores").length).toBeGreaterThan(0);
    });

    expect(apiClient.get).not.toHaveBeenCalled();
  });
});