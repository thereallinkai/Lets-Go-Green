import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LoginForm } from "../../components/login-form";
import {
  ForgotPasswordForm,
  ResetPasswordForm,
} from "../../components/recovery-form";
import { RegisterForm } from "../../components/register-form";
import { OnboardingFlow } from "../../components/onboarding-flow";
import {
  createRegistrationEmailHandoff,
  REGISTRATION_EMAIL_HANDOFF_KEY,
} from "../../src/lib/registration-email-handoff";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => router }));

function serverRenderedForm(element: ReactElement) {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(element);
  const form = container.querySelector("form");
  if (!form) throw new Error("Expected a server-rendered form.");
  return form;
}

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

describe("credential form transport safety", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    router.push.mockReset();
    router.replace.mockReset();
    router.refresh.mockReset();
  });

  it.each([
    ["registration", <RegisterForm />, "/register"],
    ["login", <LoginForm />, "/login"],
    ["password recovery", <ForgotPasswordForm />, "/forgot-password"],
    ["password reset", <ResetPasswordForm />, "/reset-password"],
  ])(
    "renders the %s form as a safe POST before hydration",
    (_label, element, expectedAction) => {
      const form = serverRenderedForm(element);
      const action = form.getAttribute("action");
      const actionUrl = new URL(action ?? "", "https://example.test");

      expect(form).toHaveAttribute("method", "post");
      expect(action).toBe(expectedAction);
      expect(actionUrl.search).toBe("");
      expect(
        form.querySelector<HTMLButtonElement>('button[type="submit"]'),
      ).toBeDisabled();

      for (const credentialName of [
        "email",
        "password",
        "passwordConfirmation",
        "confirmation",
        "otp",
        "code",
      ]) {
        expect(actionUrl.searchParams.has(credentialName)).toBe(false);
      }
    },
  );

  it("enables the client submit path once its handler is ready", async () => {
    render(<LoginForm />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Log in" })).toBeEnabled(),
    );
  });

  it("keeps a registration error until its related field changes", async () => {
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
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "EMAIL_ALREADY_REGISTERED",
    );

    await user.type(screen.getByLabelText("Full name"), " Jr");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "EMAIL_ALREADY_REGISTERED",
    );

    await user.type(screen.getByLabelText("Email"), "x");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not dismiss an operational login error when credentials change", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            data: null,
            error: {
              code: "AUTH_SERVICE_UNAVAILABLE",
              message: "Account services are temporarily unavailable.",
              details: "Try again after a short wait.",
              retryable: true,
              action: { kind: "retry", label: "Try again" },
            },
          },
          503,
        ),
      ),
    );
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText("Email"), "member@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong password");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "AUTH_SERVICE_UNAVAILABLE",
    );

    await user.type(screen.getByLabelText("Email"), "x");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "AUTH_SERVICE_UNAVAILABLE",
    );
  });

  it("consumes the registration email from session storage without a URL query", async () => {
    window.sessionStorage.setItem(
      REGISTRATION_EMAIL_HANDOFF_KEY,
      createRegistrationEmailHandoff("member@example.com")!,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ data: { currentStep: null, draft: null }, error: null }),
      ),
    );

    render(<OnboardingFlow initialStep={2} />);

    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "Account email" }),
      ).toHaveValue("member@example.com"),
    );
    expect(
      window.sessionStorage.getItem(REGISTRATION_EMAIL_HANDOFF_KEY),
    ).toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("accepts a legacy query email once and replaces it with a clean URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ data: { currentStep: null, draft: null }, error: null }),
      ),
    );

    render(
      <OnboardingFlow initialStep={2} email="legacy@example.com" />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "Account email" }),
      ).toHaveValue("legacy@example.com"),
    );
    expect(router.replace).toHaveBeenCalledWith("/onboarding?step=2");
  });
});
