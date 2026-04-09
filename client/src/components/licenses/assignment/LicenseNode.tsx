import { memo } from "react";
import { Handle, Position, NodeProps } from "reactflow";
import { License } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Key } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface LicenseNodeData {
  label: string;
  license: License;
}

export const LicenseNode = memo(
  ({ data, isConnectable }: NodeProps<LicenseNodeData>) => {
    const { label, license } = data;
    const getLicenseStatusBadge = (license: License) => {
      const status = license.status;
      if (status === "Expired")
        return <Badge variant="destructive">Expirada</Badge>;
      if (status === "Pending")
        return (
          <Badge variant="outline" className="bg-yellow-100 text-yellow-800">
            Pendiente
          </Badge>
        );
      return (
        <Badge variant="outline" className="bg-green-100 text-green-800">
          Activa
        </Badge>
      );
    };

    return (
      <Card className="border-l-4 border-l-green-500 shadow-md react-flow__node-default !w-auto" style={{width: 'auto', minWidth: '180px'}}>
        <CardContent className="p-3">
          <div className="flex items-center mb-1">
            <Key className="h-4 w-4 mr-1.5 text-green-500 flex-shrink-0" />
            <div className="font-medium text-sm">
              {label}
            </div>
          </div>
          <div className="mt-1.5 grid grid-cols-[70px_1fr] gap-y-1 text-xs">
            <span className="text-gray-500">Edición:</span>
            <span className="text-right">{license.edition}</span>
            <span className="text-gray-500">Métrica:</span>
            <span className="text-right">{license.metric}</span>
            <span className="text-gray-500">Cantidad:</span>
            <span className="text-right">{license.quantity}</span>
            <span className="text-gray-500">Estado:</span>
            <div className="flex justify-end">{getLicenseStatusBadge(license)}</div>
          </div>
          <Handle
            type="target"
            position={Position.Left}
            id="license-in"
            style={{
              background: "#4caf50",
              width: "10px",
              height: "10px",
              borderRadius: "3px",
            }}
            isConnectable={isConnectable}
          />
        </CardContent>
      </Card>
    );
  },
);
LicenseNode.displayName = "LicenseNode";
