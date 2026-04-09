import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Check, Info, Cpu, AlertCircle, Save } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Host, License } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import logger from "@/lib/logger"; // Importamos el logger
import apiClient from "@/lib/apiClient"; // Importamos el cliente API configurado

interface CoreSelectionDialogProps {
  host: Host;
  license: License;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (selectedCoreIds: number[], coreMappings?: Record<number, number>) => void | Promise<void>;
  isEditing?: boolean;
  loadAssignmentState?: boolean;
}

interface LicenseAssignmentState {
  physicalHost: Host | null;
  selectedCoreIds: number[];
  coreMappings: Record<number, number>;
  maxSelectableCores: number | null;
}

export function CoreSelectionDialog({
  host,
  license,
  open,
  onOpenChange,
  onConfirm,
  isEditing = false,
  loadAssignmentState = true,
}: CoreSelectionDialogProps) {  
  const [selectedCoreIds, setSelectedCoreIds] = useState<number[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(false);
  const [physicalHost, setPhysicalHost] = useState<Host | null>(null);
  const [coreMappings, setCoreMappings] = useState<Record<number, number>>({});
  const [maxSelectableCores, setMaxSelectableCores] = useState<number | undefined>(undefined);
  const [savingLicenseAssignments, setSavingLicenseAssignments] = useState(false);

  // Determine the effective max selectable cores - if undefined, treat as unlimited
  const effectiveMaxSelectableCores = useMemo(
    () => maxSelectableCores,
    [maxSelectableCores],
  );

  const calculatedAssignableCores = useMemo(() => {
    if (license.metric === "Processor") {
      return Math.floor((license.quantity || 0) / (host.coreFactor || 0.5));
    }

    if (license.metric === "Named User Plus") {
      return Math.floor((license.quantity || 0) / 2);
    }

    return host.cores || 0;
  }, [host.coreFactor, host.cores, license.metric, license.quantity]);

  useEffect(() => {
    if (!open) return;

    if (!loadAssignmentState) {
      setLoading(false);
      setSelectedCoreIds([]);
      setCoreMappings({});
      setPhysicalHost(null);
      setMaxSelectableCores(undefined);
      return;
    }

    const fetchAssignmentState = async () => {
      setLoading(true);
      try {
        const response = await apiClient.get<LicenseAssignmentState>(
          `/licenses/${license.id}/host/${host.id}/assignment-state`,
        );
        const data = response.data;

        setSelectedCoreIds(Array.isArray(data.selectedCoreIds) ? data.selectedCoreIds : []);
        setCoreMappings(data.coreMappings ?? {});
        setPhysicalHost(data.physicalHost ?? null);
        setMaxSelectableCores(
          typeof data.maxSelectableCores === "number" ? data.maxSelectableCores : undefined,
        );
      } catch (error) {
        logger.error("Error loading assignment state:", error);
        setSelectedCoreIds([]);
        setCoreMappings({});
        setPhysicalHost(null);
        setMaxSelectableCores(undefined);
      } finally {
        setLoading(false);
      }
    };

    fetchAssignmentState();
  }, [open, host.id, license.id, loadAssignmentState]);

  // Filter cores based on search term
  const filteredCores = useMemo(() => {
    if (!host || !host.cores) return [];

    const coreIdsArray = Array.from({ length: host.cores }, (_, i) => i + 1);
    
    if (host.serverType === "Virtual" && host.hasHardPartitioning) {
      return coreIdsArray.filter(coreId => {
        const hasMappedPhysicalCore = coreMappings[coreId] !== undefined;
        const matchesSearch = !searchTerm || coreId.toString().includes(searchTerm);
        
        return hasMappedPhysicalCore && matchesSearch;
      });
    }

    if (!searchTerm) return coreIdsArray;

    return coreIdsArray.filter((coreId) =>
      coreId.toString().includes(searchTerm)
    );
  }, [host, searchTerm, coreMappings]);

  // Handle selection of all cores
  const handleSelectAll = useCallback(() => {
    if (!host.cores) return;
    
    const allCoreIds = filteredCores.length > 0
      ? filteredCores
      : Array.from({ length: host.cores }, (_, i) => i + 1);
    
    // Si hay un límite, solo seleccionar hasta ese límite
    if (effectiveMaxSelectableCores !== undefined) {
      if (effectiveMaxSelectableCores <= 0) {
        toast({
          title: "No se pueden seleccionar cores",
          description: "No tienes suficientes licencias disponibles para asignar cores a este host",
          variant: "destructive"
        });
        setSelectedCoreIds([]);
        return;
      }
      setSelectedCoreIds(allCoreIds.slice(0, effectiveMaxSelectableCores));
      
      // Si el límite es menor que el total de cores, mostrar una notificación
      if (effectiveMaxSelectableCores < host.cores) {
        toast({
          title: "Selección limitada",
          description: `Solo se han seleccionado ${effectiveMaxSelectableCores} cores debido al límite de licenciamiento`,
          variant: "default"
        });
      }
    } else {
      setSelectedCoreIds(allCoreIds);
    }
  }, [effectiveMaxSelectableCores, filteredCores, host.cores, toast]);

  // Handle deselection of all cores
  const handleDeselectAll = useCallback(() => {
    setSelectedCoreIds([]);
  }, []);

  // Handle selection of N cores
  const handleSelectN = useCallback((n: number) => {
    if (!host.cores) return;

    const allCoreIds = filteredCores.length > 0
      ? filteredCores
      : Array.from({ length: host.cores }, (_, i) => i + 1);
    setSelectedCoreIds(allCoreIds.slice(0, n));
  }, [filteredCores, host.cores]);

  // Handle cancel action
  const handleCancel = () => {
    onOpenChange(false);
  };
  // Handle confirm action
  const handleConfirm = async () => {
    try {
      setSavingLicenseAssignments(true);
      await onConfirm(
        selectedCoreIds,
        host.hasHardPartitioning ? coreMappings : undefined,
      );
      
    } catch (error) {
      logger.error("Error guardando asignaciones de licencias:", error);
      toast({
        title: "Error",
        description: "No se pudieron guardar las asignaciones de licencias",
        variant: "destructive"
      });
    } finally {
      setSavingLicenseAssignments(false);
    }
  };

  // Handle selection of a core
  const handleCoreSelect = (coreId: number) => {
    const isCurrentlySelected = selectedCoreIds.includes(coreId);
    let newSelectedCoreIds = [...selectedCoreIds];
    
    if (isCurrentlySelected) {
      // Si ya está seleccionado, lo quitamos
      newSelectedCoreIds = newSelectedCoreIds.filter(id => id !== coreId);
    } else {
      // Si no está seleccionado, lo agregamos siempre que no exceda el máximo
      if (effectiveMaxSelectableCores === undefined || newSelectedCoreIds.length < effectiveMaxSelectableCores) {
        newSelectedCoreIds.push(coreId);
      } else {
        // Si excede el máximo, mostramos un mensaje y no hacemos nada
        toast({
          title: "Límite alcanzado",
          description: `No puedes asignar más de ${effectiveMaxSelectableCores} cores a esta licencia`,
          variant: "destructive"
        });
        return;
      }
    }
    
    setSelectedCoreIds(newSelectedCoreIds);
  };

  // Generate array of physical host cores for mapping
  const physicalCoresOptions = useMemo(() => {
    if (!physicalHost || !physicalHost.cores) return [];
    
    return Array.from({ length: physicalHost.cores }, (_, i) => {
      const coreId = i + 1;
      return {
        value: coreId,
        label: `Core Físico ${coreId}`
      };
    });
  }, [physicalHost]);
  // Debug log when rendering the component
  logger.info("Rendering CoreSelectionDialog with:", {
    host: {
      id: host.id,
      name: host.name,
      serverType: host.serverType,
      cores: host.cores,
      coreAssignmentsCount: host.coreAssignments?.length || 0
    },
    license: {
      id: license.id,
      product: license.product,
      metric: license.metric
    },
    selectedCoreIds,
    open,
    isEditing
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            Asignar Licencia a Cores
          </DialogTitle>
          <DialogDescription>
            {host.serverType === "Virtual" && host.hasHardPartitioning ? (
              <span>
                Licencia: {license.product} {license.edition} ({license.metric})
                <br />
                Host: {host.name} ({host.serverType}, {host.cores} cores)
                <br/>
                {host.coreAssignments && <span className="text-xs text-blue-500">({host.coreAssignments.length} core assignments found)</span>}
              </span>
            ) : (
              <span>
                Licencia: {license.product} {license.edition} ({license.metric})
                <br />
                Host: {host.name} ({host.serverType}, {host.cores} cores)
                <br/>
                {host.coreAssignments && <span className="text-xs text-blue-500">({host.coreAssignments.length} core assignments found)</span>}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Información de licenciamiento */}
        <div className="bg-blue-50 border border-blue-100 rounded-md p-3">
          <div className="flex items-start">
            <Info className="h-5 w-5 text-blue-600 mr-2 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-blue-800 font-medium mb-1 text-sm">Información de licenciamiento</p>
              {license.metric === "Processor" ? (
                <p className="text-sm text-blue-700">
                  El factor de core para este host es {host.coreFactor || 0.5}. Con {license.quantity || 0} licencias tipo {license.metric}, este diálogo permite asignar hasta{" "}
                  <span className="font-bold">{calculatedAssignableCores} cores</span>
                  {" "}según el core factor configurado para el host.
                </p>
              ) : license.metric === "Named User Plus" ? (
                <p className="text-sm text-blue-700">
                  Para esta licencia NUP, este diálogo aplica un límite operativo de{" "}
                  <span className="font-bold">{calculatedAssignableCores} cores</span>
                  {" "}para la asignación manual. Este valor no sustituye el cálculo de compliance NUP, que se evalúa aparte según la edición y el tipo de entorno.
                </p>
              ) : (
                <p className="text-sm text-blue-700">
                  Esta pantalla usa el límite operativo devuelto por el servidor para controlar cuántos cores puedes asignar a esta licencia.
                </p>
              )}
              <p className="text-sm text-blue-700 mt-1">
                En este host puedes asignar hasta{" "}
                <span className="font-bold">
                  {effectiveMaxSelectableCores !== undefined
                    ? effectiveMaxSelectableCores
                    : host.cores}{" "}
                  cores
                </span>
                {license.metric === "Processor" && host.coreFactor
                  ? ` (${Math.ceil(
                      (effectiveMaxSelectableCores !== undefined
                        ? effectiveMaxSelectableCores
                        : host.cores || 0) * host.coreFactor
                    )} processor)`
                  : ""}
                .
              </p>
              
              {host.serverType === "Virtual" && host.hasHardPartitioning && (
                <p className="text-sm text-amber-700 mt-2 font-medium flex items-center">
                  <AlertCircle className="h-4 w-4 mr-1 text-amber-500" /> 
                  Solo se muestran los cores mapeados a cores físicos debido a la configuración de Hard Partitioning.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Contenido de asignación de licencias - ahora mostramos directamente esta parte sin pestañas */}
        <>          <div className="flex justify-between items-center mb-4">
            <div className="text-sm">
              Seleccionados: <span className={selectedCoreIds.length > 0 ? "font-medium" : ""}>
                {selectedCoreIds.length}
              </span> de {" "}
              <span className="font-medium">
                {effectiveMaxSelectableCores !== undefined ? 
                  `${effectiveMaxSelectableCores} (máximo permitido)` : 
                  `${host.cores} (total host)`}
              </span>
            </div>
            
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleSelectAll} 
                disabled={loading || savingLicenseAssignments || (effectiveMaxSelectableCores !== undefined && effectiveMaxSelectableCores <= 0)}
              >
                Seleccionar Todos
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleDeselectAll} 
                disabled={loading || savingLicenseAssignments}
              >
                Deseleccionar Todos
              </Button>
              
              {effectiveMaxSelectableCores !== undefined && effectiveMaxSelectableCores > 0 && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => handleSelectN(effectiveMaxSelectableCores)}
                  disabled={loading || savingLicenseAssignments}
                >
                  Seleccionar {effectiveMaxSelectableCores}
                </Button>
              )}
            </div>
          </div>
          
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 my-4">
            {filteredCores.map((coreId) => {
              const isSelected = selectedCoreIds.includes(coreId);              const coreAssignment = host.coreAssignments?.find(
                (assignment) => assignment.coreId === coreId
              );
              const hasLicenseAssigned = coreAssignment?.licenseId === license.id;
              const hasOtherLicenses = coreAssignment?.licenseId && 
                coreAssignment.licenseId !== license.id;
              
              // Mostrar información del core físico si existe mapeo en servidores virtuales
              const physicalCoreId = host.serverType === "Virtual" && host.hasHardPartitioning 
                ? coreMappings[coreId] 
                : undefined;
              
              return (
                <div
                  key={`core-${coreId}`}                  className={cn(
                    "flex items-center space-x-2 p-2 border rounded-md",
                    isSelected || hasLicenseAssigned ? "border-blue-500 bg-blue-50" : "border-gray-200",
                    hasOtherLicenses ? "border-amber-300" : ""
                  )}
                  onClick={() => !loading && !savingLicenseAssignments && handleCoreSelect(coreId)}
                >                  <Checkbox
                    checked={isSelected || hasLicenseAssigned}
                    onCheckedChange={() => !loading && !savingLicenseAssignments && handleCoreSelect(coreId)}
                    id={`core-${coreId}`}
                    disabled={loading || savingLicenseAssignments}
                  />
                  <label
                    htmlFor={`core-${coreId}`}
                    className="text-sm font-medium flex flex-1 justify-between items-center cursor-pointer"
                  >
                    <div>
                      <span>Core {coreId}</span>
                      {physicalCoreId && (
                        <span className="block text-xs text-blue-600">Físico {physicalCoreId}</span>
                      )}
                    </div>

                  </label>
                </div>
              );
            })}
          </div>

          {savingLicenseAssignments && (
            <div className="flex items-center justify-center text-blue-600 mt-4">
              <Save className="animate-pulse mr-2 h-4 w-4" />
              <span className="text-sm">Guardando asignaciones...</span>
            </div>
          )}        </>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={loading || savingLicenseAssignments}>
            Cancelar
          </Button>
          <Button 
            onClick={handleConfirm} 
            disabled={loading || savingLicenseAssignments}
          >
            Aceptar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
