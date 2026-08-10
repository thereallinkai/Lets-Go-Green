import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PasswordField } from "../../components/password-field";
import { RegisterForm } from "../../components/register-form";
import {
  addLocalDays,
  isValidIanaTimeZone,
  localDateInTimeZone,
  parseLocalDate,
  registrationDateOfBirthBounds,
} from "../../src/lib/domain";

const REGISTRATION_DRAFT_KEY = "lets-go-green-registration-draft";
const LEGACY_REGISTRATION_DRAFT_KEY = "cutting-plan-registration-draft";
const nativeDateTimeOptions = Intl.DateTimeFormat().resolvedOptions();

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

function validDateOfBirth(age = 30) {
  const reportedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timeZone = isValidIanaTimeZone(reportedTimeZone)
    ? reportedTimeZone
    : "UTC";
  const currentYear = Number(
    localDateInTimeZone(new Date(), timeZone).slice(0, 4),
  );
  return `${currentYear - age}-01-01`;
}

async function completeValidRegistrationForm(
  user: ReturnType<typeof userEvent.setup>,
  dateOfBirth = validDateOfBirth(),
) {
  await user.type(screen.getByLabelText("Full name"), "Taylor Green");
  await user.selectOptions(screen.getByLabelText("Gender"), "prefer_not_to_say");
  fireEvent.change(screen.getByLabelText("Date of birth"), {
    target: { value: dateOfBirth },
  });
  await user.type(screen.getByLabelText("Email"), "taylor@example.com");
  await user.type(screen.getByLabelText("Password"), "a secure password");
  await user.type(
    screen.getByLabelText("Confirm password"),
    "a secure password",
  );
  await user.click(
    screen.getByRole("checkbox", { name: /I accept the Terms of Use/i }),
  );
  await user.click(
    screen.getByRole("checkbox", { name: /I accept the Privacy Notice/i }),
  );
}

describe("authentication forms", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("toggles password visibility without changing the field value", async () => {
    const user = userEvent.setup();
    render(<PasswordField />);
    const password = screen.getByLabelText("Password");

    await user.type(password, "correct horse battery staple");
    expect(password).toHaveAttribute("type", "password");

    const show = screen.getByRole("button", { name: "Show password" });
    await user.click(show);
    expect(password).toHaveAttribute("type", "text");
    expect(password).toHaveValue("correct horse battery staple");
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(password).toHaveAttribute("type", "password");
  });

  it("blocks mismatched registration passwords and focuses confirmation", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<RegisterForm />);

    await user.type(screen.getByLabelText("Password"), "a secure password");
    const confirmation = screen.getByLabelText("Confirm password");
    await user.type(confirmation, "a different password");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The passwords do not match.",
    );
    expect(confirmation).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("summarizes and associates invalid registration fields before submission", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<RegisterForm />);

    await user.click(screen.getByRole("button", { name: "Create account" }));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Please review your account details.");
    expect(alert).toHaveTextContent("Enter your full name.");
    expect(alert).toHaveTextContent("Enter a valid email address.");
    expect(screen.getByLabelText("Full name")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription(
      "Enter a valid email address.",
    );
    expect(screen.getByLabelText("Date of birth")).toHaveAccessibleDescription(
      "You will confirm this before account creation. It cannot be changed afterward. Enter your date of birth.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each([
    ["current", REGISTRATION_DRAFT_KEY],
    ["legacy", LEGACY_REGISTRATION_DRAFT_KEY],
  ])(
    "migrates a stale %s draft without carrying forward consent",
    async (_label, sourceKey) => {
      window.localStorage.setItem(
        sourceKey,
        JSON.stringify({
          version: 1,
          fullName: "Saved Member",
          gender: "female",
          dateOfBirth: "1990-06-15",
          email: "saved@example.com",
          password: "must never migrate",
          terms: true,
          privacy: true,
          termsVersion: "1.0",
          privacyVersion: "1.0",
        }),
      );
      const user = userEvent.setup();
      const view = render(<RegisterForm />);

      await waitFor(() =>
        expect(screen.getByLabelText("Full name")).toHaveValue("Saved Member"),
      );
      expect(screen.getByLabelText("Gender")).toHaveValue("female");
      expect(screen.getByLabelText("Date of birth")).toHaveValue(
        "1990-06-15",
      );
      expect(screen.getByLabelText("Email")).toHaveValue(
        "saved@example.com",
      );
      expect(screen.getByLabelText("Password")).toHaveValue("");
      expect(
        screen.getByRole("checkbox", { name: /Terms of Use/i }),
      ).not.toBeChecked();
      expect(
        screen.getByRole("checkbox", { name: /Privacy Notice/i }),
      ).not.toBeChecked();
      expect(window.localStorage.getItem(REGISTRATION_DRAFT_KEY)).toBeNull();
      expect(
        window.localStorage.getItem(LEGACY_REGISTRATION_DRAFT_KEY),
      ).toBeNull();
      expect(
        JSON.parse(window.sessionStorage.getItem(REGISTRATION_DRAFT_KEY)!),
      ).toEqual({
        version: 2,
        fullName: "Saved Member",
        gender: "female",
        dateOfBirth: "1990-06-15",
        email: "saved@example.com",
      });

      await user.click(
        screen.getByRole("checkbox", { name: /Terms of Use/i }),
      );
      await user.click(
        screen.getByRole("checkbox", { name: /Privacy Notice/i }),
      );
      const resavedDraft = JSON.parse(
        window.sessionStorage.getItem(REGISTRATION_DRAFT_KEY)!,
      );
      expect(resavedDraft).not.toHaveProperty("terms");
      expect(resavedDraft).not.toHaveProperty("privacy");
      expect(JSON.stringify(resavedDraft)).not.toContain("must never migrate");

      view.unmount();
      render(<RegisterForm />);
      await waitFor(() =>
        expect(screen.getByLabelText("Full name")).toHaveValue("Saved Member"),
      );
      expect(
        screen.getByRole("checkbox", { name: /Terms of Use/i }),
      ).not.toBeChecked();
      expect(
        screen.getByRole("checkbox", { name: /Privacy Notice/i }),
      ).not.toBeChecked();
    },
  );

  it("confirms the calculated age before creating an account", async () => {
    const response = new Response(
      JSON.stringify({
        data: { email: "taylor@example.com" },
        error: null,
      }),
      {
        status: 201,
        headers: { "content-type": "application/json" },
      },
    );
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const dateOfBirth = validDateOfBirth();
    const expectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    render(<RegisterForm />);

    await completeValidRegistrationForm(user, dateOfBirth);
    const createButton = screen.getByRole("button", { name: "Create account" });
    await user.click(createButton);

    const dialog = screen.getByRole("dialog", { name: "Confirm your age" });
    expect(dialog).toHaveAccessibleDescription(
      "Make sure your date of birth is correct. It cannot be changed after your account is created.",
    );
    expect(screen.getByText("30 years old")).toBeVisible();
    expect(dialog).toHaveTextContent(`Calculated in ${expectedTimeZone}`);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      JSON.parse(
        window.sessionStorage.getItem(REGISTRATION_DRAFT_KEY) ?? "{}",
      ),
    ).toMatchObject({ dateOfBirth, email: "taylor@example.com" });
    expect(
      window.sessionStorage.getItem(REGISTRATION_DRAFT_KEY),
    ).not.toContain("a secure password");
    expect(window.localStorage.getItem(REGISTRATION_DRAFT_KEY)).toBeNull();

    const cancelButton = screen.getByRole("button", {
      name: "Cancel and edit",
    });
    await waitFor(() => expect(cancelButton).toHaveFocus());
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(createButton).toHaveFocus());
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(createButton);
    await user.click(
      screen.getByRole("button", { name: "Confirm and create account" }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      fullName: "Taylor Green",
      gender: "prefer_not_to_say",
      dateOfBirth,
      timeZone: expectedTimeZone,
      email: "taylor@example.com",
      password: "a secure password",
      termsAccepted: true,
      privacyAccepted: true,
    });
    expect(JSON.parse(String(request.body))).not.toHaveProperty("age");
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(
        "/onboarding?step=2",
      ),
    );
    expect(window.sessionStorage.getItem(REGISTRATION_DRAFT_KEY)).toBeNull();
    expect(
      window.sessionStorage.getItem(
        "lets-go-green-registration-email-handoff",
      ),
    ).toContain("taylor@example.com");
  });

  it("falls back to UTC when the device reports an invalid time zone", async () => {
    vi.spyOn(
      Intl.DateTimeFormat.prototype,
      "resolvedOptions",
    ).mockReturnValue({
      ...nativeDateTimeOptions,
      timeZone: "Mars/Olympus_Mons",
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<RegisterForm />);

    await completeValidRegistrationForm(user);
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(screen.getByRole("dialog", { name: "Confirm your age" }))
      .toHaveTextContent("Calculated in UTC");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enforces the thirteenth birthday boundary before confirmation", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const reportedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const timeZone = isValidIanaTimeZone(reportedTimeZone)
      ? reportedTimeZone
      : "UTC";
    const today = localDateInTimeZone(new Date(), timeZone);
    const tooYoungDateOfBirth = addLocalDays(
      registrationDateOfBirthBounds(today).max,
      1,
    );
    render(<RegisterForm />);

    await completeValidRegistrationForm(user, tooYoungDateOfBirth);
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "You must be at least 13 years old to create an account.",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires a fresh confirmation when the local date changes", async () => {
    const earlierTimeZone = "Etc/GMT+12";
    const laterTimeZone = "Pacific/Kiritimati";
    const laterDate = localDateInTimeZone(new Date(), laterTimeZone);
    const laterDateParts = parseLocalDate(laterDate);
    const expectedAge =
      laterDateParts.month === 2 && laterDateParts.day === 29 ? 24 : 26;
    const dateOfBirth = [
      String(laterDateParts.year - expectedAge).padStart(4, "0"),
      String(laterDateParts.month).padStart(2, "0"),
      String(laterDateParts.day).padStart(2, "0"),
    ].join("-");
    const timeZoneSpy = vi.spyOn(
      Intl.DateTimeFormat.prototype,
      "resolvedOptions",
    ).mockReturnValue({
      ...nativeDateTimeOptions,
      timeZone: earlierTimeZone,
    });
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return new Promise<Response>(() => {});
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<RegisterForm />);

    await completeValidRegistrationForm(user, dateOfBirth);
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByText(`${expectedAge - 1} years old`)).toBeVisible();

    timeZoneSpy.mockReturnValue({
      ...nativeDateTimeOptions,
      timeZone: laterTimeZone,
    });
    await user.click(
      screen.getByRole("button", { name: "Confirm and create account" }),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Your local date or time zone changed.",
    );
    expect(screen.getByText(`${expectedAge} years old`)).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Confirm updated age" }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      dateOfBirth,
      timeZone: laterTimeZone,
    });
  });

  it("sends only one account request while confirmation is pending", async () => {
    let resolveRequest!: (response: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<RegisterForm />);

    await completeValidRegistrationForm(user);
    await user.click(screen.getByRole("button", { name: "Create account" }));
    const confirmButton = screen.getByRole("button", {
      name: "Confirm and create account",
    });
    await user.click(confirmButton);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Creating account…" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Creating account…" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveRequest(
      new Response(
        JSON.stringify({
          data: { email: "taylor@example.com" },
          error: null,
        }),
        {
          status: 201,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
  });
});
