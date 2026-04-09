import { useState, useEffect } from 'react';
import { useSelectedCustomerId } from '@/hooks/use-selected-customer';
import { storageService } from '@/lib/storageService';
import apiClient from '@/lib/apiClient';
import { useToast } from '@/hooks/use-toast';
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
  AlertTriangle,
  CheckCircle,
  Cpu,
  Database,
  Download,
  HardDrive,
  KeyRound,
  Loader2,
  Monitor,
  PlugZap,
  Server,
  Upload,
  XCircle,
} from 'lucide-react';

type OracleHome = {
  path: string;
  version: string;
  instances: string[];
};

type DetectedInstance = {
  name: string;
  oracleHome: string;
  version: string;
  defaultPort: number;
  defaultServiceName: string;
  detectedHost: string;
};

type KvmCpuMapping = {
  vmName: string;
  vcpus: number;
  pinnedCpus: string;
  numaNode: string;
};

type OSDiscoveryData = {
  hostname: string;
  osType: 'Linux' | 'Windows' | 'SunOS' | 'HP-UX' | 'KVM-Host' | 'VMware-Host';
  cpuModel: string;
  sockets: number;
  cores: number;
  coresPerSocket: number;
  threadsPerCore: number;
  serverType: 'Physical' | 'Virtual' | 'Oracle Cloud';
  virtualizationType: string;
  hasHardPartitioning: boolean;
  oracleHomes: OracleHome[];
  oracleInstances: DetectedInstance[];
  kvmCpuMappings?: KvmCpuMapping[];
};

type InstanceConnectionState = {
  hostname: string;
  port: string;
  serviceName: string;
  username: string;
  password: string;
  useSID: boolean;
  status: 'idle' | 'connecting' | 'connected' | 'error';
  message: string;
  importedData: any | null; // Oracle import data
};

type CoreFactorEntry = {
  cpuModel: string;
  coreFactor: number;
};

type DuplicateEnvironmentState = {
  id: string;
  name: string;
  isRAC: boolean;
  existingInstances: string[];
};

export default function OSImportPanel() {
  const { toast } = useToast();

  // Connection form state
  const [hostname, setHostname] = useState('');
  const [sshPort, setSshPort] = useState('22');
  const [winrmPort, setWinrmPort] = useState('5985');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authMethod, setAuthMethod] = useState<'password' | 'privateKey'>('password');
  const [privateKey, setPrivateKey] = useState('');
  const [privateKeyName, setPrivateKeyName] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [osType, setOsType] = useState<'linux' | 'windows' | 'sunos' | 'hp-ux' | 'kvm-host' | 'vmware-host'>('linux');
  const [useHttps, setUseHttps] = useState(false);

  // Per-instance Oracle connection state
  const [instanceConnections, setInstanceConnections] = useState<Record<string, InstanceConnectionState>>({});

  // UI state
  const [isTesting, setIsTesting] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [connectionMessage, setConnectionMessage] = useState('');
  const [connectionDiagnostic, setConnectionDiagnostic] = useState('');
  const [discoveryData, setDiscoveryData] = useState<OSDiscoveryData | null>(null);

  // Override state — user can adjust detected values before saving
  const [hostName, setHostName] = useState('');
  const [serverType, setServerType] = useState<'Physical' | 'Virtual' | 'Oracle Cloud'>('Physical');
  const [virtType, setVirtType] = useState('');
  const [cpuModelOverride, setCpuModelOverride] = useState('');
  const [coresOverride, setCoresOverride] = useState('');
  const [socketsOverride, setSocketsOverride] = useState('');
  const [threadsOverride, setThreadsOverride] = useState('');

  // Physical host (for virtual servers)
  const [physicalHostId, setPhysicalHostId] = useState<string>('');
  const [existingPhysicalHosts, setExistingPhysicalHosts] = useState<Array<{ id: string; name: string }>>([]);

  // Reference data
  const [coreFactors, setCoreFactors] = useState<CoreFactorEntry[]>([]);
  const [virtTypes, setVirtTypes] = useState<string[]>([]);
  const [matchedCoreFactor, setMatchedCoreFactor] = useState<number | null>(null);
  const [primaryUseOptions, setPrimaryUseOptions] = useState<string[]>([]);
  const [selectedPrimaryUse, setSelectedPrimaryUse] = useState<string>('Production');

  // Duplicate detection
  const [duplicateHost, setDuplicateHost] = useState<{ id: string; name: string } | null>(null);
  const [duplicateEnvs, setDuplicateEnvs] = useState<Record<string, DuplicateEnvironmentState>>({});

  const selectedCustomerId = useSelectedCustomerId();

  // Load reference data on mount
  useEffect(() => {
    apiClient.get('/reference/coreFactors').then(res => {
      setCoreFactors(res.data || []);
    }).catch(() => {});
    apiClient.get('/reference/virtualizationTypes').then(res => {
      setVirtTypes((res.data || []).map((v: any) => v.virtType || v.virt_type || v));
    }).catch(() => {});
    storageService.getPrimaryUses().then(uses => {
      setPrimaryUseOptions(uses);
      if (uses.length > 0 && !uses.includes(selectedPrimaryUse)) {
        setSelectedPrimaryUse(uses[0]);
      }
    }).catch(() => {});
  }, []);

  // Load physical hosts when server type is Virtual
  useEffect(() => {
    if (serverType === 'Virtual' && selectedCustomerId) {
      storageService.getHostsByCustomer(selectedCustomerId).then(hosts => {
        setExistingPhysicalHosts(
          hosts.filter((h: any) => h.serverType === 'Physical').map((h: any) => ({ id: h.id, name: h.name }))
        );
      }).catch(() => setExistingPhysicalHosts([]));
      return;
    }

    setExistingPhysicalHosts([]);
  }, [serverType, selectedCustomerId]);

  useEffect(() => {
    setDuplicateEnvs({});
    setPhysicalHostId('');
  }, [selectedCustomerId]);

  // Match core factor when CPU model changes
  useEffect(() => {
    if (!cpuModelOverride || coreFactors.length === 0) {
      setMatchedCoreFactor(null);
      return;
    }
    const match = coreFactors.find(cf => cf.cpuModel === cpuModelOverride);
    setMatchedCoreFactor(match ? match.coreFactor : null);
  }, [cpuModelOverride, coreFactors]);

  // Check for duplicate host whenever hostName changes
  useEffect(() => {
    if (!hostName || !selectedCustomerId) {
      setDuplicateHost(null);
      return;
    }

    let cancelled = false;

    apiClient.post('/os-import/host-conflict', {
      customerId: selectedCustomerId,
      hostName,
    }).then((response) => {
      if (!cancelled) {
        setDuplicateHost(response.data?.duplicateHost ?? null);
      }
    }).catch(() => {
      if (!cancelled) {
        setDuplicateHost(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [hostName, selectedCustomerId]);

  // Populate form when discovery completes — match detected CPU to reference table
  useEffect(() => {
    if (!discoveryData) return;
    setHostName(discoveryData.hostname);
    setServerType(discoveryData.serverType);
    setVirtType(discoveryData.virtualizationType);
    setCoresOverride(String(discoveryData.cores));
    setSocketsOverride(String(discoveryData.sockets));
    setThreadsOverride(String(discoveryData.threadsPerCore));

    // Auto-match detected CPU to reference table entry
    if (coreFactors.length > 0) {
      const matched = matchCpuToReference(discoveryData.cpuModel, coreFactors);
      setCpuModelOverride(matched || coreFactors[0]?.cpuModel || discoveryData.cpuModel);
    } else {
      setCpuModelOverride(discoveryData.cpuModel);
    }
  }, [discoveryData, coreFactors]);

  // Helper: match a raw CPU string like "Intel(R) Xeon(R) Gold 6138 CPU @ 2.00GHz"
  // to a reference table entry like "Intel Xeon"
  function matchCpuToReference(rawCpu: string, refs: CoreFactorEntry[]): string | null {
    // Normalize: strip (R), (TM), extra whitespace
    const norm = rawCpu.replace(/\(R\)|\(TM\)|®|™/gi, '').replace(/\s+/g, ' ').trim().toLowerCase();
    // Try to match each reference entry
    for (const ref of refs) {
      const refWords = ref.cpuModel.toLowerCase().split(/\s+/);
      // All words of the reference name must appear in the normalized string
      if (refWords.every(w => norm.includes(w))) return ref.cpuModel;
    }
    return null;
  }

  const useSSH = osType !== 'windows';

  const connectionPayload = {
    hostname,
    port: parseInt(sshPort, 10) || 22,
    username,
    password: authMethod === 'password' || !useSSH ? password : '',
    osType,
    winrmPort: parseInt(winrmPort, 10) || 5985,
    useHttps,
    ...(useSSH && authMethod === 'privateKey' ? {
      privateKey,
      passphrase: passphrase || undefined,
    } : {}),
  };

  const canConnect = hostname && username && (
    !useSSH ? password : (authMethod === 'password' ? password : privateKey)
  );

  async function handleTestConnection() {
    if (!canConnect) return;
    setIsTesting(true);
    setConnectionStatus('idle');
    setConnectionDiagnostic('');
    try {
      const res = await apiClient.post('/os-import/test-connection', connectionPayload, { timeout: 25000 });
      setConnectionStatus('success');
      setConnectionMessage(res.data.message);
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

  async function handleDiscover() {
    if (!canConnect) return;
    setIsDiscovering(true);
    setDiscoveryData(null);
    setInstanceConnections({});
    try {
      const res = await apiClient.post('/os-import/discover', connectionPayload, { timeout: 60000 });
      setDiscoveryData(res.data);
      setConnectionStatus('success');
      
      // Initialize per-instance connection state with detected defaults
      const initConns: Record<string, InstanceConnectionState> = {};
      for (const inst of (res.data.oracleInstances || [])) {
        initConns[inst.name] = {
          hostname: inst.detectedHost || res.data.hostname || hostname,
          port: String(inst.defaultPort || 1521),
          serviceName: inst.defaultServiceName || inst.name,
          username: 'system',
          password: '',
          useSID: true,
          status: 'idle',
          message: '',
          importedData: null,
        };
      }
      setInstanceConnections(initConns);
      
      toast({
        title: 'Discovery complete',
        description: `${res.data.hostname} — ${res.data.cores} cores, ${res.data.sockets} sockets (${res.data.serverType})`,
      });
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || 'Discovery failed';
      setConnectionStatus('error');
      setConnectionMessage(msg);
      toast({ title: 'Discovery failed', description: msg, variant: 'destructive' });
    } finally {
      setIsDiscovering(false);
    }
  }

  function updateInstanceConnection(instName: string, updates: Partial<InstanceConnectionState>) {
    setInstanceConnections(prev => ({
      ...prev,
      [instName]: { ...prev[instName], ...updates },
    }));
  }

  async function handleConnectInstance(instName: string) {
    const conn = instanceConnections[instName];
    if (!conn || !conn.password) {
      toast({ title: 'Password required', description: `Enter the Oracle password for instance "${instName}".`, variant: 'destructive' });
      return;
    }

    updateInstanceConnection(instName, { status: 'connecting', message: '', importedData: null });

    try {
      const targetHost = conn.hostname || hostname;
      const res = await apiClient.post('/import/oracle-data', {
        hostname: targetHost,
        port: parseInt(conn.port) || 1521,
        serviceName: conn.serviceName,
        username: conn.username,
        password: conn.password,
        useSID: conn.useSID,
      }, { timeout: 60000 });

      updateInstanceConnection(instName, {
        status: 'connected',
        message: `${res.data.database?.edition || ''} ${res.data.database?.version || ''} — ${res.data.features?.filter((f: any) => f.currentlyUsed).length || 0} active features`,
        importedData: res.data,
      });

      // Check for duplicate environment
      const dbName = res.data.database?.name || res.data.database?.uniqueName || instName;
      if (selectedCustomerId) {
        try {
          const conflictResponse = await apiClient.post('/import/environment-conflict', {
            customerId: selectedCustomerId,
            environmentName: dbName,
            isRAC: res.data.database?.isRAC === true,
          });
          const duplicateEnv = conflictResponse.data?.duplicateEnv;

          if (duplicateEnv) {
            setDuplicateEnvs(prev => ({ ...prev, [instName]: duplicateEnv }));
          } else {
            setDuplicateEnvs(prev => {
              const next = { ...prev };
              delete next[instName];
              return next;
            });
          }
        } catch (_) {}
      }

      toast({
        title: `Connected to ${instName}`,
        description: `${res.data.database?.name || instName} (${res.data.database?.edition || 'Unknown'})`,
      });
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || 'Oracle connection failed';
      updateInstanceConnection(instName, { status: 'error', message: msg });
      toast({ title: `Failed to connect to ${instName}`, description: msg, variant: 'destructive' });
    }
  }

  async function handleSaveHost() {
    if (!selectedCustomerId) {
      toast({ title: 'Error', description: 'Please select a customer first', variant: 'destructive' });
      return;
    }
    if (!hostName || !cpuModelOverride) {
      toast({ title: 'Error', description: 'Host name and CPU model are required', variant: 'destructive' });
      return;
    }
    if (serverType === 'Virtual' && !physicalHostId) {
      toast({ title: 'Error', description: 'Please select the physical host this virtual server runs on.', variant: 'destructive' });
      return;
    }

    const cores = parseInt(coresOverride) || 1;
    const sockets = parseInt(socketsOverride) || 1;
    const threads = parseInt(threadsOverride) || 1;
    const coreFactor = matchedCoreFactor ?? 0.5;

    setIsSaving(true);
    try {
      const connectedInstances = Object.entries(instanceConnections)
        .filter(([, connection]) => connection.status === 'connected' && connection.importedData)
        .map(([instanceName, connection]) => ({
          instanceName,
          importData: connection.importedData,
        }));

      const response = await apiClient.post('/os-import/save-host', {
        customerId: selectedCustomerId,
        primaryUse: selectedPrimaryUse,
        discoveryHostname: discoveryData?.hostname || hostname,
        host: {
          name: hostName,
          cpuModel: cpuModelOverride,
          serverType,
          virtualizationType: serverType === 'Virtual' ? virtType : undefined,
          sockets,
          cores,
          threadsPerCore: threads,
          coreFactor,
          hasHardPartitioning: false,
          physicalHostId: serverType === 'Virtual' ? physicalHostId : undefined,
        },
        connectedInstances,
      });

      await storageService.initialize();

      if (serverType === 'Virtual' && selectedCustomerId) {
        storageService.getHostsByCustomer(selectedCustomerId).then(hosts => {
          setExistingPhysicalHosts(
            hosts.filter((existingHost: any) => existingHost.serverType === 'Physical').map((existingHost: any) => ({ id: existingHost.id, name: existingHost.name }))
          );
        }).catch(() => setExistingPhysicalHosts([]));
      }

      toast({
        title: 'Host created',
        description: response.data?.message || `"${hostName}" created successfully.`,
      });
    } catch (err: any) {
      toast({
        title: 'Error creating host',
        description: err.response?.data?.error || err.message || 'Failed to create host',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  }

  const connectedCount = Object.values(instanceConnections).filter(c => c.status === 'connected' && c.importedData).length;
  const duplicateEnvironmentStates = Object.values(duplicateEnvs);
  const mergeableEnvironmentCount = duplicateEnvironmentStates.filter((duplicateEnv) => duplicateEnv.isRAC).length;
  const skippedEnvironmentCount = duplicateEnvironmentStates.filter((duplicateEnv) => !duplicateEnv.isRAC).length;

  return (
    <div className="space-y-6">
      {/* Connection Form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PlugZap className="h-5 w-5 text-blue-500" />
            Server Connection
          </CardTitle>
          <CardDescription>
            Connect to a remote server via {osType === 'windows' ? 'WinRM' : 'SSH'} to discover hardware{osType === 'kvm-host' || osType === 'vmware-host' ? ' and CPU mapping.' : ', virtualization, and Oracle installations.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 mb-4">
            <Button variant={osType === 'linux' ? 'default' : 'outline'} size="sm" onClick={() => setOsType('linux')}>
              <Monitor className="h-4 w-4 mr-1" />
              Linux
            </Button>
            <Button variant={osType === 'windows' ? 'default' : 'outline'} size="sm" onClick={() => setOsType('windows')}>
              <HardDrive className="h-4 w-4 mr-1" />
              Windows
            </Button>
            <Button variant={osType === 'sunos' ? 'default' : 'outline'} size="sm" onClick={() => setOsType('sunos')}>
              <Server className="h-4 w-4 mr-1" />
              SunOS
            </Button>
            <Button variant={osType === 'hp-ux' ? 'default' : 'outline'} size="sm" onClick={() => setOsType('hp-ux')}>
              <Server className="h-4 w-4 mr-1" />
              HP-UX
            </Button>
            <Button variant={osType === 'kvm-host' ? 'default' : 'outline'} size="sm" onClick={() => setOsType('kvm-host')}>
              <Cpu className="h-4 w-4 mr-1" />
              KVM Host
            </Button>
            <Button variant={osType === 'vmware-host' ? 'default' : 'outline'} size="sm" onClick={() => setOsType('vmware-host')}>
              <Cpu className="h-4 w-4 mr-1" />
              VMware Host
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="os-hostname">Hostname / IP</Label>
              <Input
                id="os-hostname"
                placeholder="192.168.1.100 or server.company.com"
                value={hostname}
                onChange={e => setHostname(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="os-port">{osType === 'windows' ? 'WinRM Port' : 'SSH Port'}</Label>
              <Input
                id="os-port"
                type="number"
                placeholder={osType === 'windows' ? '5985' : '22'}
                value={osType === 'windows' ? winrmPort : sshPort}
                onChange={e => osType === 'windows' ? setWinrmPort(e.target.value) : setSshPort(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="os-username">Username</Label>
              <Input
                id="os-username"
                placeholder={osType === 'windows' ? 'Administrator' : 'root'}
                value={username}
                onChange={e => setUsername(e.target.value)}
              />
            </div>
            {useSSH && authMethod === 'privateKey' ? (
              <>
                <div className="space-y-2">
                  <Label>Private Key</Label>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full justify-start text-muted-foreground"
                      onClick={() => {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = '.pem,.key,.ppk,.pub,*';
                        input.onchange = (e) => {
                          const file = (e.target as HTMLInputElement).files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onload = (event) => {
                              setPrivateKey(String(event.target?.result || ''));
                              setPrivateKeyName(file.name);
                            };
                            reader.readAsText(file);
                          }
                        };
                        input.click();
                      }}
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      {privateKeyName || 'Select key file...'}
                    </Button>
                  </div>
                  {privateKey && (
                    <p className="text-xs text-green-600 flex items-center gap-1">
                      <CheckCircle className="h-3 w-3" />
                      Key loaded ({privateKeyName})
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="os-passphrase">Passphrase <span className="text-muted-foreground text-xs">(optional)</span></Label>
                  <Input
                    id="os-passphrase"
                    type="password"
                    placeholder="Key passphrase"
                    value={passphrase}
                    onChange={e => setPassphrase(e.target.value)}
                  />
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="os-password">Password</Label>
                <Input
                  id="os-password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                />
              </div>
            )}
          </div>

          {useSSH && (
            <div className="flex items-center gap-3 mt-3">
              <Button
                variant={authMethod === 'password' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setAuthMethod('password')}
              >
                <KeyRound className="h-3.5 w-3.5 mr-1" />
                Password
              </Button>
              <Button
                variant={authMethod === 'privateKey' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setAuthMethod('privateKey')}
              >
                <Upload className="h-3.5 w-3.5 mr-1" />
                Private Key
              </Button>
            </div>
          )}

          {osType === 'windows' && (
            <div className="flex items-center gap-2 mt-3">
              <input
                type="checkbox"
                id="useHttps"
                checked={useHttps}
                onChange={e => setUseHttps(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              <Label htmlFor="useHttps" className="text-sm text-muted-foreground cursor-pointer">
                Use HTTPS for WinRM (port 5986)
              </Label>
            </div>
          )}

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
              disabled={!canConnect || isTesting || isDiscovering}
            >
              {isTesting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlugZap className="h-4 w-4 mr-2" />}
              Test Connection
            </Button>
            <Button
              onClick={handleDiscover}
              disabled={!canConnect || isDiscovering || isTesting}
            >
              {isDiscovering ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Server className="h-4 w-4 mr-2" />}
              Discover Server
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Discovery Results */}
      {discoveryData && (
        <>
          {/* System Overview */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cpu className="h-5 w-5 text-green-500" />
                Discovered Server Information
              </CardTitle>
              <CardDescription>
                Review the detected hardware and virtualization details. You can override values before saving.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                <div>
                  <div className="text-xs text-muted-foreground">Hostname</div>
                  <div className="font-semibold">{discoveryData.hostname}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Detected Type</div>
                  <Badge variant={discoveryData.serverType === 'Virtual' ? 'default' : 'outline'}>
                    {discoveryData.serverType}
                    {discoveryData.virtualizationType && ` (${discoveryData.virtualizationType})`}
                  </Badge>
                </div>
              </div>

              <Separator className="my-4" />

              {/* Editable form for host creation */}
              <div className="text-sm font-semibold mb-3">Host Details (editable)</div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Host Name</Label>
                  <Input value={hostName} onChange={e => setHostName(e.target.value)} className={duplicateHost ? 'border-amber-500' : ''} />
                  {duplicateHost && (
                    <p className="text-xs text-amber-700 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                      A host named "{duplicateHost.name}" already exists for this customer. Rename to import as a new host.
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Server Type</Label>
                  <Select value={serverType} onValueChange={v => setServerType(v as any)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Physical">Physical</SelectItem>
                      <SelectItem value="Virtual">Virtual</SelectItem>
                      <SelectItem value="Oracle Cloud">Oracle Cloud</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {serverType === 'Virtual' && (
                  <div className="space-y-2">
                    <Label>Virtualization Type</Label>
                    <Select value={virtType} onValueChange={setVirtType}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select..." />
                      </SelectTrigger>
                      <SelectContent>
                        {virtTypes.map(vt => (
                          <SelectItem key={vt} value={vt}>{vt}</SelectItem>
                        ))}
                        {virtType && !virtTypes.includes(virtType) && (
                          <SelectItem value={virtType}>{virtType} (detected)</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {serverType === 'Virtual' && (
                  <div className="space-y-2">
                    <Label>Physical Host <span className="text-red-500">*</span></Label>
                    <Select value={physicalHostId} onValueChange={setPhysicalHostId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select physical host..." />
                      </SelectTrigger>
                      <SelectContent>
                        {existingPhysicalHosts.map(h => (
                          <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {existingPhysicalHosts.length === 0 && (
                      <p className="text-xs text-red-600 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        No physical hosts found. Create one first.
                      </p>
                    )}
                  </div>
                )}
                <div className="space-y-2">
                  <Label>CPU Model</Label>
                  <Select value={cpuModelOverride} onValueChange={setCpuModelOverride}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select CPU model (required)" />
                    </SelectTrigger>
                    <SelectContent>
                      {coreFactors.map(cf => (
                        <SelectItem key={cf.cpuModel} value={cf.cpuModel}>
                          {cf.cpuModel}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {discoveryData && (
                    <p className="text-xs text-muted-foreground">Detected: {discoveryData.cpuModel}</p>
                  )}
                  {matchedCoreFactor !== null && (
                    <p className="text-xs text-green-600">Core factor: {matchedCoreFactor}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Total Cores</Label>
                  <Input type="number" value={coresOverride} onChange={e => setCoresOverride(e.target.value)} />
                  <p className="text-xs text-muted-foreground">
                    Detected: {discoveryData.coresPerSocket} cores/socket × {discoveryData.sockets} sockets = {discoveryData.cores}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Sockets</Label>
                  <Input type="number" value={socketsOverride} onChange={e => setSocketsOverride(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Threads per Core</Label>
                  <Input type="number" value={threadsOverride} onChange={e => setThreadsOverride(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Core Factor</Label>
                  <div className="h-9 flex items-center px-3 border rounded-md bg-muted text-sm">
                    {matchedCoreFactor ?? 0.5}
                  </div>
                </div>
              </div>


            </CardContent>
          </Card>

          {/* KVM CPU Mapping — only for KVM hosts */}
          {discoveryData.kvmCpuMappings && discoveryData.kvmCpuMappings.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Cpu className="h-5 w-5 text-purple-500" />
                  KVM Hard Partitioning — CPU Mapping ({discoveryData.kvmCpuMappings.length} VMs)
                </CardTitle>
                <CardDescription>
                  Physical CPU pinning detected via virsh. Shows the mapping between VMs and their assigned physical CPUs for hard partitioning.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>VM Name</TableHead>
                      <TableHead>vCPUs</TableHead>
                      <TableHead>Pinned Physical CPUs</TableHead>
                      <TableHead>NUMA Node</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {discoveryData.kvmCpuMappings.map((m, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{m.vmName}</TableCell>
                        <TableCell>{m.vcpus}</TableCell>
                        <TableCell>
                          <code className="text-xs bg-muted px-1 py-0.5 rounded">{m.pinnedCpus || 'Not pinned'}</code>
                        </TableCell>
                        <TableCell>{m.numaNode || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Oracle Instances — per-instance connection (not shown for KVM/VMware hosts) */}
          {osType !== 'kvm-host' && osType !== 'vmware-host' && discoveryData.oracleInstances && discoveryData.oracleInstances.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="h-5 w-5 text-orange-500" />
                  Oracle Instances ({discoveryData.oracleInstances.length})
                </CardTitle>
                <CardDescription>
                  Connect to each detected Oracle instance to import environment data (editions, features, PDBs).
                  Port and service name are pre-filled from listener detection.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {discoveryData.oracleInstances.map(inst => {
                  const conn = instanceConnections[inst.name];
                  if (!conn) return null;
                  return (
                    <div key={inst.name} className="border rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Database className="h-4 w-4 text-muted-foreground" />
                          <span className="font-semibold">{inst.name}</span>
                          {inst.version && <Badge variant="outline" className="text-xs">{inst.version}</Badge>}
                          {inst.oracleHome && (
                            <span className="text-xs text-muted-foreground truncate max-w-[300px]" title={inst.oracleHome}>
                              {inst.oracleHome}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {conn.status === 'connected' && <CheckCircle className="h-4 w-4 text-green-500" />}
                          {conn.status === 'error' && <XCircle className="h-4 w-4 text-red-500" />}
                          {conn.status === 'connecting' && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
                        <div className="space-y-1">
                          <Label className="text-xs">Hostname</Label>
                          <Input
                            value={conn.hostname}
                            onChange={e => updateInstanceConnection(inst.name, { hostname: e.target.value })}
                            disabled={conn.status === 'connecting'}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Port</Label>
                          <Input
                            type="number"
                            value={conn.port}
                            onChange={e => updateInstanceConnection(inst.name, { port: e.target.value })}
                            disabled={conn.status === 'connecting'}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Service Name</Label>
                          <Input
                            value={conn.serviceName}
                            onChange={e => updateInstanceConnection(inst.name, { serviceName: e.target.value })}
                            disabled={conn.status === 'connecting'}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Username</Label>
                          <Input
                            value={conn.username}
                            onChange={e => updateInstanceConnection(inst.name, { username: e.target.value })}
                            disabled={conn.status === 'connecting'}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Password</Label>
                          <Input
                            type="password"
                            placeholder="••••••••"
                            value={conn.password}
                            onChange={e => updateInstanceConnection(inst.name, { password: e.target.value })}
                            disabled={conn.status === 'connecting'}
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              id={`useSID-${inst.name}`}
                              checked={conn.useSID}
                              onChange={e => updateInstanceConnection(inst.name, { useSID: e.target.checked })}
                              disabled={conn.status === 'connecting'}
                              className="h-3.5 w-3.5 rounded border-gray-300"
                            />
                            <Label htmlFor={`useSID-${inst.name}`} className="text-xs cursor-pointer">SID</Label>
                          </div>
                          <Button
                            size="sm"
                            variant={conn.status === 'connected' ? 'outline' : 'default'}
                            onClick={() => handleConnectInstance(inst.name)}
                            disabled={conn.status === 'connecting' || !conn.password}
                          >
                            {conn.status === 'connecting' ? (
                              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                            ) : (
                              <PlugZap className="h-3.5 w-3.5 mr-1" />
                            )}
                            {conn.status === 'connected' ? 'Reconnect' : 'Connect'}
                          </Button>
                        </div>
                      </div>

                      {/* Connection result */}
                      {conn.status === 'connected' && conn.importedData && (
                        <div className="bg-green-50 p-3 rounded-md text-sm space-y-2">
                          <div className="flex items-center gap-2 text-green-700 font-medium">
                            <CheckCircle className="h-4 w-4" />
                            {conn.importedData.database?.name} — {conn.importedData.database?.edition} {conn.importedData.database?.versionShort}
                            {conn.importedData.database?.dbType === 'CDB' && (
                              <Badge variant="outline" className="text-xs">CDB</Badge>
                            )}
                          </div>
                          {/* Warning if connected to a PDB instead of CDB root */}
                          {conn.importedData.database?.isPDB && (
                            <div className="bg-amber-50 border border-amber-200 p-2 rounded-md text-xs text-amber-800 flex items-start gap-1.5">
                              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-amber-500" />
                              <span>
                                Connected to PDB <strong>{conn.importedData.database.containerName}</strong> instead of the CDB root. 
                                PDB list and per-PDB feature data will not be available. 
                                For complete data, reconnect to the CDB root (CDB$ROOT). You can still continue with the import.
                              </span>
                            </div>
                          )}
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-green-600">
                            <div>Features: {conn.importedData.features?.filter((f: any) => f.currentlyUsed).length || 0} active</div>
                            <div>Type: {conn.importedData.database?.envType || 'Standalone'}</div>
                            {conn.importedData.pdbs?.length > 0 && <div>PDBs: {conn.importedData.pdbs.length}</div>}
                            {conn.importedData.database?.isRAC && <div>RAC: Yes</div>}
                          </div>
                        </div>
                      )}
                      {/* Warning if environment already exists */}
                      {conn.status === 'connected' && duplicateEnvs[inst.name] && (
                        <div className="bg-amber-50 border border-amber-200 p-2 rounded-md text-xs text-amber-800 flex items-start gap-1.5">
                          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-amber-500" />
                          <span>
                            An environment named <strong>"{duplicateEnvs[inst.name].name}"</strong> already exists for this customer. 
                            {duplicateEnvs[inst.name].isRAC
                              ? ' It will be merged into the existing RAC environment if this instance is not already registered.'
                              : ' This non-RAC environment will be skipped during import.'}
                          </span>
                        </div>
                      )}
                      {conn.status === 'error' && conn.message && (
                        <div className="bg-red-50 p-2 rounded-md text-xs text-red-700 flex items-start gap-1">
                          <XCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                          <span>{conn.message}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Primary Use selector for imported environments */}
          {connectedCount > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Environment Settings</CardTitle>
                <CardDescription>Assign a primary use to the imported environments</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4">
                  <Label htmlFor="primaryUseSelect" className="whitespace-nowrap">Primary Use</Label>
                  <Select value={selectedPrimaryUse} onValueChange={setSelectedPrimaryUse}>
                    <SelectTrigger id="primaryUseSelect" className="w-48">
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

          {/* Save Button */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">Save to LicenseVault</h3>
                  <p className="text-sm text-muted-foreground">
                    Create the host{connectedCount > 0 ? ` and ${connectedCount} environment(s)` : ''} with the discovered details.
                    {!selectedCustomerId && (
                      <span className="text-red-500 ml-1"> Please select a customer first.</span>
                    )}
                    {duplicateHost && (
                      <span className="text-amber-600 ml-1"> Host "{duplicateHost.name}" already exists — rename it above to continue.</span>
                    )}
                    {skippedEnvironmentCount > 0 && (
                      <span className="text-amber-600 ml-1"> {skippedEnvironmentCount} non-RAC environment(s) already exist and will be skipped.</span>
                    )}
                    {mergeableEnvironmentCount > 0 && (
                      <span className="text-amber-600 ml-1"> {mergeableEnvironmentCount} RAC environment(s) already exist and will be merged when possible.</span>
                    )}
                  </p>
                </div>
                <Button
                  size="lg"
                  onClick={handleSaveHost}
                  disabled={isSaving || !selectedCustomerId || !hostName || !cpuModelOverride || (serverType === 'Virtual' && !physicalHostId) || !!duplicateHost}
                >
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  Save Host{connectedCount > 0 ? ` + ${connectedCount} Env` : ''}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
