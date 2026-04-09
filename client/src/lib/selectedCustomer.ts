import { storageService } from "@/lib/storageService";

export const CUSTOMER_SELECTION_EVENT = "customer_selection_event";

type UserLike = {
  id: string;
  role?: "admin" | "customer";
} | null | undefined;

export function getSelectedCustomerIdForUser(user: UserLike): string | null {
  if (user?.role === "customer") {
    return user.id;
  }

  return storageService.getSelectedCustomerId();
}

export function setSelectedCustomerId(customerId: string | null) {
  storageService.setSelectedCustomerId(customerId);
}