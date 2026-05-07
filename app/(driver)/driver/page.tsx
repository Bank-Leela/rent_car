import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function DriverHome() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Today's assignments</h1>
        <p className="text-muted-foreground">Trips assigned to you for today.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Nothing scheduled</CardTitle>
          <CardDescription>Driver workflow ships in Phase 3.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Phase 0 scaffold only.
        </CardContent>
      </Card>
    </div>
  );
}
