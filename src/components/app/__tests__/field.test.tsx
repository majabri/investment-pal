// The association has to exist at RUNTIME, not just look right in the source
// (audit brief G4, folding in #135).
//
// `Field` rendered a visible label beside its child with nothing joining the
// two, so fifteen Settings controls had a label a person could read and no
// accessible name at all: a screen reader announced "edit text", and clicking
// the label did not focus the field.
import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import axe from "axe-core";

import { Field } from "../Field";
import { Input } from "@/components/ui/input";

async function violations(container: HTMLElement) {
  const r = await axe.run(container, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
    rules: { region: { enabled: false } },
  });
  return r.violations.map((v) => v.id);
}

describe("Field", () => {
  test("the label points at the control it wraps", () => {
    const { container } = render(
      <Field label="Target value ($)">
        <Input defaultValue="150000" />
      </Field>,
    );
    const label = container.querySelector("label")!;
    const input = container.querySelector("input")!;
    expect(label.getAttribute("for")).toBeTruthy();
    expect(label.getAttribute("for")).toBe(input.id);
  });

  test("two Fields with the same label do not collide", () => {
    // A slug derived from the label text would give both the same id, and the
    // second label would focus the first field.
    const { container } = render(
      <>
        <Field label="Name">
          <Input />
        </Field>
        <Field label="Name">
          <Input />
        </Field>
      </>,
    );
    const ids = [...container.querySelectorAll("input")].map((i) => i.id);
    expect(ids[0]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
  });

  test("an explicit id on the child wins", () => {
    // So a caller can still point a label somewhere else deliberately.
    const { container } = render(
      <Field label="Broker">
        <Input id="chosen-by-the-caller" />
      </Field>,
    );
    expect(container.querySelector("input")!.id).toBe("chosen-by-the-caller");
  });

  test("no axe violations", async () => {
    const { container } = render(
      <Field label="Currency">
        <Input defaultValue="USD" />
      </Field>,
    );
    expect(await violations(container)).toEqual([]);
  });

  test("NEGATIVE CONTROL: axe catches the defect this component fixes", async () => {
    // The shape `Field` used to render: a label beside an input, joined by
    // nothing. Without this, the assertion above proves only that axe ran.
    const { container } = render(
      <div>
        <label className="text-xs">Currency</label>
        <input defaultValue="USD" />
      </div>,
    );
    expect(await violations(container)).toContain("label");
  });
});
