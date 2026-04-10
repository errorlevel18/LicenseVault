import React, { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Pencil, Trash2, Plus, AlertTriangle, Copy, ChevronRight, ChevronDown, Search, X, Database, Server } from "lucide-react";
import { useSortableTable } from "@/hooks/use-sortable-table";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { Host, Environment } from "@/lib/types";
import { storageService } from "@/lib/storageService";
import { useSelectedCustomerId } from "@/hooks/use-selected-customer";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import logger from "@/lib/logger"; // Importamos el logger

// Tipos para las props de nuestros componentes extraídos
type HostRowActionsProps = {
  host: Host;
  onOpenClone: (host: Host) => void;
  onDelete: (id: string) => void;
};

type ServerTypeBadgeProps = {
  type: string;
};

type StatCardProps = {
  title: string;
  description: string;
  value: number | string;
};

type FilterBarProps = {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  typeFilter: string;
  onTypeFilterChange: (value: string) => void;
  onClearFilters: () => void;
  showClearButton: boolean;
};

type CloneDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hostToClone: Host | null;
  cloneName: string;
  onCloneNameChange: (value: string) => void;
  cloneVirtualHosts: boolean;
  onCloneVirtualHostsChange: (value: boolean) => void;
  onClone: () => void;
  virtualHosts: Host[];
};

// Componente para las acciones en cada fila (editar, clonar, eliminar)
const HostRowActions = ({ host, onOpenClone, onDelete }: HostRowActionsProps) => (
  <div className="flex justify-end space-x-2">
    <Link href={`/hosts/${host.id}`}>
      <Button variant="ghost" size="icon">
        <Pencil className="h-4 w-4" />
      </Button>
    </Link>
    <Button 
      variant="ghost" 
      size="icon" 
      onClick={() => onOpenClone(host)}
      title="Clone host"
    >
      <Copy className="h-4 w-4" />
    </Button>
    <HostDeleteConfirmation host={host} onDelete={onDelete} />
  </div>
);

// Componente para mostrar el badge del tipo de servidor
const ServerTypeBadge = ({ type }: ServerTypeBadgeProps) => {
  if (type === "Physical") {
    return (
      <Badge variant="outline" className="bg-blue-100 text-blue-800">
        {type}
      </Badge>
    );
  } else if (type === "Virtual") {
    return (
      <Badge variant="outline" className="bg-purple-100 text-purple-800">
        {type}
      </Badge>
    );
  } else if (type === "Oracle Cloud" || type.includes("Cloud")) {
    return (
      <Badge variant="outline" className="bg-green-100 text-green-800">
        {type}
      </Badge>
    );
  }
  return (
    <Badge variant="outline">
      {type}
    </Badge>
  );
};

// Componente para las tarjetas de estadísticas
const StatCard = ({ title, description, value }: StatCardProps) => (
  <Card className="bg-white">
    <CardHeader className="pb-2">
      <CardTitle className="text-lg">{title}</CardTitle>
      <CardDescription>
        {description}
      </CardDescription>
    </CardHeader>
    <CardContent>
      <div className="text-3xl font-bold">
        {value}
      </div>
    </CardContent>
  </Card>
);

// Componente para la barra de filtros
const FilterBar = ({ 
  searchTerm, 
  onSearchChange, 
  typeFilter, 
  onTypeFilterChange, 
  onClearFilters,
  showClearButton 
}: FilterBarProps) => (
  <div className="mb-6 flex flex-wrap gap-4 items-center p-4 bg-slate-50 rounded-lg">
    <div className="relative">
      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        placeholder="Search hosts..."
        className="pl-8 w-56 bg-white"
        value={searchTerm}
        onChange={(e) => onSearchChange(e.target.value)}
      />
    </div>
    
    <Select value={typeFilter} onValueChange={onTypeFilterChange}>
      <SelectTrigger className="w-40 bg-white">
        <SelectValue placeholder="Host Type" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All Types</SelectItem>
        <SelectItem value="Physical">Physical</SelectItem>
        <SelectItem value="Virtual">Virtual</SelectItem>
        <SelectItem value="cloud">Cloud</SelectItem>
      </SelectContent>
    </Select>
    
    {showClearButton && (
      <Button 
        variant="ghost" 
        size="sm" 
        onClick={onClearFilters}
        className="text-sm text-gray-500"
      >
        <X className="h-4 w-4 mr-1" />
        Clear filters
      </Button>
    )}
  </div>
);

// Componente para el diálogo de clonación
const CloneDialog = ({ 
  open, 
  onOpenChange, 
  hostToClone, 
  cloneName, 
  onCloneNameChange, 
  cloneVirtualHosts, 
  onCloneVirtualHostsChange, 
  onClone,
  virtualHosts
}: CloneDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Clone Host</DialogTitle>
        <DialogDescription>
          Enter a name for the cloned host.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-4">
        <div className="grid grid-cols-4 items-center gap-4">
          <Label htmlFor="name" className="text-right">
            Name
          </Label>
          <Input 
            id="name" 
            value={cloneName} 
            onChange={(e) => onCloneNameChange(e.target.value)} 
            className="col-span-3" 
            autoFocus
          />
        </div>        {hostToClone?.serverType === "Physical" && virtualHosts.length > 0 && (
          <div className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="cloneVirtualHosts" 
                checked={cloneVirtualHosts} 
                onCheckedChange={(checked) => onCloneVirtualHostsChange(checked === true)}
              />
              <div className="grid gap-1.5 leading-none">
                <label
                  htmlFor="cloneVirtualHosts"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Clonar también servidores virtuales dependientes
                </label>
                <p className="text-sm text-muted-foreground">
                  Se clonarán también {virtualHosts.length} servidor(es) virtual(es) que dependen de este host físico.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={onClone} disabled={!cloneName.trim()}>
          Clone Host
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

// Define a new interface for the HostDeleteConfirmation component
interface HostDeleteConfirmationProps {
  host: Host;
  onDelete: (id: string) => void;
}

// Create a new component to handle host deletion confirmation
const HostDeleteConfirmation = ({ host, onDelete }: HostDeleteConfirmationProps) => {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await onDelete(host.id);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon">
          <Trash2 className="h-4 w-4 text-red-500" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you sure?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="text-sm text-muted-foreground">
              This will permanently delete the host <strong>{host.name}</strong>.
              <div className="mt-2 text-amber-600">
                <AlertTriangle className="h-4 w-4 inline mr-1" />
                <span>Warning: If this host has instances assigned to it, those instances will be deleted, which may affect environments.</span>
              </div>
              <div className="mt-2">
                This action cannot be undone.
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction 
            onClick={handleDelete}
            className="bg-red-500 hover:bg-red-600"
            disabled={isDeleting}
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export function HostList() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [hostToDelete, setHostToDelete] = useState<string | null>(null);
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const [hostToClone, setHostToClone] = useState<Host | null>(null);
  const [cloneName, setCloneName] = useState("");
  const [cloneVirtualHosts, setCloneVirtualHosts] = useState(false);
  const [expandedHosts, setExpandedHosts] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [location] = useLocation();
  const selectedCustomerId = useSelectedCustomerId();

  // Cargar datos iniciales y cuando cambia la ubicación O el cliente seleccionado
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      setError(null);
      try {
        await loadHosts();
        await loadEnvironments(); // Consider if this also needs customer dependency
      } catch (error) {
        logger.error("Error loading data:", error);
        setError("Failed to load hosts. Please refresh the page.");
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [selectedCustomerId, location]); // Add location as a dependency to reload when navigation occurs

  // Display error toast when error state changes
  useEffect(() => {
    if (error) {
      toast({
        title: "Error",
        description: error,
        variant: "destructive"
      });
    }
  }, [error, toast]);

  const loadHosts = async () => {
    try {
      // getHostsByCustomer already uses the selected customer ID internally
      const allHosts = await storageService.getHostsByCustomer();
      
      // Check if allHosts is an array before mapping
      if (!allHosts || !Array.isArray(allHosts)) {
        console.warn("getHostsByCustomer did not return an array:", allHosts);
        setHosts([]);
        return [];
      }
      
      // Fix any hosts that might have undefined serverType
      const fixedHosts = allHosts.map(host => {
        // Extract properties using only TypeScript-compatible property names
        const serverType = host.serverType;
        const virtualizationType = host.virtualizationType;
        const physicalHostId = host.physicalHostId;
        const coreCount = host.coreCount;
        const threadCount = host.threadCount;
        const hasHardPartitioning = host.hasHardPartitioning;
        
        // Handle any raw data from API that might come with non-standard property names
        const hostData = host as any; // Use any to access possible non-standard properties
        
        // Determine correct serverType value
        let normalizedServerType: 'Physical' | 'Virtual' | 'Oracle Cloud';
        
        if (!serverType && !hostData.server_type) {
          // Apply default serverType based on other properties
          normalizedServerType = physicalHostId || hostData.physical_host_id ? 'Virtual' : 'Physical';
        } else if (
          serverType === 'Physical' || 
          serverType === 'Virtual' || 
          serverType === 'Oracle Cloud' ||
          hostData.server_type === 'Physical' ||
          hostData.server_type === 'Virtual' ||
          hostData.server_type === 'Oracle Cloud'
        ) {
          normalizedServerType = (serverType || hostData.server_type) as 'Physical' | 'Virtual' | 'Oracle Cloud';
        } else {
          // Handle any other string value by mapping it to one of our allowed values
          const typeStr = String(serverType || hostData.server_type || "").toLowerCase();
          if (typeStr.includes('cloud') || typeStr.includes('oracle')) {
            normalizedServerType = 'Oracle Cloud';
          } else if (typeStr === 'virtual' || typeStr.includes('vm')) {
            normalizedServerType = 'Virtual';
          } else {
            normalizedServerType = 'Physical'; // Default
          }
        }
        
        // Return a host with the correct TypeScript properties
        return {
          ...host,
          serverType: normalizedServerType,
          virtualizationType: virtualizationType || hostData.virtualization_type,
          physicalHostId: physicalHostId || hostData.physical_host_id,
          coreCount: coreCount || hostData.core_count,
          threadCount: threadCount || hostData.thread_count,
          hasHardPartitioning: hasHardPartitioning || hostData.has_hard_partitioning
        };
      });
      
      setHosts(fixedHosts || []);
      return fixedHosts;
    } catch (error) {
      setHosts([]);
      throw new Error("Failed to load hosts");
    }
  };

  const loadEnvironments = async () => {
    try {
      // Use getEnvironments instead of non-existent getEnvironmentsByCustomer
      const allEnvironments = await storageService.getEnvironments();
      // Filter environments by customer ID manually
      const customerEnvironments = allEnvironments.filter(env => 
        !env.customerId || env.customerId === selectedCustomerId
      );
      setEnvironments(customerEnvironments || []);
      return customerEnvironments;
    } catch (error) {
      logger.error("Error loading environments:", error);
      setEnvironments([]);
      return [];
    }
  };

  // Helper function to find instances running on a specific host
  const getInstancesForHost = (hostId: string): {name: string, environmentName: string}[] => {
    const instancesOnHost: {name: string, environmentName: string}[] = [];
    
    // We won't try to access env.instances since it's not in the Environment type
    // Instead we'd need to implement this differently using proper APIs
    // This is a placeholder that returns an empty array for now
    
    return instancesOnHost;
  };
  
  const openCloneDialog = (host: Host) => {
    setHostToClone(host);
    setCloneName(`${host.name} (Clone)`); // Default name suggestion
    setCloneDialogOpen(true);
  };

  const handleCloneHost = async () => {
    if (!hostToClone || !cloneName.trim()) return;
    
    try {
      await storageService.cloneHost(hostToClone.id, cloneName.trim(), cloneVirtualHosts);
      
      await loadHosts();
      setCloneDialogOpen(false);
      setHostToClone(null);
      setCloneName("");
      setCloneVirtualHosts(false);
    } catch (error) {
      logger.error("Error cloning host:", error);
      alert("Failed to clone host. Please try again.");
    }
  };
  const handleDeleteHost = async (id: string) => {
    // Check for virtual hosts
    const virtualHosts = Array.isArray(hosts) ? hosts.filter(h => h.physicalHostId === id) : [];
    if (virtualHosts.length > 0) {
      toast({
        title: "Cannot delete host",
        description: `Cannot delete this host because it is the physical host for ${virtualHosts.length} virtual machines. Please reassign or delete those virtual machines first.`,
        variant: "destructive"
      });
      return;
    }

    try {
      const success = await storageService.deleteHost(id);
      if (success) {
        setHosts(Array.isArray(hosts) ? hosts.filter(host => host.id !== id) : []);
        setHostToDelete(null);
      }
    } catch (error: any) {
      // Check if the error contains information about instances and environments
      if (error.message && error.message.includes("Cannot delete host because it has")) {
        toast({
          title: "Cannot delete host",
          description: error.message,
          variant: "destructive"
        });
      } else {
        // Default error message
        toast({
          title: "Error",
          description: "Failed to delete host. Please try again.",
          variant: "destructive"
        });
        logger.error("Error deleting host:", error);
      }
    }
  };

  // Toggle expansion state of a physical host
  const toggleHostExpansion = (hostId: string) => {
    const newExpandedHosts = new Set(expandedHosts);
    if (newExpandedHosts.has(hostId)) {
      newExpandedHosts.delete(hostId);
    } else {
      newExpandedHosts.add(hostId);
    }
    setExpandedHosts(newExpandedHosts);
  };

  // Group hosts by physical/virtual
  const physicalHosts = Array.isArray(hosts) ? hosts.filter(h => h.serverType === "Physical") : [];
  
  // Create a map of virtual hosts by parent physical host ID
  const virtualHostsByParent: Record<string, Host[]> = {};
  if (Array.isArray(hosts)) {
    hosts.forEach(host => {
      if (host.physicalHostId) {
        if (!virtualHostsByParent[host.physicalHostId]) {
          virtualHostsByParent[host.physicalHostId] = [];
        }
        virtualHostsByParent[host.physicalHostId].push(host);
      }
    });
  }
  
  // Virtual hosts without assigned physical parent
  const orphanVirtualHosts = Array.isArray(hosts) ? hosts.filter(h => h.serverType === "Virtual" && !h.physicalHostId) : [];
  
  // Cloud hosts (Oracle Cloud, etc.)
  const cloudHosts = Array.isArray(hosts) ? hosts.filter(h => h.serverType === "Oracle Cloud") : [];

  // Aplicar filtros a la lista completa de hosts
  const filteredHosts = Array.isArray(hosts) ? hosts.filter(host => {
    // Normalize server type from different possible property names
    const serverType = host.serverType || (host as any).server_type || "Unknown";
    
    const matchesSearch = searchTerm === "" || 
      host.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (host.cpuModel || "").toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesType = typeFilter === "all" || 
      (typeFilter === "cloud" && (serverType === "Oracle Cloud" || serverType.toLowerCase().includes("cloud"))) ||
      serverType.toLowerCase().includes(typeFilter.toLowerCase());
    
    return matchesSearch && matchesType;
  }) : [];

  // Sort filtered hosts
  const { sortedData: sortedFilteredHosts, sortConfig, requestSort } = useSortableTable(filteredHosts);


  // Verificar si hay hosts virtuales dependientes del host a clonar
  const getVirtualHostsForPhysical = (physicalHostId: string): Host[] => {
    return Array.isArray(hosts) ? hosts.filter(h => h.serverType === "Virtual" && h.physicalHostId === physicalHostId) : [];
  };

  // Estadísticas para las tarjetas de resumen
  const physicalHostCount = Array.isArray(hosts) ? hosts.filter(h => 
    h.serverType === "Physical"
  ).length : 0;
  
  const virtualHostCount = Array.isArray(hosts) ? hosts.filter(h => 
    h.serverType === "Virtual"
  ).length : 0;
  
  const totalCpuCores = Array.isArray(hosts) ? hosts.reduce((sum, host) => sum + (host.cores || 0), 0) : 0;

  // Resetear filtros
  const clearFilters = () => {
    setSearchTerm("");
    setTypeFilter("all");
  };

  // Verificar si hay filtros activos
  const hasActiveFilters = searchTerm !== "" || typeFilter !== "all";

  // Agrupar hosts filtrados por tipo - fix case sensitivity issues
  const filteredPhysicalHosts = Array.isArray(sortedFilteredHosts) ? sortedFilteredHosts.filter(h => 
    h.serverType === "Physical"
  ) : [];
  
  const filteredOrphanVirtualHosts = Array.isArray(sortedFilteredHosts) ? sortedFilteredHosts.filter(h => 
    h.serverType === "Virtual" && !h.physicalHostId
  ) : [];
  
  const filteredCloudHosts = Array.isArray(sortedFilteredHosts) ? sortedFilteredHosts.filter(h => 
    h.serverType === "Oracle Cloud"
  ) : [];

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Host Management</h2>
        <div className="flex space-x-2">
          {hosts.length > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete All
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Eliminar todos los hosts?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Se eliminarán los {hosts.length} host(s) del cliente seleccionado, junto con sus instancias y asignaciones de cores. Esta acción no se puede deshacer.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={async () => {
                      if (!selectedCustomerId) return;
                      try {
                        const deleted = await storageService.deleteAllHosts(selectedCustomerId);
                        setHosts([]);
                        toast({ title: 'Hosts eliminados', description: `${deleted} host(s) eliminados correctamente.` });
                      } catch (err: any) {
                        toast({ title: 'Error', description: err.message || 'No se pudieron eliminar los hosts.', variant: 'destructive' });
                      }
                    }}
                  >
                    Eliminar todos
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <Link href="/hosts/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Host
            </Button>
          </Link>
        </div>
      </div>

      {/* Filtros */}
      <FilterBar 
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        onClearFilters={clearFilters}
        showClearButton={hasActiveFilters}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard 
          title="Physical Servers" 
          description="Physical hardware servers" 
          value={physicalHostCount} 
        />

        <StatCard 
          title="Virtual Machines" 
          description="VM instances" 
          value={virtualHostCount} 
        />

        <StatCard 
          title="Total Servers" 
          description="All server instances" 
          value={physicalHostCount + virtualHostCount} 
        />
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableTableHead column="name" sortConfig={sortConfig} onSort={requestSort}>Host Name</SortableTableHead>
              <SortableTableHead column="serverType" sortConfig={sortConfig} onSort={requestSort}>Type</SortableTableHead>
              <SortableTableHead column="virtualizationType" sortConfig={sortConfig} onSort={requestSort}>Virtualization Type</SortableTableHead>
              <SortableTableHead column="cpuModel" sortConfig={sortConfig} onSort={requestSort}>CPU Model</SortableTableHead>
              <SortableTableHead column="cores" sortConfig={sortConfig} onSort={requestSort}>Cores</SortableTableHead>
              <SortableTableHead column="sockets" sortConfig={sortConfig} onSort={requestSort}>Sockets</SortableTableHead>
              <SortableTableHead column="hasHardPartitioning" sortConfig={sortConfig} onSort={requestSort}>Hard Partitioning</SortableTableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {hosts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-6 text-sm text-neutral-500">
                  No hosts found. Add your first server to get started.
                </TableCell>
              </TableRow>
            ) : filteredHosts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-6 text-sm text-neutral-500">
                  No hosts match your filter criteria.
                </TableCell>
              </TableRow>
            ) : (
              <>
                {/* Physical hosts with their virtual children */}
                {filteredPhysicalHosts.map((host) => (
                  <React.Fragment key={host.id}>
                    <TableRow className="bg-white hover:bg-slate-100">
                      <TableCell className="font-medium">
                        <div className="flex items-center">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-6 w-6 p-0 mr-1"
                            onClick={() => toggleHostExpansion(host.id)}
                            disabled={!virtualHostsByParent[host.id] || virtualHostsByParent[host.id].length === 0}
                          >
                            {virtualHostsByParent[host.id] && virtualHostsByParent[host.id].length > 0 ? (
                              expandedHosts.has(host.id) ? 
                                <ChevronDown className="h-4 w-4" /> : 
                                <ChevronRight className="h-4 w-4" />
                            ) : <span className="w-4"></span>}
                          </Button>
                            <div className="flex items-center">
                              <Server className="h-5 w-5 mr-3 text-indigo-500" />
                              {host.name}
                            </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <ServerTypeBadge type={host.serverType} />
                      </TableCell>
                      <TableCell>{host.virtualizationType || '-'}</TableCell>
                      <TableCell>{host.cpuModel}</TableCell>
                      <TableCell>{host.cores}</TableCell>
                      <TableCell>{host.sockets}</TableCell>
                      <TableCell>{host.hasHardPartitioning ? 'Yes' : 'No'}</TableCell>
                      <TableCell className="text-right">
                        <HostRowActions 
                          host={host} 
                          onOpenClone={openCloneDialog} 
                          onDelete={handleDeleteHost} 
                        />
                      </TableCell>
                    </TableRow>
                    {/* Virtual hosts belonging to this physical host */}
                    {expandedHosts.has(host.id) &&
                      virtualHostsByParent[host.id]?.map((virtualHost) => (
                        <TableRow key={virtualHost.id} className="bg-white hover:bg-slate-50 border-l-4 border-l-purple-200">
                          <TableCell className="font-medium">
                            <div className="pl-7 flex items-center">
                              <Badge variant="outline" className="bg-purple-50 text-purple-600 mr-2 px-1 py-0 h-5">
                                VM
                              </Badge>
                              {virtualHost.name}
                            </div>
                          </TableCell>
                          <TableCell>
                            <ServerTypeBadge type={virtualHost.serverType} />
                          </TableCell>
                          <TableCell>{virtualHost.virtualizationType || '-'}</TableCell>
                          <TableCell>{virtualHost.cpuModel}</TableCell>
                          <TableCell>{virtualHost.cores}</TableCell>
                          <TableCell>{virtualHost.sockets}</TableCell>
                          <TableCell>{virtualHost.hasHardPartitioning ? 'Yes' : 'No'}</TableCell>
                          <TableCell className="text-right">
                            <HostRowActions 
                              host={virtualHost} 
                              onOpenClone={openCloneDialog} 
                              onDelete={handleDeleteHost} 
                            />
                          </TableCell>
                        </TableRow>
                      ))
                    }
                  </React.Fragment>
                ))}

                {/* Virtual hosts without a physical parent (orphaned) */}
                {filteredOrphanVirtualHosts.length > 0 && (
                  <>
                    <TableRow className="bg-amber-50">
                      <TableCell colSpan={7} className="font-medium text-amber-800">
                        <div className="flex items-center">
                          <AlertTriangle className="h-4 w-4 mr-2" />
                          Virtual hosts without assigned physical servers
                        </div>
                      </TableCell>
                    </TableRow>
                    {filteredOrphanVirtualHosts.map((host) => (
                        <TableRow key={host.id} className="bg-white hover:bg-slate-50 border-l-4 border-l-amber-200">
                          <TableCell className="font-medium">
                            <div className="pl-7">
                              {host.name}
                            </div>
                          </TableCell>
                          <TableCell>
                            <ServerTypeBadge type={host.serverType} />
                          </TableCell>
                          <TableCell>{host.virtualizationType || '-'}</TableCell>
                          <TableCell>{host.cpuModel}</TableCell>
                          <TableCell>{host.cores}</TableCell>
                          <TableCell>{host.sockets}</TableCell>
                          <TableCell>{host.hasHardPartitioning ? 'Yes' : 'No'}</TableCell>
                          <TableCell className="text-right">
                            <HostRowActions 
                              host={host} 
                              onOpenClone={openCloneDialog} 
                              onDelete={handleDeleteHost} 
                            />
                          </TableCell>
                        </TableRow>
                    ))}
                  </>
                )}

                {/* Cloud hosts (Oracle Cloud, etc.) - Mostrados directamente sin agrupación */}
                {filteredCloudHosts.map((host) => (
                  <TableRow key={host.id} className="bg-white hover:bg-slate-100">
                    <TableCell className="font-medium">
                      <div className="flex items-center">
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-6 w-6 p-0 mr-1"
                          disabled={true}
                        >
                          <span className="w-4"></span>
                        </Button>
                        {host.name}
                      </div>
                    </TableCell>
                    <TableCell>
                      <ServerTypeBadge type={host.serverType} />
                    </TableCell>
                    <TableCell>{host.virtualizationType || '-'}</TableCell>
                    <TableCell>{host.cpuModel}</TableCell>
                    <TableCell>{host.cores}</TableCell>
                    <TableCell>{host.sockets}</TableCell>
                    <TableCell>{host.hasHardPartitioning ? 'Yes' : 'No'}</TableCell>
                    <TableCell className="text-right">
                      <HostRowActions 
                        host={host} 
                        onOpenClone={openCloneDialog} 
                        onDelete={handleDeleteHost} 
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Clone Dialog */}
      {hostToClone && (
        <CloneDialog
          open={cloneDialogOpen}
          onOpenChange={setCloneDialogOpen}
          hostToClone={hostToClone}
          cloneName={cloneName}
          onCloneNameChange={setCloneName}
          cloneVirtualHosts={cloneVirtualHosts}
          onCloneVirtualHostsChange={setCloneVirtualHosts}
          onClone={handleCloneHost}
          virtualHosts={hostToClone.serverType === 'Physical' 
            ? getVirtualHostsForPhysical(hostToClone.id) 
            : []}
        />
      )}
    </div>
  );
}