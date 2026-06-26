import { NotFoundState } from "@/components/not-found-state";

// 404 for the requester segment (notFound() in the booking-detail page when the
// booking is missing or belongs to another requester).
export default function RequesterNotFound() {
  return <NotFoundState homeHref="/requester" />;
}
