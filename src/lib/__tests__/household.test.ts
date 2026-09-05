// Phase 4, rule 22: household is optional, and no dependant is assumed.
//
// Two things are being pinned here, and they fail in different ways:
//
//   * The behaviour — an unknown age is `null`, never 0 and never NaN, and an
//     account's holder comes only from the recorded link.
//   * The absence — the compiled-in roster of three children cannot come back.
//     Removing data once is not a control. The guards at the bottom are
//     structural rather than value-based on purpose: writing three minors'
//     names and birth dates into a test file to prove they are gone from the
//     rest of the tree would put them back in a public repository.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import {
  RELATIONSHIPS,
  ageOf,
  describeMember,
  memberOfAccount,
  membersOfAccounts,
} from "../household";
import { holderLabel, kidAccounts } from "../kidAccounts";

const AT = new Date("2026-09-05T12:00:00");

const member = (over: Partial<{ id: string; display_name: string; birth_date: string | null }> = {}) => ({
  id: "m1",
  display_name: "Alex",
  birth_date: "2014-06-03",
  ...over,
});

describe("ageOf", () => {
  test("whole years, and the birthday counts on the day", () => {
    expect(ageOf("2014-06-03", AT)).toBe(12);
    expect(ageOf("2014-09-05", AT)).toBe(12);
    expect(ageOf("2014-09-06", AT)).toBe(11);
  });

  test("unknown is null, not zero", () => {
    // Rule 13. The version this replaces returned a `number`, so a missing
    // date reached the screen as an age. `Number(new Date("x")) || 0` and
    // `ageOf(undefined!)` both produced something that RENDERED.
    expect(ageOf(null, AT)).toBeNull();
    expect(ageOf(undefined, AT)).toBeNull();
    expect(ageOf("", AT)).toBeNull();
  });

  test("an impossible or malformed date is null, not NaN", () => {
    // `new Date("2014-02-31T12:00:00")` does not throw; it rolls forward. A
    // shape check alone accepts it and every consumer treats it as real.
    expect(ageOf("2014-02-31", AT)).toBeNull();
    expect(ageOf("03/06/2014", AT)).toBeNull();
    expect(ageOf("not a date", AT)).toBeNull();
  });

  test("a future birth date is null, not a negative age", () => {
    expect(ageOf("2030-01-01", AT)).toBeNull();
  });

  test("NEGATIVE CONTROL: a real past date does produce a number", () => {
    // Without this, every assertion above passes on `ageOf = () => null`.
    expect(typeof ageOf("2000-01-01", AT)).toBe("number");
  });
});

describe("memberOfAccount", () => {
  const members = [member(), member({ id: "m2", display_name: "Sam" })];

  test("resolves the recorded link", () => {
    expect(memberOfAccount({ owner_member_id: "m2" }, members)?.display_name).toBe("Sam");
  });

  test("no link is null", () => {
    expect(memberOfAccount({ owner_member_id: null }, members)).toBeNull();
  });

  test("a dangling link is null, not the first member", () => {
    // Falling back to `members[0]` would attribute an account to whoever
    // happened to be added first — the same class of error as the account
    // classifier's old "everything else is Primary".
    expect(memberOfAccount({ owner_member_id: "gone" }, members)).toBeNull();
  });

  test("the account's NAME is never matched against a member's name", () => {
    // The defect Phase 1b removed, arriving by the back door. An account
    // literally called "Alex" with no link stays unlinked.
    const named = { owner_member_id: null, name: "Alex" } as {
      owner_member_id: string | null;
      name: string;
    };
    expect(memberOfAccount(named, members)).toBeNull();
  });
});

describe("describeMember", () => {
  test("name and age when known", () => {
    expect(describeMember(member(), AT)).toBe("Alex 12");
  });

  test("name alone when the birth date is not known", () => {
    // Not "Alex 0". Into a prompt, that is a fact about a person that nobody
    // entered, and the model reasons from it.
    expect(describeMember(member({ birth_date: null }), AT)).toBe("Alex");
  });
});

describe("membersOfAccounts", () => {
  const members = [member(), member({ id: "m2", display_name: "Sam" })];

  test("distinct, in account order, skipping unlinked accounts", () => {
    const out = membersOfAccounts(
      [
        { owner_member_id: "m2" },
        { owner_member_id: null },
        { owner_member_id: "m1" },
        { owner_member_id: "m2" },
      ],
      members,
    );
    expect(out.map((m) => m.display_name)).toEqual(["Sam", "Alex"]);
  });

  test("no accounts, or no links, is an empty roster", () => {
    expect(membersOfAccounts([], members)).toEqual([]);
    expect(membersOfAccounts([{ owner_member_id: null }], members)).toEqual([]);
  });
});

describe("kidAccounts", () => {
  const account = (over = {}) => ({
    id: "a1",
    name: "UTMA 1",
    account_type: "custodial",
    cash: 10,
    owner_member_id: "m1",
    ...over,
  });
  const holding = (over = {}) => ({
    account_id: "a1",
    symbol: "MSFT",
    quantity: 2,
    cost_basis: 300,
    current_price: 400,
    ...over,
  });

  test("selects by TYPE and carries the holder", () => {
    const out = kidAccounts([account()], [holding()], [member()], AT);
    expect(out).toHaveLength(1);
    expect(out[0].holder).toBe("Alex");
    expect(out[0].age).toBe(12);
    expect(out[0].holdings.map((h) => h.symbol)).toEqual(["MSFT"]);
  });

  test("a non-custodial account is not a kid account whatever it is called", () => {
    const out = kidAccounts(
      [account({ account_type: "brokerage", name: "Kids money" })],
      [],
      [member()],
      AT,
    );
    expect(out).toEqual([]);
  });

  test("NEGATIVE CONTROL: an account with no type is excluded, not defaulted in", () => {
    expect(kidAccounts([account({ account_type: null })], [], [member()], AT)).toEqual([]);
  });

  test("no accounts means no kid accounts — there is no seed fallback", () => {
    // The screens used to render `KIDS_SEED` here: three named children with
    // hand-copied positions, presented exactly like the user's own.
    expect(kidAccounts([], [holding()], [member()], AT)).toEqual([]);
  });

  test("unlinked account: no holder, no age, and it still appears", () => {
    const out = kidAccounts([account({ owner_member_id: null })], [], [], AT);
    expect(out).toHaveLength(1);
    expect(out[0].holder).toBeNull();
    expect(out[0].age).toBeNull();
  });

  test("a member with no birth date has no age, and cash stays unknown", () => {
    const out = kidAccounts(
      [account({ cash: null })],
      [],
      [member({ birth_date: null })],
      AT,
    );
    expect(out[0].age).toBeNull();
    expect(out[0].cash).toBeNull();
  });

  test("only this account's holdings", () => {
    const out = kidAccounts(
      [account()],
      [holding(), holding({ account_id: "a2", symbol: "AMZN" }), holding({ account_id: null, symbol: "GOOGL" })],
      [member()],
      AT,
    );
    expect(out[0].holdings.map((h) => h.symbol)).toEqual(["MSFT"]);
  });
});

describe("holderLabel", () => {
  const kid = (over = {}) => ({
    id: "a1",
    name: "UTMA 1",
    holder: "Alex" as string | null,
    age: 12 as number | null,
    cash: null,
    holdings: [],
    ...over,
  });

  test("holder and age when both known", () => {
    expect(holderLabel(kid())).toBe("Alex 12");
  });

  test("holder alone when the age is not known", () => {
    expect(holderLabel(kid({ age: null }))).toBe("Alex");
  });

  test("the account's own name when nobody is linked", () => {
    // Not omitted. A prompt that silently drops an account is a worse lie than
    // one that names it without an age.
    expect(holderLabel(kid({ holder: null, age: null }))).toBe("UTMA 1");
  });
});

describe("the compiled-in roster cannot come back", () => {
  // Structural, not value-based — see the note at the top of this file.
  test("familyPolicy carries no people", () => {
    const text = readFileSync("src/lib/data/familyPolicy.ts", "utf8");
    // Comments stripped first. The comment in that file EXPLAINS what was
    // removed, and it has to name `children` and birth dates to do so. A guard
    // that fires on its own explanation pressures the next person to delete
    // the explanation, which is the opposite of what it is for.
    const code = stripComments(text);
    expect(code).not.toMatch(/\bchildren\s*:/);
    expect(code).not.toMatch(/birth[_ ]?[Dd]ate/);
    // The literal shape of the thing that was there: `{ key: ..., name: ... }`.
    expect(code).not.toMatch(/\bkey\s*:\s*"/);
  });

  test("NEGATIVE CONTROL: those patterns do match the array that was removed", () => {
    // Otherwise the assertions above would pass against a regex that matches
    // nothing — the failure mode that has bitten this suite before.
    const removed = `children: [{ key: "a", name: "A", birthDate: "2014-06-03" }],`;
    expect(removed).toMatch(/\bchildren\s*:/);
    expect(removed).toMatch(/birth[_ ]?[Dd]ate/);
    expect(removed).toMatch(/\bkey\s*:\s*"/);
  });

  test("NEGATIVE CONTROL: comment stripping does not blank the file", () => {
    // If `stripComments` returned "" the guard above would pass forever.
    const code = stripComments(readFileSync("src/lib/data/familyPolicy.ts", "utf8"));
    expect(code).toContain("FAMILY_POLICY");
    expect(code).toContain("targetPerChild");
  });

  test("kidsSeed is gone and does not return", () => {
    expect(existsSync("src/lib/data/kidsSeed.ts")).toBe(false);
    expect(existsSync("src/lib/kidsSeed.ts")).toBe(false);
  });

  test("the relationship vocabulary does not assume a family shape", () => {
    // "dependant", not "child": what the app needs to know is whether a longer
    // horizon and a custodial arrangement apply.
    expect(RELATIONSHIPS).toContain("dependant");
    expect(RELATIONSHIPS as readonly string[]).not.toContain("child");
  });
});

/** Strips `//` and block comments. Crude, and deliberately so — it only ever
 *  runs over source this repo controls. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}
