import { memo } from "react";
import { Handle, Position, NodeProps } from "reactflow";
import { Instance } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Server } from "lucide-react";

interface InstanceNodeData {
  label: string;
  instance: Instance;
  environmentName: string;
  hostName?: string; // Nombre del host asociado
}

export const InstanceNode = memo(({ data }: NodeProps<InstanceNodeData>) => {
  const { label, instance } = data;
  return (
    <Card className="border-l-4 border-l-purple-500 shadow-md react-flow__node-default !w-auto" style={{width: 'auto', minWidth: '180px'}}>
      <CardContent className="p-3">
        <div className="flex items-center">
          <Server className="h-4 w-4 mr-1.5 text-purple-500 flex-shrink-0" />
          <div className="font-medium text-sm">
            {label}
          </div>
        </div>
      </CardContent>
      <Handle
        type="target"
        position={Position.Left}
        id="instance-in"
        style={{
          background: "#a855f7",
          width: "8px",
          height: "8px",
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="instance-out"
        style={{
          background: "#a855f7",
          width: "8px",
          height: "8px",
        }}
      />
    </Card>
  );
});
InstanceNode.displayName = "InstanceNode";
