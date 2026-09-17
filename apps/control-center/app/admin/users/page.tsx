import { redirect } from "next/navigation";
import { listStaff, listEvents, ApiError } from "@/lib/api";
import { StaffAdmin } from "@/components/StaffAdmin";

export const dynamic = "force-dynamic";

export default async function StaffAdminPage() {
  try {
    const [staff, events] = await Promise.all([listStaff(), listEvents()]);
    return <StaffAdmin initial={staff.items} events={events.items} />;
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
