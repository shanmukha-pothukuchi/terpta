import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import { EmptyState } from "../components/ui";

export default function NotFound() {
  return (
    <div className="mx-auto mt-24 max-w-md">
      <EmptyState icon={Compass} title="Page not found">
        <Link
          to="/"
          className="mt-4 text-sm text-neutral-600 underline hover:text-neutral-900"
        >
          Back to home
        </Link>
      </EmptyState>
    </div>
  );
}
