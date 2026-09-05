// The load window on the Settings policy editors.
//
// `useIpsLite` returns `query.data ?? IPS_LITE_DEFAULTS`, and TanStack leaves
// `data` undefined until the first fetch resolves. So while loading, the hook
// hands back the ADR-APP-004 defaults — 30%/25% caps and, via
// MARGIN_POLICY_UNSET, a NULL margin rate. The editors used to populate from
// that through an effect, with Save enabled and no loading guard, making two
// money-adjacent writes reachable:
//
//   - saving in the window wrote 30/25 over the stored caps;
//   - the rate field showed blank even when a rate WAS stored, and blank is the
//     value that form uses to clear the rate (ADR-APP-007) — so a save in the
//     window un-set a correctly-set rate.
//
// The cards take their record and loading flag as props, so these tests render
// the real components against the real loading states with no mocking.
import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";

import { IpsLiteCard, MarginRateCard, ObjectiveCard } from "../PolicyCards";
// From lib/ipsPolicy, not the hooks module: these are the real constants the
// guard protects against, and importing them here keeps the Supabase client
// out of the tests typecheck program.
import { IPS_LITE_DEFAULTS, type IpsLite } from "@/lib/ipsPolicy";
import { assertNoA11yViolations } from "@/test/a11y";

const STORED: IpsLite = {
  position_cap_pct: 12,
  position_cap_hard: true,
  margin_cap_pct: 8,
  margin_rate_annual_pct: 11.325,
  margin_rate_as_of: "2026-09-03",
  margin_rate_is_floating: true,
  margin_rate_stale_days: 45,
};

const GOAL = {
  id: "goal-1",
  target_value: 150000,
  target_date: "2027-03-31",
  starting_value: 50000,
  monthly_contribution: 1000,
};

const noop = { mutate: () => {}, isPending: false };

describe("IpsLiteCard", () => {
  test("renders no editable cap field while the stored policy is loading", () => {
    // IPS_LITE_DEFAULTS is what the hook actually hands back in this state.
    render(<IpsLiteCard ips={IPS_LITE_DEFAULTS} isLoading save={noop} />);

    expect(screen.queryByDisplayValue("30")).toBeNull();
    expect(screen.queryByDisplayValue("25")).toBeNull();
    expect(screen.queryByRole("button", { name: /Save policy/ })).toBeNull();
  });

  test("shows the stored caps once loaded, not the defaults", () => {
    render(<IpsLiteCard ips={STORED} isLoading={false} save={noop} />);

    expect(screen.getByDisplayValue("12")).toBeInTheDocument();
    expect(screen.getByDisplayValue("8")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("30")).toBeNull();
  });

  test("labels every cap field", async () => {
    // These inputs shipped unlabelled: <Label> sat next to <Input> with no
    // htmlFor/id pair, so a screen reader announced bare number fields on a
    // form that sets money-adjacent limits.
    const { container } = render(<IpsLiteCard ips={STORED} isLoading={false} save={noop} />);

    expect(screen.getByLabelText(/Max single position/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Max margin utilization/)).toBeInTheDocument();
    await assertNoA11yViolations(container);
  });
});

describe("MarginRateCard", () => {
  test("renders no rate field while loading, so blank cannot be saved as a clear", () => {
    render(<MarginRateCard ips={IPS_LITE_DEFAULTS} isLoading save={noop} />);

    expect(screen.queryByRole("button", { name: /Save rate/ })).toBeNull();
    expect(screen.queryByPlaceholderText("not set")).toBeNull();
  });

  test("shows the stored rate and its verified-on date once loaded", () => {
    render(<MarginRateCard ips={STORED} isLoading={false} save={noop} />);

    expect(screen.getByDisplayValue("11.325")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2026-09-03")).toBeInTheDocument();
  });

  test("leaves the rate field genuinely blank when no rate is stored", () => {
    // Unset is a valid shipped state; the guard must not invent a value for it.
    render(<MarginRateCard ips={IPS_LITE_DEFAULTS} isLoading={false} save={noop} />);

    expect(screen.getByPlaceholderText("not set")).toHaveValue(null);
  });

  test("labels the rate and verified-on fields", async () => {
    const { container } = render(<MarginRateCard ips={STORED} isLoading={false} save={noop} />);

    expect(screen.getByLabelText(/Annual rate/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Verified on/)).toBeInTheDocument();
    await assertNoA11yViolations(container);
  });
});

describe("ObjectiveCard", () => {
  test("does not claim the objective is unset while it is still loading", () => {
    render(<ObjectiveCard goal={undefined} isLoading update={noop} />);

    expect(screen.queryByText(/No objective set yet/)).toBeNull();
    expect(screen.getByText(/Loading the objective/)).toBeInTheDocument();
  });

  test("still reports a genuinely absent objective once loaded", () => {
    render(<ObjectiveCard goal={null} isLoading={false} update={noop} />);

    expect(screen.getByText(/No objective set yet/)).toBeInTheDocument();
  });

  test("shows the stored objective once loaded", () => {
    render(<ObjectiveCard goal={GOAL} isLoading={false} update={noop} />);

    expect(screen.getByDisplayValue("150000")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2027-03-31")).toBeInTheDocument();
  });

  test("has no axe violations", async () => {
    const { container } = render(<ObjectiveCard goal={GOAL} isLoading={false} update={noop} />);
    await assertNoA11yViolations(container);
  });
});
