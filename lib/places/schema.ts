import { z } from "zod";

const labelField = z.string().trim().min(1, "Name this place").max(100);
const destinationField = z.string().trim().min(2, "Required").max(300);
const provinceField = z.string().trim().min(2, "Required").max(100);
// Optional on a place: a place can be saved before its Maps link is known.
// http(s) only — rendered as a clickable href, so reject javascript:/data:.
const mapsField = z
  .string()
  .trim()
  .url("Add a valid Google Maps link")
  .refine((v) => /^https?:\/\//i.test(v), "Add a valid Google Maps link")
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : undefined));

export const createPlaceSchema = z.object({
  label: labelField,
  destination: destinationField,
  province: provinceField,
  googleMapsUrl: mapsField,
});

export const updatePlaceSchema = createPlaceSchema.extend({
  id: z.string().min(1),
});

export const deletePlaceSchema = z.object({ id: z.string().min(1) });

export type NewPlaceInput = z.infer<typeof createPlaceSchema>;
