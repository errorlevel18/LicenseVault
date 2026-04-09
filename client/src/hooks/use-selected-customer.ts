import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { CUSTOMER_SELECTION_EVENT, getSelectedCustomerIdForUser } from "@/lib/selectedCustomer";

export function useSelectedCustomerId() {
  const { user } = useAuth();
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(() => getSelectedCustomerIdForUser(user));

  useEffect(() => {
    const syncSelectedCustomerId = () => {
      setSelectedCustomerId(getSelectedCustomerIdForUser(user));
    };

    syncSelectedCustomerId();
    window.addEventListener(CUSTOMER_SELECTION_EVENT, syncSelectedCustomerId);

    return () => {
      window.removeEventListener(CUSTOMER_SELECTION_EVENT, syncSelectedCustomerId);
    };
  }, [user]);

  return selectedCustomerId;
}