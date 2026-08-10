import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { HeightPicker } from "../../components/height-picker";

describe("HeightPicker", () => {
  it("uses a list instead of a keyboard-entered height", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <HeightPicker value="" preferredUnit="kg" onChange={onChange} />,
    );

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Choose centimeters" }),
      "175",
    );
    expect(onChange).toHaveBeenLastCalledWith("175 cm");
  });

  it("converts an existing height when switching display systems", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <HeightPicker value="175 cm" preferredUnit="kg" onChange={onChange} />,
    );

    expect(screen.getByText(/175 cm equals 5 ft 9 in/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Feet & inches" }));
    expect(onChange).toHaveBeenLastCalledWith("5 ft 9 in");
  });

  it("can switch units before a height has been chosen", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <HeightPicker value="" preferredUnit="kg" onChange={onChange} />,
    );

    await user.click(screen.getByRole("button", { name: "Feet & inches" }));
    expect(screen.getByRole("combobox", { name: "Feet" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Choose centimeters" })).not.toBeInTheDocument();
  });

  it("builds a canonical imperial value from two lists", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <HeightPicker value="" preferredUnit="lb" onChange={onChange} />,
    );

    await user.selectOptions(screen.getByRole("combobox", { name: "Feet" }), "5");
    expect(onChange).toHaveBeenLastCalledWith("5 ft 0 in");

    rerender(
      <HeightPicker value="5 ft 0 in" preferredUnit="lb" onChange={onChange} />,
    );
    await user.selectOptions(screen.getByRole("combobox", { name: "Inches" }), "10");
    expect(onChange).toHaveBeenLastCalledWith("5 ft 10 in");
  });

  it("never offers an imperial combination above the 300 cm limit", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <HeightPicker value="8 ft 11 in" preferredUnit="lb" onChange={onChange} />,
    );

    await user.selectOptions(screen.getByRole("combobox", { name: "Feet" }), "9");
    expect(onChange).toHaveBeenLastCalledWith("9 ft 10 in");

    rerender(
      <HeightPicker value="9 ft 10 in" preferredUnit="lb" onChange={onChange} />,
    );
    expect(
      within(screen.getByRole("combobox", { name: "Inches" })).queryByRole(
        "option",
        { name: "11 in" },
      ),
    ).not.toBeInTheDocument();
  });
});
