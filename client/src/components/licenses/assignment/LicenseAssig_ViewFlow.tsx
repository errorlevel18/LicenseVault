import { useState, useEffect, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { License, Host, Environment, Instance } from "@/lib/types";
import { storageService as globalStorageService } from "@/lib/storageService"; // Renombrar para evitar conflicto
import { CoreSelectionDialog } from "@/components/licenses/assignment/CoreSelectionDialog";
import { Filter, RefreshCw, Database, Server, Monitor, CreditCard } from "lucide-react";
import { useToast as useGlobalToast } from "@/hooks/use-toast"; // Renombrar para evitar conflicto
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Edge,
  Connection,
  MarkerType,
  NodeTypes,
  Node,
  Position,
  // applyNodeChanges, // No es necesario si usamos onNodesChange directo de useNodesState
  // applyEdgeChanges, // No es necesario si usamos onEdgesChange directo de useEdgesState
  useReactFlow,
  ReactFlowProvider,
  NodeChange,
  EdgeChange,
  OnNodesChange,
  OnEdgesChange,
  OnConnect,
} from "reactflow";
import "reactflow/dist/style.css";
import { EnvironmentNode } from "@/components/licenses/assignment/EnvironmentNode";
import { InstanceNode } from "@/components/licenses/assignment/InstanceNode";
import { HostNode } from "@/components/licenses/assignment/HostNode";
import { LicenseNode } from "@/components/licenses/assignment/LicenseNode";
import globalLogger from "@/lib/logger"; // Renombrar para evitar conflicto
import apiClient from "@/lib/apiClient"; // Import apiClient to use the correct endpoint
import { getHostAssignedLicenseIds } from "./assignment-utils";

interface ReactFlowVisualizerProps {
  initialLicenses: License[];
  initialHosts: Host[];
  initialEnvironments: Environment[];
  onAssignmentChange: () => void;
  toast: ReturnType<typeof useGlobalToast>["toast"];
  logger: typeof globalLogger;
  storageService: typeof globalStorageService;
}

interface FilterState {
  showEnvironments: boolean;
  showInstances: boolean;
  showHosts: boolean;
  showLicenses: boolean;
  hostType: string;
  licenseEdition: string;
  licenseMetric: string;
  searchTerm: string;
}

function ReactFlowVisualizerInternal({
  initialLicenses,
  initialHosts,
  initialEnvironments,
  onAssignmentChange,
  toast,
  logger,
  storageService
}: ReactFlowVisualizerProps) {
  const [licenses, setLicenses] = useState<License[]>(initialLicenses);
  const [hosts, setHosts] = useState<Host[]>(initialHosts);
  const [environments, setEnvironments] = useState<Environment[]>(initialEnvironments);

  const [originalNodes, setOriginalNodes] = useState<Node[]>([]);
  const [nodes, setNodes, onNodesChangeInternal] = useNodesState([]);
  const [edges, setEdges, onEdgesChangeInternal] = useEdgesState([]);
  const { fitView } = useReactFlow();

  const [coreDialogOpen, setCoreDialogOpen] = useState(false);
  const [selectedHostId, setSelectedHostId] = useState<string>("");
  const [selectedLicenseId, setSelectedLicenseId] = useState<string>("");
  const [pendingConnection, setPendingConnection] = useState<Connection | null>(null);

  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<FilterState>({
    showEnvironments: true,
    showInstances: true,
    showHosts: true,
    showLicenses: true,
    hostType: 'all',
    licenseEdition: 'all',
    licenseMetric: 'all',
    searchTerm: ''
  });

  useEffect(() => {
    setLicenses(initialLicenses);
  }, [initialLicenses]);

  useEffect(() => {
    setHosts(initialHosts);
  }, [initialHosts]);

  useEffect(() => {
    setEnvironments(initialEnvironments);
  }, [initialEnvironments]);

  const nodeTypes = useMemo<NodeTypes>(
    () => ({
      environmentNode: EnvironmentNode,
      instanceNode: InstanceNode,
      hostNode: HostNode,
      licenseNode: LicenseNode,
    }),
    []
  );

  const generateNodes = useCallback((
    currentEnvironments: Environment[],
    currentHosts: Host[],
    currentLicenses: License[]
  ): Node[] => {
    const nodeWidth = 180;
    const nodeHeight = 120;
    const licenseNodeHeight = 150;
    const columnSpacing = 320;
    const verticalSpacing = 40;
    const startX = 50;
    const startY = 50;
    const flowNodes: Node[] = [];

    let envY = startY;
    currentEnvironments.forEach((env) => {
      flowNodes.push({
        id: `env-${env.id}`,
        type: "environmentNode",
        position: { x: startX, y: envY },
        data: { label: env.name, environment: env },
        draggable: false,
        selectable: false,
        style: { width: nodeWidth, height: nodeHeight },
        sourcePosition: Position.Right,
      });
      envY += nodeHeight + verticalSpacing;
    });

    let instY = startY;
    const allInstances: (Instance & { environmentId: string })[] = [];
    currentEnvironments.forEach((env) => {
      if (env.instances) {
        allInstances.push(...env.instances.map((inst) => ({ ...inst, environmentId: env.id })));
      }
    });

    allInstances.forEach((instance) => {
      const parentEnv = currentEnvironments.find((env) => env.id === instance.environmentId);
      flowNodes.push({
        id: `instance-${instance.id}`,
        type: "instanceNode",
        position: { x: startX + columnSpacing, y: instY },
        data: {
          label: instance.name,
          instance,
          environmentName: parentEnv?.name || "Unknown",
        },
        draggable: false,
        selectable: false,
        style: { width: nodeWidth, height: nodeHeight },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      });
      instY += nodeHeight + verticalSpacing;
    });

    let hostY = startY;
    currentHosts.forEach((host) => {
      flowNodes.push({
        id: `host-${host.id}`,
        type: "hostNode",
        position: { x: startX + columnSpacing * 2, y: hostY },
        data: { label: host.name, host },
        connectable: true,
        draggable: true,
        style: { width: nodeWidth, height: nodeHeight },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      });
      hostY += nodeHeight + verticalSpacing;
    });

    let licenseY = startY;
    currentLicenses.forEach((license) => {
      flowNodes.push({
        id: `license-${license.id}`,
        type: "licenseNode",
        position: { x: startX + columnSpacing * 3, y: licenseY },
        data: {
          label: `${license.product} (${license.metric})`,
          license,
        },
        connectable: true,
        selectable: true,
        draggable: true,
        style: { width: nodeWidth, height: licenseNodeHeight },
        targetPosition: Position.Left,
      });
      licenseY += licenseNodeHeight + verticalSpacing;
    });

    return flowNodes;
  }, []);

  const generateEdges = useCallback((
    currentEnvironments: Environment[],
    currentHosts: Host[],
    currentLicenses: License[]
  ): Edge[] => {
    const flowEdges: Edge[] = [];
    const allInstances: (Instance & { environmentId: string })[] = [];

    currentEnvironments.forEach((env) => {
      if (env.instances) {
        allInstances.push(...env.instances.map((inst) => ({ ...inst, environmentId: env.id })));
      }
    });

    const staticEdgeStyle = { stroke: "#b0b0b0", strokeWidth: 1.5 };
    const staticEdgeProps = {
      type: "default",
      animated: false,
      selectable: false,
      deletable: false,
      zIndex: 1,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 15,
        height: 15,
        color: "#b0b0b0",
      },
    };
    const interactiveEdgeStyle = { strokeWidth: 2, stroke: "#333" };
    const interactiveEdgeProps = {
      animated: true,
      deletable: true,
      type: "default",
      zIndex: 10,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 15,
        height: 15,
        color: "#333",
      },
    };

    currentEnvironments.forEach((env) => {
      env.instances?.forEach((instance) => {
        flowEdges.push({
          id: `edge-env-${env.id}-inst-${instance.id}`,
          source: `env-${env.id}`,
          target: `instance-${instance.id}`,
          sourceHandle: "env-out",
          targetHandle: "instance-in",
          style: staticEdgeStyle,
          ...staticEdgeProps,
        });
      });
    });

    allInstances.forEach((instance) => {
      if (instance.hostId) {
        const hostExists = currentHosts.some((host) => host.id === instance.hostId);
        if (hostExists) {
          flowEdges.push({
            id: `edge-inst-${instance.id}-host-${instance.hostId}`,
            source: `instance-${instance.id}`,
            target: `host-${instance.hostId}`,
            sourceHandle: "instance-out",
            targetHandle: "host-in",
            style: staticEdgeStyle,
            ...staticEdgeProps,
          });
        }
      }
    });

    currentHosts.forEach((host) => {
      getHostAssignedLicenseIds(host).forEach((licenseId) => {
        const licenseExists = currentLicenses.some((license) => license.id === licenseId);

        if (!licenseExists) {
          return;
        }

        flowEdges.push({
          id: `edge-host-${host.id}-license-${licenseId}`,
          source: `host-${host.id}`,
          target: `license-${licenseId}`,
          sourceHandle: "host-out",
          targetHandle: "license-in",
          style: interactiveEdgeStyle,
          ...interactiveEdgeProps,
        });
      });
    });

    return flowEdges;
  }, []);

  const regenerateGraph = useCallback(() => {
    const physicalHosts = hosts.filter((host) => host.serverType !== 'Virtual');
    const generatedNodes = generateNodes(environments, physicalHosts, licenses);
    const generatedEdges = generateEdges(environments, physicalHosts, licenses);

    setOriginalNodes(generatedNodes);
    applyFilters(generatedNodes);
    setEdges(generatedEdges);

    setTimeout(() => fitView({ padding: 0.2, includeHiddenNodes: false }), 100);
  }, [environments, hosts, licenses, generateNodes, generateEdges, setEdges, fitView]);

  useEffect(() => {
    regenerateGraph();
  }, [regenerateGraph]);


  const applyFilters = useCallback((nodesToFilter?: Node[]) => {
        const baseNodes = nodesToFilter || originalNodes;
        if (!baseNodes.length && !(nodesToFilter && nodesToFilter.length > 0) ) return;

        let filteredNodes = [...baseNodes];

        if (!filters.showEnvironments) {
            filteredNodes = filteredNodes.filter(node => !node.id.startsWith('env-'));
        }
        if (!filters.showInstances) {
            filteredNodes = filteredNodes.filter(node => !node.id.startsWith('instance-'));
        }
        if (!filters.showHosts) {
            filteredNodes = filteredNodes.filter(node => !node.id.startsWith('host-'));
        }
        if (!filters.showLicenses) {
            filteredNodes = filteredNodes.filter(node => !node.id.startsWith('license-'));
        }
        if (filters.hostType !== 'all') {
            filteredNodes = filteredNodes.filter(node => {
                if (!node.id.startsWith('host-')) return true;
                const hostId = node.id.replace('host-', '');
                const host = hosts.find(h => h.id === hostId); // Use 'hosts' from state
                return host && host.serverType === filters.hostType;
            });
        }
        if (filters.licenseEdition !== 'all') {
            filteredNodes = filteredNodes.filter(node => {
                if (!node.id.startsWith('license-')) return true;
                const licenseId = node.id.replace('license-', '');
                const license = licenses.find(l => l.id === licenseId); // Use 'licenses' from state
                return license && license.edition === filters.licenseEdition;
            });
        }
        if (filters.licenseMetric !== 'all') {
            filteredNodes = filteredNodes.filter(node => {
                if (!node.id.startsWith('license-')) return true;
                const licenseId = node.id.replace('license-', '');
                const license = licenses.find(l => l.id === licenseId); // Use 'licenses' from state
                return license && license.metric === filters.licenseMetric;
            });
        }
        if (filters.searchTerm.trim()) {
            const searchLower = filters.searchTerm.toLowerCase().trim();
            filteredNodes = filteredNodes.filter(node => {
                if (node.id.startsWith('env-')) {
                    return node.data.label.toLowerCase().includes(searchLower);
                }
                if (node.id.startsWith('instance-')) {
                     return node.data.label.toLowerCase().includes(searchLower) ||
                            (node.data.environmentName && node.data.environmentName.toLowerCase().includes(searchLower));
                }
                if (node.id.startsWith('host-')) {
                    const hostId = node.id.replace('host-', '');
                    const host = hosts.find(h => h.id === hostId); // Use 'hosts' from state
                    return host && (host.name.toLowerCase().includes(searchLower) ||
                                    (host.serverType && host.serverType.toLowerCase().includes(searchLower)));
                }
                if (node.id.startsWith('license-')) {
                    const licenseId = node.id.replace('license-', '');
                    const license = licenses.find(l => l.id === licenseId); // Use 'licenses' from state
                     return license && (license.product?.toLowerCase().includes(searchLower) ||
                                        (license.csi && license.csi.toLowerCase().includes(searchLower)) ||
                                        license.edition.toLowerCase().includes(searchLower));
                }
                return false;
            });
        }
        setNodes(filteredNodes);
        setTimeout(() => {
            fitView({ padding: 0.2, includeHiddenNodes: false });
        }, 50);
    }, [filters, originalNodes, hosts, licenses, setNodes, fitView]);


  useEffect(() => {
      applyFilters();
  }, [filters, originalNodes, applyFilters]);


  const resetFilters = () => {
    setFilters({
      showEnvironments: true,
      showInstances: true,
      showHosts: true,
      showLicenses: true,
      hostType: 'all',
      licenseEdition: 'all',
      licenseMetric: 'all',
      searchTerm: ''
    });
     applyFilters(originalNodes);
  };

  const isValidConnection = (connection: Connection): boolean => {
    const sourceIsHost = connection.source?.startsWith("host-");
    const targetIsLicense = connection.target?.startsWith("license-");
    const sourceHandleIsCorrect = connection.sourceHandle === "host-out";
    const targetHandleIsCorrect = connection.targetHandle === "license-in";
    return !!(
      sourceIsHost &&
      targetIsLicense &&
      sourceHandleIsCorrect &&
      targetHandleIsCorrect
    );
  };

  const onConnect: OnConnect = useCallback(
    async (params: Connection) => {
      if (!isValidConnection(params)) {
        toast({
          title: "Conexión Inválida",
          description: "Solo se pueden conectar Hosts (punto naranja) a Licencias (punto verde).",
          variant: "destructive",
        });
        return;
      }

      const sourceId = params.source!;
      const targetId = params.target!;
      const hostId = sourceId.replace("host-", "");
      const licenseId = targetId.replace("license-", "");

      const license = await storageService.getLicense(licenseId);
      const host = await storageService.getHost(hostId);

      if (!license || !host) {
        toast({
          title: "Error",
          description: "No se encontró la licencia o el host seleccionado.",
          variant: "destructive",
        });
        return;
      }

      const existingEdge = edges.find(
        (edge) => edge.source === sourceId && edge.target === targetId,
      );

      if (existingEdge) {
        toast({
          title: "Ya asignado",
          description: "Este host ya está asignado a esta licencia. Haz doble clic para editar.",
          variant: "default",
        });
        return;
      }

      setSelectedHostId(hostId);
      setSelectedLicenseId(licenseId);
      setPendingConnection(params);
      setCoreDialogOpen(true);
    },
    [edges, toast, storageService],
  );  const handleCoreSelectionConfirm = useCallback(async (
        selectedCoreIds: number[],
        coreMappings?: Record<number, number>
    ) => {
        // Obtener host y license de los IDs seleccionados
        const host = hosts.find(h => h.id === selectedHostId);
        const license = licenses.find(l => l.id === selectedLicenseId);
        
        if (!host || !license) return;

        setCoreDialogOpen(false);

        try {
            // Use the correct endpoint to assign licenses to cores
            await apiClient.post(
                `/licenses/${license.id}/assign-to-host/${host.id}`, 
                { 
                    selectedCoreIds: selectedCoreIds,
                    coreMappings: host.hasHardPartitioning ? coreMappings : undefined 
                }
            );
            
            toast({
                title: "Licencia asignada correctamente",
                description: `La licencia ${license.product} ha sido asignada a ${selectedCoreIds.length} cores del host ${host.name}`,
            });
            
            if (onAssignmentChange) {
                onAssignmentChange();
            }
        } catch (error) {
            logger.error("Error guardando asignación:", error);
            toast({
                title: "Error", 
                description: "Error al guardar la asignación de licencias", 
                variant: "destructive"
            });
        }
    }, [selectedHostId, selectedLicenseId, hosts, licenses, setCoreDialogOpen, toast, onAssignmentChange, logger]);  const handleEdgeRemove = useCallback(
    async (edgeToRemove: Edge) => {
      if (
        edgeToRemove.source.startsWith("host-") &&
        edgeToRemove.target.startsWith("license-")
      ) {
        const hostId = edgeToRemove.source.replace("host-", "");
        const licenseId = edgeToRemove.target.replace("license-", "");
        const license = await storageService.getLicense(licenseId);
        const host = await storageService.getHost(hostId);

        if (license && host) {
            try {
                // Call the proper endpoint with empty selectedCoreIds array to remove all assignments
                await apiClient.post(
                    `/licenses/${licenseId}/assign-to-host/${hostId}`, 
                    { 
                        selectedCoreIds: [], // Empty array means remove all assignments
                        coreMappings: host.hasHardPartitioning ? {} : undefined 
                    }
                );
                
                toast({
                    title: "Licencia desasignada",
                    description: `Host ${host.name} desasignado de la licencia ${license.product}.`,
                });
                
                onAssignmentChange();
                setEdges(eds => eds.filter(e => e.id !== edgeToRemove.id));
            } catch (error) {
                logger.error("Error removing assignment:", error);
                toast({ title: "Error", description: "No se pudo guardar la desasignación.", variant: "destructive" });
            }
        } else {
            logger.warn("Host or License not found for edge removal:", hostId, licenseId);
            setEdges(eds => eds.filter(e => e.id !== edgeToRemove.id));
        }
      } else {
           setEdges(eds => eds.filter(e => e.id !== edgeToRemove.id));
      }
    },
    [setEdges, toast, onAssignmentChange, storageService, logger],
  );

  const onEdgesChangeCustom: OnEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const edgesToRemove = changes.filter(
        (change): change is { type: 'remove', id: string } => change.type === "remove",
      );
      if (edgesToRemove.length > 0) {
        edgesToRemove.forEach((change) => {
          const edge = edges.find((e) => e.id === change.id);
          if (edge && edge.deletable) {
            handleEdgeRemove(edge);
          }
        });
      } else {
        onEdgesChangeInternal(changes);
      }
    },
    [edges, handleEdgeRemove, onEdgesChangeInternal],
  );

  const onEdgeDoubleClick = useCallback(
     async (_: React.MouseEvent, edge: Edge) => {
      if (
        edge.source.startsWith("host-") &&
        edge.target.startsWith("license-") &&
        edge.deletable
      ) {
        const hostId = edge.source.replace("host-", "");
        const licenseId = edge.target.replace("license-", "");

        const host = await storageService.getHost(hostId);
        const license = await storageService.getLicense(licenseId);

        if (host && license) {
            setSelectedHostId(hostId);
            setSelectedLicenseId(licenseId);
            setPendingConnection(null);
            setCoreDialogOpen(true);
        } else {
            toast({title: "Error", description: "No se encontró el host o la licencia para editar.", variant: "destructive"});
        }
      }
    },
    [toast, storageService],
  );

   const onNodesChange: OnNodesChange = useCallback(
       (changes: NodeChange[]) => {
           onNodesChangeInternal(changes);
       },
       [onNodesChangeInternal]
   );

  return (
    <div className="w-full h-full flex flex-col">
      <Card className="border-0 shadow-none flex-shrink-0 mb-4">
        <CardContent className="py-2">
           <div className="flex justify-between items-center">
             <p className="text-sm text-gray-600">
               Conecta <strong>Hosts</strong> (naranja) a <strong>Licencias</strong> (verde) arrastrando desde el punto
               naranja al punto verde. <span className="text-blue-600 font-semibold">Haz doble clic en una conexión existente
               para editar</span>. Para eliminar una conexión, selecciónala y presiona <strong>Supr/Del</strong>.
             </p>
             <div className="flex gap-2">
               <TooltipProvider>
                 <Tooltip>
                   <TooltipTrigger asChild>
                     <Button
                       variant={showFilters ? "default" : "outline"}
                       size="sm"
                       onClick={() => setShowFilters(!showFilters)}
                     >
                       <Filter className="h-4 w-4 mr-1" />
                       {showFilters ? "Ocultar Filtros" : "Mostrar Filtros"}
                     </Button>
                   </TooltipTrigger>
                   <TooltipContent>
                     <p>Mostrar/ocultar opciones de filtrado</p>
                   </TooltipContent>
                 </Tooltip>
               </TooltipProvider>
               <TooltipProvider>
                 <Tooltip>
                   <TooltipTrigger asChild>
                     <Button
                       variant="outline"
                       size="sm"
                       onClick={() => {
                         regenerateGraph();
                         resetFilters();
                         toast({
                           title: "Visualización actualizada",
                           description: "Se ha regenerado la visualización",
                         });
                       }}
                     >
                       <RefreshCw className="h-4 w-4 mr-1" />
                       Refrescar Vista
                     </Button>
                   </TooltipTrigger>
                   <TooltipContent>
                     <p>Regenerar la visualización con los datos actuales</p>
                   </TooltipContent>
                 </Tooltip>
               </TooltipProvider>
             </div>
           </div>
           {showFilters && (
            <div className="bg-neutral-50 border rounded-md p-3 mt-2">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-sm font-medium">Filtrar elementos</h3>
                <Button variant="ghost" size="sm" onClick={resetFilters} className="text-xs h-8 px-2">
                  Restablecer filtros
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-neutral-700">Mostrar tipos de elementos:</h4>
                   <div className="flex flex-wrap gap-3">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="show-environments-rf"
                        checked={filters.showEnvironments}
                        onCheckedChange={(checked) =>
                          setFilters(prev => ({ ...prev, showEnvironments: checked === true }))
                        }
                      />
                      <label htmlFor="show-environments-rf" className="text-sm flex items-center">
                        <Database className="h-3 w-3 mr-1 text-blue-600" />
                        Entornos
                      </label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                         id="show-instances-rf"
                        checked={filters.showInstances}
                        onCheckedChange={(checked) =>
                          setFilters(prev => ({ ...prev, showInstances: checked === true }))
                        }
                      />
                      <label htmlFor="show-instances-rf" className="text-sm flex items-center">
                        <Server className="h-3 w-3 mr-1 text-purple-600" />
                        Instancias
                      </label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                         id="show-hosts-rf"
                        checked={filters.showHosts}
                        onCheckedChange={(checked) =>
                          setFilters(prev => ({ ...prev, showHosts: checked === true }))
                        }
                      />
                      <label htmlFor="show-hosts-rf" className="text-sm flex items-center">
                        <Monitor className="h-3 w-3 mr-1 text-orange-600" />
                        Hosts
                      </label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="show-licenses-rf"
                        checked={filters.showLicenses}
                        onCheckedChange={(checked) =>
                          setFilters(prev => ({ ...prev, showLicenses: checked === true }))
                        }
                      />
                      <label htmlFor="show-licenses-rf" className="text-sm flex items-center">
                        <CreditCard className="h-3 w-3 mr-1 text-green-600" />
                        Licencias
                      </label>
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-neutral-700">Filtrar por término:</h4>
                  <Input
                    placeholder="Buscar por nombre..."
                    value={filters.searchTerm}
                    onChange={(e) => setFilters(prev => ({ ...prev, searchTerm: e.target.value }))}
                    className="h-8"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                 <div>
                  <h4 className="text-xs font-medium text-neutral-700 mb-1">Tipo de host:</h4>
                  <Select
                    value={filters.hostType}
                    onValueChange={(value) => setFilters(prev => ({ ...prev, hostType: value }))}
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue placeholder="Todos los tipos" />
                    </SelectTrigger>
                    <SelectContent>                      <SelectItem value="all">Todos los tipos</SelectItem>
                      <SelectItem value="Physical">Físicos</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                 <div>
                  <h4 className="text-xs font-medium text-neutral-700 mb-1">Edición de licencia:</h4>
                  <Select
                    value={filters.licenseEdition}
                    onValueChange={(value) => setFilters(prev => ({ ...prev, licenseEdition: value }))}
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue placeholder="Todas las ediciones" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas las ediciones</SelectItem>
                      <SelectItem value="Enterprise">Enterprise</SelectItem>
                      <SelectItem value="Standard">Standard</SelectItem>
                      <SelectItem value="Standard One">Standard One</SelectItem>
                      <SelectItem value="Standard 2">Standard 2</SelectItem>
                      <SelectItem value="Express">Express</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                 <div>
                  <h4 className="text-xs font-medium text-neutral-700 mb-1">Métrica de licencia:</h4>
                  <Select
                    value={filters.licenseMetric}
                    onValueChange={(value) => setFilters(prev => ({ ...prev, licenseMetric: value }))}
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue placeholder="Todas las métricas" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas las métricas</SelectItem>
                      <SelectItem value="Processor">Processor</SelectItem>
                      <SelectItem value="Named User Plus">Named User Plus</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex-grow border rounded overflow-hidden bg-white">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChangeCustom}
          onConnect={onConnect}
          onEdgeDoubleClick={onEdgeDoubleClick}
          nodeTypes={nodeTypes}
          minZoom={0.1}
          maxZoom={1.5}
          connectOnClick={false}
          fitView
          fitViewOptions={{ padding: 0.2, includeHiddenNodes: false }}
        >
          <Controls />
          <MiniMap nodeStrokeWidth={3} zoomable pannable />
          <Background color="#e9e9e9" gap={24} size={1.5} />
        </ReactFlow>
      </div>

      {coreDialogOpen && selectedHostId && selectedLicenseId && (
           <CoreSelectionDialog
             host={hosts.find(h => h.id === selectedHostId)!}
             license={licenses.find(l => l.id === selectedLicenseId)!}
             open={coreDialogOpen}
             onOpenChange={(open) => {
                 setCoreDialogOpen(open);
                 if (!open) setPendingConnection(null);
             }}
             onConfirm={handleCoreSelectionConfirm}
             isEditing={!pendingConnection}
           />
      )}
    </div>
  );
}

export function LicenseAssig_ViewFlow({ 
    initialLicenses, 
    initialHosts, 
    initialEnvironments, 
    onAssignmentChange,
    toast,
    logger,
    storageService
}: ReactFlowVisualizerProps) {
  return (
    <ReactFlowProvider>
      <ReactFlowVisualizerInternal
        initialLicenses={initialLicenses}
        initialHosts={initialHosts}
        initialEnvironments={initialEnvironments}
        onAssignmentChange={onAssignmentChange}
        toast={toast}
        logger={logger}
        storageService={storageService}
       />
    </ReactFlowProvider>
  );
}