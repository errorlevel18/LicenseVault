import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { HostForm } from "@/components/hosts/HostForm";
import { HostList } from "@/components/hosts/HostList";
import { RequireCustomer } from "@/components/customers/RequireCustomer";
import { CoreMappingPage } from "@/components/hosts/CoreMappingPage";

export default function HostsPage() {
  const [location] = useLocation();
  const [mode, setMode] = useState<'list' | 'edit' | 'new' | 'map-cores'>('list');
  const [hostId, setHostId] = useState<string | undefined>(undefined);

  useEffect(() => {
    // Parse the location to determine what to display
    if (location === '/hosts') {
      setMode('list');
      setHostId(undefined);
    } else if (location === '/hosts/new') {
      setMode('new');
      setHostId(undefined);
    } else if (location.includes('/map-cores')) {
      setMode('map-cores');
      setHostId(location.split('/hosts/')[1].split('/map-cores')[0]);
    } else if (location.startsWith('/hosts/')) {
      setMode('edit');
      setHostId(location.split('/hosts/')[1]);
    }
  }, [location]);

  return (
    <div className="w-full">
      <RequireCustomer>
        {mode === 'list' && <HostList />}
        {(mode === 'edit' || mode === 'new') && <HostForm hostId={hostId} />}
        {mode === 'map-cores' && hostId && <CoreMappingPage hostId={hostId} />}
      </RequireCustomer>
    </div>
  );
}
