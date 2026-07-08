import fs from "node:fs/promises";
import path from "node:path";

// Local-disk storage. On Vercel only `/tmp` is writable at runtime, and even
// that's ephemeral per instance — durable storage (S3 / Vercel Blob) is the
// right answer once the demo phase is over.
const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? process.env.UPLOADS_DIR
  : process.env.VERCEL
    ? "/tmp/rent_car/uploads"
    : path.join(process.cwd(), "uploads");

export const SIGNATURE_DIR = path.join(UPLOADS_DIR, "signatures");
export const PDF_DIR = path.join(UPLOADS_DIR, "booking-pdfs");
export const SIGNED_PDF_DIR = path.join(UPLOADS_DIR, "signed-pdfs");
export const ATTACHMENT_DIR = path.join(UPLOADS_DIR, "booking-attachments");

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export async function writeSignature(userId: string, bytes: Buffer, ext: "png" | "jpg"): Promise<string> {
  await ensureDir(SIGNATURE_DIR);
  const filename = `${userId}.${ext}`;
  const fullPath = path.join(SIGNATURE_DIR, filename);
  // Remove any prior signatures for this user with the other extension.
  const otherExt = ext === "png" ? "jpg" : "png";
  await fs.rm(path.join(SIGNATURE_DIR, `${userId}.${otherExt}`), { force: true });
  await fs.writeFile(fullPath, bytes);
  return `signature:${userId}.${ext}`;
}

export async function readSignatureBytes(storedRef: string): Promise<Buffer | null> {
  if (!storedRef.startsWith("signature:")) return null;
  const filename = storedRef.slice("signature:".length);
  // Defence-in-depth path traversal check.
  if (filename.includes("/") || filename.includes("..")) return null;
  try {
    return await fs.readFile(path.join(SIGNATURE_DIR, filename));
  } catch {
    return null;
  }
}

export async function writeBookingPdf(bookingId: string, bytes: Buffer): Promise<string> {
  await ensureDir(PDF_DIR);
  const filename = `${bookingId}.pdf`;
  await fs.writeFile(path.join(PDF_DIR, filename), bytes);
  return `pdf:${filename}`;
}

export async function readBookingPdf(bookingId: string): Promise<Buffer | null> {
  if (bookingId.includes("/") || bookingId.includes("..")) return null;
  try {
    return await fs.readFile(path.join(PDF_DIR, `${bookingId}.pdf`));
  } catch {
    return null;
  }
}

// The Adobe-Sign–returned, fully-signed PDF for a booking.
export async function writeSignedPdf(bookingId: string, bytes: Buffer): Promise<string> {
  await ensureDir(SIGNED_PDF_DIR);
  await fs.writeFile(path.join(SIGNED_PDF_DIR, `${bookingId}.pdf`), bytes);
  return `signed:${bookingId}.pdf`;
}

export async function readSignedPdf(bookingId: string): Promise<Buffer | null> {
  if (bookingId.includes("/") || bookingId.includes("..")) return null;
  try {
    return await fs.readFile(path.join(SIGNED_PDF_DIR, `${bookingId}.pdf`));
  } catch {
    return null;
  }
}

// Supporting-document attachment alongside a booking's remark (e.g. an
// official memo). One file per booking; re-attaching overwrites the prior one.
export async function writeBookingAttachment(
  bookingId: string,
  ext: string,
  bytes: Buffer,
): Promise<string> {
  await ensureDir(ATTACHMENT_DIR);
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").slice(0, 10) || "bin";
  const filename = `${bookingId}.${safeExt}`;
  await fs.writeFile(path.join(ATTACHMENT_DIR, filename), bytes);
  return `attachment:${filename}`;
}

export async function readBookingAttachment(storedRef: string): Promise<Buffer | null> {
  if (!storedRef.startsWith("attachment:")) return null;
  const filename = storedRef.slice("attachment:".length);
  // Defence-in-depth path traversal check.
  if (filename.includes("/") || filename.includes("..")) return null;
  try {
    return await fs.readFile(path.join(ATTACHMENT_DIR, filename));
  } catch {
    return null;
  }
}

// Outsource quote document (ใบเสนอราคา). Distinct "-quote" filename so it never
// collides with the requester's memo attachment for the same booking.
export async function writeOutsourceQuote(bookingId: string, ext: string, bytes: Buffer): Promise<string> {
  await ensureDir(ATTACHMENT_DIR);
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").slice(0, 10) || "bin";
  const filename = `${bookingId}-quote.${safeExt}`;
  await fs.writeFile(path.join(ATTACHMENT_DIR, filename), bytes);
  return `quote:${filename}`;
}

export async function readOutsourceQuote(storedRef: string): Promise<Buffer | null> {
  if (!storedRef.startsWith("quote:")) return null;
  const filename = storedRef.slice("quote:".length);
  if (filename.includes("/") || filename.includes("..")) return null;
  try {
    return await fs.readFile(path.join(ATTACHMENT_DIR, filename));
  } catch {
    return null;
  }
}
