import { NotFoundState } from "@/components/not-found-state";

// 404 for the admin segment (notFound() in the booking-detail + calendar-day
// pages). Rendered inside the admin layout, so it keeps the app chrome.
export default function AdminNotFound() {
  return <NotFoundState homeHref="/admin/schedule" />;
}
