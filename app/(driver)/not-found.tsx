import { NotFoundState } from "@/components/not-found-state";

// 404 for the driver segment (notFound() in the trip-detail page).
export default function DriverNotFound() {
  return <NotFoundState homeHref="/driver" />;
}
