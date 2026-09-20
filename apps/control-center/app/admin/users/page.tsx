import { redirect } from "next/navigation";
import { listStaff, ApiError } from "@/lib/api";
import { StaffAccounts } from "@/components/StaffAccounts";

export const dynamic = "force-dynamic";

export default async function StaffAccountsPage() {
  try {
    const staff = await listStaff();
    return <StaffAccounts initial={staff.items} />;
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 401) {
      redirect("/login?next=%2Fadmin%2Fusers&reason=required");
    }
    if (caught instanceof ApiError && caught.status === 403) {
      return (
        <div className="card">
          <div className="cbd">
            <h1 className="htitle">Staff accounts</h1>
            <div className="err" style={{ marginTop: 10 }}>
              {caught.message}
            </div>
          </div>
        </div>
      );
    }
    throw caught;
  }
}
