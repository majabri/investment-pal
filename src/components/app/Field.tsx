// A labelled form field (audit brief G4, folding in #135).
//
// It lived inside `settings.tsx` and rendered a `<Label>` beside its child with
// nothing joining the two, so fifteen controls on the Settings page had a
// visible label and no accessible name. A screen reader announced "edit text",
// and clicking the label did not focus the field.
//
// The association is made ONCE, here, rather than at each call site — the next
// field added at a call site would forget, which is how it got to fifteen.
import { cloneElement, isValidElement, useId } from "react";
import { Label } from "@/components/ui/label";

export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  // `useId` gives a stable id per instance, so two Fields with the same label
  // on one screen do not collide — which a slug derived from the label text
  // would.
  const id = useId();
  // `cloneElement` rather than context: the child is always a single control,
  // and this leaves every call site untouched. A Field wrapping something that
  // is not an element renders as before, unassociated — visible to the guard
  // test rather than silently broken. An explicit `id` on the child wins, so a
  // caller can still point a label somewhere else deliberately.
  const child = isValidElement(children)
    ? cloneElement(children as React.ReactElement<{ id?: string }>, {
        id: (children as React.ReactElement<{ id?: string }>).props.id ?? id,
      })
    : children;
  return (
    <div className={className}>
      <Label className="text-xs text-muted-foreground" htmlFor={id}>
        {label}
      </Label>
      <div className="mt-1">{child}</div>
    </div>
  );
}
