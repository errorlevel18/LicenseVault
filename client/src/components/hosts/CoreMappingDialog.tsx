import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Microchip, Server, AlertCircle, Trash2, RefreshCw, MapPin, Check, X } from "lucide-react";
import { Host } from "@/lib/types";
import { toast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import logger from "@/lib/logger";
import apiClient from "@/lib/apiClient";

interface CoreMappingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  virtualHost: Partial<Host>;
  physicalHost: Host | null;
  onCoreMappingChange: (mapping: Record<number, number>) => void;
  existingMapping?: Record<number, number>; // New prop to pass existing mapping
}

export function CoreMappingDialog({ 
  open, 
  onOpenChange, 
  virtualHost, 
  physicalHost, 
  onCoreMappingChange,
  existingMapping = {} // Default to empty object if not provided
}: CoreMappingDialogProps) {  const [coreMapping, setCoreMapping] = useState<Record<number, number>>({});
  const [usedPhysicalCores, setUsedPhysicalCores] = useState<Record<number, Array<{hostId: string, hostName: string, coreId: number}>>>({});
  // Estado para rastrear qué core virtual está seleccionado actualmente
  const [selectedVirtualCore, setSelectedVirtualCore] = useState<number | null>(null);
  // Estado para mostrar cuántos cores están mapeados
  const [mappedCoreCount, setMappedCoreCount] = useState<number>(0);
  // Estado para mostrar si hay cambios sin guardar
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);
  
  // Initialize core mapping when dialog opens or when existingMapping changes
  useEffect(() => {
    if (open && virtualHost && virtualHost.cores) {
      // Create initial mapping with either existing mapping values or 0 (unmapped)
      const initialMapping: Record<number, number> = {};
      for (let i = 1; i <= virtualHost.cores; i++) {
        initialMapping[i] = existingMapping[i] || 0; // Use existing mapping or default to 0
      }
      setCoreMapping(initialMapping);
      
      // Calculate initial mapped core count
      const mappedCount = Object.values(initialMapping).filter(val => val > 0).length;
      setMappedCoreCount(mappedCount);
      
      // Reset unsaved changes flag
      setHasUnsavedChanges(false);
      
      // Log for debugging
      logger.info("CoreMappingDialog initialized with cores:", virtualHost.cores);
      logger.info("Using existing mapping:", Object.keys(existingMapping).length > 0 ? "Yes" : "No");
    }
  }, [open, virtualHost, existingMapping]);
    // Cargar información sobre cores físicos ya utilizados
  useEffect(() => {
    if (open && physicalHost && physicalHost.id) {
      // Cargar información sobre cores ya utilizados por otras VMs
      const fetchUsedPhysicalCores = async () => {
        try {
          // Llamada al API para obtener los cores ya asignados del host físico
          const response = await apiClient.get(`/hosts/${physicalHost.id}/core-assignments`);
          
          if (response.data && response.data.usedPhysicalCores) {
            logger.info("Loaded used physical cores:", response.data.usedPhysicalCores);
            setUsedPhysicalCores(response.data.usedPhysicalCores);
          } else {
            // Si no hay datos, inicializar como objeto vacío
            logger.info("No used physical cores found for physical host:", physicalHost.id);
            setUsedPhysicalCores({});
          }
        } catch (error) {
          logger.error("Error fetching used physical cores:", error);
          // En caso de error, inicializar como objeto vacío
          setUsedPhysicalCores({});
        }
      };
      
      fetchUsedPhysicalCores();
    }
  }, [open, physicalHost]);

  // Function to reset all mappings
  const resetAllMappings = useCallback(() => {
    if (virtualHost && virtualHost.cores) {
      const clearedMapping: Record<number, number> = {};
      for (let i = 1; i <= virtualHost.cores; i++) {
        clearedMapping[i] = 0; // Set all cores to unmapped
      }
      setCoreMapping(clearedMapping);
      setMappedCoreCount(0);
      setSelectedVirtualCore(null);
      setHasUnsavedChanges(true);
      
      toast({
        title: "Mapeo reiniciado",
        description: "Se han eliminado todas las asignaciones de cores",
        variant: "default"
      });
      
      logger.info("All core mappings reset");
    }
  }, [virtualHost]);
  // Function to automatically map all cores in sequence
  const autoMapCores = useCallback(() => {
    if (!virtualHost?.cores || !physicalHost?.cores) return;
    
    // Get all physical cores (including those used by other VMs for soft partitioning)
    const availableCores: number[] = [];
    for (let i = 1; i <= physicalHost.cores; i++) {
      availableCores.push(i);
    }
    
    if (availableCores.length < virtualHost.cores) {
      toast({
        title: "Error",
        description: `No hay suficientes cores físicos. Necesita ${virtualHost.cores} cores, pero solo hay ${availableCores.length} cores en el host físico.`,
        variant: "destructive"
      });
      return;
    }
    
    // Create new mapping
    const newMapping: Record<number, number> = {};
    for (let i = 1; i <= virtualHost.cores; i++) {
      newMapping[i] = availableCores[i - 1];
    }
    
    // Update state
    setCoreMapping(newMapping);
    setMappedCoreCount(virtualHost.cores);
    setSelectedVirtualCore(null);
    setHasUnsavedChanges(true);
    
    toast({
      title: "Mapeo automático completado",
      description: `Se han mapeado todos los ${virtualHost.cores} cores virtuales en secuencia.`,
      variant: "default"
    });
    
    logger.info(`Auto-mapped ${virtualHost.cores} cores`);
    
    // Update parent component
    onCoreMappingChange(newMapping);
  }, [virtualHost, physicalHost, usedPhysicalCores, onCoreMappingChange]);
  
  // Handle mapping a core
  const handleCoreMapping = useCallback((virtualCoreId: number, physicalCoreId: number) => {
    setCoreMapping(prevMapping => {
      // Si es el mismo valor, lo desmapeamos (establecemos a 0)
      const newValue = physicalCoreId === prevMapping[virtualCoreId] ? 0 : physicalCoreId;
      
      logger.info(
        `CoreMapping change: Virtual ${virtualCoreId} => Physical ${newValue} (was ${prevMapping[virtualCoreId]})`
      );
      
      const newMapping = {
        ...prevMapping,
        [virtualCoreId]: newValue
      };
      
      // Actualizar el componente padre
      onCoreMappingChange(newMapping);
        // Actualizar contador de cores mapeados
      // Asegurarse de que solo contamos los cores del 1 al virtualHost.cores
      let newMappedCount = 0;
      for (let i = 1; i <= (virtualHost?.cores || 0); i++) {
        if (newMapping[i] && newMapping[i] > 0) {
          newMappedCount++;
        }
      }
      
      setMappedCoreCount(newMappedCount);
      
      // Marcar que hay cambios sin guardar
      setHasUnsavedChanges(true);
      
      return newMapping;
    });
  }, [onCoreMappingChange]);
  
  // Group cores by socket for physical host display
  const getPhysicalCoresBySockets = useCallback(() => {
    if (!physicalHost || !physicalHost.cores || !physicalHost.sockets) return [];

    const totalCores = physicalHost.cores;
    const totalSockets = physicalHost.sockets;
    const coresPerSocket = Math.ceil(totalCores / totalSockets);
    
    const sockets: number[][] = [];
    
    for (let s = 0; s < totalSockets; s++) {
      const socketCores: number[] = [];
      const startCore = s * coresPerSocket + 1;
      const endCore = Math.min(startCore + coresPerSocket - 1, totalCores);
      
      for (let c = startCore; c <= endCore; c++) {
        socketCores.push(c);
      }
      
      sockets.push(socketCores);
    }
    
    return sockets;
  }, [physicalHost]);  // Render virtual core
  const renderVirtualCore = (coreId: number) => {
    const isMapped = coreMapping[coreId] > 0;
    const isSelected = selectedVirtualCore === coreId;
      // Determinar el estilo según el estado (mapeado, seleccionado o ninguno)
    let coreStyle = "";
    if (isSelected) {
      coreStyle = "bg-blue-200 border-blue-500 shadow-md"; // Core virtual seleccionado actualmente
    } else if (isMapped) {
      coreStyle = "bg-blue-100 border-blue-500 shadow-md"; // Core ya mapeado - mismo color que core físico
    } else {
      coreStyle = "bg-gray-100 border-gray-200 hover:bg-blue-50"; // Sin mapear
    }
    
    return (
      <TooltipProvider key={`v-${coreId}`} delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div 
              className={`relative w-16 h-16 m-1 rounded-md flex flex-col items-center justify-center border cursor-pointer transition-all hover:shadow-md ${coreStyle}`}
              onClick={() => {
                // Si está mapeado, lo desmapeamos
                if (isMapped) {
                  handleCoreMapping(coreId, 0);
                  logger.info(`Desmapeado core virtual ${coreId}`);
                  // Feedback visual
                  toast({
                    description: `Core virtual ${coreId} desmapeado`,
                    variant: "default"
                  });
                  // Deseleccionamos
                  setSelectedVirtualCore(null);
                } else {
                  // Si no está mapeado, lo seleccionamos para mapearlo
                  setSelectedVirtualCore(coreId);
                  logger.info(`Core virtual ${coreId} seleccionado para mapear`);
                  toast({
                    description: `Ahora selecciona un core físico para asignarlo al core virtual ${coreId}`,
                    variant: "default"
                  });
                }
              }}
            >
              <Microchip className={`h-8 w-8 ${isMapped ? "text-blue-500" : "text-gray-400"}`} />
              <span className={`text-xs font-medium ${isMapped ? "text-blue-700" : "text-gray-500"}`}>
                {coreId}
              </span>
              {isMapped && (
                <div className="absolute bottom-1 right-1 bg-blue-500 rounded-full w-4 h-4 flex items-center justify-center">
                  <span className="text-[8px] text-white font-bold">{coreMapping[coreId]}</span>
                </div>
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p className="text-sm font-medium">Core Virtual {coreId}</p>
            {isMapped ? (
              <p className="text-xs">Mapeado al core físico {coreMapping[coreId]}</p>
            ) : (
              <p className="text-xs">No mapeado a ningún core físico</p>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };  // Render physical core
  const renderPhysicalCore = (coreId: number) => {
    const virtualCoresMapping = Object.entries(coreMapping)
      .filter(([_, pCoreId]) => parseInt(String(pCoreId)) === coreId)
      .map(([vCoreId]) => parseInt(vCoreId));
    
    const isMappedToCurrentVM = virtualCoresMapping.length > 0;
    
    // Verificar si este core ya está asignado a otras VMs (ahora es un array)
    const isUsedByOtherVMs = usedPhysicalCores[coreId] !== undefined && usedPhysicalCores[coreId].length > 0;
    const otherVMsInfo = isUsedByOtherVMs ? usedPhysicalCores[coreId] : [];
    
    // Determinar los estados de asignación para múltiples combinaciones
    const hasCurrentVM = isMappedToCurrentVM;
    const hasOtherVMs = isUsedByOtherVMs;
    
    // Calcular el total de VMs asignadas (VM actual + otras VMs)
    const currentVMCount = hasCurrentVM ? 1 : 0;
    const otherVMCount = otherVMsInfo.length;
    const totalVMCount = currentVMCount + otherVMCount;
    
    // Determinar el estilo del core según su estado (4 combinaciones posibles)
    let coreStyle = "";
    let backgroundPattern = null;
      if (hasCurrentVM && hasOtherVMs) {
      // Azul+Ámbar: Asignado a VM actual Y otras VMs
      coreStyle = "border-blue-500 shadow-md";
      backgroundPattern = "proportional"; // Patrón proporcional azul+ámbar
    } else if (hasCurrentVM && !hasOtherVMs) {
      // Azul puro: Solo asignado a VM actual
      coreStyle = "bg-blue-100 border-blue-500 shadow-md";
    } else if (!hasCurrentVM && hasOtherVMs) {
      // Ámbar puro: Solo asignado a otras VMs
      coreStyle = "bg-amber-50 border-amber-300";
    } else {
      // Gris: Libre
      coreStyle = "bg-gray-100 border-gray-200 hover:bg-blue-50 hover:border-blue-200";
    }
    
    return (
      <TooltipProvider key={`p-${coreId}`} delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div 
              className={`relative w-16 h-16 m-1 rounded-md flex flex-col items-center justify-center border transition-all ${coreStyle} cursor-pointer hover:shadow-md`}
              onClick={() => {
                // Si el core ya está usado por otras VMs, mostrar advertencia pero permitir asignación
                if (hasOtherVMs) {
                  const vmNames = otherVMsInfo.map(vm => vm.hostName).join(", ");
                  toast({
                    title: "Core compartido",
                    description: `Este core también está asignado a las VMs: ${vmNames}. Se permite el mapeo múltiple para soft partitioning.`,
                    variant: "default"
                  });
                }
                
                // Si hay un core virtual seleccionado, lo mapeamos a este core físico
                if (selectedVirtualCore !== null) {
                  // Si está mapeado al mismo core físico, lo desmapeamos
                  if (coreMapping[selectedVirtualCore] === coreId) {
                    handleCoreMapping(selectedVirtualCore, 0);
                    logger.info(`Desmapeado core virtual ${selectedVirtualCore} del core físico ${coreId}`);
                    toast({
                      description: `Core virtual ${selectedVirtualCore} desmapeado`,
                      variant: "default"
                    });
                  } else {
                    // Mapear el core virtual seleccionado a este core físico
                    handleCoreMapping(selectedVirtualCore, coreId);
                    logger.info(`Mapeado core virtual ${selectedVirtualCore} a core físico ${coreId}`);
                    toast({
                      description: `Core virtual ${selectedVirtualCore} mapeado al core físico ${coreId}`,
                      variant: "default"
                    });
                  }
                  // Limpiamos la selección después del mapeo
                  setSelectedVirtualCore(null);
                } else {
                  // Find the first unmapped virtual core
                  const unmappedVirtualCore = Object.entries(coreMapping)
                    .find(([_, pCoreId]) => parseInt(String(pCoreId)) === 0);
                  
                  if (unmappedVirtualCore) {
                    const virtualCoreId = parseInt(unmappedVirtualCore[0]);
                    handleCoreMapping(virtualCoreId, coreId);
                    
                    // Log para depuración
                    logger.info(`Mapeado core virtual ${virtualCoreId} a core físico ${coreId}`);
                    
                    // Feedback visual para el usuario
                    toast({
                      description: `Core virtual ${virtualCoreId} mapeado al core físico ${coreId}`,
                      variant: "default"
                    });
                  } else {
                    toast({
                      title: "Información",
                      description: "Todos los cores virtuales ya están mapeados. Desmapea alguno primero para reasignar.",
                      variant: "default"
                    });
                  }
                }              }}
            >
              {/* Patrón de fondo para cores con múltiples asignaciones */}
              {backgroundPattern === "proportional" && (
                <div className="absolute inset-0 rounded-md overflow-hidden">
                  {/* Segment for current VM (always first) */}                  {hasCurrentVM && (
                    <div 
                      className="absolute h-full bg-blue-100 opacity-70" 
                      style={{ 
                        width: `${100 / totalVMCount}%`, 
                        left: "0%" 
                      }}
                    ></div>
                  )}
                  {/* Segments for other VMs */}
                  {otherVMsInfo.map((vm, index) => (
                    <div 
                      key={vm.hostId}
                      className="absolute h-full bg-amber-100 opacity-70" 
                      style={{ 
                        width: `${100 / totalVMCount}%`, 
                        left: `${(100 / totalVMCount) * (currentVMCount + index)}%` 
                      }}
                    ></div>
                  ))}
                </div>
              )}
                <Microchip className={`h-8 w-8 relative z-10 ${
                hasCurrentVM ? "text-blue-500" : 
                hasOtherVMs ? "text-amber-500" : 
                "text-gray-400"
              }`} />
              <span className={`text-xs font-medium relative z-10 ${
                hasCurrentVM ? "text-blue-700" : 
                hasOtherVMs ? "text-amber-700" : 
                "text-gray-500"
              }`}>
                {coreId}
              </span>
                {/* Badge para cores mapeados a esta VM */}              {hasCurrentVM && virtualCoresMapping.length > 0 && (
                <div className="absolute top-0 right-0 -mt-1 -mr-1 z-10">
                  <Badge variant="outline" className="bg-blue-100 text-blue-800 text-[10px] h-5 min-w-5 flex items-center justify-center p-0">
                    {virtualCoresMapping.length}
                  </Badge>
                </div>
              )}
              
              {/* Indicador para cores usados por otras VMs */}
              {hasOtherVMs && (
                <div className="absolute top-0 left-0 -mt-1 -ml-1 z-10">
                  <Badge variant="outline" className="bg-amber-100 text-amber-800 text-[10px] h-5 px-1 flex items-center justify-center">
                    VM
                  </Badge>
                </div>
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p className="text-sm font-medium">Core Físico {coreId}</p>
            {hasCurrentVM ? (
              <>
                <p className="text-xs">Mapeado a los cores virtuales:</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {virtualCoresMapping.map(vCoreId => (
                    <Badge key={vCoreId} variant="outline" className="bg-blue-100">
                      {vCoreId}
                    </Badge>
                  ))}
                </div>
                {hasOtherVMs && (
                  <>
                    <p className="text-xs text-amber-700 font-medium mt-2">También compartido con:</p>
                    {otherVMsInfo.map((vm, index) => (
                      <p key={vm.hostId} className="text-xs mt-1">
                        <span className="font-medium">{vm.hostName}</span> (Core virtual {vm.coreId})
                      </p>
                    ))}
                  </>
                )}
              </>
            ) : hasOtherVMs ? (
              <>
                <p className="text-xs text-amber-700 font-medium">Este core está asignado a:</p>
                {otherVMsInfo.map((vm, index) => (
                  <p key={vm.hostId} className="text-xs mt-1">
                    <span className="font-medium">{vm.hostName}</span> (Core virtual {vm.coreId})
                  </p>
                ))}
                <p className="text-xs text-blue-700 mt-1">Puede asignarse a múltiples VMs (soft partitioning)</p>
              </>
            ) : (
              <p className="text-xs">No mapeado a ningún core virtual</p>
            )}
            
            <p className="text-xs mt-1">Haz clic para mapear un core virtual disponible</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  const physicalSockets = getPhysicalCoresBySockets();
  // Function to check if any core is unmapped
  const hasUnmappedCores = () => {
    if (!virtualHost || !virtualHost.cores) return false;
    
    // Asegurarse que cada core del 1 al totalCores tiene un mapeo diferente de 0
    for (let i = 1; i <= virtualHost.cores; i++) {
      if (!coreMapping[i] || coreMapping[i] === 0) {
        return true; // Encontramos un core sin mapear
      }
    }
    return false; // Todos los cores están mapeados
  };

  // Handler for confirm close with unsaved changes
  const handleCloseWithConfirm = () => {
    if (hasUnsavedChanges) {
      // Show confirmation dialog
      const confirmed = window.confirm("¿Cerrar sin guardar los cambios de mapeo?");
      if (!confirmed) return;
    }
    onOpenChange(false);
  };

  if (!virtualHost || !physicalHost) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Error</DialogTitle>
            <DialogDescription>
              No se pudo cargar la información de los hosts necesarios.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>
                Debe seleccionar un host físico antes de intentar mapear cores.
              </AlertDescription>
            </Alert>
          </div>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      // Mostrar confirmación si hay cambios sin guardar
      if (!isOpen && hasUnsavedChanges) {
        handleCloseWithConfirm();
      } else {
        onOpenChange(isOpen);
      }
    }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Mapeo de Cores</DialogTitle>
          <DialogDescription>
            Mapear cores virtuales a físicos para {virtualHost.name || "Nuevo Host Virtual"} - Todos los cores deben ser mapeados
          </DialogDescription>
            {/* Resumen de mapeo */}
          <div className="flex items-center justify-between mt-2">
            <div className="text-sm">
              <span className="font-medium">Cores mapeados:</span> {mappedCoreCount} de {virtualHost.cores || 0} 
              {hasUnmappedCores() && 
                <span className="text-red-500 ml-2 text-xs font-medium">
                  * Todos los cores deben estar mapeados
                </span>
              }
              <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
                <div 
                  className={`h-2 rounded-full ${
                    mappedCoreCount === 0 ? 'bg-gray-400' : 
                    mappedCoreCount === virtualHost.cores ? 'bg-green-500' : 
                    'bg-amber-500'
                  }`} 
                  style={{ width: `${virtualHost.cores ? (mappedCoreCount / virtualHost.cores) * 100 : 0}%` }}
                >
                </div>
              </div>
            </div>
            
          </div>
          
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
            <h4 className="text-sm font-medium text-blue-700 mb-1">Instrucciones</h4>
            <ul className="text-xs text-blue-700 space-y-1 list-disc pl-4">
              <li>Selecciona un core virtual (izquierda), luego un core físico (derecha) para mapearlos</li>
              <li>Si seleccionas un core virtual ya mapeado, lo desmapearás</li>
              <li>Los cores ya mapeados se muestran en color</li>
              <li>Los cores asignados a otras VMs pueden reutilizarse (soft partitioning)</li>
              <li>Al finalizar, haz clic en "Aplicar Mapeo" para guardar los cambios</li>
            </ul>
          </div>
        </DialogHeader>

        <div className="grid md:grid-cols-2 gap-4">
          {/* Virtual Host Cores */}
          <div>            <div className="flex items-center justify-between gap-2 mb-4">
              <div className="flex items-center">
                <Server className="h-5 w-5 text-blue-500 mr-2" />
                <h3 className="text-lg font-medium">Host Virtual: {virtualHost.name || "Nuevo Host"}</h3>
              </div>
              
              <div className="flex items-center gap-2">
                {/* Botón para mapeo automático */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={autoMapCores}
                  className="h-8 flex items-center space-x-1 text-xs bg-green-50 hover:bg-green-100 text-green-700 border-green-200"
                  title="Mapear todos los cores automáticamente"
                >
                  <MapPin className="h-3 w-3 mr-1" />
                  <span>Auto-Mapear</span>
                </Button>
                
                {/* Botón para reiniciar mapeos */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={resetAllMappings}
                  className="h-8 flex items-center space-x-1 text-xs"
                  title="Reiniciar todos los mapeos"
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  <span>Reiniciar</span>
                </Button>
              </div>
            </div>
            
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Cores Virtuales</CardTitle>
                <CardDescription>Selecciona un core para mapearlo o desmapearlo</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap justify-center">
                  {virtualHost.cores && Array.from({ length: virtualHost.cores }, (_, i) => i + 1).map((coreId) => (
                    <div key={coreId}>
                      {renderVirtualCore(coreId)}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
          
          {/* Physical Host Cores */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Server className="h-5 w-5 text-green-500" />
              <h3 className="text-lg font-medium">Host Físico: {physicalHost.name}</h3>
            </div>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Cores Físicos</CardTitle>
                <CardDescription>Haz clic en un core físico para asignarlo</CardDescription>
              </CardHeader>
              <CardContent>                <div className="flex items-center gap-2 mb-3 justify-center flex-wrap">
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 bg-green-300 rounded-sm"></div>
                    <span className="text-xs text-gray-600">Solo esta VM</span>
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    <div className="w-3 h-3 rounded-sm relative overflow-hidden">
                      <div className="absolute h-full bg-green-300" style={{ width: "50%", left: "0%" }}></div>
                      <div className="absolute h-full bg-amber-300" style={{ width: "50%", left: "50%" }}></div>
                    </div>
                    <span className="text-xs text-gray-600">Esta VM + otras</span>
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    <div className="w-3 h-3 bg-amber-300 rounded-sm"></div>
                    <span className="text-xs text-gray-600">Solo otras VMs</span>
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    <div className="w-3 h-3 bg-gray-200 rounded-sm"></div>
                    <span className="text-xs text-gray-600">Disponible</span>
                  </div>
                </div>
                {physicalSockets.map((socketCores, socketIndex) => (
                  <div key={`socket-${socketIndex}`} className="mb-4">
                    <h4 className="text-sm font-medium mb-2">Socket {socketIndex + 1}</h4>
                    <div className="flex flex-wrap justify-center bg-gray-50 p-3 rounded-md border border-gray-200">
                      {socketCores.map(coreId => renderPhysicalCore(coreId))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>

        <DialogFooter className="pt-4 border-t border-gray-100 mt-4">
          <Button
            variant="outline"
            onClick={handleCloseWithConfirm}
            className="mr-2"
          >
            Cerrar
          </Button>          <Button
            onClick={() => {
              // Comprobar si todos los cores están mapeados
              if (hasUnmappedCores()) {
                // No permitir continuar si hay cores sin mapear
                toast({
                  title: "Error",
                  description: "Todos los cores virtuales deben estar mapeados a cores físicos para poder continuar. El mapeo completo de cores es obligatorio para el correcto funcionamiento de hosts virtuales con hard partitioning.",
                  variant: "destructive"
                });
                return; // Prevenir que el diálogo se cierre
              }
              
              // Log detallado del mapeo final para depuración
              const mappedCores = Object.entries(coreMapping)
                .filter(([_, physicalCore]) => physicalCore > 0)
                .map(([virtualCore, physicalCore]) => `V${virtualCore}->P${physicalCore}`)
                .join(", ");
              
              logger.info(`Aplicando mapeo de cores: ${mappedCores || "Ninguno"}`);
              
              // Actualizar el componente padre con el mapeo final
              onCoreMappingChange(coreMapping);
              
              // Cerrar el diálogo
              onOpenChange(false);
              setHasUnsavedChanges(false);
              
              // Mostrar confirmación al usuario
              toast({
                title: "Mapeo guardado",
                description: mappedCores 
                  ? `Mapeo de cores aplicado: ${mappedCores}` 
                  : "No se ha realizado ningún mapeo de cores",
                variant: "default"
              });
            }}
          >
            Aplicar Mapeo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
