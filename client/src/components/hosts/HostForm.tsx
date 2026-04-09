import { useEffect, useState } from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import logger from "@/lib/logger"; // Importamos el logger
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { storageService } from "@/lib/storageService";
import { useSelectedCustomerId } from "@/hooks/use-selected-customer";
import apiClient from "@/lib/apiClient";
import { Host, Customer } from "@/lib/types";
import { toast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { AlertCircle, Lock, Unlock, Map, MapPin, Check, X } from "lucide-react";
import { CoreMappingDialog } from "./CoreMappingDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Form schema
const formSchema = z.object({
  name: z.string().min(2, {
    message: "Name must be at least 2 characters.",
  }),
  serverType: z.enum(["Physical", "Virtual", "Oracle Cloud"]),
  virtualizationType: z.string().optional(),
  cpuModel: z.string().min(1, {
    message: "CPU Model is required.",
  }),
  sockets: z.coerce.number().int().min(1),
  cores: z.coerce.number().int().min(1),
  threadsPerCore: z.coerce.number().int().min(1),
  physicalHostId: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export interface HostFormProps {
  hostId?: string;
}

export function HostForm({ hostId }: HostFormProps) {
  const [, navigate] = useLocation();
  const [host, setHost] = useState<Host | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [physicalHosts, setPhysicalHosts] = useState<Host[]>([]);
  const [selectedPhysicalHost, setSelectedPhysicalHost] = useState<Host | null>(null);
  const [virtualizationTypes, setVirtualizationTypes] = useState<string[]>([]);
  const [cpuModelsWithFactors, setCpuModelsWithFactors] = useState<{ [key: string]: number }>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [customerLoaded, setCustomerLoaded] = useState(false);
  const [hardPartitioning, setHardPartitioning] = useState(false);
  const [isEditingCoreFactor, setIsEditingCoreFactor] = useState(false);
  const [customCoreFactor, setCustomCoreFactor] = useState<number | null>(null);
  const [currentServerType, setCurrentServerType] = useState<"Physical" | "Virtual" | "Oracle Cloud">("Physical");
  const [coreMappingDialogOpen, setCoreMappingDialogOpen] = useState(false);
  const [coreMapping, setCoreMapping] = useState<Record<number, number>>({});
  const [showHardPartitioningAlert, setShowHardPartitioningAlert] = useState(false);
    // Calcular cuántos cores virtuales están mapeados
  const getMappedCoreCount = () => {
    const coreCount = form.getValues("cores");
    if (!coreCount || coreCount < 1) return 0;
    
    // Verificar específicamente los cores del 1 al coreCount
    let mappedCount = 0;
    for (let i = 1; i <= coreCount; i++) {
      if (coreMapping[i] && coreMapping[i] > 0) {
        mappedCount++;
      }
    }
    
    return mappedCount;
  };
    // Función para comprobar si todos los cores virtuales están mapeados
  const areAllCoresMapped = () => {
    const coreCount = form.getValues("cores");
    if (!coreCount || coreCount < 1) return false;
    
    // Log para depuración
    logger.info("Verificando si todos los cores están mapeados:", { 
      coreCount, 
      coreMapping, 
      mappedCount: Object.values(coreMapping).filter(val => val > 0).length 
    });
    
    // Verificar que cada core del 1 al coreCount tiene un mapeo válido
    for (let i = 1; i <= coreCount; i++) {
      if (!coreMapping[i] || coreMapping[i] === 0) {
        logger.info(`Core virtual ${i} no está mapeado`);
        return false; // Al menos un core no está mapeado
      }
    }
    
    return true; // Todos los cores están mapeados
  };

  // Función para manejar el mapeo de cores
  const handleMapCores = () => {
    const physicalHostId = form.getValues("physicalHostId");
    const coreCount = form.getValues("cores");
    
    if (!coreCount || coreCount < 1) {
      toast({
        title: "Atención",
        description: "Primero debe especificar la cantidad de cores virtuales.",
        variant: "destructive"
      });
      return;
    }
    
    if (hostId && physicalHostId) {
      // Para hosts existentes, navegamos a la página dedicada
      logger.info(`Navegando a la página de mapeo de cores para host existente: ${hostId}`);
      navigate(`/hosts/${hostId}/map-cores`);
    } else if (physicalHostId) {
      // Para nuevos hosts, abrimos el diálogo de mapeo
      logger.info(`Abriendo diálogo de mapeo de cores para nuevo host con ${coreCount} cores virtuales`);
      setCoreMappingDialogOpen(true);
      
      // Mensaje informativo
      toast({
        title: "Mapeo de cores",
        description: "Seleccione qué cores físicos se asignarán a los cores virtuales",
        variant: "default"
      });
    } else {
      toast({
        title: "Error",
        description: "Primero debe seleccionar un host físico para mapear los cores.",
        variant: "destructive"
      });
    }
  };
  
  // Manejar cambio en el mapeo de cores
  const handleCoreMappingChange = (mapping: Record<number, number>) => {
    setCoreMapping(mapping);
    
    // Log más detallado para depuración
    const mappedEntries = Object.entries(mapping)
      .filter(([_, physicalCore]) => physicalCore > 0)
      .map(([vCore, pCore]) => `V${vCore}->P${pCore}`);
    
    if (mappedEntries.length > 0) {
      logger.info(`Core mapping actualizado con ${mappedEntries.length} asignaciones: ${mappedEntries.join(", ")}`);
    } else {
      logger.info("Core mapping actualizado: No hay cores mapeados");
    }
  };

  // Get current customer ID from storage
  const currentCustomerId = useSelectedCustomerId();

  useEffect(() => {
    if (currentCustomerId) {
      setCustomerLoaded(true);
    }
  }, [currentCustomerId]);

  useEffect(() => {
    if (!customerLoaded) return;

    const loadData = async () => {
      setLoading(true);
      setError(null);

      try {
        const [hosts, virtTypes, cpuFactors] = await Promise.all([
          storageService.getHostsByCustomer(currentCustomerId),
          storageService.getVirtualizationTypes(),
          storageService.getCpuModelsWithFactors()
        ]);
        
       
        // Check if CPU models are empty - if so, this is our issue
        if (Object.keys(cpuFactors).length === 0) {
          logger.error("WARNING: No CPU models/factors returned from server");
        }
        
        // Improved filter for physical hosts - check both serverType and server_type
        const filtered = hosts.filter(h => {
          const isPhysical = (h.serverType === "Physical" || 
                             (h as any).server_type === "Physical" || 
                             (!h.physicalHostId && h.serverType !== "Virtual" && h.serverType !== "Oracle Cloud"));
          return isPhysical && h.id !== hostId;
        });
        
        setPhysicalHosts(filtered);

        setVirtualizationTypes(virtTypes);
        setCpuModelsWithFactors(cpuFactors);

        // Load host data if editing
        if (hostId) {
          const hostData = hosts.find(h => h.id === hostId);
          if (hostData) {
            setHost(hostData);
          }
        }

        setError(null);
      } catch (error) {
        logger.error('Error loading data:', error);
        setError("Could not load necessary data. Please try again.");
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [hostId, customerLoaded, currentCustomerId]);

  // Set up form with default values or existing host data
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: hostId ? {} : {
      name: "",
      serverType: "Physical",
      virtualizationType: "None",
      sockets: 1,
      cores: 1,
      threadsPerCore: 1,
    },
  });

  // Update form when host data is loaded
  useEffect(() => {
    if (host) {
      logger.info("Loading host data into form:", host);
      // Use only the correct property names from the Host interface
      const serverType = host.serverType || "Physical";
      const virtualizationType = host.virtualizationType || "None";
      const physicalHostId = host.physicalHostId;
      
      logger.info("Normalized serverType:", serverType);
      
      // Update currentServerType state
      setCurrentServerType(serverType as "Physical" | "Virtual" | "Oracle Cloud");
      
      form.reset({
        name: host.name,
        serverType: serverType as "Physical" | "Virtual" | "Oracle Cloud",
        virtualizationType: virtualizationType,
        cpuModel: host.cpuModel,
        sockets: host.sockets || 1,
        cores: host.coreCount || host.cores || 1,
        threadsPerCore: host.threadCount || host.threadsPerCore || 1,
        physicalHostId: physicalHostId ?? undefined,
      });
      
      // If this is a virtual machine with a physical host, set hardPartitioning based on virtualization type
      if ((serverType === "Virtual") && physicalHostId && virtualizationType) {
        const isHardPartitioningType = ["KVM", "LDOM"].includes(virtualizationType);
        setHardPartitioning(host.hasHardPartitioning || false);
      }
    }
  }, [host, form]);
  
  // Effect to update inherited values from physical host when physicalHostId changes
  useEffect(() => {
    const physicalHostId = form.watch("physicalHostId");
    const serverType = form.watch("serverType");
    
    if (serverType === "Virtual" && physicalHostId) {
      const physicalHost = physicalHosts.find(h => h.id === physicalHostId);
      if (physicalHost) {
        setSelectedPhysicalHost(physicalHost);
        
        // Inherit CPU model and sockets from physical host
        if (physicalHost.cpuModel) {
          form.setValue("cpuModel", physicalHost.cpuModel);
          logger.info("Inherited CPU model from physical host:", physicalHost.cpuModel);
        }
        
        if (physicalHost.sockets) {
          form.setValue("sockets", physicalHost.sockets);
          logger.info("Inherited sockets from physical host:", physicalHost.sockets);
        }
      }
    } else if (serverType !== "Virtual") {
      setSelectedPhysicalHost(null);

      if (physicalHostId) {
        form.setValue("physicalHostId", undefined, {
          shouldDirty: true,
          shouldValidate: true,
        });
      }
    }
  }, [form.watch("physicalHostId"), form.watch("serverType"), physicalHosts, form]);
  
  // Update hard partitioning flag when virtualization type changes
  useEffect(() => {
    const virtType = form.watch("virtualizationType");
    if (virtType === "KVM" || virtType === "LDOM") {
      setHardPartitioning(host?.hasHardPartitioning || false);
    } else {
      setHardPartitioning(false);
    }
  }, [form.watch("virtualizationType"), host]);

  // Efecto para verificar el mapeo cuando cambia el número de cores
  useEffect(() => {
    const cores = form.watch("cores");
    const serverType = form.watch("serverType");
    
    if (serverType === "Virtual" && hardPartitioning && cores) {
      // Si el número de cores cambia y ya tenemos un mapeo, verificamos si sigue siendo válido
      if (Object.keys(coreMapping).length > 0) {
        // Verificar que cada core virtual tenga un mapeo
        let validMapping = true;
        for (let i = 1; i <= cores; i++) {
          if (!coreMapping[i] || coreMapping[i] === 0) {
            validMapping = false;
            break;
          }
        }
        
        // Si el mapeo ya no es válido con el nuevo número de cores, mostrar mensaje
        if (!validMapping) {
          logger.info("Mapeo de cores incompleto después de cambiar el número de cores:", { cores, coreMapping });
        }
      }
    }
  }, [form.watch("cores"), form.watch("serverType"), hardPartitioning, coreMapping]);

  // Update core factor when CPU model changes or when editing core factor value
  useEffect(() => {
    if (isEditingCoreFactor && customCoreFactor !== null) {
      // If custom core factor is being edited, keep using that value
      return;
    }
    
    const cpuModel = form.watch("cpuModel");
    const serverType = form.watch("serverType");
    
    if (serverType === "Virtual" && selectedPhysicalHost?.coreFactor) {
      // For virtual servers, inherit core factor from physical host
      setCustomCoreFactor(selectedPhysicalHost.coreFactor);
    } else if (cpuModel && cpuModelsWithFactors[cpuModel]) {
      // For physical servers, use core factor based on CPU model
      setCustomCoreFactor(cpuModelsWithFactors[cpuModel]);
    } else {
      // Default value if no CPU model is selected
      setCustomCoreFactor(0.5);
    }
  }, [form.watch("cpuModel"), form.watch("serverType"), selectedPhysicalHost, cpuModelsWithFactors, isEditingCoreFactor]);

  // Server Types - these are fixed because they are fundamental to the application
  const serverTypes = [
    { label: "Physical", value: "Physical" },
    { label: "Virtual", value: "Virtual" },
    { label: "Oracle Cloud", value: "Oracle Cloud" },
  ];  // Form submission
  async function onSubmit(data: FormValues) {
    try {
      logger.info("🚀 onSubmit FUNCTION CALLED with form data:", JSON.stringify(data));
      
      // Verificar que tenemos un hostId si estamos en modo de actualización
      if (hostId) {
        logger.info("🔄 Updating existing host with ID:", hostId);
      } else {
        logger.info("➕ Creating new host");
      }
        // Verificar si tenemos hard partitioning habilitado y si todos los cores están mapeados
      if (data.serverType === "Virtual" && hardPartitioning && !areAllCoresMapped()) {
        logger.warn("Hard partitioning enabled but not all cores are mapped. Submission prevented.");
        toast({
          title: "Mapeo de Cores Incompleto",
          description: "Con Hard Partitioning habilitado, todos los cores virtuales deben estar mapeados a cores físicos para poder guardar.",
          variant: "destructive",
        });
        return; // Prevenir el envío del formulario
      }

      logger.info("Creating/updating host with customer ID:", currentCustomerId);
      
      if (!currentCustomerId) {
        logger.error("No customer ID available when saving host");
        toast({
          title: "Error",
          description: "No hay cliente seleccionado. Por favor, cierre sesión y vuelva a iniciar sesión.",
          variant: "destructive"
        });
        return;
      }
      
      // Log core mapping if exists (for new hosts with hard partitioning)
      if (data.serverType === "Virtual" && hardPartitioning && Object.keys(coreMapping).length > 0) {
        logger.info("Core mapping will be applied after host creation:", coreMapping);
      }
        // Log core mapping if exists (for new hosts with hard partitioning)
      if (data.serverType === "Virtual" && hardPartitioning && Object.keys(coreMapping).length > 0) {
        logger.info("Core mapping will be applied after host creation:", coreMapping);
      }

      // Use custom core factor if editing is enabled, otherwise calculate based on CPU model
      const coreFactor = isEditingCoreFactor && customCoreFactor !== null
                        ? customCoreFactor
                        : (data.cpuModel && cpuModelsWithFactors[data.cpuModel] 
                           ? cpuModelsWithFactors[data.cpuModel] 
                           : 0.5);
      
      // Fix virtualization type handling - set to null when "None" or empty
      const virtualizationType = (!data.virtualizationType || data.virtualizationType === "None") 
                                ? null 
                                : data.virtualizationType;

      // Ensure serverType is exactly "Physical", "Virtual", or "Oracle Cloud"
      let normalizedServerType = data.serverType;
      if (!normalizedServerType) {
        // Default to Physical if undefined
        normalizedServerType = "Physical";
        logger.warn("serverType was undefined, defaulting to Physical");
      } else if (normalizedServerType.toLowerCase() === "physical") {
        normalizedServerType = "Physical";
      } else if (normalizedServerType.toLowerCase() === "virtual") {
        normalizedServerType = "Virtual";
      } else if (normalizedServerType.toLowerCase().includes("cloud")) {
        normalizedServerType = "Oracle Cloud";
      }
      
      logger.info("🔹 Normalized serverType:", normalizedServerType);
      
      // Map form data to exactly match server expectations
      const hostData = {
        name: data.name,
        cpuModel: data.cpuModel, // Required by schema validation
        serverType: normalizedServerType as 'Physical' | 'Virtual' | 'Oracle Cloud',
        virtualizationType: virtualizationType || undefined,
        hasHardPartitioning: hardPartitioning,
        cores: data.cores,
        sockets: data.sockets,
        threadsPerCore: data.threadsPerCore,
        coreFactor: coreFactor,
        physicalHostId: data.physicalHostId || undefined,
        customerId: currentCustomerId,
        coreCount: data.cores,
        threadCount: data.cores * data.threadsPerCore
      };

      logger.info("🔹 Prepared host data:", JSON.stringify(hostData));      if (hostId) {
        // Update existing host - with proper error tracking
        try {
          logger.info("🔄 Starting update for host with ID:", hostId);
          
          // Mostrar explícitamente datos que se envían para update
          logger.info("📤 Sending data to updateHost method:", JSON.stringify(hostData));
          
          // Establecer explícitamente loading state 
          setLoading(true);
          
          // Log before API call
          logger.info("⏱️ Starting updateHost API call");
          
          const updatedHost = await storageService.updateHost(hostId, hostData);
          
          // Log after API call
          logger.info("✅ updateHost API call completed");
          
          logger.info("✅ Host updated successfully:", updatedHost);
          
          // Show success message
          toast({
            title: "Host Updated",
            description: "Host has been successfully updated"
          });
          
          // Only navigate if update was successful
          logger.info("🔄 Navigating to /hosts after successful update");
          navigate("/hosts");
        } catch (error: any) {
          // Get detailed error message from the server if available
          let errorMessage = "There was an error updating the host";
          
          logger.error("❌ Error caught in host update:", {
            error,
            errorMessage: error.message,
            errorType: typeof error,
            errorKeys: Object.keys(error)
          });
          
          if (error.response && error.response.data && error.response.data.error) {
            // Convert error object to string if it's not already
            if (typeof error.response.data.error === 'object') {
              errorMessage = `Server error: ${JSON.stringify(error.response.data.error)}`;
            } else {
              errorMessage = `Server error: ${error.response.data.error}`;
            }
          } else if (error.message) {
            errorMessage = error.message;
          }
          
          // Show error message
          toast({
            title: "Error",
            description: errorMessage,
            variant: "destructive"
          });
          logger.error("❌ Detailed error updating host:", error);
        } finally {
          setLoading(false);
        }      } else {
        // Create new host
        try {
          // Create the host first
          const newHost = await storageService.addHost(hostData);
          
          // If host creation was successful and we have core mapping data
          if (newHost && newHost.id && hardPartitioning && Object.keys(coreMapping).length > 0) {
            try {
              logger.info("Applying core mapping to new host:", newHost.id);
              
              // Use the server endpoint to save the core mapping
              await apiClient.post(`/hosts/${newHost.id}/core-mappings`, {
                coreMappings: coreMapping
              });
              
              logger.info("Core mapping saved successfully");
            } catch (mappingError: any) {
              // Just log the error but don't fail the entire operation
              logger.error("Error saving core mapping:", mappingError);
                toast({
                title: "Advertencia",
                description: "El host se ha creado pero hubo un problema al guardar el mapeo de cores. Puede editar el host para aplicar el mapeo más tarde.",
                variant: "destructive"
              });
            }
          }
          
          toast({
            title: "Host Created",
            description: "New host has been successfully created"
          });
          form.reset();
          setCoreMapping({});
          
          // Only navigate if creation was successful
          navigate("/hosts");
        } catch (error: any) {
          // Get detailed error message from the server if available
          let errorMessage = "There was an error saving the host";
          if (error.response && error.response.data && error.response.data.error) {
            // Convert error object to string if it's not already
            if (typeof error.response.data.error === 'object') {
              errorMessage = `Server error: ${JSON.stringify(error.response.data.error)}`;
            } else {
              errorMessage = `Server error: ${error.response.data.error}`;
            }
          } else if (error.message) {
            errorMessage = error.message;
          }
          
          toast({
            title: "Error",
            description: errorMessage,
            variant: "destructive"
          });
          logger.error("Detailed error creating host:", error);
        }
      }
    } catch (error: any) {
      logger.error("Error in form submission:", error);
      // Get detailed error message if available
      let errorMessage = "There was an error processing your request";
      if (error.response && error.response.data && error.response.data.error) {
        // Convert error object to string if it's not already
        if (typeof error.response.data.error === 'object') {
          errorMessage = `Server error: ${JSON.stringify(error.response.data.error)}`;
        } else {
          errorMessage = `Server error: ${error.response.data.error}`;
        }
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive"
      });
    }
  }

  // Cargar datos del host usando getHostById
  useEffect(() => {
    if (hostId) {
      const fetchHostDirectly = async () => {
        logger.info("🔍 Fetching host data directly from API for ID:", hostId);
        setLoading(true);
        try {
          // Usar apiClient en lugar de fetch para incluir automáticamente el token de autenticación
          const response = await apiClient.get(`/hosts/${hostId}`);
          
          logger.info("🔄 Raw API response:", JSON.stringify(response.data, null, 2));
          
          if (response.data) {
            setHost(response.data);
            
            // Normalizing server type from different property naming conventions
            let serverType = "Physical"; // Default value
            
            // Check for server_type (snake_case from API) or serverType (camelCase from front-end)
            if (response.data.server_type || response.data.serverType) {
              const rawType = (response.data.server_type || response.data.serverType).toLowerCase();
              
              // Normalize to one of our three valid server types
              if (rawType.includes('virtual') || rawType === 'vm') {
                serverType = "Virtual";
              } else if (rawType.includes('cloud') || rawType.includes('oracle cloud')) {
                serverType = "Oracle Cloud";
              } else if (rawType.includes('physical')) {
                serverType = "Physical";
              }
            } else {
              // Infer type based on physical host association
              serverType = response.data.physical_host_id || response.data.physicalHostId ? "Virtual" : "Physical";
            }
            
            logger.info("⚙️ Normalized server type:", serverType);
            
            // Establecer valores del formulario directamente
            form.setValue("name", response.data.name);
            form.setValue("serverType", serverType as "Physical" | "Virtual" | "Oracle Cloud");
            form.setValue("virtualizationType", response.data.virtualization_type || response.data.virtualizationType || "None");
            form.setValue("cpuModel", response.data.cpu_model || response.data.cpuModel || "");
            form.setValue("sockets", response.data.sockets || 1);
            form.setValue("cores", response.data.core_count || response.data.coreCount || response.data.cores || 1);
            form.setValue("threadsPerCore", response.data.threads_per_core || response.data.threadCount || response.data.threadsPerCore || 1);
            form.setValue("physicalHostId", response.data.physical_host_id || response.data.physicalHostId || undefined);
              // Establecer hard partitioning explícitamente
            const hasHardPartitioning = Boolean(response.data.has_hard_partitioning || response.data.hasHardPartitioning);
            setHardPartitioning(hasHardPartitioning);
            logger.info("🔒 Hard partitioning set to:", hasHardPartitioning);
            
            // Si tiene hard partitioning, intentaremos cargar el mapeo de cores en el siguiente useEffect
          }
        } catch (error) {
          logger.error("❌ Error fetching host:", error);
          setError("Failed to fetch host data");
        } finally {
          setLoading(false);
        }
      };
      
      fetchHostDirectly();
    }
  }, [hostId, form]);

  // Cargar el mapeo de cores si es un host virtual con hard partitioning
  useEffect(() => {
    if (hostId && host && host.serverType === "Virtual" && host.hasHardPartitioning) {
      const fetchCoreMappings = async () => {
        try {
          logger.info("🔄 Fetching core mappings for host:", hostId);
          const response = await apiClient.get(`/hosts/${hostId}/core-assignments`);
          
          if (response.data && response.data.mappings) {
            // Convertir el mapeo de string a números para la interfaz
            const mappings: Record<number, number> = {};
            
            // Procesar las asignaciones de cores
            Object.entries(response.data.mappings).forEach(([vCoreStr, pCoreStr]) => {
              const vCore = parseInt(vCoreStr);
              const pCore = parseInt(String(pCoreStr));
              if (!isNaN(vCore) && !isNaN(pCore)) {
                mappings[vCore] = pCore;
              }
            });
            
            logger.info("✅ Core mappings loaded:", mappings);
            
            // Actualizar el estado local de coreMapping
            setCoreMapping(mappings);
            
            // Mensaje de confirmación
            if (Object.keys(mappings).length > 0) {
              toast({
                title: "Información",
                description: `Se han cargado ${Object.keys(mappings).length} mapeos de cores existentes`,
                variant: "default"
              });
            }
          }
        } catch (error) {
          logger.error("❌ Error fetching core mappings:", error);
          // No mostrar un error al usuario, simplemente dejar el mapeo vacío
        }
      };
      
      fetchCoreMappings();
    }
  }, [hostId, host]);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{hostId ? "Edit Host" : "Create New Host"}</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>        <form onSubmit={(e) => {
            e.preventDefault(); // Prevent default form submission
            logger.info("📝 Form submit event triggered", { formId: "host-form" });
            
            form.handleSubmit(
              (data) => {
                logger.info("❗❗❗ Form validation passed, starting onSubmit function");
                return onSubmit(data);
              }, 
              (errors) => {
                logger.error("❗❗❗ Form validation errors:", JSON.stringify(errors));
                // Show validation errors to user
                toast({
                  title: "Validation Error",
                  description: "Please fix the form errors before submitting",
                  variant: "destructive"
                });
              }
            )(e); // Execute the form handler immediately with the event
          }} className="space-y-6" id="host-form">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Host Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Host name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="serverType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Server Type</FormLabel>
                    <Select
                      onValueChange={(value) => {
                        field.onChange(value);
                        setCurrentServerType(value as "Physical" | "Virtual" | "Oracle Cloud");
                      }}
                      value={host?.serverType || field.value || "Physical"}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {serverTypes.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            {type.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {form.watch("serverType") === "Virtual" && (
                <>
                  <FormField
                    control={form.control}
                    name="virtualizationType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Virtualization Technology</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                          disabled={loading}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select virtualization type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {virtualizationTypes.map((type) => (
                              <SelectItem key={type} value={type}>
                                {type}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="physicalHostId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Physical Host</FormLabel>
                        <div className="flex space-x-2">
                          <div className="flex-grow">
                            <Select
                              onValueChange={field.onChange}
                              value={field.value ?? undefined}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select physical host" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {physicalHosts.map((host) => (
                                  <SelectItem key={host.id} value={host.id}>
                                    {host.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}
              
              <FormField
                control={form.control}
                name="cpuModel"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>CPU Model</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={loading || form.watch("serverType") === "Virtual"}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={form.watch("serverType") === "Virtual" && selectedPhysicalHost?.cpuModel 
                            ? `Inherited from ${selectedPhysicalHost.name}` 
                            : "Select CPU model (required)"} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {Object.keys(cpuModelsWithFactors).map((model) => (
                          <SelectItem key={model} value={model}>
                            {model}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {form.watch("serverType") === "Virtual" && selectedPhysicalHost?.cpuModel && (
                      <p className="text-xs text-muted-foreground mt-1">
                        CPU model inherited from physical host: {selectedPhysicalHost.cpuModel}
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="sockets"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sockets</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="1"
                        {...field}
                        type="number"
                        min={1}
                        disabled={form.watch("serverType") === "Virtual"}
                      />
                    </FormControl>
                    {form.watch("serverType") === "Virtual" && selectedPhysicalHost && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Sockets inherited from physical host: {selectedPhysicalHost.sockets || 1}
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="cores"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {form.watch("serverType") === "Virtual" 
                        ? "Virtual CPUs" 
                        : form.watch("serverType") === "Oracle Cloud" 
                          ? "OCPUs" 
                          : "Cores"}
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="1"
                        {...field}
                        type="number"
                        min={1}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="threadsPerCore"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Threads per Core</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="1"
                        {...field}
                        type="number"
                        min={1}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              {/* Core Factor field with padlock */}
              <FormItem>
                <FormLabel>Core Factor</FormLabel>
                <div className="flex items-center space-x-2">
                  <Input
                    placeholder="0.5"
                    value={customCoreFactor !== null ? customCoreFactor : "0.5"}
                    onChange={(e) => {
                      const value = parseFloat(e.target.value);
                      if (!isNaN(value)) {
                        setCustomCoreFactor(value);
                      }
                    }}
                    type="number"
                    min={0}
                    step={0.1}
                    max={1}
                    disabled={!isEditingCoreFactor}
                    className="flex-grow"
                  />
                  <Button 
                    type="button"
                    variant="outline" 
                    size="icon" 
                    onClick={() => setIsEditingCoreFactor(!isEditingCoreFactor)}
                    title={isEditingCoreFactor ? "Lock core factor" : "Unlock to edit core factor"}
                    className="flex-shrink-0"
                  >
                    {isEditingCoreFactor ? (
                      <Unlock className="h-4 w-4" />
                    ) : (
                      <Lock className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </FormItem>
              
              {/* Hard Partitioning Checkbox for KVM/LDOM virtualization */}
              {form.watch("serverType") === "Virtual" && 
               ["KVM", "LDOM"].includes(form.watch("virtualizationType") || "") && (
                <div className="col-span-2">
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="hardPartitioning"
                      checked={hardPartitioning}
                      onChange={(e) => setHardPartitioning(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div>
                      <label htmlFor="hardPartitioning" className="text-sm font-medium text-gray-900">
                        Hard Partitioning
                      </label>
                      <p className="text-xs text-gray-500">
                        Mark this if the virtual machine uses hard partitioning technology. This affects Oracle licensing.
                      </p>
                    </div>
                  </div>                    {/* Botón para mapear cores cuando está habilitado hard partitioning y hay un host físico seleccionado */}                  {hardPartitioning && form.watch("physicalHostId") && (
                    <div className="mt-4 ml-6 border-t pt-4">
                      <div className="flex items-center justify-between mb-3">
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          onClick={handleMapCores}
                          className="flex items-center space-x-1 bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
                        >
                          <MapPin className="h-4 w-4" />
                          <span>Mapear Cores</span>
                        </Button>
                        
                        {/* Indicador de estado de mapeo */}
                        <div className="flex items-center">
                          {areAllCoresMapped() ? (
                            <div className="flex items-center text-green-600">
                            </div>
                          ) : getMappedCoreCount() > 0 ? (
                            <div className="flex items-center text-amber-600">
                              <AlertCircle className="h-4 w-4 mr-1" />
                              <span className="text-xs font-medium">{getMappedCoreCount()} de {form.getValues("cores")} cores mapeados</span>
                            </div>
                          ) : (
                            <div className="flex items-center text-red-600">
                              <X className="h-4 w-4 mr-1" />
                              <span className="text-xs font-medium">Sin mapeo de cores</span>
                            </div>
                          )}
                        </div>
                      </div>
                      
                      <p className="text-xs text-muted-foreground mt-2">
                        Configure qué cores físicos están asignados a esta VM con hard partitioning.
                        Este paso es necesario para un licenciamiento correcto.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3">
                <div className="flex items-start">
                  <div className="flex-shrink-0">
                    <AlertCircle className="h-4 w-4 text-red-500" />
                  </div>
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-red-800">Error de carga</h3>
                    <div className="text-sm text-red-700 mt-1">
                      {error}
                    </div>
                  </div>
                </div>
              </div>
            )}            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => navigate("/hosts")}>
                Cancel
              </Button>              <Button 
                type="button" 
                disabled={loading} 
                className="bg-blue-500 hover:bg-blue-600"
                onClick={(e) => {
                  e.preventDefault(); // Prevenir comportamiento por defecto
                  
                  // Debug information about button click
                  logger.info("🔘 Submit button clicked manually", { 
                    hostId, 
                    eventType: e.type,
                    formValid: form.formState.isValid,
                    formErrors: form.formState.errors 
                  });
                  
                  if (Object.keys(form.formState.errors).length > 0) {
                    logger.error("Form has validation errors:", form.formState.errors);
                    return; // Don't proceed if there are validation errors
                  }
                  
                  // Get form values directly for debugging
                  const formValues = form.getValues();
                  logger.debug("📝 Current form values:", formValues);
                  
                  try {
                    // Enviar el formulario manualmente - con manejo de errores explícito
                    logger.info("⏱️ Calling form.handleSubmit...");
                    const submitHandler = form.handleSubmit(
                      (data) => {
                        logger.info("✅ Form validation passed, data:", data);
                        
                        // Try-catch específico para el onSubmit para capturar errores
                        try {
                          logger.info("🚀 Calling onSubmit function with data");
                          return onSubmit(data);
                        } catch (submitError) {
                          logger.error("❌ Error in onSubmit:", submitError);
                          throw submitError; // Re-throw to show in UI
                        }
                      }, 
                      (errors) => {
                        logger.error("❌ Form validation errors:", errors);
                      }
                    );
                    
                    // Ejecutar el handler directamente
                    submitHandler(e);
                    logger.info("⏱️ After form.handleSubmit execution");
                  } catch (error) {
                    logger.error("❌ Error in form submission:", error);
                  }
                }}
              >
                {hostId ? "Update Host" : "Create Host"}
              </Button>
            </div>
          </form>
        </Form>      </CardContent>
        {/* Core Mapping Dialog */}
      <CoreMappingDialog
        open={coreMappingDialogOpen}
        onOpenChange={setCoreMappingDialogOpen}
        virtualHost={form.getValues()}
        physicalHost={selectedPhysicalHost}
        onCoreMappingChange={handleCoreMappingChange}
        existingMapping={coreMapping}
      />
      
      {/* Alert Dialog for Hard Partitioning */}      {/* Ya no usamos el diálogo de alerta, pero lo mantenemos por compatibilidad */}
      <AlertDialog open={false} onOpenChange={() => {}}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mapeo de Cores Requerido</AlertDialogTitle>
            <AlertDialogDescription>
              <p className="mb-2">Ha habilitado Hard Partitioning para este host virtual. Debe mapear todos los cores virtuales a cores físicos.</p>
              <p className="mb-2">En un entorno con Hard Partitioning, todos los cores virtuales deben estar mapeados a cores físicos específicos para cumplir con las condiciones de licenciamiento de Oracle.</p>
              <p>Por favor, complete el mapeo de cores antes de continuar.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Entendido</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
