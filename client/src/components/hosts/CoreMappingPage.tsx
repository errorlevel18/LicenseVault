import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Microchip, Save, ArrowLeft, Server, Info } from "lucide-react";
import { Host } from "@/lib/types";
import { storageService } from "@/lib/storageService";
import { authService } from "@/lib/authService";  // Importar el servicio de autenticación
import apiClient from "@/lib/apiClient";
import { toast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import logger from "@/lib/logger"; // Importamos el logger

interface CoreMappingPageProps {
  hostId: string;
}

export function CoreMappingPage({ hostId }: CoreMappingPageProps) {
  const [, navigate] = useLocation();
  const [virtualHost, setVirtualHost] = useState<Host | null>(null);
  const [physicalHost, setPhysicalHost] = useState<Host | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);  const [coreMapping, setCoreMapping] = useState<Record<number, number>>({});
  // Nuevo estado para almacenar los cores físicos ya utilizados por otras VMs
  const [usedPhysicalCores, setUsedPhysicalCores] = useState<Record<number, Array<{hostId: string, hostName: string, coreId: number}>>>({});
  
  // Load virtual host and its associated physical host
  useEffect(() => {
    const loadHosts = async () => {
      setLoading(true);
      setError(null);
      
      try {
        // Fetch the virtual host
        const vHost = await storageService.getHost(hostId);
        
        if (!vHost) {
          throw new Error("No se encontró el host virtual");
        }
        
        setVirtualHost(vHost);
        
        if (!vHost.physicalHostId) {
          throw new Error("Este host virtual no tiene un host físico asociado");
        }
        
        // Fetch the physical host
        const pHost = await storageService.getHost(vHost.physicalHostId);
        
        if (!pHost) {
          throw new Error("No se encontró el host físico asociado");
        }
        
        setPhysicalHost(pHost);
        
        // Obtener las asignaciones guardadas en la tabla core_assignments
        logger.info("Cargando asignaciones de cores existentes desde la base de datos");
        
        // Obtener token de autenticación
        const token = authService.getToken();

        if (token) {
          try {
            // Llamar al nuevo endpoint para obtener las asignaciones de cores usando apiClient
            const response = await apiClient.get(`/hosts/${hostId}/core-assignments`);
            
            if (response.status === 200) {
              const data = response.data;
              
              // Log the raw data for debugging
              logger.debug('Raw core assignments data from server', {
                rawAssignments: data.assignments,
                rawMappings: data.mappings,
                hostType: data.hostType,
                physicalHostId: data.physicalHostId
              });
              
              // Inicializar el mapa de cores con los datos obtenidos
              if (data && data.mappings && Object.keys(data.mappings).length > 0) {
                logger.info("Asignaciones de cores cargadas correctamente:", data.mappings);
                
                // Asegurarse de que todos los cores del host virtual tienen una entrada en el mapeo
                const completeMappings = { ...data.mappings };
                
                // Verificar que tenemos un mapeo para todos los cores virtuales
                if (vHost.cores) {
                  for (let i = 1; i <= vHost.cores; i++) {
                    // Si no existe un mapeo para este core, inicializarlo con 0 (no mapeado)
                    if (completeMappings[i] === undefined) {
                      logger.info(`Inicializando core virtual ${i} como no mapeado`);
                      completeMappings[i] = 0;
                    }
                  }
                }
                
                setCoreMapping(completeMappings);
              } else {
                logger.info("No se encontraron asignaciones de cores guardadas");
                // Crear mapeo inicial con todas las asignaciones en 0
                const initialMapping: Record<number, number> = {};
                if (vHost.cores) {
                  for (let i = 1; i <= vHost.cores; i++) {
                    initialMapping[i] = 0; // 0 means not mapped
                  }
                }
                setCoreMapping(initialMapping);
              }
              
              // Guardar información sobre cores ya utilizados por otras VMs
              if (data && data.usedPhysicalCores) {
                logger.info("Cores físicos ya utilizados por otras VMs:", data.usedPhysicalCores);
                setUsedPhysicalCores(data.usedPhysicalCores);
              }
            } else {
              // Si falla la obtención de asignaciones, usar las del campo coreMapping como respaldo
              logger.warn("No se pudieron cargar las asignaciones desde el servidor, usando datos locales");
              if (vHost.coreMapping && Object.keys(vHost.coreMapping).length > 0) {
                setCoreMapping(vHost.coreMapping);
              } else {
                const initialMapping: Record<number, number> = {};
                if (vHost.cores) {
                  for (let i = 1; i <= vHost.cores; i++) {
                    initialMapping[i] = 0; // 0 means not mapped
                  }
                }
                setCoreMapping(initialMapping);
              }
            }
          } catch (error) {
            logger.error("Error al cargar las asignaciones de cores:", error);
            // Usar los datos locales si falló la carga desde el servidor
            if (vHost.coreMapping && Object.keys(vHost.coreMapping).length > 0) {
              setCoreMapping(vHost.coreMapping);
            } else {
              const initialMapping: Record<number, number> = {};
              if (vHost.cores) {
                for (let i = 1; i <= vHost.cores; i++) {
                  initialMapping[i] = 0; // 0 means not mapped
                }
              }
              setCoreMapping(initialMapping);
            }
          }
        } else {
          logger.warn("No hay token de autenticación disponible");
          if (vHost.coreMapping && Object.keys(vHost.coreMapping).length > 0) {
            setCoreMapping(vHost.coreMapping);
          } else {
            const initialMapping: Record<number, number> = {};
            if (vHost.cores) {
              for (let i = 1; i <= vHost.cores; i++) {
                initialMapping[i] = 0; // 0 means not mapped
              }
            }
            setCoreMapping(initialMapping);
          }
        }
      } catch (error: any) {
        logger.error("Error loading hosts:", error);
        setError(error.message || "Error al cargar la información de los hosts");
      } finally {
        setLoading(false);
      }
    };
    
    loadHosts();
  }, [hostId]);
  
  // Handle mapping a core
  const handleCoreMapping = (virtualCoreId: number, physicalCoreId: number) => {
    setCoreMapping(prevMapping => ({
      ...prevMapping,
      [virtualCoreId]: physicalCoreId === prevMapping[virtualCoreId] ? 0 : physicalCoreId
    }));
  };
  
  // Save core mapping
  const handleSave = async () => {
    if (!virtualHost) return;
    
    try {
      logger.info(`Guardando mapeo de cores para host ${hostId}`, coreMapping);
        // Log each mapping for debugging
      Object.entries(coreMapping).forEach(([virtualCoreId, physicalCoreId]) => {
        logger.debug('Preparing to save core mapping', {
          virtualCoreId,
          physicalCoreId,
          hostId
        });
      });
      
      // Usar el endpoint específico para mapeo de cores usando apiClient
      try {
        const response = await apiClient.post(`/hosts/${hostId}/core-mappings`, 
          { coreMappings: coreMapping }
        );
          // Log the response data
        logger.debug('Core mapping save response', {
          responseStatus: response.status,
          responseData: response.data
        });
        
        // Si llegamos aquí, la respuesta fue exitosa
      } catch (apiError: any) {
        logger.error("Error en la respuesta del servidor:", {
          status: apiError.response?.status,
          statusText: apiError.response?.statusText,
          data: apiError.response?.data
        });
        
        if (apiError.response?.status === 401 || apiError.response?.status === 403) {          toast({
            title: "Error de autenticación",
            description: "Su sesión ha expirado. Por favor, inicie sesión nuevamente.",
            variant: "destructive"
          });
          // Redirigir a la página de login
          navigate('/login');
          return;
        }
        
        throw new Error(`Error al guardar el mapeo: ${apiError.response?.status || 'desconocido'} ${apiError.response?.statusText || 'Error de conexión'}`);
      }
      
      // Para actualización local, también mantenemos el coreMapping en el host local
      setVirtualHost(prev => {
        if (!prev) return null;
        return {
          ...prev,
          coreMapping
        };
      });
      
      toast({
        title: "Mapeo guardado",
        description: "El mapeo de cores se ha guardado correctamente"
      });
      
      // Navigate back to the host detail page
      navigate(`/hosts/${hostId}`);
    } catch (error) {
      logger.error("Error saving core mapping:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Hubo un problema al guardar el mapeo de cores",
        variant: "destructive"
      });
    }
  };
  
  // Render virtual core
  const renderVirtualCore = (coreId: number) => {
    const isMapped = coreMapping[coreId] > 0;
    
    return (
      <TooltipProvider key={`v-${coreId}`} delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div 
              className={`relative w-16 h-16 m-1 rounded-md flex flex-col items-center justify-center border cursor-pointer transition-all hover:shadow-md ${
                isMapped ? "bg-blue-50 border-blue-300" : "bg-gray-100 border-gray-200"
              }`}
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
  };    // Render physical core
  const renderPhysicalCore = (coreId: number) => {
    const virtualCoresMapping = Object.entries(coreMapping)
      .filter(([_, pCoreId]) => parseInt(String(pCoreId)) === coreId)
      .map(([vCoreId]) => parseInt(vCoreId));
    
    const isMapped = virtualCoresMapping.length > 0;
    
    // Verificar si este core ya está asignado a otras VMs
    const isUsedByOtherVMs = usedPhysicalCores[coreId] !== undefined && usedPhysicalCores[coreId].length > 0;
    const otherVMsInfo = isUsedByOtherVMs ? usedPhysicalCores[coreId] : [];
    
    // Determinar el estilo del core según su estado
    let coreStyle = "";
    let bgElements: JSX.Element[] = [];
    
    if (isMapped && isUsedByOtherVMs) {
      // Core usado por esta VM y otras VMs - patrón proporcional
      coreStyle = "bg-gray-100 border-gray-300";
      const totalVMCount = 1 + otherVMsInfo.length; // Current VM + other VMs
      const currentVMCount = 1;
      
      // Segment for current VM (green)
      bgElements.push(
        <div 
          key="current-vm"
          className="absolute h-full bg-green-100 opacity-70" 
          style={{ 
            width: `${100 / totalVMCount}%`, 
            left: "0%" 
          }}
        />
      );
      
      // Segments for other VMs (amber)
      otherVMsInfo.forEach((vm, index) => {
        bgElements.push(
          <div 
            key={`other-vm-${vm.hostId}`}
            className="absolute h-full bg-amber-100 opacity-70" 
            style={{ 
              width: `${100 / totalVMCount}%`, 
              left: `${(100 / totalVMCount) * (currentVMCount + index)}%` 
            }}
          />
        );
      });
    } else if (isMapped) {
      coreStyle = "bg-green-50 border-green-300"; // Asignado solo a esta VM
    } else if (isUsedByOtherVMs) {
      coreStyle = "bg-amber-50 border-amber-300"; // Asignado solo a otras VMs
    } else {
      coreStyle = "bg-gray-100 border-gray-200"; // Libre
    }
    
    return (
      <TooltipProvider key={`p-${coreId}`} delayDuration={300}>        <Tooltip>
          <TooltipTrigger asChild>
            <div 
              className={`relative w-16 h-16 m-1 rounded-md flex flex-col items-center justify-center border transition-all ${coreStyle} cursor-pointer hover:shadow-md`}
              onClick={() => {
                // Si el core ya está usado por otras VMs, mostrar advertencia pero permitir asignación
                if (isUsedByOtherVMs) {
                  const vmNames = otherVMsInfo.map(vm => vm.hostName).join(', ');
                  toast({
                    title: "Core compartido",
                    description: `Este core también está asignado a las VMs: ${vmNames}. Se permite el mapeo múltiple para soft partitioning.`,
                    variant: "default"
                  });
                }
                
                // Find the first unmapped virtual core
                const unmappedVirtualCore = Object.entries(coreMapping)
                  .find(([_, pCoreId]) => parseInt(String(pCoreId)) === 0);
                
                if (unmappedVirtualCore) {
                  handleCoreMapping(parseInt(unmappedVirtualCore[0]), coreId);
                } else {
                  toast({
                    title: "Información",
                    description: "Todos los cores virtuales ya están mapeados. Desmapea alguno primero para reasignar.",
                    variant: "default"
                  });
                }
              }}
            >
              {/* Background pattern elements for proportional division */}
              {bgElements}
              
              <Microchip className={`h-8 w-8 relative z-10 ${
                isMapped ? "text-green-500" : 
                isUsedByOtherVMs ? "text-amber-500" : 
                "text-gray-400"
              }`} />
              <span className={`text-xs font-medium relative z-10 ${
                isMapped ? "text-green-700" : 
                isUsedByOtherVMs ? "text-amber-700" : 
                "text-gray-500"
              }`}>
                {coreId}
              </span>
                {/* Badge para cores mapeados a esta VM */}
              {isMapped && virtualCoresMapping.length > 0 && (
                <div className="absolute top-0 right-0 -mt-1 -mr-1 z-20">
                  <Badge variant="outline" className="bg-green-100 text-green-800 text-[10px] h-5 min-w-5 flex items-center justify-center p-0">
                    {virtualCoresMapping.length}
                  </Badge>
                </div>
              )}
              
              {/* Indicador para cores usados por otras VMs */}
              {isUsedByOtherVMs && (
                <div className="absolute top-0 left-0 -mt-1 -ml-1 z-20">
                  <Badge variant="outline" className="bg-amber-100 text-amber-800 text-[10px] h-5 px-1 flex items-center justify-center">
                    VM
                  </Badge>
                </div>
              )}            </div>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p className="text-sm font-medium">Core Físico {coreId}</p>
            {isMapped ? (
              <>
                <p className="text-xs">Mapeado a los cores virtuales:</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {virtualCoresMapping.map(vCoreId => (
                    <Badge key={vCoreId} variant="outline" className="bg-blue-100">
                      {vCoreId}
                    </Badge>
                  ))}
                </div>
              </>
            ) : isUsedByOtherVMs ? (
              <>
                <p className="text-xs text-amber-700 font-medium">Este core también está asignado a:</p>
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
  
  // Group cores by socket for physical host display
  const getPhysicalCoresBySockets = () => {
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
  };
  
  if (loading) {
    return (
      <Card className="w-full">
        <CardContent className="pt-6">
          <p className="text-center text-gray-500">Cargando información de hosts...</p>
        </CardContent>
      </Card>
    );
  }
  
  if (error) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Error</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTitle>Error al cargar datos</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <div className="mt-4">
            <Button 
              variant="outline" 
              onClick={() => navigate(`/hosts/${hostId}`)}
              className="flex items-center gap-1"
            >
              <ArrowLeft className="h-4 w-4" />
              Volver al host
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }
  
  if (!virtualHost || !physicalHost) {
    return (
      <Card className="w-full">
        <CardContent className="pt-6">
          <p className="text-center text-gray-500">No se encontraron los hosts necesarios</p>
          <div className="mt-4 flex justify-center">
            <Button 
              variant="outline" 
              onClick={() => navigate(`/hosts/${hostId}`)}
              className="flex items-center gap-1"
            >
              <ArrowLeft className="h-4 w-4" />
              Volver al host
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }
  
  const physicalSockets = getPhysicalCoresBySockets();
  
  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Mapeo de Cores</CardTitle>
            <CardDescription>
              Mapear cores virtuales a físicos para {virtualHost.name}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              onClick={() => navigate(`/hosts/${hostId}`)}
              className="flex items-center gap-1"
            >
              <ArrowLeft className="h-4 w-4" />
              Volver
            </Button>
            <Button 
              onClick={handleSave}
              className="flex items-center gap-1 bg-blue-500 hover:bg-blue-600"
            >
              <Save className="h-4 w-4" />
              Guardar Mapeo
            </Button>
          </div>
        </div>
      </CardHeader>
      <Separator />
      <CardContent className="pt-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Virtual Host Cores */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Server className="h-5 w-5 text-blue-500" />
              <h3 className="text-lg font-medium">Host Virtual: {virtualHost.name}</h3>
            </div>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Cores Virtuales</CardTitle>
                <CardDescription>Selecciona un core para mapearlo o desmapearlo</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap justify-center">
                  {virtualHost.cores && Array.from({ length: virtualHost.cores }, (_, i) => i + 1).map((coreId) => (
                    <div 
                      key={coreId} 
                      onClick={() => handleCoreMapping(coreId, 0)}
                    >
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
              </CardHeader>              <CardContent>                <div className="flex items-center gap-2 mb-3 justify-center flex-wrap">
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 bg-green-300 rounded-sm"></div>
                    <span className="text-xs text-gray-600">Solo esta VM</span>
                  </div>
                  <div className="flex items-center gap-1 ml-3">
                    <div className="w-3 h-3 bg-amber-300 rounded-sm"></div>
                    <span className="text-xs text-gray-600">Solo otras VMs</span>
                  </div>
                  <div className="flex items-center gap-1 ml-3">
                    <div className="w-3 h-3 bg-gradient-to-r from-green-300 to-amber-300 rounded-sm"></div>
                    <span className="text-xs text-gray-600">Compartido (múltiple)</span>
                  </div>
                  <div className="flex items-center gap-1 ml-3">
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
        
      </CardContent>
    </Card>
  );
}