import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SignatureForm, DelegateForm } from "@/components/forms/signature-form";

export default async function ApproverProfile() {
  const session = await requireRole("APPROVER");
  const me = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: {
      signatureImageUrl: true,
      delegatedTo: { select: { email: true } },
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="text-muted-foreground">Set up your signature and (optionally) delegate signing authority.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Stored signature</CardTitle>
          <CardDescription>
            {me.signatureImageUrl
              ? "A signature is on file. It will be embedded in PDFs you approve."
              : "No signature on file. You can still approve without one — the PDF will leave the signature blank."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignatureForm hasSignature={!!me.signatureImageUrl} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Delegation</CardTitle>
          <CardDescription>
            Pick an administrative staff member who can approve on your behalf.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DelegateForm currentDelegateEmail={me.delegatedTo?.email ?? null} />
        </CardContent>
      </Card>
    </div>
  );
}
