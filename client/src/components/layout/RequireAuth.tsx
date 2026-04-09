import { ReactNode, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/AuthContext";
import { authService } from "@/lib/authService";
import logger from "@/lib/logger";
import { Loader2 } from "lucide-react";

interface RequireAuthProps {
  children: ReactNode;
  adminOnly?: boolean;
}

export function RequireAuth({ children, adminOnly = false }: RequireAuthProps) {
  const [, navigate] = useLocation();
  const { isAuthenticated, isAdmin } = useAuth();
  const [isValidating, setIsValidating] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/login");
      return;
    }

    if (adminOnly && !isAdmin) {
      navigate("/");
      return;
    }

    const validateToken = async () => {
      setIsValidating(true);
      const isTokenValid = await authService.validateToken();
      if (!isTokenValid) {
        logger.warn("RequireAuth: Token inválido o caducado, redirigiendo al login");
        navigate("/login");
      }
      setIsValidating(false);
    };

    void validateToken();
  }, [adminOnly, isAdmin, isAuthenticated, navigate]);

  if (!isAuthenticated) {
    return null;
  }

  if (adminOnly && !isAdmin) {
    return null;
  }

  if (isValidating) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <div className="flex items-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Validating session...
        </div>
      </div>
    );
  }

  return <>{children}</>;
}