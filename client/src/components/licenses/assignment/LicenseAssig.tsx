import { Suspense, lazy, useState, useEffect, useMemo, useCallback } from "react";
// Link no se usa directamente aquí, pero podría ser necesario si se añaden links en el futuro
// import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle } from "@/components/ui/card"; // CardContent, CardDescription no se usan directamente aquí
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  // SelectGroup, // No usado
  SelectItem,
  // SelectLabel, // No usado
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
// Checkbox no se usa directamente aquí
// import { Checkbox } from "@/components/ui/checkbox";
import { License, Host, Environment } from "@/lib/types"; // CoreLicenseAssignment, Instance no se usan directamente aquí
import { storageService } from "@/lib/storageService";
import { CoreSelectionDialog } from "@/components/licenses/assignment/CoreSelectionDialog";
import { Search, Filter, Ban, Loader2 } from "lucide-react"; // X, SlidersHorizontal, Check, Cpu, Microchip, Server, Info, XCircle, Database, Monitor, CreditCard, RefreshCw no se usan directamente aquí
import { useToast } from "@/hooks/use-toast";
import logger from "@/lib/logger";
import apiClient from "@/lib/apiClient"; // Add this import
import {
  countAssignedCoresForLicense,
  hostHasAssignments,
  isLicenseAssignedToHost as hostHasLicenseAssignment,
} from "./assignment-utils";

// Importar los nuevos componentes de las pestañas
import { LicenseAssig_ViewMatriz } from "./LicenseAssig_ViewMatriz";
import { LicenseAssig_ViewCores } from "./LicenseAssig_ViewCores";

const LicenseAssig_ViewFlow = lazy(() =>
  import("./LicenseAssig_ViewFlow").then((module) => ({
    default: module.LicenseAssig_ViewFlow,
  })),
);

function AssignmentTabFallback({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-[20rem] items-center justify-center text-muted-foreground">
      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
      <span>Cargando {label}...</span>
    </div>
  );
}

export function LicenseAssignment() {
  const { toast } = useToast();
  const [licenses, setLicenses] = useState<License[]>([]);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [selectedLicense, setSelectedLicense] = useState<License | null>(null);
  const [selectedHost, setSelectedHost] = useState<Host | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [hostType, setHostType] = useState<string>("all");
  const [csiFilter, setCsiFilter] = useState<string>("all");
  const [metricFilter, setMetricFilter] = useState<string>("all");
  const [coreDialogOpen, setCoreDialogOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedHostIds, setSelectedHostIds] = useState<string[]>([]);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const MAX_SELECTED_HOSTS = 4;

  // Cargar datos
  useEffect(() => {
    const loadData = async () => {
      try {
        const [loadedLicenses, loadedHosts, loadedEnvironments] = await Promise.all([
          storageService.getLicensesByCustomer(),
          storageService.getHostsByCustomer(),
          storageService.getEnvironmentsByCustomer()
        ]);

        const licensesArray = Array.isArray(loadedLicenses) ? loadedLicenses : [];
        const hostsArray = Array.isArray(loadedHosts) ? loadedHosts : [];
        const environmentsArray = Array.isArray(loadedEnvironments) ? loadedEnvironments : [];

        setLicenses(licensesArray);
        setHosts(hostsArray);
        setEnvironments(environmentsArray);

        if (selectedHostIds.length === 0 && hostsArray.length > 0) {
          const hostsWithLicenses = hostsArray.filter((host) => hostHasAssignments(host));

          if (hostsWithLicenses.length > 0) {
            setSelectedHostIds(hostsWithLicenses.slice(0, MAX_SELECTED_HOSTS).map(h => h.id));
          } else {
            setSelectedHostIds(hostsArray.slice(0, MAX_SELECTED_HOSTS).map(h => h.id));
          }
        }
      } catch (error) {
        logger.error("Error loading data:", error);
        toast({ title: "Error", description: "Failed to load data", variant: "destructive" });
      }
    };

    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // No incluir selectedHostIds para evitar recargas no deseadas

  // Filtrar hosts según criterios - solo mostrar hosts físicos
  const filteredHosts = useMemo(() => hosts.filter(host => {
    // Solo considerar hosts físicos (no virtuales)
    if (host.serverType === 'Virtual') return false;
    
    const matchesSearch = searchTerm === "" ||
      host.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = hostType === "all" || host.serverType === hostType;
    return matchesSearch && matchesType;
  }), [hosts, searchTerm, hostType]);

  // Filtrar licencias según criterios
  const filteredLicenses = useMemo(() => licenses.filter(license => {
    const matchesSearch = searchTerm === "" ||
      (license.product && license.product.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesCSI = csiFilter === "all" || (license.csi === csiFilter);
    const matchesMetric = metricFilter === "all" || license.metric === metricFilter;
    return matchesSearch && matchesCSI && matchesMetric;
  }), [licenses, searchTerm, csiFilter, metricFilter]);

  // Obtener todas las CSIs únicas para el filtro
  const uniqueCSIs = useMemo(() => Array.from(new Set(licenses.map(license => license.csi || "Sin CSI"))), [licenses]);

  // Manejar la asignación de licencias
  const handleLicenseAssign = useCallback((host: Host) => {
    if (!selectedLicense) return;
    setSelectedHost(host);
    setCoreDialogOpen(true);
  }, [selectedLicense]);

  // Confirmar la selección de cores
  const handleCoreSelectionConfirm = useCallback(async (selectedCoreIds: number[], coreMappings?: Record<number, number>) => {
    if (!selectedHost || !selectedLicense) return;

    try {
      await apiClient.post(
        `/licenses/${selectedLicense.id}/assign-to-host/${selectedHost.id}`, 
        { 
          selectedCoreIds: selectedCoreIds,
          coreMappings: selectedHost.hasHardPartitioning ? coreMappings : undefined 
        }
      );

        // Recargar todos los datos para asegurar consistencia
      const [reloadedLicenses, reloadedHosts, reloadedEnvironments] = await Promise.all([
        storageService.getLicensesByCustomer(),
        storageService.getHostsByCustomer(),
        storageService.getEnvironmentsByCustomer()
      ]);
      
      setLicenses(Array.isArray(reloadedLicenses) ? reloadedLicenses : []);
      setHosts(Array.isArray(reloadedHosts) ? reloadedHosts : []);
      setEnvironments(Array.isArray(reloadedEnvironments) ? reloadedEnvironments : []);

      toast({
        title: "Licencia asignada",
        description: `La licencia ${selectedLicense.product} ha sido asignada a ${selectedCoreIds.length} cores del host ${selectedHost.name}`,
      });
    } catch (error) {
      logger.error("Error general en el proceso de asignación:", error);
      toast({ 
        title: "Error", 
        description: "Ocurrió un error inesperado durante el proceso de asignación", 
        variant: "destructive" 
      });    } finally {
      setCoreDialogOpen(false);
    }
  }, [selectedHost, selectedLicense, toast]);
  
  const handleClearLicenseAssignments = useCallback(async () => {
    try {
      const message = await storageService.clearLicenseAssignments();

      const [reloadedLicenses, reloadedHosts, reloadedEnvironments] = await Promise.all([
        storageService.getLicensesByCustomer(),
        storageService.getHostsByCustomer(),
        storageService.getEnvironmentsByCustomer()
      ]);
      
      setLicenses(Array.isArray(reloadedLicenses) ? reloadedLicenses : []);
      setHosts(Array.isArray(reloadedHosts) ? reloadedHosts : []);
      setEnvironments(Array.isArray(reloadedEnvironments) ? reloadedEnvironments : []);
      
      toast({
        title: "Asignaciones eliminadas",
        description: message,
        variant: "default"
      });

      // Limpiar cualquier selección activa
      setSelectedLicense(null);
      setSelectedHost(null);
    } catch (error) {
      logger.error("Error clearing license assignments:", error);
      toast({ 
        title: "Error", 
        description: error instanceof Error ? error.message : "Ocurrió un error al intentar eliminar las asignaciones", 
        variant: "destructive" 
      });
    } finally {
      setClearDialogOpen(false);
    }
  }, [toast, setSelectedLicense, setSelectedHost]);

  // Verificar si un host tiene una licencia asignada
  const isLicenseAssignedToHost = useCallback((licenseId: string, hostId: string): boolean => {
    const host = hosts.find(h => h.id === hostId);

    return hostHasLicenseAssignment(host, licenseId);
  }, [hosts]);
  // Contar cores asignados a una licencia en un host
  const countAssignedCores = useCallback((licenseId: string, hostId: string): number => {
    const host = hosts.find(h => h.id === hostId);

    return countAssignedCoresForLicense(host, licenseId);
  }, [hosts]);


  return (
    <div className="w-full">
      <Card className="border-0 shadow-none">
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>Asignación de Licencias</CardTitle>
          </div>
        </CardHeader>
      </Card>

      <div className="flex flex-col gap-6">
        <div className="flex justify-between items-center">
          {showFilters ? (
            <div className="flex gap-2 items-center flex-wrap">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar hosts o licencias..."
                  className="pl-8 w-64"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <Select value={hostType} onValueChange={setHostType}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Tipo de Host" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los tipos</SelectItem>
                  <SelectItem value="Physical">Físicos</SelectItem>
                  <SelectItem value="Cloud">Cloud</SelectItem>
                </SelectContent>
              </Select>
              <Select value={csiFilter} onValueChange={setCsiFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="CSI" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los CSI</SelectItem>
                  {uniqueCSIs.map(csi => (
                    <SelectItem key={csi} value={csi}>{csi}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={metricFilter} onValueChange={setMetricFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Métrica" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las métricas</SelectItem>
                  <SelectItem value="Processor">Processor</SelectItem>
                  <SelectItem value="Named User Plus">Named User Plus</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : <div></div>}
          <div className="flex gap-2">
            <Button
              variant={showFilters ? "default" : "outline"}
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
            >
              <Filter className="h-4 w-4 mr-1" />
              {showFilters ? "Ocultar Filtros" : "Mostrar Filtros"}
            </Button>
            <AlertDialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-red-100 text-red-700 hover:bg-red-200 hover:text-red-800 border-red-200"
                >
                  <Ban className="h-4 w-4 mr-1" />
                  Clear Assignments
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Esto eliminará TODAS las asignaciones de licencias de todos los hosts.
                    Las licencias en sí mismas permanecerán, pero ya no estarán asignadas.
                    Esta acción no se puede deshacer.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleClearLicenseAssignments}
                    className="bg-red-500 hover:bg-red-600"
                  >
                    Clear All Assignments
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        <Tabs defaultValue="matrix">
          <TabsList className="mb-4">
            <TabsTrigger value="matrix">Vista Matriz</TabsTrigger>
            <TabsTrigger value="reactflow">ReactFlow</TabsTrigger>
            <TabsTrigger value="cores">Cores</TabsTrigger>
            {/* Pestañas "Por Licencias" y "Por Hosts" eliminadas */}
          </TabsList>

          <TabsContent value="matrix" className="p-4 border rounded-md">
            <LicenseAssig_ViewMatriz
              filteredLicenses={filteredLicenses}
              filteredHosts={filteredHosts}
              isLicenseAssignedToHost={isLicenseAssignedToHost}
              countAssignedCores={countAssignedCores}
              setSelectedLicense={setSelectedLicense}
              handleLicenseAssign={handleLicenseAssign}
              licenses={licenses} // Pasamos licenses para getLicenseStatusBadge
            />
          </TabsContent>

          <TabsContent value="reactflow" className="p-4 border rounded-md h-[75vh]">
            <Suspense fallback={<AssignmentTabFallback label="la vista ReactFlow" />}>
              <LicenseAssig_ViewFlow
                initialLicenses={licenses}
                initialHosts={hosts}
                initialEnvironments={environments}
                onAssignmentChange={async () => {
                  try {
                    const [reloadedLicenses, reloadedHosts, reloadedEnvironments] = await Promise.all([
                      storageService.getLicensesByCustomer(),
                      storageService.getHostsByCustomer(),
                      storageService.getEnvironmentsByCustomer()
                    ]);
                    setLicenses(Array.isArray(reloadedLicenses) ? reloadedLicenses : []);
                    setHosts(Array.isArray(reloadedHosts) ? reloadedHosts : []);
                    setEnvironments(Array.isArray(reloadedEnvironments) ? reloadedEnvironments : []);
                    toast({ title: "Datos Recargados", description: "La vista de ReactFlow ha actualizado los datos." });
                  } catch (error) {
                    logger.error("Error reloading data after assignment change:", error);
                    toast({ title: "Error", description: "Failed to reload data after update", variant: "destructive" });
                  }
                }}
                toast={toast}
                logger={logger}
                storageService={storageService}
              />
            </Suspense>
          </TabsContent>
          
          <TabsContent value="cores" className="p-4 border rounded-md">
            <LicenseAssig_ViewCores
                hosts={hosts}
                licenses={licenses}
                environments={environments}
                selectedHostIds={selectedHostIds}
                setSelectedHostIds={setSelectedHostIds}
                MAX_SELECTED_HOSTS={MAX_SELECTED_HOSTS}
            />
          </TabsContent>

          {/* Contenido de "Por Licencias" y "Por Hosts" eliminado */}

        </Tabs>
      </div>

      {selectedHost && selectedLicense && (
        <CoreSelectionDialog
          host={selectedHost}
          license={selectedLicense}
          open={coreDialogOpen}
          onOpenChange={setCoreDialogOpen}
          onConfirm={handleCoreSelectionConfirm}
          isEditing={isLicenseAssignedToHost(selectedLicense.id, selectedHost.id)}
        />
      )}
    </div>
  );
}