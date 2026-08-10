import { describe, expect, it } from "vitest";

import {
  createRegistrationEmailHandoff,
  readRegistrationEmailHandoff,
} from "../../src/lib/registration-email-handoff";

describe("registration email handoff", () => {
  it("accepts a valid handoff only during its short lifetime", () => {
    const createdAt = Date.UTC(2026, 7, 3, 12);
    const handoff = createRegistrationEmailHandoff(
      " member@example.com ",
      createdAt,
    );

    expect(readRegistrationEmailHandoff(handoff, createdAt + 14 * 60_000)).toBe(
      "member@example.com",
    );
    expect(readRegistrationEmailHandoff(handoff, createdAt + 16 * 60_000)).toBe(
      null,
    );
  });

  it("rejects malformed, future-dated, and invalid-email payloads", () => {
    const now = Date.UTC(2026, 7, 3, 12);

    expect(readRegistrationEmailHandoff("not json", now)).toBeNull();
    expect(
      readRegistrationEmailHandoff(
        JSON.stringify({
          version: 1,
          email: "member@example.com",
          createdAt: now + 1,
        }),
        now,
      ),
    ).toBeNull();
    expect(createRegistrationEmailHandoff("not-an-email", now)).toBeNull();
  });
});
