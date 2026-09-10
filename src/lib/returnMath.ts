// Return, as distinct from change in value (PERF-001).
//
// `portfolioSummary.performance()` computed `latest.net - start.net` and
// reported it as performance. That figure is a change in value, and it equals a
// return only when nothing crossed the portfolio's boundary in the window. A
// $10,000 deposit read as $10,000 earned; a withdrawal read as a loss; both
// carried a percentage.
//
// Two return measures, because they answer different questions and neither
// subsumes the other:
//
//   * TIME-WEIGHTED (TWR) — how the INVESTMENTS did, with the timing and size
//     of deposits removed. It is the honest answer to "was I any good at
//     picking these", and it is what a fund's published return means.
//   * MONEY-WEIGHTED (MWR / XIRR) — how the MONEY did, timing included. It is
//     the honest answer to "what did I actually earn on what I had in".
//
// Both are reported with a label saying which. A percentage that does not say
// whether it is time- or money-weighted is the same class of defect as one that
// does not say its denominator.
//
// Neither is computed at all when the flow history is not known. That is the
// whole point: a TWR computed as though there were no flows IS the defect, with
// a better name on it.

/** A dated portfolio value. Net equity, never gross — see `performance()`. */
export type ValuePoint = { date: string; net: number };

/** A dated external flow. Positive = into the portfolio. */
export type FlowPoint = { date: string; amount: number };

/** Days between two YYYY-MM-DD dates. UTC-anchored at both ends (P0-04). */
function daysBetween(fromIso: string, toIso: string): number {
  return (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000;
}

/**
 * Time-weighted return over a series, with external flows removed.
 *
 * CONVENTION, stated because it changes the answer: a flow dated `d` is treated
 * as having happened at the START of day `d`, so it is already inside day `d`'s
 * closing value. A sub-period running from `p[i-1]` to `p[i]` therefore earns
 *
 *     r = p[i].net / (p[i-1].net + F) − 1,    F = flows in (p[i-1].date, p[i].date]
 *
 * and the window's return is the product of `(1 + r)` less one. Linking rather
 * than averaging is what makes the result independent of when the money arrived.
 *
 * `null`, never a number, when:
 *   * there are fewer than two points — one day compared with itself is not 0%;
 *   * any sub-period starts from a non-positive base, because a return measured
 *     against nothing is undefined and linking through it would silently drop
 *     the whole period before it.
 */
export function timeWeightedReturn(
  series: readonly ValuePoint[],
  flows: readonly FlowPoint[],
): number | null {
  if (series.length < 2) return null;

  let linked = 1;
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1];
    const curr = series[i];
    let flow = 0;
    for (const f of flows) {
      if (f.date > prev.date && f.date <= curr.date) flow += f.amount;
    }
    const base = prev.net + flow;
    // A withdrawal that empties the account, or a start of exactly zero. There
    // is no return to measure across that boundary, and pretending there is
    // would put a −100% or a division by zero into a linked product.
    if (!(base > 0) || !Number.isFinite(curr.net)) return null;
    linked *= curr.net / base;
    if (!Number.isFinite(linked)) return null;
  }
  return linked - 1;
}

/**
 * Money-weighted return (XIRR), annualised.
 *
 * The investor's own cash flows: paying money in is negative to them, the
 * closing value is a positive terminal receipt. Solves
 *
 *     Σ CF_i · (1 + r)^(−t_i / 365) = 0
 *
 * by Newton-Raphson, falling back to bisection when the derivative misbehaves —
 * which it does routinely on short windows with large late flows.
 *
 * `null` when there is no sign change (all money in, or all out: no rate makes
 * that sum zero), when the window is shorter than a day, or when neither method
 * converges. A non-converged XIRR is not a number to round and print.
 */
export function moneyWeightedReturn(
  startValue: number,
  startDate: string,
  endValue: number,
  endDate: string,
  flows: readonly FlowPoint[],
): number | null {
  const span = daysBetween(startDate, endDate);
  if (!Number.isFinite(span) || span < 1) return null;
  if (!Number.isFinite(startValue) || !Number.isFinite(endValue)) return null;

  // From the investor's point of view: the opening position and every
  // contribution are money paid in; the closing value is what comes back.
  const cf: { t: number; amount: number }[] = [{ t: 0, amount: -startValue }];
  for (const f of flows) {
    const t = daysBetween(startDate, f.date);
    if (!Number.isFinite(t) || t < 0 || t > span) continue;
    if (!Number.isFinite(f.amount)) return null;
    cf.push({ t, amount: -f.amount });
  }
  cf.push({ t: span, amount: endValue });

  const hasPositive = cf.some((c) => c.amount > 0);
  const hasNegative = cf.some((c) => c.amount < 0);
  if (!hasPositive || !hasNegative) return null;

  const npv = (rate: number): number => {
    let sum = 0;
    for (const c of cf) sum += c.amount / Math.pow(1 + rate, c.t / 365);
    return sum;
  };

  // Newton-Raphson first: fast where it works.
  let rate = 0.1;
  for (let i = 0; i < 60; i++) {
    const f0 = npv(rate);
    if (!Number.isFinite(f0)) break;
    if (Math.abs(f0) < 1e-9) return rate;
    // Numerical derivative — the analytic one buys nothing here and is one
    // more place for an exponent sign to be wrong.
    const h = 1e-6;
    const d = (npv(rate + h) - f0) / h;
    if (!Number.isFinite(d) || Math.abs(d) < 1e-12) break;
    const next = rate - f0 / d;
    // Below −100% the portfolio owes more than it ever held; the power term is
    // complex there and the iteration has left the domain.
    if (!Number.isFinite(next) || next <= -0.9999) break;
    if (Math.abs(next - rate) < 1e-10) return next;
    rate = next;
  }

  // Bisection over a wide but finite bracket. Deliberately bounded: a "return"
  // outside −99.99%..+10,000% is a data error, and reporting it as a rate would
  // dress that error up as a result.
  let lo = -0.9999;
  let hi = 100;
  let fLo = npv(lo);
  const fHi = npv(hi);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || fLo * fHi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (!Number.isFinite(fMid)) return null;
    if (Math.abs(fMid) < 1e-9 || hi - lo < 1e-12) return mid;
    // `fLo` is reassigned with `lo`. Holding it constant across iterations was
    // the first version of this loop and it converges to the wrong root: after
    // the bracket moves, the sign test is being made against a value from an
    // interval that no longer exists.
    if (fLo * fMid <= 0) {
      hi = mid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return null;
}

/**
 * A period return expressed as an annual rate.
 *
 * Here so a time-weighted period return and an annualised money-weighted one
 * can be put on the same basis before they are shown side by side. Returns
 * `null` for a period shorter than a day, and for a period return at or below
 * −100%: compounding a total loss to an annual rate is not a number.
 */
export function annualise(periodReturn: number | null, days: number): number | null {
  if (periodReturn === null || !Number.isFinite(periodReturn)) return null;
  if (!Number.isFinite(days) || days < 1) return null;
  if (periodReturn <= -1) return null;
  const r = Math.pow(1 + periodReturn, 365 / days) - 1;
  return Number.isFinite(r) ? r : null;
}
