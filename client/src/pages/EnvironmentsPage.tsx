import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { EnvironmentForm } from "@/components/environments/EnvironmentForm";
import { EnvironmentList } from "@/components/environments/EnvironmentList";
import { RequireCustomer } from "@/components/customers/RequireCustomer";

export default function EnvironmentsPage() {
  const [location] = useLocation();
  const [mode, setMode] = useState<'list' | 'edit' | 'new' | 'details'>('list');
  const [environmentId, setEnvironmentId] = useState<string | undefined>(undefined);

  useEffect(() => {
    // Parse the location to determine what to display
    if (location === '/environments') {
      setMode('list');
      setEnvironmentId(undefined);
    } else if (location === '/environments/new') {
      setMode('new');
      setEnvironmentId(undefined);
    } else if (location.match(/^\/environments\/[^/]+\/details$/)) {
      setMode('details');
      setEnvironmentId(location.split('/environments/')[1].split('/details')[0]);
    } else if (location.startsWith('/environments/')) {
      setMode('edit');
      setEnvironmentId(location.split('/environments/')[1]);
    }
  }, [location]);

  return (
    <div className="w-full">
      <RequireCustomer>
        {mode === 'list' && <EnvironmentList />}
        {(mode === 'edit' || mode === 'new') && <EnvironmentForm environmentId={environmentId} />}
        {mode === 'details' && (
          <div>
            <h2 className="text-2xl font-bold mb-6">Environment Details</h2>
            <EnvironmentForm environmentId={environmentId} />
          </div>
        )}
      </RequireCustomer>
    </div>
  );
}
