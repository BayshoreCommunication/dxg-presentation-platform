"use client";

import { useRouter } from "next/navigation";
import { logout } from "@/lib/api";

/** Really signs out, then goes to the sign-in page (D-108). */
export function SignOutButton({ className = "btn" }: { className?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className={className}
      onClick={() =>
        void logout()
          .catch(() => undefined)
          .then(() => {
            router.replace("/login?reason=signed_out");
            router.refresh();
          })
      }
    >
      Sign out
    </button>
  );
}
