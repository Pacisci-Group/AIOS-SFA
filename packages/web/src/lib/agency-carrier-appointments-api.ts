import type {
  CarrierAppointmentInput,
  CarrierAppointmentsResponse,
  CarrierAppointmentView,
} from "@sfa/shared";
import { apiFetch } from "@/lib/api-client";

/**
 * The agency's own carrier appointments (PAC-93).
 *
 * Gated on `agency:carrier_appointments:read` / `:write` — a capability with
 * its own blast radius, since a wrong code files this agency's mailer prospects
 * under another tenant. Used by both the owner's first-run setup step and the
 * Workspace Settings page; they render the same editor over the same data.
 */
export const agencyCarrierAppointmentsKey = ["agency-carrier-appointments"] as const;

/**
 * `GET /agency/carrier-appointments`.
 *
 * Returns the pickable carriers alongside the appointments, so the picker never
 * has to call the module-gated `/carriers` and always offers exactly the set
 * the server will validate against.
 */
export function getCarrierAppointments(): Promise<CarrierAppointmentsResponse> {
  return apiFetch<CarrierAppointmentsResponse>("/agency/carrier-appointments");
}

/**
 * `PUT /agency/carrier-appointments` — replace the whole list.
 *
 * Whole-list rather than per-row because "exactly one primary" and "no
 * duplicate pairs" are properties of the list, and because an appointment has
 * no id to address it by. Rows with no code are dropped server-side.
 */
export async function replaceCarrierAppointments(
  appointments: CarrierAppointmentInput[],
): Promise<CarrierAppointmentView[]> {
  const response = await apiFetch<{ appointments: CarrierAppointmentView[] }>(
    "/agency/carrier-appointments",
    { method: "PUT", body: JSON.stringify({ appointments }) },
  );
  return response.appointments;
}
