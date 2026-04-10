import { useState, useEffect, Fragment } from 'react';
import { useSelectedCustomerId } from '@/hooks/use-selected-customer';
import { storageService } from '@/lib/storageService';
import apiClient from '@/lib/apiClient';
import { useToast } from '@/hooks/use-toast';
import { Host } from '@/lib/types';
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
  CheckCircle,
  Database,
  FileArchive,
  Loader2,
  Server,
  Upload,
  XCircle,
  Cpu,
  Eye,
} from 'lucide-react';

type ReviewLiteHost = {
  machineName: string;
  cpuModel: string;
  cpuModelRaw: string;
  serverType: string;
  sockets: number;
  coresPerSocket: number;
  totalCores: number;
  threadsPerCore: number;
  coreFactor: number;
};

type ReviewLiteDatabase = {
  sid: string;
  machineName: string;
  oracleHome: string;
  database: {
    name: string;
    uniqueName: string;
    banner: string;
    edition: string;
    version: string;
    versionShort: string;
    databaseRole: string;
    openMode: string;
    logMode: string;
    isDataGuard: boolean;
    isRAC: boolean;
    platform: string;
    envType: string;
    dbType: string;
  };
  instance: {
    name: string;
    hostName: string;
    status: string;
  };
  cpu: { cpuCount: number };
  license: { sessionsMax: number; sessionsHighwater: number; sessionsCurrent: number };
  features: {
    name: string;
    version: string;
    detectedUsages: number;
    currentlyUsed: boolean;
    firstUsageDate: string | null;
    lastUsageDate: string | null;
    description: string;
  }[];
  dbOptions: { parameter: string; value: string }[];
  // Client-side selection state
  selected?: boolean;
};

type ReviewLiteParseResult = {
  fileNames: string[];
  skippedFiles: { name: string; reason: string }[];
  hosts: ReviewLiteHost[];
  databases: ReviewLiteDatabase[];
};

export default function ReviewLitePanel() {
  const { toast } = useToast();
  const selectedCustomerId = useSelectedCustomerId();

  // Upload state
  const [files, setFiles] = useState<FileList | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [parseResult, setParseResult] = useState<ReviewLiteParseResult | null>(null);

  // Database selection
  const [selectedDbs, setSelectedDbs] = useState<Record<string, boolean>>({});

  // Host assignment
  const [createHost, setCreateHost] = useState(true);
  const [selectedHostId, setSelectedHostId] = useState('');
  const [availableHosts, setAvailableHosts] = useState<Host[]>([]);

  // Primary use per database
  const [primaryUseOptions, setPrimaryUseOptions] = useState<string[]>([]);
  const [primaryUseByDb, setPrimaryUseByDb] = useState<Record<string, string>>({});

  // Physical host assignment for virtual hosts
  const [physicalHostMap, setPhysicalHostMap] = useState<Record<string, string>>({});

  // Expanded features view
  const [expandedDb, setExpandedDb] = useState<string | null>(null);

  useEffect(() => {
    storageService.getPrimaryUses().then(uses => {
      setPrimaryUseOptions(uses);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    storageService.getHosts().then(h => setAvailableHosts(h)).catch(() => setAvailableHosts([]));
    setSelectedHostId('');
  }, [selectedCustomerId]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files;
    if (selected && selected.length > 0) {
      setFiles(selected);
      setParseResult(null);
      setSelectedDbs({});
    }
  }

  async function handleParse() {
    if (!files || files.length === 0) return;

    setIsParsing(true);
    setParseResult(null);

    try {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
      }

      const res = await apiClient.post('/review-lite/parse', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      });

      const result = res.data as ReviewLiteParseResult;
      setParseResult(result);

      // Select all databases by default
      const selections: Record<string, boolean> = {};
      const primaryUses: Record<string, string> = {};
      result.databases.forEach(db => {
        selections[db.sid] = true;
        primaryUses[db.sid] = 'Production';
      });
      setSelectedDbs(selections);
      setPrimaryUseByDb(primaryUses);

      // If host info detected, default to create host
      setCreateHost(result.hosts.length > 0);

      toast({
        title: 'Review Lite parsed',
        description: `${result.databases.length} database(s), ${result.hosts.length} host(s) from ${result.fileNames.length} file(s)`,
      });
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || 'Failed to parse file';
      toast({ title: 'Parse failed', description: msg, variant: 'destructive' });
    } finally {
      setIsParsing(false);
    }
  }

  async function handleSave() {
    if (!parseResult || !selectedCustomerId) {
      toast({
        title: 'Error',
        description: !selectedCustomerId ? 'Selecciona un cliente primero' : 'No hay datos para guardar',
        variant: 'destructive',
      });
      return;
    }

    const selected = parseResult.databases.filter(db => selectedDbs[db.sid]);
    if (selected.length === 0) {
      toast({ title: 'Error', description: 'Selecciona al menos una base de datos', variant: 'destructive' });
      return;
    }

    if (!createHost && !selectedHostId) {
      toast({ title: 'Error', description: 'Selecciona un host o crea uno nuevo', variant: 'destructive' });
      return;
    }

    // Validate virtual hosts have a physical host assigned
    if (createHost && parseResult.hosts.length > 0) {
      const unassignedVirtual = parseResult.hosts
        .filter(h => h.serverType === 'Virtual' && !physicalHostMap[h.machineName]);
      if (unassignedVirtual.length > 0) {
        toast({
          title: 'Error',
          description: `Asigna un host físico a: ${unassignedVirtual.map(h => h.machineName).join(', ')}`,
          variant: 'destructive',
        });
        return;
      }
    }

    setIsSaving(true);
    try {
      const payload = {
        customerId: selectedCustomerId,
        createHost,
        databases: selected.map(db => ({
          selected: true,
          sid: db.sid,
          machineName: db.machineName,
          primaryUse: primaryUseByDb[db.sid] || 'Production',
          database: db.database,
          instance: db.instance,
          features: db.features.map(f => ({
            name: f.name,
            currentlyUsed: f.currentlyUsed,
            detectedUsages: f.detectedUsages,
            firstUsageDate: f.firstUsageDate,
            lastUsageDate: f.lastUsageDate,
          })),
        })),
        hosts: parseResult.hosts.length > 0 ? parseResult.hosts.map(h => ({
          machineName: h.machineName,
          cpuModel: h.cpuModel,
          serverType: h.serverType,
          sockets: h.sockets,
          totalCores: h.totalCores,
          threadsPerCore: h.threadsPerCore,
          physicalHostRef: physicalHostMap[h.machineName] || undefined,
        })) : undefined,
        hostId: !createHost ? selectedHostId : undefined,
      };

      const res = await apiClient.post('/review-lite/save', payload, { timeout: 30000 });

      const created = res.data.environments?.filter((e: any) => e.mode === 'created').length || 0;
      const updated = res.data.environments?.filter((e: any) => e.mode === 'updated').length || 0;
      const hostCount = res.data.hostNames?.length || 0;

      toast({
        title: 'Datos guardados',
        description: `${created} entorno(s) creado(s), ${updated} actualizado(s). ${hostCount} host(s).`,
      });
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || 'Error al guardar';
      toast({ title: 'Error', description: msg, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  }

  const selectedCount = Object.values(selectedDbs).filter(Boolean).length;
  const usedFeatureCount = parseResult?.databases
    .filter(db => selectedDbs[db.sid])
    .reduce((sum, db) => sum + db.features.filter(f => f.currentlyUsed).length, 0) || 0;

  return (
    <div className="space-y-6">
      {/* File Upload */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileArchive className="h-5 w-5 text-orange-500" />
            Oracle Review Lite Collection
          </CardTitle>
          <CardDescription>
            Sube uno o varios ficheros <code>.tar.bz2</code> generados por el script de Review Lite de Oracle.
            Se extraerán los datos de CPU, base de datos, features y opciones para crear entornos y hosts.
            Los duplicados de host o base de datos entre ficheros se consolidarán automáticamente.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-4">
            <div className="flex-1 space-y-2">
              <Label htmlFor="reviewLiteFile">Ficheros Collection (.tar.bz2, .zip)</Label>
              <Input
                id="reviewLiteFile"
                type="file"
                accept=".tar.bz2,.bz2,.zip"
                multiple
                onChange={handleFileChange}
                className="cursor-pointer"
              />
            </div>
            <Button
              onClick={handleParse}
              disabled={!files || files.length === 0 || isParsing}
            >
              {isParsing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Eye className="h-4 w-4 mr-2" />
              )}
              Preview
            </Button>
          </div>

          {files && files.length > 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              {files.length} fichero(s): {Array.from(files).map(f => f.name).join(', ')}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Parse Results */}
      {parseResult && (
        <>
          {/* Parse Summary */}
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="text-sm space-y-1">
                <p>
                  <span className="font-semibold">{parseResult.fileNames.length}</span> de{' '}
                  <span className="font-semibold">{parseResult.fileNames.length + (parseResult.skippedFiles?.length || 0)}</span>{' '}
                  fichero(s) procesados correctamente →{' '}
                  <span className="font-semibold">{parseResult.hosts.length}</span> host(s),{' '}
                  <span className="font-semibold">{parseResult.databases.length}</span> base(s) de datos
                </p>
                {parseResult.skippedFiles?.length > 0 && (
                  <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-yellow-800 text-xs">
                    <p className="font-semibold">⚠ {parseResult.skippedFiles.length} fichero(s) no se pudieron procesar:</p>
                    <ul className="list-disc list-inside mt-1">
                      {parseResult.skippedFiles.map((sf, i) => (
                        <li key={i}>{sf.name}: {sf.reason}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Host Information */}
          {parseResult.hosts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Server className="h-5 w-5 text-purple-500" />
                  Hosts Detectados ({parseResult.hosts.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Hostname</TableHead>
                      <TableHead>Server Type</TableHead>
                      <TableHead>CPU Model</TableHead>
                      <TableHead className="text-center">Sockets</TableHead>
                      <TableHead className="text-center">Cores</TableHead>
                      <TableHead className="text-center">Threads/Core</TableHead>
                      <TableHead className="text-center">Core Factor</TableHead>
                      <TableHead>Host Físico</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parseResult.hosts.map(h => {
                      const isVirtual = h.serverType === 'Virtual';
                      const physicalHosts = parseResult.hosts.filter(ph => ph.serverType === 'Physical');
                      return (
                        <TableRow key={h.machineName}>
                          <TableCell className="font-semibold">{h.machineName}</TableCell>
                          <TableCell>
                            <Badge variant={isVirtual ? 'secondary' : 'default'}>{h.serverType}</Badge>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">{h.cpuModel}</div>
                            {h.cpuModelRaw !== h.cpuModel && (
                              <div className="text-xs text-muted-foreground">{h.cpuModelRaw}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-center">{h.sockets}</TableCell>
                          <TableCell className="text-center font-semibold">{h.totalCores}</TableCell>
                          <TableCell className="text-center">{h.threadsPerCore}</TableCell>
                          <TableCell className="text-center">{h.coreFactor}</TableCell>
                          <TableCell>
                            {isVirtual ? (
                              <Select
                                value={physicalHostMap[h.machineName] || ''}
                                onValueChange={val => setPhysicalHostMap(prev => ({ ...prev, [h.machineName]: val }))}
                              >
                                <SelectTrigger className="w-[220px] h-8 text-xs">
                                  <SelectValue placeholder="Asignar host físico..." />
                                </SelectTrigger>
                                <SelectContent>
                                  {physicalHosts.map(ph => (
                                    <SelectItem key={`new_${ph.machineName}`} value={`new:${ph.machineName}`}>
                                      {ph.machineName} (importando)
                                    </SelectItem>
                                  ))}
                                  {availableHosts
                                    .filter(eh => eh.serverType === 'Physical')
                                    .map(eh => (
                                      <SelectItem key={eh.id} value={`existing:${eh.id}`}>
                                        {eh.name} (existente{eh.cores ? ` — ${eh.cores} cores` : ''})
                                      </SelectItem>
                                    ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Databases Found */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5 text-blue-500" />
                Bases de Datos ({parseResult.databases.length})
              </CardTitle>
              <CardDescription>
                Selecciona las bases de datos que deseas importar como entornos.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>SID / Name</TableHead>
                    <TableHead>Edition</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Primary Use</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Instance</TableHead>
                    <TableHead className="text-center">Features</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parseResult.databases.map(db => {
                    const usedFeatures = db.features.filter(f => f.currentlyUsed);
                    const isExpanded = expandedDb === db.sid;

                    return (
                      <Fragment key={db.sid}>
                        <TableRow className={selectedDbs[db.sid] ? '' : 'opacity-50'}>
                          <TableCell>
                            <input
                              type="checkbox"
                              checked={selectedDbs[db.sid] || false}
                              onChange={e => setSelectedDbs(prev => ({ ...prev, [db.sid]: e.target.checked }))}
                              className="h-4 w-4 rounded border-gray-300"
                            />
                          </TableCell>
                          <TableCell>
                            <div className="font-semibold">{db.database.name}</div>
                            <div className="text-xs text-muted-foreground">{db.sid}</div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{db.database.edition}</Badge>
                          </TableCell>
                          <TableCell>{db.database.version}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{db.database.envType}</Badge>
                          </TableCell>
                          <TableCell>
                            <Select
                              value={primaryUseByDb[db.sid] || 'Production'}
                              onValueChange={val => setPrimaryUseByDb(prev => ({ ...prev, [db.sid]: val }))}
                            >
                              <SelectTrigger className="w-36 h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {primaryUseOptions.map(opt => (
                                  <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Badge variant={db.database.databaseRole.includes('STANDBY') ? 'secondary' : 'default'}>
                              {db.database.databaseRole}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">{db.instance.name}</div>
                            <div className="text-xs text-muted-foreground">{db.instance.hostName}</div>
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-1">
                              <span className="text-green-600 font-semibold">{usedFeatures.length}</span>
                              <span className="text-muted-foreground">/ {db.features.length}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setExpandedDb(isExpanded ? null : db.sid)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>

                        {/* Expanded features detail */}
                        {isExpanded && (
                          <TableRow key={`${db.sid}-detail`}>
                            <TableCell colSpan={10} className="bg-muted/30 p-4">
                              <div className="space-y-4">
                                {/* DB Options */}
                                {db.dbOptions.length > 0 && (
                                  <div>
                                    <h4 className="text-sm font-semibold mb-2">Database Options</h4>
                                    <div className="flex flex-wrap gap-1">
                                      {db.dbOptions.map(opt => (
                                        <Badge
                                          key={opt.parameter}
                                          variant={opt.value === 'TRUE' ? 'default' : 'outline'}
                                          className="text-xs"
                                        >
                                          {opt.parameter}: {opt.value}
                                        </Badge>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                <Separator />

                                {/* Features */}
                                <div>
                                  <h4 className="text-sm font-semibold mb-2">
                                    Feature Usage Statistics ({usedFeatures.length} activas de {db.features.length})
                                  </h4>
                                  <div className="max-h-64 overflow-y-auto">
                                    <Table>
                                      <TableHeader>
                                        <TableRow>
                                          <TableHead>Feature</TableHead>
                                          <TableHead className="text-center">En Uso</TableHead>
                                          <TableHead className="text-center">Usos</TableHead>
                                          <TableHead>Primer Uso</TableHead>
                                          <TableHead>Último Uso</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {db.features
                                          .sort((a, b) => (a.currentlyUsed === b.currentlyUsed ? 0 : a.currentlyUsed ? -1 : 1))
                                          .map(feature => (
                                          <TableRow key={feature.name} className={feature.currentlyUsed ? '' : 'opacity-50'}>
                                            <TableCell className="text-xs">{feature.name}</TableCell>
                                            <TableCell className="text-center">
                                              {feature.currentlyUsed ? (
                                                <CheckCircle className="h-4 w-4 text-green-500 inline" />
                                              ) : (
                                                <XCircle className="h-4 w-4 text-gray-300 inline" />
                                              )}
                                            </TableCell>
                                            <TableCell className="text-center text-xs">{feature.detectedUsages}</TableCell>
                                            <TableCell className="text-xs">{feature.firstUsageDate || '—'}</TableCell>
                                            <TableCell className="text-xs">{feature.lastUsageDate || '—'}</TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </div>
                                </div>

                                {/* Extra info */}
                                <div className="grid grid-cols-3 gap-4 text-sm">
                                  <div>
                                    <span className="text-muted-foreground">CPU Count (DB): </span>
                                    <span className="font-semibold">{db.cpu.cpuCount}</span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">Sessions Highwater: </span>
                                    <span className="font-semibold">{db.license.sessionsHighwater}</span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">Sessions Current: </span>
                                    <span className="font-semibold">{db.license.sessionsCurrent}</span>
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Host Assignment */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cpu className="h-5 w-5 text-green-500" />
                Asignación de Host
              </CardTitle>
              <CardDescription>
                Elige si crear un nuevo host con los datos detectados o asignar uno existente.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    id="createHostYes"
                    name="hostOption"
                    checked={createHost}
                    onChange={() => setCreateHost(true)}
                    className="h-4 w-4"
                  />
                  <Label htmlFor="createHostYes" className="cursor-pointer">
                    Crear host(s) detectado(s)
                    {parseResult.hosts.length > 0 && (
                      <span className="text-muted-foreground ml-1">
                        ({parseResult.hosts.length} host(s): {parseResult.hosts.map(h => h.machineName).join(', ')})
                      </span>
                    )}
                  </Label>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  id="createHostNo"
                  name="hostOption"
                  checked={!createHost}
                  onChange={() => setCreateHost(false)}
                  className="h-4 w-4"
                />
                <Label htmlFor="createHostNo" className="cursor-pointer">
                  Asignar a host existente
                </Label>
                {!createHost && (
                  <Select value={selectedHostId} onValueChange={setSelectedHostId}>
                    <SelectTrigger className="w-[300px] ml-2">
                      <SelectValue placeholder="Selecciona un host..." />
                    </SelectTrigger>
                    <SelectContent>
                      {availableHosts.map(h => (
                        <SelectItem key={h.id} value={h.id}>
                          {h.name} ({h.serverType}{h.cores ? ` — ${h.cores} cores` : ''})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Save */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">Guardar en LicenseVault</h3>
                  <p className="text-sm text-muted-foreground">
                    Se creará {selectedCount} entorno(s) con {usedFeatureCount} feature(s) activa(s).
                    {!selectedCustomerId && (
                      <span className="text-red-500 ml-1"> Selecciona un cliente primero.</span>
                    )}
                  </p>
                </div>
                <Button
                  size="lg"
                  onClick={handleSave}
                  disabled={isSaving || !selectedCustomerId || selectedCount === 0}
                >
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4 mr-2" />
                  )}
                  Guardar Entornos
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
