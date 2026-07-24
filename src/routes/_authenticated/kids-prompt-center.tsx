import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/kids-prompt-center")({
  component: Page,
});

function Page() {
  return (
    <AppShell title="Kids Prompt Center" subtitle="Biweekly Family Investment Committee">
      <Card>
        <CardHeader><CardTitle className="text-base">Family Committee workflow</CardTitle></CardHeader>
        <CardContent className="space-y-1.5 text-sm text-muted-foreground">
          <p>The full Family Investment OS policy v1.0 prompt (parity rule, approved holdings, portfolio score weights) ports here next PR.</p>
          <p>Chat interface arrives in PR 3 — copy/open workflow first.</p>
        </CardContent>
      </Card>
    </AppShell>
  );
}
