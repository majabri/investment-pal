// One column of the Opportunities price screen.
//
// It lives here rather than inside the route for two reasons. A component
// created during render is a new component type on every render, so React
// unmounts and remounts the whole subtree each time — losing DOM identity and
// any state it grows later (react-hooks/static-components). And a component
// declared at module scope inside a route file breaks fast refresh for that
// file, because the file also exports a non-component `Route`.
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { normaliseSymbol } from "@/lib/universe";
import { fmtUSD } from "@/lib/finance";
import { cn } from "@/lib/utils";

export type MoverRow = { sym: string; price: number; changePct: number };

/** One mover column. Declared at module scope, not inside Page: a component
    created during render is a new component type on every render, so React
    unmounts and remounts the whole subtree each time — losing DOM identity and
    any state it grows later. `held` was the only reason this lived inside the
    component, so it becomes a prop. */
export function MoverList({
  title,
  items,
  tone,
  held,
}: {
  title: string;
  items: readonly MoverRow[];
  tone: "up" | "down";
  held: ReadonlySet<string>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.map((r) => (
          <div
            key={r.sym}
            className="flex items-center justify-between border-b py-1.5 text-sm last:border-0"
          >
            <span className="flex items-center gap-2 font-medium">
              {r.sym}
              {held.has(normaliseSymbol(r.sym)) && (
                <Badge className="px-1.5 py-0 text-[10px]">Held</Badge>
              )}
            </span>
            <span className="flex gap-3 tabular-nums">
              <span>{fmtUSD(r.price, 2)}</span>
              <span
                className={cn(
                  "w-16 text-right",
                  tone === "up" ? "text-emerald-500" : "text-red-500",
                )}
              >
                {r.changePct >= 0 ? "+" : ""}
                {r.changePct.toFixed(2)}%
              </span>
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
