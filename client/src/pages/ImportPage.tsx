import { Suspense, lazy, useEffect, useState } from 'react';
import { useSelectedCustomerId } from '@/hooks/use-selected-customer';
import { storageService } from '@/lib/storageService';
import apiClient from '@/lib/apiClient';
import { useToast } from '@/hooks/use-toast';
import { Host } from '@/lib/types';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  AlertTriangle,
  CheckCircle,
  Database,
  Download,
  FileArchive,
  Loader2,
  PlugZap,
  Server,
  XCircle,
} from 'lucide-react';

const OSImportPanel = lazy(() => import('@/components/import/OSImportPanel'));
const ReviewLitePanel = lazy(() => import('@/components/import/ReviewLitePanel'));

function ImportTabFallback({ label }: { label: string }) {
  return (
    <div className="flex min-h-[24rem] items-center justify-center rounded-lg border border-dashed text-muted-foreground">
      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
      <span>Cargando {label}...</span>
    </div>
  );
}

type ImportedFeature = {
  name: string;
  currentlyUsed: boolean;
  detectedUsages: number;
  firstUsageDate: string | null;
  lastUsageDate: string | null;
  description: string;
  version: string;
};

type ImportedInstance = {
  name: string;
  hostName: string;
  status: string;
  cpu?: {
    numCpus: string;
    numCores: string;
    numSockets: string;
    physicalMemory: string;
  };
};

type HighWaterMark = {
  cpuCount: string | null;
  cpuCoreCount: string | null;
  cpuSocketCount: string | null;
  sessionsHighwater: string | null;
  sessionsMax: string | null;
  userCount: string | null;
  dbSize: string | null;
  current: {
    cpuCount: string | null;
    cpuCoreCount: string | null;
    cpuSocketCount: string | null;
    sessionsHighwater: string | null;
    userCount: string | null;
  };
};

type OracleImportData = {
  database: {
    name: string;
    uniqueName: string;
    version: string;
    versionShort: string;
    banner: string;
    edition: string;
    platform: string;
    logMode: string;
    dbType: string;
    envType: string;
    isRAC: boolean;
    isDataGuard: boolean;
    databaseRole: string;
    isPDB?: boolean;
    containerName?: string;
  };
  localInstanceName?: string;
  localInstanceHost?: string;
  instances: ImportedInstance[];
  cpu: {
    numCpus: string;
    numCores: string;
    numSockets: string;
    physicalMemory: string;
  };
  highWaterMark: HighWaterMark | null;
  features: ImportedFeature[];
  pdbs: { conId: number; name: string; openMode: string; featureCount?: number; features?: { name: string; currentlyUsed: boolean }[]; currentSessions?: number; currentUsers?: number }[];
  dbOptions: { parameter: string; value: string }[];
};

export default function ImportPage() {
  const { toast } = useToast();

  // Connection form state
  const [hostname, setHostname] = useState('');
  const [port, setPort] = useState('1521');
  const [serviceName, setServiceName] = useState('');
  const [username, setUsername] = useState('system');
  const [password, setPassword] = useState('');
  const [useSID, setUseSID] = useState(false);

  // UI state
  const [isTesting, setIsTesting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [connectionMessage, setConnectionMessage] = useState('');
  const [connectionDiagnostic, setConnectionDiagnostic] = useState('');
  const [importData, setImportData] = useState<OracleImportData | null>(null);
  const [driverInfo, setDriverInfo] = useState<{ driverMode: string; message: string } | null>(null);
  const [pdbWarning, setPdbWarning] = useState<{ isPDB: boolean; containerName: string } | null>(null);
  const [showPdbConfirm, setShowPdbConfirm] = useState(false);

  // Host assignment state: map instance name -> host ID
  const [hostAssignments, setHostAssignments] = useState<Record<string, string>>({});
  const [availableHosts, setAvailableHosts] = useState<Host[]>([]);

  // Duplicate environment detection
  const [duplicateEnv, setDuplicateEnv] = useState<{ id: string; name: string; isRAC: boolean; existingInstances: string[] } | null>(null);

  // Primary use for imported environment
  const [primaryUseOptions, setPrimaryUseOptions] = useState<string[]>([]);
  const [selectedPrimaryUse, setSelectedPrimaryUse] = useState<string>('Production');

  const selectedCustomerId = useSelectedCustomerId();

  // Compute core mismatch errors for assigned hosts
  // Uses the HIGHER of current v$osstat and HWM values (Oracle audits use peak)
  function getCoreErrors(): Record<string, string> {
    if (!importData) return {};
    const errors: Record<string, string> = {};
    for (const inst of displayInstances) {
      const hostId = hostAssignments[inst.name];
      if (!hostId) continue;
      const host = availableHosts.find(h => h.id === hostId);
      if (!host) continue;
      const currentCores = parseInt((inst.cpu || importData.cpu).numCores) || 0;
      const hwmCores = parseInt(importData.highWaterMark?.cpuCoreCount || '0') || 0;
      const detectedCores = Math.max(currentCores, hwmCores);
      const hostCores = host.cores || 0;
      if (detectedCores > 0 && hostCores > 0 && hostCores < detectedCores) {
        const source = hwmCores > currentCores ? ' (from High Water Mark)' : '';
        errors[inst.name] = `Host "${host.name}" has ${hostCores} cores but Oracle reports ${detectedCores} cores${source}. The host must have at least as many cores as the peak value.`;
      }
    }
    return errors;
  }
  const coreErrors = importData ? getCoreErrors() : {};
  const hasCoreErrors = Object.keys(coreErrors).length > 0;

  // Fetch driver info and primary uses on mount
  useEffect(() => {
    apiClient.get('/import/driver-info').then(res => setDriverInfo(res.data)).catch(() => {});
    storageService.getPrimaryUses().then(uses => {
      setPrimaryUseOptions(uses);
      if (uses.length > 0) setSelectedPrimaryUse(uses[0]);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    storageService.getHosts().then(h => setAvailableHosts(h)).catch(() => setAvailableHosts([]));
    setHostAssignments({});
    setDuplicateEnv(null);
  }, [selectedCustomerId]);

  const connectionPayload = {
    hostname,
    port: parseInt(port, 10) || 1521,
    serviceName,
    username,
    password,
    useSID,
  };

  const canConnect = hostname && serviceName && username && password;

  async function refreshDuplicateEnvironmentState(nextImportData: OracleImportData) {
    if (!selectedCustomerId || !nextImportData.database) {
      setDuplicateEnv(null);
      return;
    }

    const environmentName = nextImportData.database.name || nextImportData.database.uniqueName || '';
    if (!environmentName) {
      setDuplicateEnv(null);
      return;
    }

    try {
      const response = await apiClient.post('/import/environment-conflict', {
        customerId: selectedCustomerId,
        environmentName,
        isRAC: nextImportData.database.isRAC === true,
      });

      setDuplicateEnv(response.data?.duplicateEnv ?? null);
    } catch (_) {
      setDuplicateEnv(null);
    }
  }

  async function handleTestConnection() {
    if (!canConnect) return;
    setIsTesting(true);
    setConnectionStatus('idle');
    setConnectionDiagnostic('');
    setPdbWarning(null);
    try {
      const res = await apiClient.post('/import/test-connection', connectionPayload, { timeout: 25000 });
      setConnectionStatus('success');
      setConnectionMessage(res.data.message);
      setConnectionDiagnostic('');
      // Detect PDB connection
      if (res.data.isPDB) {
        setPdbWarning({ isPDB: true, containerName: res.data.containerName || '' });
        setConnectionDiagnostic(
          `You are connected to PDB "${res.data.containerName || 'unknown'}", not the CDB root (CDB$ROOT). ` +
          `Feature usage data from a PDB may be incomplete — it only covers this specific pluggable database. ` +
          `For a complete compliance view, connect to the CDB root instead.`
        );
      }
      toast({ title: 'Connection successful', description: res.data.message });
    } catch (err: any) {
      setConnectionStatus('error');
      const msg = err.response?.data?.message || err.message || 'Connection failed';
      const diag = err.response?.data?.diagnostic || '';
      setConnectionMessage(msg);
      setConnectionDiagnostic(diag);
      toast({ title: 'Connection failed', description: msg, variant: 'destructive' });
    } finally {
      setIsTesting(false);
    }
  }

  async function handleImportData() {
    // If PDB detected and user hasn't confirmed yet, show dialog
    if (pdbWarning?.isPDB) {
      setShowPdbConfirm(true);
      return;
    }
    doImport();
  }

  function handlePdbConfirmContinue() {
    setShowPdbConfirm(false);
    doImport();
  }

  async function doImport() {
    if (!canConnect) return;
    setIsImporting(true);
    setImportData(null);
    setHostAssignments({});
    try {
      const res = await apiClient.post('/import/oracle-data', connectionPayload, { timeout: 60000 });
      setImportData(res.data);
      setConnectionStatus('success');
      if (res.data.database?.isPDB && !pdbWarning) {
        setPdbWarning({ isPDB: true, containerName: res.data.database.containerName || '' });
      }
      storageService.getHosts().then(h => setAvailableHosts(h)).catch(() => {});
      await refreshDuplicateEnvironmentState(res.data);

      toast({
        title: 'Data imported successfully',
        description: `${res.data.features?.length || 0} features retrieved from ${res.data.database?.name || 'Oracle'}`,
      });
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || 'Import failed';
      toast({ title: 'Import failed', description: msg, variant: 'destructive' });
    } finally {
      setIsImporting(false);
    }
  }

  async function handleSaveToEnvironment() {
    if (!importData || !selectedCustomerId) {
      toast({
        title: 'Error',
        description: !selectedCustomerId ? 'Please select a customer first' : 'No data to save',
        variant: 'destructive',
      });
      return;
    }

    // Validate all new instances have host assignments
    const newInsts = duplicateEnv
      ? displayInstances.filter(inst => !duplicateEnv.existingInstances.includes(inst.name))
      : displayInstances;
    const unassigned = newInsts.filter(inst => !hostAssignments[inst.name]);
    if (unassigned.length > 0) {
      toast({
        title: 'Host assignment required',
        description: `Please assign a host to all instances: ${unassigned.map(i => i.name).join(', ')}`,
        variant: 'destructive',
      });
      return;
    }

    // Validate core counts
    const errors = getCoreErrors();
    if (Object.keys(errors).length > 0) {
      toast({
        title: 'Host core mismatch',
        description: Object.values(errors)[0],
        variant: 'destructive',
      });
      return;
    }

    setIsSaving(true);
    try {
      const response = await apiClient.post('/import/save-environment', {
        customerId: selectedCustomerId,
        hostname,
        port: parseInt(port, 10) || 1521,
        serviceName,
        primaryUse: selectedPrimaryUse,
        hostAssignments,
        importData,
      });

      setDuplicateEnv(response.data?.duplicateEnv ?? null);

      if (response.data?.mode === 'merged') {
        toast({
          title: 'RAC instances added',
          description: `${response.data.addedInstanceCount || 0} instance(s) added to existing RAC environment "${response.data.environmentName}".`,
        });
      } else if (response.data?.mode === 'unchanged') {
        toast({
          title: 'Environment already up to date',
          description: `All imported instances already existed in "${response.data.environmentName}". Feature and PDB data were refreshed.`,
        });
      } else {
        toast({
          title: 'Environment created',
          description: `"${response.data.environmentName}" created with ${response.data.instanceCount || 0} instance(s) and ${response.data.featureCount || 0} features.`,
        });
      }

      storageService.getEnvironmentsByCustomer(selectedCustomerId).catch(() => {});
    } catch (err: any) {
      if (err.response?.data?.duplicateEnv) {
        setDuplicateEnv(err.response.data.duplicateEnv);
      }

      toast({
        title: 'Error saving data',
        description: err.response?.data?.error || err.message || 'Failed to save imported data',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  }

  const usedFeatures = importData?.features?.filter(f => f.currentlyUsed) || [];
  const unusedFeatures = importData?.features?.filter(f => !f.currentlyUsed) || [];

  // For RAC: only show the local instance (the one running on the host we connected to)
  // Remote instances should be imported from their own hosts
  const displayInstances = importData
    ? importData.database.isRAC && importData.localInstanceName
      ? importData.instances.filter(i => i.name === importData.localInstanceName)
      : importData.instances
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Import</h1>
        <p className="text-muted-foreground">
          Import data from Oracle databases or discover server hardware to create hosts and environments.
        </p>
      </div>

      <Tabs defaultValue="oracle" className="w-full">
        <TabsList className="grid w-full grid-cols-3 max-w-lg">
          <TabsTrigger value="oracle" className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            Oracle Database
          </TabsTrigger>
          <TabsTrigger value="os" className="flex items-center gap-2">
            <Server className="h-4 w-4" />
            Server (OS)
          </TabsTrigger>
          <TabsTrigger value="review-lite" className="flex items-center gap-2">
            <FileArchive className="h-4 w-4" />
            Review Lite
          </TabsTrigger>
        </TabsList>

        <TabsContent value="oracle" className="space-y-6 mt-4">

      {/* Connection Form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PlugZap className="h-5 w-5 text-orange-500" />
            Connection Details
          </CardTitle>
          <CardDescription>
            Enter the Oracle listener details and credentials. Automatically detects Oracle Instant Client for full version compatibility.
            If no Oracle Client is found, uses Thin mode (Oracle 12.1+ only).
            {driverInfo && (
              <span className={`ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                driverInfo.driverMode === 'thick' 
                  ? 'bg-green-100 text-green-800' 
                  : 'bg-amber-100 text-amber-800'
              }`}>
                {driverInfo.driverMode === 'thick' ? '✓ Thick mode — all versions' : '⚠ Thin mode — Oracle 12.1+ only'}
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="hostname">Hostname / IP</Label>
              <Input
                id="hostname"
                placeholder="192.168.1.100 or db-server.company.com"
                value={hostname}
                onChange={e => setHostname(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="port">Port</Label>
              <Input
                id="port"
                type="number"
                placeholder="1521"
                value={port}
                onChange={e => setPort(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="serviceName">{useSID ? 'SID' : 'Service Name'}</Label>
              <Input
                id="serviceName"
                placeholder={useSID ? 'ORCL' : 'ORCL or orcl.company.com'}
                value={serviceName}
                onChange={e => setServiceName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                placeholder="sys, system, or DBA user"
                value={username}
                onChange={e => setUsername(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-2 mt-3">
            <input
              type="checkbox"
              id="useSID"
              checked={useSID}
              onChange={e => setUseSID(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            <Label htmlFor="useSID" className="text-sm text-muted-foreground cursor-pointer">
              Use SID instead of Service Name (for older Oracle databases)
            </Label>
          </div>

          {/* Connection status */}
          {connectionStatus !== 'idle' && (
            <div className={`mt-4 p-3 rounded-md text-sm ${
              connectionStatus === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
            }`}>
              <div className="flex items-center gap-2">
                {connectionStatus === 'success' ? (
                  <CheckCircle className="h-4 w-4 flex-shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 flex-shrink-0" />
                )}
                <span className="break-all">{connectionMessage}</span>
              </div>
              {connectionDiagnostic && (
                <div className="mt-2 p-2 bg-amber-50 text-amber-800 rounded text-xs flex items-start gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                  <span>{connectionDiagnostic}</span>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-3 mt-4">
            <Button
              variant="outline"
              onClick={handleTestConnection}
              disabled={!canConnect || isTesting || isImporting}
            >
              {isTesting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlugZap className="h-4 w-4 mr-2" />}
              Test Connection
            </Button>
            <Button
              onClick={handleImportData}
              disabled={!canConnect || isImporting || isTesting}
            >
              {isImporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
              Import Data
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Import Results */}
      {importData && (
        <>
          {/* PDB Warning Banner */}
          {importData.database.isPDB && (
            <div className="p-4 bg-amber-50 border border-amber-300 rounded-lg flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <div className="font-semibold text-amber-800">Data imported from PDB: {importData.database.containerName || importData.database.name}</div>
                <p className="text-sm text-amber-700 mt-1">
                  This data was collected from a Pluggable Database, not the CDB root. Feature usage statistics 
                  may only reflect this PDB. For a complete compliance assessment, re-import from CDB$ROOT.
                </p>
              </div>
            </div>
          )}

          {/* Database Overview */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5 text-blue-500" />
                Database Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-xs text-muted-foreground">Database Name</div>
                  <div className="font-semibold">{importData.database.name}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Edition</div>
                  <div className="font-semibold">{importData.database.edition}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Version</div>
                  <div className="font-semibold">{importData.database.version}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Platform</div>
                  <div className="font-semibold">{importData.database.platform}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Type</div>
                  <Badge variant="outline">{importData.database.envType}</Badge>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">CDB / Non-CDB</div>
                  <Badge variant="outline">{importData.database.dbType}</Badge>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">DataGuard</div>
                  <Badge variant={importData.database.isDataGuard ? 'default' : 'outline'}>
                    {importData.database.isDataGuard ? `Yes (${importData.database.databaseRole})` : 'No'}
                  </Badge>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Log Mode</div>
                  <Badge variant="outline">{importData.database.logMode}</Badge>
                </div>
              </div>

              <Separator className="my-4" />

              {/* Instances detected */}
              <div>
                <div className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <Server className="h-4 w-4" />
                  Instances Detected ({displayInstances.length})
                  {importData.database.isRAC && <Badge variant="default" className="text-xs">RAC</Badge>}
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Instance Name</TableHead>
                      <TableHead>Reported Host</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayInstances.map(inst => {
                      return (
                        <TableRow key={inst.name}>
                          <TableCell className="font-medium">{inst.name}</TableCell>
                          <TableCell className="flex items-center gap-1">
                            <Server className="h-3 w-3 text-muted-foreground" />
                            {inst.hostName}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>



              {/* PDBs */}
              {importData.pdbs.length > 0 && (
                <>
                  <Separator className="my-4" />
                  <div>
                    <div className="text-sm font-semibold mb-2 flex items-center gap-2">
                      <Database className="h-4 w-4" />
                      Pluggable Databases ({importData.pdbs.length})
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>PDB Name</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-center">Active Features</TableHead>
                          <TableHead className="text-center">Current Sessions</TableHead>
                          <TableHead className="text-center">Distinct Users</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {importData.pdbs.map(pdb => (
                          <TableRow key={pdb.conId}>
                            <TableCell className="font-medium">{pdb.name}</TableCell>
                            <TableCell>
                              <Badge variant={pdb.openMode === 'READ WRITE' ? 'default' : 'outline'}>
                                {pdb.openMode}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-center">{pdb.featureCount ?? '—'}</TableCell>
                            <TableCell className="text-center">{pdb.currentSessions ?? '—'}</TableCell>
                            <TableCell className="text-center">{pdb.currentUsers ?? '—'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {importData.pdbs.some(p => p.featureCount && p.featureCount > 0) && (
                      <p className="text-xs text-muted-foreground mt-2">
                        Feature counts are from CDB_FEATURE_USAGE_STATISTICS per PDB. Session/user counts reflect current activity (for NUP sizing).
                      </p>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Host Assignment */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-5 w-5 text-purple-500" />
                Host Assignment
              </CardTitle>
              <CardDescription>
                Assign each Oracle instance to a host registered in LicenseVault.
                {importData.database.isRAC && ' Each RAC instance may run on a different host.'}
                {availableHosts.length === 0 && (
                  <span className="text-red-500 ml-1">No hosts found. Create hosts first in the Hosts page.</span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Instance</TableHead>
                    <TableHead>Reported Host</TableHead>
                    <TableHead>Assign to LicenseVault Host</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayInstances.map(inst => {
                    const isExistingInstance = duplicateEnv?.existingInstances.includes(inst.name);
                    return (
                    <TableRow key={inst.name} className={isExistingInstance ? 'bg-amber-50 opacity-60' : coreErrors[inst.name] ? 'bg-red-50' : ''}>
                      <TableCell className="font-medium">
                        {inst.name}
                        {isExistingInstance && (
                          <Badge variant="outline" className="ml-2 text-xs text-amber-700 border-amber-300">Already exists</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{inst.hostName}</TableCell>
                      <TableCell>
                        {isExistingInstance ? (
                          <span className="text-xs text-amber-700">Skipped — already registered in this environment</span>
                        ) : (
                        <div className="space-y-1">
                          <Select
                            value={hostAssignments[inst.name] || ''}
                            onValueChange={(val) => setHostAssignments(prev => ({ ...prev, [inst.name]: val }))}
                          >
                            <SelectTrigger className={`w-[280px] ${coreErrors[inst.name] ? 'border-red-500' : ''}`}>
                              <SelectValue placeholder="Select a host..." />
                            </SelectTrigger>
                            <SelectContent>
                              {availableHosts.map(h => (
                                <SelectItem key={h.id} value={h.id}>
                                  {h.name} ({h.serverType}{h.cores ? ` — ${h.cores} cores` : ''})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {coreErrors[inst.name] && (
                            <div className="text-xs text-red-600 flex items-center gap-1">
                              <XCircle className="h-3 w-3 flex-shrink-0" />
                              {coreErrors[inst.name]}
                            </div>
                          )}
                        </div>
                        )}
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Primary Use selector */}
          {!duplicateEnv && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Database className="h-4 w-4" />
                  Environment Settings
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4">
                  <Label htmlFor="importPrimaryUse" className="whitespace-nowrap">Primary Use</Label>
                  <Select value={selectedPrimaryUse} onValueChange={setSelectedPrimaryUse}>
                    <SelectTrigger id="importPrimaryUse" className="w-48">
                      <SelectValue placeholder="Select primary use" />
                    </SelectTrigger>
                    <SelectContent>
                      {primaryUseOptions.map(opt => (
                        <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Duplicate environment warning — only for non-RAC */}
          {duplicateEnv && !duplicateEnv.isRAC && (
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-start gap-2 text-amber-700">
                  <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">
                      Environment "{duplicateEnv.name}" already exists for this customer.
                    </p>
                    <p className="text-sm mt-1">
                      You cannot import it again. Rename or delete the existing environment first.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Save Button */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">Save to LicenseVault</h3>
                  <p className="text-sm text-muted-foreground">
                    Create the environment with {displayInstances.length} instance(s) and {importData.features.length} features.
                    {!selectedCustomerId && (
                      <span className="text-red-500 ml-1"> Please select a customer first.</span>
                    )}
                    {(() => {
                      const newInstances = duplicateEnv 
                        ? displayInstances.filter(i => !duplicateEnv.existingInstances.includes(i.name))
                        : displayInstances;
                      const unassigned = newInstances.filter(i => !hostAssignments[i.name]).length;
                      return unassigned > 0 ? (
                        <span className="text-amber-600 ml-1"> {unassigned} instance(s) still need a host assignment.</span>
                      ) : hasCoreErrors ? (
                        <span className="text-red-500 ml-1"> Fix host core mismatches before saving.</span>
                      ) : null;
                    })()}
                  </p>
                </div>
                <Button
                  size="lg"
                  onClick={handleSaveToEnvironment}
                  disabled={
                    isSaving || !selectedCustomerId || hasCoreErrors
                    || (!!duplicateEnv && !duplicateEnv.isRAC)
                    || (!!duplicateEnv && duplicateEnv.isRAC && displayInstances.every(i => duplicateEnv.existingInstances.includes(i.name)))
                    || (() => {
                      const newInsts = duplicateEnv
                        ? displayInstances.filter(i => !duplicateEnv.existingInstances.includes(i.name))
                        : displayInstances;
                      return newInsts.some(i => !hostAssignments[i.name]);
                    })()
                  }
                >
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  {duplicateEnv?.isRAC ? 'Add Instances' : 'Create Environment'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* PDB Confirmation Dialog */}
      <AlertDialog open={showPdbConfirm} onOpenChange={setShowPdbConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Connected to a Pluggable Database (PDB)
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                You are connected to <strong>{pdbWarning?.containerName || 'a PDB'}</strong>, 
                not the CDB root (CDB$ROOT).
              </p>
              <p>
                Importing from a PDB has limitations:
              </p>
              <ul className="list-disc pl-5 space-y-1 text-sm">
                <li><strong>Feature usage data</strong> will only reflect this specific PDB, not the entire database.</li>
                <li><strong>DBA_HIGH_WATER_MARK_STATISTICS</strong> may show PDB-level values, not the full server peak.</li>
                <li><strong>CPU/core information</strong> from v$osstat is server-wide and will be correct.</li>
                <li>For a <strong>complete compliance assessment</strong>, Oracle recommends connecting to CDB$ROOT.</li>
              </ul>
              <p className="text-sm font-medium text-amber-700">
                Do you want to continue importing from this PDB anyway?
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel — Connect to CDB instead</AlertDialogCancel>
            <AlertDialogAction onClick={handlePdbConfirmContinue} className="bg-amber-600 hover:bg-amber-700">
              Continue with PDB
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

        </TabsContent>

        <TabsContent value="os" className="mt-4">
          <Suspense fallback={<ImportTabFallback label="el importador de servidores" />}>
            <OSImportPanel />
          </Suspense>
        </TabsContent>

        <TabsContent value="review-lite" className="mt-4">
          <Suspense fallback={<ImportTabFallback label="Review Lite" />}>
            <ReviewLitePanel />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}
