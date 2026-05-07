import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function ApproverHome() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pending approvals</h1>
        <p className="text-muted-foreground">Review and sign booking requests for your department.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Inbox empty</CardTitle>
          <CardDescription>Approval flow lands in Phase 2.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Phase 0 scaffold only — sign-in, schema, role-based routing.
        </CardContent>
      </Card>
    </div>
  );
}
