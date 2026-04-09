import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { InstanceForm } from "@/components/instances/InstanceForm";
import { InstanceList } from "@/components/instances/InstanceList";

export default function InstancesPage() {
  const [location] = useLocation();
  const [mode, setMode] = useState<'list' | 'edit' | 'new'>('list');
  const [instanceId, setInstanceId] = useState<string | undefined>(undefined);
  const [environmentId, setEnvironmentId] = useState<string | undefined>(undefined);

  useEffect(() => {
    // Parse the location to determine what to display
    if (location.startsWith('/instances?')) {
      // Parse query parameters
      const params = new URLSearchParams(location.split('?')[1]);
      setEnvironmentId(params.get('environment') || undefined);
      setMode('list');
    } else if (location === '/instances') {
      setMode('list');
      setInstanceId(undefined);
      setEnvironmentId(undefined);
    } else if (location.startsWith('/instances/new')) {
      setMode('new');
      setInstanceId(undefined);
      
      // Check if there's an environment parameter
      if (location.includes('?')) {
        const params = new URLSearchParams(location.split('?')[1]);
        setEnvironmentId(params.get('environment') || undefined);
      } else {
        setEnvironmentId(undefined);
      }
    } else if (location.startsWith('/instances/')) {
      setMode('edit');
      setInstanceId(location.split('/instances/')[1]);
      setEnvironmentId(undefined);
    }
  }, [location]);

  return (
    <div className="w-full">
      {mode === 'list' && <InstanceList />}
      {mode === 'new' && <InstanceForm environmentId={environmentId} />}
      {mode === 'edit' && <InstanceForm instanceId={instanceId} />}
    </div>
  );
}
