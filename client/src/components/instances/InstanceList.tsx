import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Pencil, Trash2, Plus, AlertTriangle, Database } from "lucide-react";
import { Environment, Host, Instance } from "@/lib/types";
import { storageService } from "@/lib/storageService";
import logger from "@/lib/logger"; // Importamos el logger

// Tipo extendido para instancias con información de entorno y host
interface InstanceWithEnvironment extends Instance {
  environmentName: string;
  hostName: string;
  environmentType: string;
  customerName?: string;
}

// Props para componentes más pequeños y reutilizables
interface InstanceRowProps {
  instance: InstanceWithEnvironment;
  onDeleteClick: (instance: InstanceWithEnvironment) => void;
}

interface EnvironmentFilterInfoProps {
  environmentId: string | null;
  onClearFilter: () => void;
}

interface EnvironmentTypeBadgeProps {
  type: string;
}

interface InstanceRowActionsProps {
  instance: InstanceWithEnvironment;
  onDeleteClick: (instance: InstanceWithEnvironment) => void;
}

interface NoInstancesMessageProps {
  isFiltering: boolean;
}

// Componente para mostrar información del filtro de entorno
const EnvironmentFilterInfo = ({ environmentId, onClearFilter }: EnvironmentFilterInfoProps) => {
  const [envName, setEnvName] = useState<string | undefined>(undefined);
  
  useEffect(() => {
    const getEnvironmentName = async () => {
      if (environmentId) {
        const env = await storageService.getEnvironment(environmentId);
        setEnvName(env?.name || 'Unknown Environment');
      }
    };
    
    getEnvironmentName();
  }, [environmentId]);
  
  if (!environmentId) return null;
  
  return (
    <div className="flex items-center mt-1">
      <span className="text-sm text-neutral-500 mr-2">Filtered by environment:</span>
      <Badge variant="secondary">
        {envName || 'Loading...'}
      </Badge>
      <Button 
        variant="ghost" 
        size="sm"
        className="ml-2 h-7 text-xs" 
        onClick={onClearFilter}
      >
        Clear filter
      </Button>
    </div>
  );
};

// Componente para mostrar el badge del tipo de entorno
const EnvironmentTypeBadge = ({ type }: EnvironmentTypeBadgeProps) => (
  <Badge variant="outline" className="bg-primary-100 text-primary-800">
    {type}
  </Badge>
);

// Componente para las acciones de fila (editar, eliminar)
const InstanceRowActions = ({ instance, onDeleteClick }: InstanceRowActionsProps) => (
  <div className="flex justify-end space-x-2">
    <Link href={`/instances/${instance.id}`}>
      <Button variant="ghost" size="icon">
        <Pencil className="h-4 w-4" />
      </Button>
    </Link>
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button 
          variant="ghost" 
          size="icon"
          onClick={() => onDeleteClick(instance)}
        >
          <Trash2 className="h-4 w-4 text-red-500" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you sure?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete the instance {instance.name} from environment {instance.environmentName}.
            This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction 
            onClick={() => onDeleteClick(instance)}
            className="bg-red-500 hover:bg-red-600"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
);

// Componente para una fila de instancia
const InstanceRow = ({ instance, onDeleteClick }: InstanceRowProps) => (
  <TableRow key={instance.id}>
    <TableCell className="font-medium">
      <div className="flex items-center">
        <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
        {instance.name}
      </div>
    </TableCell>
    <TableCell>
      <div className="flex items-center space-x-2">
        <span>{instance.environmentName}</span>
        <EnvironmentTypeBadge type={instance.environmentType} />
      </div>
    </TableCell>
    <TableCell>
      {instance.hostId ? (
        instance.hostName
      ) : (
        <div className="flex items-center text-orange-600 text-xs">
          <AlertTriangle className="h-3 w-3 mr-1" />
          No host assigned
        </div>
      )}
    </TableCell>
    <TableCell>
      {instance.customerName ? (
        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
          {instance.customerName}
        </Badge>
      ) : (
        <span className="text-neutral-500 text-xs">No customer</span>
      )}
    </TableCell>
    <TableCell>{instance.sessions || 'N/A'}</TableCell>
    <TableCell className="text-right">
      <InstanceRowActions 
        instance={instance}
        onDeleteClick={onDeleteClick}
      />
    </TableCell>
  </TableRow>
);

// Componente para mostrar mensaje cuando no hay instancias
const NoInstancesMessage = ({ isFiltering }: NoInstancesMessageProps) => (
  <TableRow>
    <TableCell colSpan={6} className="text-center py-6 text-sm text-neutral-500">
      {isFiltering 
        ? "No instances found for this environment."
        : "No instances found. Add your first database instance to get started."}
    </TableCell>
  </TableRow>
);

export function InstanceList() {
  const [instances, setInstances] = useState<InstanceWithEnvironment[]>([]);
  const [instanceToDelete, setInstanceToDelete] = useState<InstanceWithEnvironment | null>(null);
  const [location, setLocation] = useLocation();
  const [loading, setLoading] = useState<boolean>(true);
  
  // Parse query parameters
  const params = new URLSearchParams(location.split('?')[1] || '');
  const filterEnvironmentId = params.get('environment');
  
  useEffect(() => {
    loadInstances();
  }, [filterEnvironmentId]);

  const loadInstances = async () => {
    setLoading(true);
    try {
      // Usar los métodos que filtran por cliente activo
      const environments = await storageService.getEnvironmentsByCustomer();
      const hosts = await storageService.getHostsByCustomer();
      const customers = await storageService.getCustomers();
      
      let allInstances: InstanceWithEnvironment[] = [];
      
      environments.forEach(env => {
        // If filtering by environmentId, only include instances from that environment
        if (filterEnvironmentId && env.id !== filterEnvironmentId) {
          return;
        }
        
        // Get customer for this environment
        let customerName: string | undefined;
        if (env.customerId) {
          const customer = customers.find(c => c.id === env.customerId);
          customerName = customer?.name;
        }
        
        const envInstances = env.instances.map(instance => {
          const host = hosts.find(h => h.id === instance.hostId);
          
          // If host has a customer ID that's different from environment's, use host's customer
          let instanceCustomerName = customerName;
          if (host?.customerId) {
            const hostCustomer = customers.find(c => c.id === host.customerId);
            if (hostCustomer && (!env.customerId || host.customerId !== env.customerId)) {
              instanceCustomerName = hostCustomer.name;
            }
          }
          
          return {
            ...instance,
            environmentName: env.name,
            environmentType: env.type,
            hostName: host ? host.name : 'Unknown Host',
            customerName: instanceCustomerName
          };
        });
        
        allInstances = [...allInstances, ...envInstances];
      });
      
      setInstances(allInstances);
    } catch (error) {
      logger.error("Error loading instances:", error);
      setInstances([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteClick = (instance: InstanceWithEnvironment) => {
    setInstanceToDelete(instance);
  };

  const handleDeleteInstance = async () => {
    if (!instanceToDelete) return;

    try {
      const { id: instanceId, environmentId } = instanceToDelete;
      
      // Find the environment
      const environment = await storageService.getEnvironment(environmentId);
      if (!environment) {
        throw new Error("Environment not found");
      }
      
      // Remove the instance
      const updatedInstances = environment.instances.filter(i => i.id !== instanceId);
      
      // Update the environment
      await storageService.updateEnvironment(environmentId, {
        instances: updatedInstances
      });
      
      // Refresh the list
      await loadInstances();
      setInstanceToDelete(null);
    } catch (error) {
      logger.error("Error deleting instance:", error);
      alert("Failed to delete instance: " + (error instanceof Error ? error.message : 'Unknown error'));
    }
  };

  const clearEnvironmentFilter = () => {
    setLocation('/instances');
  };
  
  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold">Database Instances</h2>
          <EnvironmentFilterInfo 
            environmentId={filterEnvironmentId} 
            onClearFilter={clearEnvironmentFilter} 
          />
        </div>
        <Link href={filterEnvironmentId ? `/instances/new?environment=${filterEnvironmentId}` : "/instances/new"}>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Add Instance
          </Button>
        </Link>
      </div>
      
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Instance Name</TableHead>
              <TableHead>Environment</TableHead>
              <TableHead>Host</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Sessions</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {instances.length === 0 ? (
              <NoInstancesMessage isFiltering={!!filterEnvironmentId} />
            ) : (
              instances.map((instance) => (
                <InstanceRow 
                  key={instance.id} 
                  instance={instance} 
                  onDeleteClick={handleDeleteClick} 
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Dialogo de confirmación de eliminación */}
      {instanceToDelete && (
        <AlertDialog open={!!instanceToDelete} onOpenChange={() => setInstanceToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete the instance {instanceToDelete.name} from environment {instanceToDelete.environmentName}.
                This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setInstanceToDelete(null)}>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={handleDeleteInstance}
                className="bg-red-500 hover:bg-red-600"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
