import { useEffect, useState, ReactNode } from "react";
import { useLocation } from "wouter";
import { storageService } from "@/lib/storageService";
import { useAuth } from "@/lib/AuthContext";
import { useSelectedCustomerId } from "@/hooks/use-selected-customer";
import logger from "@/lib/logger"; // Importamos el logger

interface RequireCustomerProps {
  children: ReactNode;
}

export function RequireCustomer({ children }: RequireCustomerProps) {
  const [location, navigate] = useLocation();
  const { isAdmin } = useAuth();
  const selectedCustomerId = useSelectedCustomerId();
  const [hasCustomer, setHasCustomer] = useState<boolean | null>(null);
  
  useEffect(() => {
    const checkCustomer = async () => {
      try {
        if (isAdmin && !selectedCustomerId) {
          setHasCustomer(false);
          if (location !== '/customers') {
            navigate('/customers');
          }
          return;
        }

        if (!selectedCustomerId) {
          setHasCustomer(true);
          return;
        }

        const selectedCustomer = await storageService.getSelectedCustomer();

        if (isAdmin && !selectedCustomer) {
          setHasCustomer(false);
          if (location !== '/customers') {
            navigate('/customers');
          }
          return;
        }

        setHasCustomer(true);
      } catch (error) {
        logger.error("RequireCustomer: error checking selected customer", error);
        setHasCustomer(false);
      }
    };

    void checkCustomer();
  }, [isAdmin, location, navigate, selectedCustomerId]);

  // Don't render children until we confirm a customer is selected
  if (hasCustomer === null || hasCustomer === false) {
    return null;
  }

  return <>{children}</>;
}