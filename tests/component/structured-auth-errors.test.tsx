import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LoginForm } from "../../components/login-form";
import {
  ForgotPasswordForm,
  ResetPasswordForm,
} from "../../components/recovery-form";
import { RegisterForm } from "../../components/register-form";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => router }));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function fillRegistration(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Full name"), "Taylor Green");
  await user.selectOptions(
    screen.getByLabelText("Gender"),
    "prefer_not_to_say",
  );
  fireEvent.change(screen.getByLabelText("Date of birth"), {
    target: { value: "1990-01-01" },
  });
  await user.type(screen.getByLabelText("Email"), "used@example.com");
  await user.type(screen.getByLabelText("Password"), "a secure password");
  await user.type(
    screen.getByLabelText("Confirm password"),
    "a secure password",
  );
  await user.click(screen.getByRole("checkbox", { name: /Terms of Use/i }));
  await user.click(screen.getByRole("checkbox", { name: /Privacy Notice/i }));
}

describe("structured authentication errors", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    router.push.mockReset();
    router.replace.mockReset();
    router.refresh.mockReset();
  });

  it("registration concretely identifies a duplicate email and offers login", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            data: null,
            error: {
              code: "EMAIL_ALREADY_REGISTERED",
              message: "An account already uses this email address.",
              details:
                "Log in instead, or reset the password if you no longer remember it.",
              retryable: false,
              action: { kind: "navigate", label: "Log in", href: "/login" },
            },
          },
          409,
        ),
      ),
    );
    const user = userEvent.setup();
    render(<RegisterForm />);

    await fillRegistration(user);
    await user.click(screen.getByRole("button", { name: "Create account" }));
    await user.click(
      screen.getByRole("button", { name: "Confirm and create account" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("An account already uses this email address.");
    expect(alert).toHaveTextContent("Error code: EMAIL_ALREADY_REGISTERED");
    expect(alert).toHaveTextContent(
      "Retry available: not until the issue is resolved",
    );
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("login keeps identity failures generic while preserving the safe action", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            data: null,
            error: {
              code: "INVALID_CREDENTIALS",
              message: "The email or password was not accepted.",
              details:
                "Check both fields, or use password recovery if you cannot sign in.",
              retryable: false,
              action: {
                kind: "navigate",
                label: "Reset password",
                href: "/forgot-password",
              },
            },
          },
          401,
        ),
      ),
    );
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText("Email"), "unknown@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong password");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The email or password was not accepted.");
    expect(alert).toHaveTextContent("Error code: INVALID_CREDENTIALS");
    expect(alert).not.toHaveTextContent("unknown@example.com");
    expect(alert).not.toHaveTextContent("user not found");
    expect(screen.getByRole("link", { name: "Reset password" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  });

  it("recovery reports operational errors without revealing account existence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            data: null,
            error: {
              code: "RECOVERY_EMAIL_UNAVAILABLE",
              message: "Password recovery email could not be sent right now.",
              details:
                "Wait briefly, check the connection, and submit one new recovery request.",
              retryable: true,
              action: { kind: "retry", label: "Try again" },
            },
          },
          503,
        ),
      ),
    );
    const user = userEvent.setup();
    render(<ForgotPasswordForm />);

    await user.type(screen.getByLabelText("Email"), "unknown@example.com");
    await user.click(
      screen.getByRole("button", { name: "Send reset instructions" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Error code: RECOVERY_EMAIL_UNAVAILABLE");
    expect(alert).not.toHaveTextContent("unknown@example.com");
    expect(alert).not.toHaveTextContent("user not found");
  });

  it("password mismatch offers an edit action that focuses confirmation", async () => {
    const user = userEvent.setup();
    render(<ResetPasswordForm />);
    await user.type(screen.getByLabelText("Password"), "a secure password");
    await user.type(screen.getByLabelText("Confirm new password"), "different");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Error code: PASSWORDS_DO_NOT_MATCH",
    );
    await user.click(screen.getByRole("button", { name: "Edit confirmation" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Confirm new password")).toHaveFocus(),
    );
  });
});
