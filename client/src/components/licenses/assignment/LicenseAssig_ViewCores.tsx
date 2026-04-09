import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ComboboxMulti } from "@/components/ui/combobox-multi";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { License, Host, CoreLicenseAssignment, Environment, Instance } from "@/lib/types";
import { Cpu, Microchip, Server, Info, XCircle, Database } from "lucide-react";
import { getHostCoreLicenseMap } from "./assignment-utils";

interface ViewCoresProps {
  hosts: Host[];
  licenses: License[];
  environments: Environment[];
  selectedHostIds: string[];
  setSelectedHostIds: (ids: string[]) => void;
  MAX_SELECTED_HOSTS: number;
}

export function LicenseAssig_ViewCores({
  hosts,
  licenses,
  environments,
  selectedHostIds,
  setSelectedHostIds,
  MAX_SELECTED_HOSTS,
}: ViewCoresProps) {

  const currentHosts = useMemo(() => {
    return selectedHostIds.map(id => hosts.find(host => host.id === id)).filter(Boolean) as Host[];
  }, [hosts, selectedHostIds]);

  const licenseColorMap = useMemo(() => {
    const colors = [
      "bg-blue-500", "bg-green-500", "bg-amber-500", "bg-purple-500",
      "bg-pink-500", "bg-indigo-500", "bg-red-500", "bg-teal-500",
      "bg-cyan-500", "bg-orange-500", "bg-lime-500", "bg-emerald-500",
      "bg-sky-500", "bg-violet-500", "bg-fuchsia-500", "bg-rose-500"
    ];
    const colorMap: Record<string, string> = {};
    licenses.forEach((license, index) => {
      colorMap[license.id] = colors[index % colors.length];
    });
    return colorMap;
  }, [licenses]);

  const getLicenseById = (licenseId: string): License | undefined => {
    return licenses.find(license => license.id === licenseId);
  };

  const socketCores = useMemo(() => {
    return currentHosts.map(currentHost => {
      if (!currentHost || !currentHost.cores || currentHost.cores <= 0) return [];
      const socketsCount = currentHost.sockets || 1;
      const coresPerSocket = Math.max(1, Math.ceil(currentHost.cores / socketsCount));
      const coreLicenseMap = getHostCoreLicenseMap(currentHost);
      const socketsData = [];
      for (let s = 0; s < socketsCount; s++) {
        const socketCoresData = [];
        for (let c = 0; c < coresPerSocket; c++) {
          const coreIndex = s * coresPerSocket + c;
          if (coreIndex < currentHost.cores) {
            const coreId = coreIndex + 1;
            const assignedLicenseIds = coreLicenseMap[coreId];
            const coreAssignment = assignedLicenseIds
              ? { coreId, licenses: assignedLicenseIds }
              : undefined;
            socketCoresData.push({
              coreId: coreId,
              socketId: s + 1,
              assignments: coreAssignment
            });
          }
        }
        if (socketCoresData.length > 0) {
          socketsData.push(socketCoresData);
        }
      }
      return socketsData;
    });
  }, [currentHosts]);

  const hostInstances = useMemo(() => {
    return currentHosts.map(currentHost => {
      if (!currentHost) return [];
      const instancesOnHost: Instance[] = [];
      environments.forEach((env: Environment) => {
        if (env.instances) {
          const matchingInstances = env.instances.filter(instance => instance.hostId === currentHost.id);
          instancesOnHost.push(...matchingInstances);
        }
      });
      return instancesOnHost;
    });
  }, [currentHosts, environments]);

  const renderCore = (core: { coreId: number, assignments?: CoreLicenseAssignment }, hostIndex: number = 0) => {
    const hasLicenses = core.assignments && core.assignments.licenses && core.assignments.licenses.length > 0;
    const licenseCount = hasLicenses ? core.assignments!.licenses.length : 0;

    return (
      <TooltipProvider key={`${currentHosts[hostIndex]?.id}-${core.coreId}`} delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={`relative w-16 h-16 m-1 rounded-md flex flex-col items-center justify-center border ${
                hasLicenses ? "border-gray-300" : "border-gray-200 bg-gray-100"
              } transition-all hover:shadow-md`}
            >
              {hasLicenses ? (
                <>
                  {licenseCount === 1 ? (
                    <div
                      className={`absolute inset-0 rounded-md opacity-70 ${licenseColorMap[core.assignments!.licenses[0]]}`}
                    ></div>
                  ) : (
                    <div className="absolute inset-0 rounded-md overflow-hidden">
                      {core.assignments!.licenses.map((licenseId, index, arr) => (
                        <div
                          key={licenseId}
                          className={`absolute h-full ${licenseColorMap[licenseId]} opacity-70`}
                          style={{
                            width: `${100 / arr.length}%`,
                            left: `${(100 / arr.length) * index}%`
                          }}
                        ></div>
                      ))}
                    </div>
                  )}
                  <Microchip className="h-8 w-8 text-white drop-shadow-md z-10" />
                  <span className="text-xs font-medium text-white drop-shadow-md z-10">{core.coreId}</span>
                </>
              ) : (
                <>
                  <Microchip className="h-8 w-8 text-gray-400" />
                  <span className="text-xs font-medium text-gray-500">{core.coreId}</span>
                </>
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="w-64 p-0">
            <div className="p-3">
              <h4 className="font-semibold">Core {core.coreId}</h4>
              <p className="text-sm text-gray-500 mb-2">
                Host: {currentHosts[hostIndex]?.name} {currentHosts[hostIndex]?.serverType === 'Virtual' ? '(Virtual)' : '(Physical)'}
              </p>
              {hostInstances[hostIndex] && hostInstances[hostIndex].length > 0 ? (
                <div className="mb-2">
                  <p className="text-xs font-medium">Instancias en este host:</p>
                  <div className="mt-1 space-y-1">
                    {hostInstances[hostIndex].map(instance => {
                      const instanceEnv = environments.find(env =>
                        env.instances && env.instances.some(i => i.id === instance.id)
                      );
                      return (
                        <div key={instance.id} className="flex items-center">
                          <Database className="h-3 w-3 mr-1 text-purple-500" />
                          <span className="text-xs">{instance.name} {instanceEnv && `(${instanceEnv.name})`}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex items-center text-gray-500 mb-2">
                  <XCircle className="h-3 w-3 mr-1" />
                  <span className="text-xs">Sin instancias asignadas</span>
                </div>
              )}
              {hasLicenses ? (
                <>
                  <p className="text-xs font-medium">Licencias asignadas:</p>
                  <div className="mt-1 space-y-1">
                    {core.assignments!.licenses.map(licenseId => {
                      const license = getLicenseById(licenseId);
                      return (
                        <div key={licenseId} className="flex items-center">
                          <div className={`w-3 h-3 rounded-full ${licenseColorMap[licenseId]} mr-2`}></div>
                          <span className="text-xs">{license?.product} {license?.edition} ({license?.metric})</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="flex items-center text-gray-500">
                  <XCircle className="h-4 w-4 mr-2 text-gray-400" />
                  <span className="text-sm">Sin licencias asignadas</span>
                </div>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  const renderSocket = (socketCoresData: { coreId: number, assignments?: CoreLicenseAssignment }[], socketId: number, hostIndex: number = 0) => {
    return (
      <div key={`${socketId}-${hostIndex}`} className="mb-6">
        <div className="flex items-center mb-2">
          <Cpu className="mr-2 h-5 w-5 text-gray-700" />
          <h3 className="text-sm font-medium">Socket {socketId}</h3>
        </div>
        <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
          <div className="flex flex-wrap justify-center">
            {socketCoresData.map(core => renderCore(core, hostIndex))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center mb-4">
        <h3 className="text-lg font-medium">Visualización de Cores</h3>
      </div>

      <div className="w-full sm:w-64">
        <ComboboxMulti
          options={hosts
            .filter(host => host.serverType !== 'Virtual') // Solo mostrar hosts físicos
            .map(host => ({
              label: `${host.name} (${host.cores} cores)`,
              value: host.id
            }))}
          selectedValues={selectedHostIds}
          onSelectionChange={(values) => {
            if (values.length <= MAX_SELECTED_HOSTS) {
              setSelectedHostIds(values);
            }
          }}
          placeholder="Seleccionar hosts físicos"
          emptyText="No se encontraron hosts físicos"
        />
        {selectedHostIds.length === MAX_SELECTED_HOSTS && (
          <p className="text-xs text-amber-600 mt-1">
            Has alcanzado el límite máximo de {MAX_SELECTED_HOSTS} hosts seleccionados.
          </p>
        )}
      </div>

      <div className={`grid ${currentHosts.length > 1 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'} gap-4`}>
        {currentHosts.map((currentHost, hostMapIndex) => (
          <Card key={currentHost.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-xl flex items-center">
                    <Server className="mr-2 h-6 w-6 text-blue-600" />
                    {currentHost.name}
                  </CardTitle>
                  <CardDescription>
                    {currentHost.cpuModel} • {currentHost.cores} Cores • {currentHost.sockets} Sockets • {currentHost.serverType}
                  </CardDescription>
                </div>
                <Badge variant={currentHost.serverType === 'Physical' ? "default" : "outline"}>
                  {currentHost.serverType}
                </Badge>
              </div>
            </CardHeader>
            <Separator />
            <CardContent className="pt-6">
              <div className="space-y-4">
                {socketCores[hostMapIndex] && socketCores[hostMapIndex].map((coresInSocket, socketIndex) => (
                  renderSocket(coresInSocket, socketIndex + 1, hostMapIndex)
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-6 bg-blue-50 rounded-lg p-4 border border-blue-100">
        <h3 className="flex items-center text-sm font-medium text-blue-800 mb-2">
          <Info className="mr-2 h-5 w-5" />
          Referencia de Colores de Licencias
        </h3>
        <div className="flex flex-wrap gap-2">
          {licenses.map(license => (
            <div
              key={license.id}
              className="flex items-center bg-white rounded-md px-2 py-1 border border-gray-200"
            >
              <div className={`w-3 h-3 rounded-full ${licenseColorMap[license.id]} mr-2`}></div>
              <span className="text-xs">{license.product} {license.edition} {license.csi && `- CSI: ${license.csi}`}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}