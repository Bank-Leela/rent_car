import fs from "node:fs/promises";
import path from "node:path";

// Local-disk storage for Phase 2. Real deployments will swap this for S3 or
// equivalent. `UPLOADS_DIR` lives outside `public/` because signatures and
// generated PDFs need access control.
const UPLOADS_DIR = path.join(process.cwd(), "uploads");

export const SIGNATURE_DIR = path.join(UPLOADS_DIR, "signatures");
export const PDF_DIR = path.join(UPLOADS_DIR, "booking-pdfs");

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
