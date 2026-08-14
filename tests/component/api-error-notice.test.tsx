import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApiErrorNotice } from "../../components/api-error-notice";
import {
  apiErrorFromPayload,
  clientApiError,
} from "../../src/lib/client-api-error";

describe("ApiErrorNotice", () => {
  it("presents a stable code, concrete details, retry status, and real action", async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    render(
      <ApiErrorNotice
        error={{
          code: "DRAFT_SAVE_FAILED",
          message: "Onboarding progress could not be saved.",
          details: "Your browser copy is unchanged.",
          retryable: true,
          action: { kind: "retry", label: "Try again" },
        }}
        heading="We could not save and exit."
        onAction={onAction}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("We could not save and exit.");
    expect(alert).toHaveTextContent("Onboarding progress could not be saved.");
    expect(alert).toHaveTextContent("Your browser copy is unchanged.");
    expect(alert).toHaveTextContent("Error code: DRAFT_SAVE_FAILED");
    expect(alert).toHaveTextContent("Retry available: yes");

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("renders an internal navigation action as a link", () => {
    render(
      <ApiErrorNotice
        error={{
          code: "SESSION_EXPIRED",
          message: "Log in again to continue.",
          retryable: false,
          action: { kind: "navigate", label: "Log in", href: "/login" },
        }}
      />,
    );

    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("does not claim that an immediate retry is available during a cooldown", () => {
    render(
      <ApiErrorNotice
        error={{
          code: "FOOD_IMPORT_RATE_LIMITED",
          message: "Wait before trying this import again.",
          retryable: true,
          action: { kind: "wait", label: "Wait 2 minutes, then try again" },
        }}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(
      "Retry available: after the waiting period",
    );
    expect(alert).not.toHaveTextContent("Retry available: yes");
  });
});

describe("apiErrorFromPayload", () => {
  it("accepts only the documented public envelope and safe internal links", () => {
    const fallback = clientApiError(
      "SAFE_FALLBACK",
      "The request failed safely.",
      "Try again.",
    );
    const result = apiErrorFromPayload(
      {
        error: {
          code: "INVALID_CREDENTIALS",
          message: "The email or password was not accepted.",
          details: "Check both fields.",
          retryable: false,
          retryAfterSeconds: 19.2,
          action: {
            kind: "navigate",
            label: "Reset password",
            href: "//untrusted.example/collect",
          },
        },
      },
      fallback,
    );

    expect(result).toMatchObject({
      code: "INVALID_CREDENTIALS",
      retryable: false,
      retryAfterSeconds: 20,
      action: { kind: "navigate", label: "Reset password" },
    });
    expect(result.action).not.toHaveProperty("href");
  });

  it("uses the safe fallback for malformed or non-public errors", () => {
    const fallback = clientApiError(
      "SAFE_FALLBACK",
      "The request failed safely.",
      "Try again.",
    );

    expect(
      apiErrorFromPayload(
        {
          error: {
            code: "private provider code",
            message: "private database diagnostics",
          },
        },
        fallback,
      ),
    ).toEqual(fallback);
  });
});
