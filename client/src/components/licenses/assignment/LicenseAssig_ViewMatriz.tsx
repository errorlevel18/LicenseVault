import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { License, Host } from "@/lib/types";
import { Check } from "lucide-react";

interface ViewMatrizProps {
  filteredLicenses: License[];
  filteredHosts: Host[];
  isLicenseAssignedToHost: (licenseId: string, hostId: string) => boolean;
  countAssignedCores: (licenseId: string, hostId: string) => number;
  setSelectedLicense: (license: License | null) => void;
  handleLicenseAssign: (host: Host) => void;
  licenses: License[]; // Para getLicenseStatusBadge
}

export function LicenseAssig_ViewMatriz({
  filteredLicenses,
  filteredHosts,
  isLicenseAssignedToHost,
  countAssignedCores,
  setSelectedLicense,
  handleLicenseAssign,
  licenses, // Recibimos licenses
}: ViewMatrizProps) {

  // Renderizar el estado de la licencia
  const getLicenseStatusBadge = (license: License) => {
    const now = new Date();
    const endDate = license.endDate ? new Date(license.endDate) : null;
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(now.getDate() + 30);

    if (!endDate) {
        return <Badge variant="outline">Perpetua?</Badge>;
    }
    if (endDate < now) {
      return <Badge variant="destructive">Caducada</Badge>;
    } else if (endDate <= thirtyDaysFromNow) {
      return <Badge variant="outline" className="bg-yellow-100 text-yellow-800">Por caducar</Badge>;
    } else {
      return <Badge variant="outline" className="bg-green-100 text-green-800">Activa</Badge>;
    }
  };

  // Renderizar el badge para la asignación de cores
  const getAssignmentBadge = (license: License, coreCount: number) => {
    if (license.metric === "Named User Plus") {
      return (
        <Badge variant="outline">
          <Check className="h-3 w-3 mr-1" />
          {coreCount} cores
        </Badge>
      );
    } else { // Assuming Processor
      return (
        <Badge variant="outline" className="bg-green-50">
          <Check className="h-3 w-3 mr-1" />
          {coreCount} cores
        </Badge>
      );
    }
  };
  
  return (
    <div className="flex flex-col">
      <div className="overflow-x-auto">
        <Table className="border-collapse relative">
          <TableHeader>
            <TableRow>
              <TableHead className="bg-gray-100 sticky left-0 min-w-[200px] z-10">
                Hosts / Licencias
              </TableHead>
              {filteredLicenses.map(license => (
                <TableHead 
                  key={license.id} 
                  className="min-w-[200px] max-w-[300px] text-center bg-gray-50 h-auto p-0"
                >
                  <div className="flex flex-col items-stretch p-3 h-full">
                    <div className="overflow-hidden">
                      <div className="font-medium text-sm overflow-wrap-anywhere hyphens-auto mb-1.5">
                        {license.product}
                      </div>
                      <div className="text-xs text-gray-600 overflow-wrap-anywhere hyphens-auto mb-1">
                        {license.metric}
                      </div>
                      <div className="text-xs text-blue-600 overflow-wrap-anywhere hyphens-auto mb-1">
                        {license.edition}
                      </div>
                      {license.csi && (
                        <div className="text-xs text-purple-600 overflow-wrap-anywhere hyphens-auto mb-1.5">
                          CSI: {license.csi}
                        </div>
                      )}
                    </div>
                    <div className="mt-auto">
                      {getLicenseStatusBadge(license)}
                    </div>
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredHosts.map(host => (
              <TableRow key={host.id}>
                <TableCell className="bg-gray-50 sticky left-0 font-medium z-10">
                  <div className="flex flex-col">
                    <span>{host.name}</span>
                    <span className="text-xs text-gray-500">
                      {host.serverType} ({host.cores} cores)
                    </span>
                  </div>
                </TableCell>
                {filteredLicenses.map(license => (
                  <TableCell key={`${host.id}-${license.id}`} className="text-center">
                    <div className="flex flex-col items-center gap-1">
                      {isLicenseAssignedToHost(license.id, host.id) ? (
                        <>
                          {getAssignmentBadge(license, countAssignedCores(license.id, host.id))}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs h-6"
                            onClick={() => {
                              setSelectedLicense(license);
                              handleLicenseAssign(host);
                            }}
                          >
                            Editar
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedLicense(license);
                            handleLicenseAssign(host);
                          }}
                        >
                          Asignar
                        </Button>
                      )}
                    </div>
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}