import userEvent from "@testing-library/user-event";

import { renderWithProviders, screen, within } from "__support__/ui";

import { DateAllOptionsWidget } from "./DateAllOptionsWidget";

const typeTime = async (input: HTMLElement, text: string) => {
  await userEvent.type(input, text, {
    initialSelectionStart: 0,
    initialSelectionEnd: (input as HTMLInputElement).value.length,
  });
};

type SetupOpts = {
  value?: string;
  withTimeOfDay?: boolean;
};

function setup({ value, withTimeOfDay }: SetupOpts = {}) {
  const onChange = jest.fn();
  renderWithProviders(
    <DateAllOptionsWidget
      value={value}
      withTimeOfDay={withTimeOfDay}
      onChange={onChange}
    />,
  );
  return { onChange };
}

describe("DateAllOptionsWidget", () => {
  it('should allow to select a "specific" filter', async () => {
    const { onChange } = setup();
    await userEvent.click(screen.getByText("Fixed date range…"));
    await userEvent.click(screen.getByText("On"));
    const panel = screen.getByRole("tabpanel", { name: "On" });
    const input = within(panel).getByLabelText("Date");
    await userEvent.clear(input);
    await userEvent.type(input, "Feb 15, 2020");
    await userEvent.click(within(panel).getByText("Apply"));
    expect(onChange).toHaveBeenCalledWith("2020-02-15");
  });

  it('should accept a previously selected "specific" filter', () => {
    setup({ value: "2020-02-15" });
    const panel = screen.getByRole("tabpanel", { name: "On" });
    const input = within(panel).getByLabelText("Date");
    expect(input).toHaveDisplayValue("February 15, 2020");
  });

  it('should allow to select a "relative" filter', async () => {
    const { onChange } = setup();
    await userEvent.click(screen.getByText("Relative date range…"));
    await userEvent.click(screen.getByText("Current"));
    const panel = screen.getByRole("tabpanel", { name: "Current" });
    await userEvent.click(within(panel).getByText("Week"));
    expect(onChange).toHaveBeenCalledWith("thisweek");
  });

  it('should accept a previously selected "relative" filter', async () => {
    setup({ value: "thisweek" });
    const panel = screen.getByRole("tabpanel", { name: "Current" });
    expect(within(panel).getByRole("button", { name: "Week" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      within(panel).getByRole("button", { name: "Year" }),
    ).not.toHaveAttribute("aria-selected", "true");
  });

  it('should allow to select an "exclude" filter', async () => {
    const { onChange } = setup();
    await userEvent.click(screen.getByText("Exclude…"));
    await userEvent.click(screen.getByText("Hours of the day…"));
    await userEvent.click(screen.getByText("5 AM"));
    await userEvent.click(screen.getByText("2 PM"));
    await userEvent.click(screen.getByText("Apply"));
    expect(onChange).toHaveBeenCalledWith("exclude-hours-5-14");
  });

  it('should accept a previously selected "exclude" filter', () => {
    setup({ value: "exclude-hours-5-14" });
    expect(screen.getByLabelText("5 AM")).toBeChecked();
    expect(screen.getByLabelText("2 PM")).toBeChecked();
    expect(screen.getByLabelText("3 PM")).not.toBeChecked();
  });

  it('should allow to select a "time of day" filter', async () => {
    const { onChange } = setup({ withTimeOfDay: true });
    await userEvent.click(screen.getByText("Time of day…"));
    const panel = screen.getByRole("tabpanel", { name: "Between" });
    await typeTime(within(panel).getByLabelText("Start time"), "09:00");
    await typeTime(within(panel).getByLabelText("End time"), "17:30");
    await userEvent.click(within(panel).getByText("Apply"));
    expect(onChange).toHaveBeenCalledWith("time:09:00~17:30");
  });

  it('should allow to select a "before" time of day filter', async () => {
    const { onChange } = setup({ withTimeOfDay: true });
    await userEvent.click(screen.getByText("Time of day…"));
    await userEvent.click(screen.getByRole("tab", { name: "Before" }));
    const panel = screen.getByRole("tabpanel", { name: "Before" });
    await typeTime(within(panel).getByLabelText("Time"), "17:30");
    await userEvent.click(within(panel).getByText("Apply"));
    expect(onChange).toHaveBeenCalledWith("time:~17:30");
  });

  it('should accept a previously selected "time of day" filter', () => {
    setup({ value: "time:09:00~17:30", withTimeOfDay: true });
    const panel = screen.getByRole("tabpanel", { name: "Between" });
    expect(within(panel).getByLabelText("Start time")).toHaveDisplayValue(
      "09:00",
    );
    expect(within(panel).getByLabelText("End time")).toHaveDisplayValue(
      "17:30",
    );
  });

  it("should not offer a time of day filter for columns that have no time of day", () => {
    setup();
    expect(screen.queryByText("Time of day…")).not.toBeInTheDocument();
  });
});
