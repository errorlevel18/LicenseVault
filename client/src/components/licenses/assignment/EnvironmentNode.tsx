import { memo } from "react";
import { Handle, Position, NodeProps } from "reactflow";
import { Environment } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Database } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface EnvironmentNodeData {
  label: string;
  environment: Environment;
}

export const EnvironmentNode = memo(
  ({ data }: NodeProps<EnvironmentNodeData>) => {
    const { label, environment } = data;
    const getEnvironmentBadge = (env: Environment) => {
      const type = env.primaryUse;
      if (type === "Production")
        return (
          <Badge variant="outline" className="bg-red-100 text-red-800">
            Producción
          </Badge>
        );
      if (type === "Development")
        return (
          <Badge variant="outline" className="bg-blue-100 text-blue-800">
            Desarrollo
          </Badge>
        );
      if (type === "Test")
        return (
          <Badge variant="outline" className="bg-yellow-100 text-yellow-800">
            Pruebas
          </Badge>
        );
      return <Badge variant="outline">QA</Badge>;
    };

    return (
      <Card className="border-l-4 border-l-blue-500 shadow-md react-flow__node-default !w-auto" style={{width: 'auto', minWidth: '180px'}}>
        <CardContent className="p-3">
          <div className="flex items-center mb-1">
            <Database className="h-4 w-4 mr-1.5 text-blue-500 flex-shrink-0" />
            <div className="font-medium text-sm">
              {label}
            </div>
          </div>
          <div className="mt-1.5 grid grid-cols-[55px_1fr] gap-y-1 text-xs">
            <span className="text-gray-500">Tipo:</span>
            <span className="text-right">{environment.type}</span>
            <span className="text-gray-500">Edición:</span>
            <span className="text-right">{environment.edition}</span>
            <span className="text-gray-500">Uso:</span>
            <div className="flex justify-end">{getEnvironmentBadge(environment)}</div>
          </div>
        </CardContent>
        <Handle
          type="source"
          position={Position.Right}
          id="env-out"
          style={{
            background: "#3b82f6",
            width: "8px",
            height: "8px",
          }}
        />
      </Card>
    );
  },
);
EnvironmentNode.displayName = "EnvironmentNode";
