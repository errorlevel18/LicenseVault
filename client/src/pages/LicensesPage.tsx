import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { LicenseForm } from "@/components/licenses/LicenseForm";
import { LicenseList } from "@/components/licenses/LicenseList";
import { RequireCustomer } from "@/components/customers/RequireCustomer";
import logger from "@/lib/logger"; // Importamos el logger

export default function LicensesPage() {
  const [location] = useLocation();
  const [mode, setMode] = useState<'list' | 'edit' | 'new' | 'assign'>('list');
  const [licenseId, setLicenseId] = useState<string | undefined>(undefined);

  useEffect(() => {
    // Parse the location to determine what to display
    if (location === '/licenses') {
      setMode('list');
      setLicenseId(undefined);
    } else if (location === '/licenses/new') {
      setMode('new');
      setLicenseId(undefined);
    } else if (location.startsWith('/licenses/assign/')) {
      setMode('assign');
      setLicenseId(location.split('/licenses/assign/')[1]);
    } else if (location.startsWith('/licenses/')) {
      setMode('edit');
      setLicenseId(location.split('/licenses/')[1]);
    }
  }, [location]);

  return (
    <div className="w-full">
      <RequireCustomer>
        {mode === 'list' && <LicenseList />}
        {(mode === 'edit' || mode === 'new') && <LicenseForm licenseId={licenseId} />}
        {mode === 'assign' && (
          <div>
            <h2 className="text-2xl font-bold mb-6">Assign License</h2>
            <LicenseForm licenseId={licenseId} />
          </div>
        )}
      </RequireCustomer>
    </div>
  );
}
