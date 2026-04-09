import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Environment, Host, Instance, License } from '@/lib/types';
import { Card, CardContent } from '@/components/ui/card';
import { Database, Server, HardDrive, Key } from 'lucide-react';

// Temporary node components for development

interface EnvironmentNodeData {
  label: string;
  environment: Environment;
}

export const EnvironmentNode = memo(({
  data
}: NodeProps<EnvironmentNodeData>) => {
  const { label } = data;

  return (
    <Card className="border-l-4 border-l-blue-500">
      <CardContent className="p-3">
        <div className="flex items-center">
          <Database className="h-4 w-4 mr-2 text-blue-500" />
          <div className="font-medium">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
});

interface InstanceNodeData {
  label: string;
  instance: Instance;
  environmentName: string;
}

export const InstanceNode = memo(({
  data
}: NodeProps<InstanceNodeData>) => {
  const { label } = data;

  return (
    <Card className="border-l-4 border-l-purple-500">
      <CardContent className="p-3">
        <div className="flex items-center">
          <Server className="h-4 w-4 mr-2 text-purple-500" />
          <div className="font-medium">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
});

interface HostNodeData {
  label: string;
  host: Host;
}

export const HostNode = memo(({
  data
}: NodeProps<HostNodeData>) => {
  const { label } = data;

  return (
    <Card className="border-l-4 border-l-orange-500">
      <CardContent className="p-3">
        <div className="flex items-center">
          <HardDrive className="h-4 w-4 mr-2 text-orange-500" />
          <div className="font-medium">{label}</div>
        </div>
      </CardContent>
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        style={{ background: '#ff9800', width: '8px', height: '8px' }}
      />
    </Card>
  );
});

interface LicenseNodeData {
  label: string;
  license: License;
}

export const LicenseNode = memo(({
  data
}: NodeProps<LicenseNodeData>) => {
  const { label, license } = data;

  return (
    <Card className="border-l-4 border-l-green-500">
      <CardContent className="p-3">
        <div className="flex items-center mb-1">
          <Key className="h-4 w-4 mr-2 text-green-500" />
          <div className="font-medium">{label}</div>
        </div>
        <div className="text-xs text-gray-500 pl-6">
          <div>Edición: {license.edition}</div>
          <div>Métrica: {license.metric}</div>
          <div>Cantidad: {license.quantity}</div>
        </div>
      </CardContent>
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        style={{ background: '#4caf50', width: '8px', height: '8px' }}
      />
    </Card>
  );
});