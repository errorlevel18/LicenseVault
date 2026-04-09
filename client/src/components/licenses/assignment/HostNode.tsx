import { memo } from "react";
import { Handle, Position, NodeProps } from "reactflow";
import { Host } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { HardDrive } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface HostNodeData {
  label: string;
  host: Host;
}

export const HostNode = memo(
  ({ data, isConnectable }: NodeProps<HostNodeData>) => {
    const { label, host } = data;
    // Convertir el nombre del host a minúsculas
    const lowerCaseLabel = typeof label === 'string' ? label.toLowerCase() : label;
    
    const getServerTypeBadge = (serverType: string) => {
      if (serverType === "Physical")
        return (
          <Badge variant="outline" className="bg-green-100 text-green-800">
            Físico
          </Badge>
        );
      if (serverType === "Virtual")
        return (
          <Badge variant="outline" className="bg-blue-100 text-blue-800">
            Virtual
          </Badge>
        );
      if (serverType === "Cloud")
        return (
          <Badge variant="outline" className="bg-purple-100 text-purple-800">
            Cloud
          </Badge>
        );
      return <Badge variant="outline">{serverType || "N/D"}</Badge>;
    };

    return (
      <Card className="border-l-4 border-l-orange-500 shadow-md react-flow__node-default !w-auto" style={{width: 'auto', minWidth: '180px'}}>
        <CardContent className="p-3">
          <div className="flex items-center mb-1">
            <HardDrive className="h-4 w-4 mr-1.5 text-orange-500 flex-shrink-0" />
            <div className="font-medium text-sm">
              {lowerCaseLabel}
            </div>
          </div>
          <div className="mt-1.5 grid grid-cols-[55px_1fr] gap-y-1 text-xs">
            <span className="text-gray-500">Tipo:</span>
            <div className="flex justify-end">{getServerTypeBadge(host.serverType)}</div>
            <span className="text-gray-500">Cores:</span>
            <span className="text-right">
              {host.cores} (x{host.coreFactor})
            </span>
            <span className="text-gray-500">Sockets:</span>
            <span className="text-right">{host.sockets}</span>
          </div>
          <Handle
            type="target"
            position={Position.Left}
            id="host-in"
            style={{
              background: "#ff9800",
              width: "8px",
              height: "8px",
            }}
            isConnectable={isConnectable}
          />
          <Handle
            type="source"
            position={Position.Right}
            id="host-out"
            style={{
              background: "#ff9800",
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
HostNode.displayName = "HostNode";
