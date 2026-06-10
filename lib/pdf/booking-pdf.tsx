import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
} from "@react-pdf/renderer";
import { format } from "date-fns";
import type { Booking, Department, User, Vehicle, Driver, Approval } from "@prisma/client";

export type PdfBooking = Booking & {
  requester: User;
  department: Department;
  vehicle: Vehicle | null;
  primaryDriver: (Driver & { user: User }) | null;
  secondaryDriver: (Driver & { user: User }) | null;
  approvals: (Approval & { approver: User })[];
};

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Helvetica" },
  header: { marginBottom: 16, borderBottom: "1pt solid #333", paddingBottom: 8 },
  title: { fontSize: 16, fontWeight: 700, marginBottom: 2 },
  subtitle: { fontSize: 9, color: "#555" },
  jobNumber: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 4 },
  section: { marginTop: 12 },
  sectionTitle: { fontSize: 10, fontFamily: "Helvetica-Bold", textTransform: "uppercase", letterSpacing: 0.5, color: "#333", marginBottom: 6 },
  row: { flexDirection: "row", marginBottom: 4 },
  label: { width: 130, color: "#666" },
  value: { flex: 1 },
  signatureBlock: { marginTop: 28, flexDirection: "row", justifyContent: "space-between" },
  signatureBox: { width: 220 },
  signatureLine: { borderTop: "1pt solid #333", marginTop: 40, paddingTop: 4, fontSize: 9, color: "#666" },
  signatureImage: { width: 140, height: 60, objectFit: "contain", marginTop: 6 },
  approvalNote: { fontSize: 8, color: "#666", marginTop: 4 },
});

const fmt = (d: Date) => format(d, "EEE d MMM yyyy HH:mm");

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

export function BookingRequestPdf({
  booking,
  signatureDataUri,
}: {
  booking: PdfBooking;
  signatureDataUri: string | null;
}) {
  const decided = booking.approvals.find((a) => a.status === "APPROVED" || a.status === "DENIED");
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Vehicle Booking Request</Text>
          <Text style={styles.subtitle}>Internal use — for finance reimbursement records</Text>
          <Text style={styles.jobNumber}>{booking.jobNumber}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Requester</Text>
          <Field label="Name" value={booking.requester.name ?? booking.requester.email ?? "—"} />
          <Field label="Department" value={booking.department.nameEn} />
          {booking.requester.phone && <Field label="Phone" value={booking.requester.phone} />}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Trip</Text>
          <Field label="Purpose" value={booking.purpose} />
          <Field label="Destination" value={`${booking.destination}, ${booking.province}`} />
          <Field label="Start" value={fmt(booking.startAt)} />
          <Field label="End (back at faculty)" value={fmt(booking.endAt)} />
          <Field label="Passengers" value={String(booking.passengerCount)} />
          {booking.estimatedDistance != null && (
            <Field label="Estimated distance" value={`${booking.estimatedDistance} km`} />
          )}
          {booking.passengerNotes && <Field label="Notes" value={booking.passengerNotes} />}
        </View>

        {booking.vehicle && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Assignment</Text>
            <Field label="Vehicle" value={`${booking.vehicle.registrationNumber} (${booking.vehicle.type})`} />
            {booking.primaryDriver && (
              <Field
                label="Driver"
                value={booking.primaryDriver.user.name ?? booking.primaryDriver.user.email ?? "—"}
              />
            )}
            {booking.secondaryDriver && (
              <Field
                label="Co-driver"
                value={booking.secondaryDriver.user.name ?? booking.secondaryDriver.user.email ?? "—"}
              />
            )}
          </View>
        )}

        <View style={styles.signatureBlock}>
          <View style={styles.signatureBox}>
            <Text style={styles.sectionTitle}>Department Head</Text>
            {signatureDataUri ? (
              // eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer Image renders into a PDF, not a DOM <img>; alt is not applicable
              <Image src={signatureDataUri} style={styles.signatureImage} />
            ) : (
              <View style={{ height: 60 }} />
            )}
            <Text style={styles.signatureLine}>
              {decided?.approver.name ?? decided?.approver.email ?? ""}
            </Text>
            {decided && (
              <Text style={styles.approvalNote}>
                {decided.status === "APPROVED" ? "Approved" : "Denied"} on{" "}
                {decided.decidedAt ? format(decided.decidedAt, "d MMM yyyy") : "—"}
                {decided.comment ? ` · ${decided.comment}` : ""}
              </Text>
            )}
          </View>
          <View style={styles.signatureBox}>
            <Text style={styles.sectionTitle}>Requester</Text>
            <View style={{ height: 60 }} />
            <Text style={styles.signatureLine}>
              {booking.requester.name ?? booking.requester.email ?? ""}
            </Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
