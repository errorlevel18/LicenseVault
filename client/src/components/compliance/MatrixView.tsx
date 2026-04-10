// filepath: e:\LicenseVault\client\src\components\compliance\MatrixView.tsx
import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSelectedCustomerId } from '../../hooks/use-selected-customer';
import apiClient from '../../lib/apiClient';
import { AlertTriangle, Loader2, CheckCircle, XCircle, Circle, AlertCircle, HelpCircle, X, Database, Server, Info, ChevronDown, EyeOff, Eye, Filter} from 'lucide-react';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { Separator } from '../ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { MultiSelectFilter } from '../ui/multi-select-filter';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '../ui/dialog';

// Types for Matrix View Data
type FeatureStatus = 'licensed' | 'used' | 'both' | 'unlicensed' | 'unused' | 'enterprise-required';
type ComplianceStatus = 'compliant' | 'non-compliant' | 'warning' | 'unknown';
type BaseProductStatus = 'licensed' | 'used' | 'enterprise-required' | 'unused';

type FeatureData = {
  product: string;
  licensed: boolean;
  used: boolean;
  onlyEnterprise: boolean | null;
  type: string | null;
  status: FeatureStatus;
};

type BaseProductData = {
  product: string;
  licensed: boolean;
  onlyEnterprise: boolean | null;
};

type InstanceData = {
  id: string;
  name: string;
  environmentId?: string;
  hostId: string;
  isPrimary?: boolean;
  status?: string;
  sessions?: number;
};

type HostData = {
  id: string;
  name: string;
  cpuModel?: string;
  cores?: number;
  sockets?: number;
  serverType?: string;
};

type ComplianceHostDetail = {
  id: string;
  complianceDetailId: string;
  hostId: string;
  hostName: string;
  serverType: string;
  totalCores: number;
  physicalCores: number | null;
  coreFactor: number;
  processorLicensesRequired: number;
  hasHardPartitioning: boolean;
  physicalHostId: string | null;
  licensedCores: number;
  unlicensedCores: number;
  licenseStatus: string;
};

type ComplianceDetailData = {
  id: string;
  environmentId: string;
  environmentName: string;
  environmentType: string;
  environmentEdition: string;
  environmentVersion: string;
  status: string;  processorLicensesRequired: number;
  processorLicensesAvailable: number;
  processorLicensesVariance: number;
  processorLicensesNeededForUnlicensed: number;
  nupLicensesRequired: number;
  nupLicensesAvailable: number;
  nupLicensesVariance: number;
  totalCores: number;
  totalPhysicalCores: number;
  coreFactor: number;
  processorCalculationDetails: any[];
  nupCalculationDetails: any;
  hostDetails: ComplianceHostDetail[];
  featureIssues: any[];
};

type EnvironmentData = {
  id: string;
  name: string;
  edition: string;
  effectiveEdition?: string;
  version: string;
  type: string;
  primaryUse?: string;
  baseProducts: BaseProductData[];
  features: FeatureData[];
  
  // Pre-computed compliance status from server
  complianceStatus: ComplianceStatus;
  baseProductStatus: BaseProductStatus;
  isCompliant: boolean;
  hasNoLicenses: boolean;
  processorNeeded: number;
  nupNeeded: number;
  unlicensedFeatures: string[];
    
  // Raw license calculation data
  processorLicensesRequired?: number;
  processorLicensesAvailable?: number;
  processorLicensesVariance?: number;
  processorLicensesNeededForUnlicensed?: number;
  nupLicensesRequired?: number;
  nupLicensesAvailable?: number;
  nupLicensesVariance?: number;
  totalCores?: number;
  totalPhysicalCores?: number;
  coreFactor?: number;
  processorCalculationDetails?: string;
  nupCalculationDetails?: string;
  
  // Warnings
  warnings: string[];
  
  // Relations
  instances?: InstanceData[];
  hosts?: HostData[];
};

type SharedHostGroup = {
  physicalHostId: string;
  physicalHostName: string;
  cores: number;
  coreFactor: number;
  sharedProcessorLicenses: number;
  environmentIds: string[];
  environmentNames: string[];
};

type FeatureNeed = {
  feature: string;
  hostNames?: string[];
  environmentNames?: string[];
  requiredHostCount?: number;
  deduplicatedCount?: number;
};

type HostNeed = {
  hostId: string;
  hostName: string;
  licensingUnitType: string;
  environmentNames: string[];
  editions: string[];
  effectiveEditions: string[];
  processorRequired: number;
  status: 'partial' | 'non-compliant';
};

type LicensePurchaseSummary = {
  allCompliant: boolean;
  totalProcessorNeeded: number;
  sharedHostDeduction: number;
  deduplicatedProcessorNeeded: number;
  hostNeeds?: HostNeed[];
  featureNeeds?: FeatureNeed[];
};

type MatrixViewResponse = {
  environments: EnvironmentData[];
  sharedHostGroups: SharedHostGroup[];
  licensePurchaseSummary: LicensePurchaseSummary;
};

type SelectedFeatureData = {
  featureName: string;
  environmentName: string;
  environmentId: string;
  feature: FeatureData;
  status: FeatureStatus;
  environment: EnvironmentData;
};

const hasWarnings = (env: EnvironmentData): boolean => {
  return env.warnings.length > 0;
};

const hasNoInstances = (env: EnvironmentData): boolean => {
  return !env.instances || env.instances.length === 0;
};

// Helper function to format structured host details
const formatStructuredHostDetails = (hostDetails: ComplianceHostDetail[]) => {
  if (!hostDetails || hostDetails.length === 0) {
    return <div className="text-gray-500 italic">No detailed host information available</div>;
  }

  return (
    <div className="space-y-4">
      <div className="text-sm font-semibold text-blue-900 mb-3">Host-by-Host Breakdown:</div>
      
      {hostDetails.map((host, index) => (
        <div key={host.id} className="border border-blue-200 rounded-lg p-3 bg-white">
          <div className="font-medium text-blue-900 mb-2 flex items-center justify-between">
            <span>🖥️ {host.hostName}</span>
            <span className="text-xs text-blue-700 bg-blue-100 px-2 py-1 rounded">
              {host.serverType}
            </span>
          </div>
          
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-600">Total Cores:</span>
                <span className="font-medium">{host.totalCores}</span>
              </div>
              {host.physicalCores && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Physical Cores:</span>
                  <span className="font-medium">{host.physicalCores}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-600">Core Factor:</span>
                <span className="font-medium">{host.coreFactor}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Has Partitioning:</span>
                <span className={`font-medium ${host.hasHardPartitioning ? 'text-green-600' : 'text-gray-500'}`}>
                  {host.hasHardPartitioning ? 'Yes' : 'No'}
                </span>
              </div>
            </div>
            
            <div className="space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-600">Licenses Required:</span>
                <span className="font-medium">{host.processorLicensesRequired}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Licensed Cores:</span>
                <span className={`font-medium ${host.licensedCores > 0 ? 'text-green-600' : 'text-gray-500'}`}>
                  {host.licensedCores}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Unlicensed Cores:</span>
                <span className={`font-medium ${host.unlicensedCores > 0 ? 'text-red-600' : 'text-gray-500'}`}>
                  {host.unlicensedCores}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">License Status:</span>
                <span className={`font-medium text-xs px-2 py-1 rounded ${
                  host.licenseStatus === 'compliant' ? 'bg-green-100 text-green-700' :
                  host.licenseStatus === 'partial' ? 'bg-yellow-100 text-yellow-700' :
                  'bg-red-100 text-red-700'
                }`}>
                  {host.licenseStatus}
                </span>
              </div>
            </div>
          </div>
        </div>
      ))}
      
      {hostDetails.length > 1 && (
        <div className="border-t border-blue-200 pt-3 mt-4">
          <div className="text-sm font-semibold text-blue-900 mb-2">Summary:</div>
          <div className="text-xs text-blue-800 space-y-1">
            <div>Total hosts analyzed: <span className="font-medium">{hostDetails.length}</span></div>
            <div>Total licensed cores: <span className="font-medium text-green-600">
              {hostDetails.reduce((sum, host) => sum + host.licensedCores, 0)}
            </span></div>
            <div>Total unlicensed cores: <span className="font-medium text-red-600">
              {hostDetails.reduce((sum, host) => sum + host.unlicensedCores, 0)}
            </span></div>
          </div>
        </div>
      )}
    </div>
  );
};

// Helper function to format calculation details in a user-friendly way
const formatCalculationDetails = (calculationDetailsJson: string) => {
  try {
    const details = JSON.parse(calculationDetailsJson);
    
    if (!Array.isArray(details) || details.length === 0) {
      return <div className="text-gray-500 italic">No detailed calculation information available</div>;
    }

    return (
      <div className="space-y-4">
        <div className="text-sm font-semibold text-blue-900 mb-3">Host-by-Host Breakdown:</div>
        
        {details.map((host: any, index: number) => (
          <div key={index} className="border border-blue-200 rounded-lg p-3 bg-white">
            <div className="font-medium text-blue-900 mb-2 flex items-center justify-between">
              <span>🖥️ {host.hostName || host.instanceName || `Host ${index + 1}`}</span>
              <span className="text-xs text-blue-700 bg-blue-100 px-2 py-1 rounded">
                {host.serverType || 'Unknown Type'}
              </span>
            </div>
            
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-600">Cores:</span>
                  <span className="font-medium">{host.cores || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Sockets:</span>
                  <span className="font-medium">{host.sockets || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Core Factor:</span>
                  <span className="font-medium">{host.coreFactor || 'N/A'}</span>
                </div>
              </div>
              
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-600">Licenses Required:</span>
                  <span className="font-medium">{host.processorLicensesRequired || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Has Partitioning:</span>
                  <span className={`font-medium ${host.hasHardPartitioning ? 'text-green-600' : 'text-gray-500'}`}>
                    {host.hasHardPartitioning ? 'Yes' : 'No'}
                  </span>
                </div>
                {host.processorCalculationDetails && (
                  <div className="text-xs text-gray-500 mt-1 italic">
                    {host.processorCalculationDetails}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
        
        {details.length > 1 && (
          <div className="border-t border-blue-200 pt-3 mt-4">
            <div className="text-sm font-semibold text-blue-900 mb-2">Summary:</div>
            <div className="text-xs text-blue-800">
              Total hosts analyzed: <span className="font-medium">{details.length}</span>
            </div>
          </div>
        )}
      </div>
    );
  } catch (error) {
    // Fallback to showing the raw text if JSON parsing fails
    return (
      <div className="space-y-2">
        <div className="text-sm font-semibold text-blue-900 mb-2">Calculation Details:</div>
        <div className="text-xs text-blue-800 leading-relaxed whitespace-pre-wrap">
          {calculationDetailsJson}
        </div>
      </div>
    );
  }
};

const MatrixView: React.FC = () => {
  const queryClient = useQueryClient();
  const selectedCustomerId = useSelectedCustomerId();
  const [activeTab, setActiveTab] = useState('features'); // Default to features tab
  const [selectedFeature, setSelectedFeature] = useState<SelectedFeatureData | null>(null);
  const [isCalculationDetailsOpen, setIsCalculationDetailsOpen] = useState(false);
  const [hideEmptyColumns, setHideEmptyColumns] = useState(false);
  const [filterEdition, setFilterEdition] = useState<string[]>([]);
  const [filterPrimaryUse, setFilterPrimaryUse] = useState<string[]>([]);
  const [filterType, setFilterType] = useState<string[]>([]);
  const [filterVersion, setFilterVersion] = useState<string[]>([]);

  useEffect(() => {
    setSelectedFeature(null);
    setActiveTab('features');
  }, [selectedCustomerId]);

  // Fetch matrix view data
  const { data: matrixData, isLoading, error } = useQuery({
    queryKey: ['compliance', 'matrix', selectedCustomerId],
    queryFn: () => 
      apiClient.post<MatrixViewResponse>('/compliance/matrix-view', { customerId: selectedCustomerId })
        .then(res => res.data),
    enabled: !!selectedCustomerId,
  });

  // Fetch detailed compliance information for dialog
  const { data: complianceDetail, isLoading: isLoadingDetail } = useQuery({
    queryKey: ['compliance', 'detail', selectedFeature?.environmentId],
    queryFn: async () => {
      if (!selectedFeature?.environmentId) return null;
      
      // First get the latest detail ID for this environment
      const latestDetailResponse = await apiClient.get<{ detailId: string }>(
        `/compliance/environment/${selectedFeature.environmentId}/latest-detail`
      );
      
      // Then fetch the detailed compliance information
      const detailResponse = await apiClient.get<ComplianceDetailData>(
        `/compliance/detail/${latestDetailResponse.data.detailId}`
      );
      
      return detailResponse.data;
    },
    enabled: !!selectedFeature?.environmentId,
  });

  // Group all unique products and features
  const allBaseProducts = React.useMemo(() => {
    if (!matrixData?.environments?.length) return [];
    
    const productSet = new Set<string>();
    matrixData.environments.forEach(env => {
      env.baseProducts.forEach(product => {
        productSet.add(product.product);
      });
    });
    
    return Array.from(productSet).sort();
  }, [matrixData]);
  const allFeatures = React.useMemo(() => {
    if (!matrixData?.environments?.length) return [];
    
    const featureSet = new Set<string>();
    matrixData.environments.forEach(env => {
      env.features.forEach(feature => {
        featureSet.add(feature.product);
      });
    });
    
    // Orden personalizado de características - edita esta lista según tus preferencias
    const customOrder = [
      'Tuning',
      'Diagnostics',
      'Real Application Clusters',
      'Partitioning',
      'Advanced Compression',
      'Advanced Security',
      'Multitenant',
      'In-Memory Database',
      'Active Data Guard',
      'Database Vault',
      'OLAP',
      'Label Security',
      'Data Masking and Subsetting',
      // Agrega más características en el orden que prefieras
    ];
    
    // Aplicamos el orden personalizado y luego ordenamos alfabéticamente el resto
    return Array.from(featureSet).sort((a, b) => {
      const indexA = customOrder.indexOf(a);
      const indexB = customOrder.indexOf(b);
      
      // Si ambos elementos están en la lista personalizada, usa ese orden
      if (indexA !== -1 && indexB !== -1) return indexA - indexB;
      
      // Si solo uno está en la lista, ese va primero
      if (indexA !== -1) return -1;
      if (indexB !== -1) return 1;
      
      // Para el resto, usa orden alfabético
      return a.localeCompare(b);
    });
  }, [matrixData]);

  // Compute which features have at least one non-unused status across all environments
  const nonEmptyFeatures = React.useMemo(() => {
    if (!matrixData?.environments?.length) return new Set<string>();
    const used = new Set<string>();
    for (const env of matrixData.environments) {
      for (const feature of env.features) {
        if (feature.status !== 'unused') {
          used.add(feature.product);
        }
      }
    }
    return used;
  }, [matrixData]);

  // Features to display (all or only non-empty)
  const visibleFeatures = React.useMemo(() => {
    if (!hideEmptyColumns) return allFeatures;
    return allFeatures.filter(f => nonEmptyFeatures.has(f));
  }, [allFeatures, nonEmptyFeatures, hideEmptyColumns]);

  // Filter options derived from data
  const filterOptions = React.useMemo(() => {
    if (!matrixData?.environments?.length) return { editions: [], primaryUses: [], types: [], versions: [] };
    const editions = new Set<string>();
    const primaryUses = new Set<string>();
    const types = new Set<string>();
    const versions = new Set<string>();
    for (const env of matrixData.environments) {
      if (env.edition) editions.add(env.edition);
      if (env.primaryUse) primaryUses.add(env.primaryUse);
      if (env.type) types.add(env.type);
      if (env.version) versions.add(env.version);
    }
    return {
      editions: Array.from(editions).sort(),
      primaryUses: Array.from(primaryUses).sort(),
      types: Array.from(types).sort(),
      versions: Array.from(versions).sort((a, b) => Number(a) - Number(b)),
    };
  }, [matrixData]);

  // Filtered environments
  const filteredEnvironments = React.useMemo(() => {
    if (!matrixData?.environments) return [];
    return matrixData.environments.filter(env => {
      if (filterEdition.length > 0 && !filterEdition.includes(env.edition)) return false;
      if (filterPrimaryUse.length > 0 && (!env.primaryUse || !filterPrimaryUse.includes(env.primaryUse))) return false;
      if (filterType.length > 0 && !filterType.includes(env.type)) return false;
      if (filterVersion.length > 0 && !filterVersion.includes(env.version)) return false;
      return true;
    });
  }, [matrixData, filterEdition, filterPrimaryUse, filterType, filterVersion]);

  const hasActiveFilters = filterEdition.length > 0 || filterPrimaryUse.length > 0 || filterType.length > 0 || filterVersion.length > 0;

  // Render status cell with appropriate icon
  const renderStatusCell = (
    status: FeatureStatus | BaseProductStatus,
    featureName: string,
    environment: EnvironmentData,
    feature: FeatureData
  ) => {
    const handleFeatureClick = () => {
      setSelectedFeature({
        featureName,
        environmentName: environment.name,
        environmentId: environment.id,
        feature,
        status,
        environment
      });
    };

    const iconElement = (() => {
      switch (status) {
        case 'licensed':
          return <CheckCircle className="h-6 w-6 text-green-500" />;
        case 'used':
          return <XCircle className="h-6 w-6 text-red-500" />;
        case 'both':
          return <CheckCircle className="h-6 w-6 text-green-500" />;
        case 'unlicensed':
          return <XCircle className="h-6 w-6 text-red-500" />;
        case 'unused':
          return <Circle className="h-6 w-6 text-gray-200" />;
        case 'enterprise-required':
          return <AlertCircle className="h-6 w-6 text-red-500" />;
        default:
          return null;
      }
    })();

    const tooltipText = (() => {
      switch (status) {
        case 'licensed': return 'Licensed';
        case 'used': return 'Used but not licensed';
        case 'both': return 'Used and licensed';
        case 'unlicensed': return 'Not licensed';
        case 'unused': return 'Unused';
        case 'enterprise-required': return 'Enterprise Edition Required';
        default: return '';
      }
    })();    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div 
              className="flex items-center justify-center cursor-pointer hover:bg-gray-50 rounded p-1 transition-colors"
              onClick={handleFeatureClick}
            >
              {iconElement}
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>{tooltipText}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-muted-foreground mt-2">Loading license matrix...</p>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="mb-4 border-destructive">
        <CardHeader>
          <CardTitle className="flex items-center text-destructive">
            <AlertCircle className="h-5 w-5 mr-2" />
            Error Loading Matrix View
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p>Failed to load license matrix data. Please try again.</p>
        </CardContent>
        <CardFooter>
          <Button 
            variant="outline"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['compliance', 'matrix'] })}
          >
            Retry
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (!matrixData?.environments || matrixData.environments.length === 0) {
    return (
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center">
            <AlertCircle className="h-5 w-5 mr-2" />
            No Data Available
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p>No environments or license data available to display in the matrix view.</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-2">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 mb-4 md:grid-cols-5">
        <Card className="bg-slate-50 shadow-sm">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold">{matrixData?.environments?.length || 0}</div>
            <div className="text-sm text-muted-foreground">Total Environments</div>
          </CardContent>
        </Card>
        <Card className="bg-green-50 shadow-sm">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-green-700">
              {matrixData?.environments?.filter(env => env.complianceStatus === 'compliant').length || 0}
            </div>
            <div className="text-sm text-green-600">Compliant</div>
          </CardContent>
        </Card>
        <Card className="bg-red-50 shadow-sm">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-red-700">
              {matrixData?.environments?.filter(env => env.complianceStatus === 'non-compliant').length || 0}
            </div>
            <div className="text-sm text-red-600">Non-Compliant</div>
          </CardContent>
        </Card>
        <Card className="bg-amber-50 shadow-sm">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-amber-700">
              {matrixData?.environments?.filter(env => env.complianceStatus === 'warning').length || 0}
            </div>
            <div className="text-sm text-amber-600">Warning</div>
          </CardContent>
        </Card>
        <Card className="bg-yellow-50 shadow-sm">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-yellow-700">
              {matrixData?.environments?.filter(env => env.complianceStatus === 'unknown').length || 0}
            </div>
            <div className="text-sm text-yellow-700">Unknown</div>
          </CardContent>
        </Card>
      </div>
      <Card className="w-full">
        <CardHeader className="py-3">
          <div className="flex items-center justify-between">
            <CardTitle>License Matrix</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setHideEmptyColumns(!hideEmptyColumns)}
              className="text-xs"
            >
              {hideEmptyColumns ? (
                <><Eye className="h-3.5 w-3.5 mr-1.5" />Show All Columns</>
              ) : (
                <><EyeOff className="h-3.5 w-3.5 mr-1.5" />Hide Empty Columns</>
              )}
            </Button>
          </div>
          <CardDescription className="text-xs text-muted-foreground mt-1">
            <span className="flex items-center">
              <Info className="h-3 w-3 mr-1" /> 
              Virtual hosts with hard partitioning are evaluated based on their assigned cores only, while soft-partitioned VMs use the entire physical host's cores.
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="px-2">
          {/* Filter bar */}
          <div className="mb-3 flex flex-wrap gap-2 items-center p-2 bg-slate-50 rounded-md border text-xs">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <MultiSelectFilter
              label="All Editions"
              options={filterOptions.editions}
              selected={filterEdition}
              onChange={setFilterEdition}
              className="w-[130px]"
            />
            <MultiSelectFilter
              label="All Uses"
              options={filterOptions.primaryUses}
              selected={filterPrimaryUse}
              onChange={setFilterPrimaryUse}
              className="w-[130px]"
            />
            <MultiSelectFilter
              label="All Types"
              options={filterOptions.types}
              selected={filterType}
              onChange={setFilterType}
              className="w-[130px]"
            />
            <MultiSelectFilter
              label="All Versions"
              options={filterOptions.versions}
              selected={filterVersion}
              onChange={setFilterVersion}
              className="w-[120px]"
            />
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-gray-500"
                onClick={() => { setFilterEdition([]); setFilterPrimaryUse([]); setFilterType([]); setFilterVersion([]); }}
              >
                <X className="h-3 w-3 mr-1" />Clear
              </Button>
            )}
            {hasActiveFilters && (
              <span className="text-muted-foreground ml-auto">
                {filteredEnvironments.length} of {matrixData?.environments?.length || 0}
              </span>
            )}
          </div>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">

              <TabsContent value="features" className="w-full overflow-x-auto">
              <Table className="border-collapse">
                <TableHeader className="sticky top-0 z-10">
                  <TableRow>
                    <TableHead className="bg-background sticky left-0 z-20 px-2">Environment</TableHead>
                    <TableHead className="text-center px-2 min-w-[60px] max-w-[80px]">Oracle Database</TableHead>
                    {visibleFeatures.map((feature) => (
                       <TableHead key={feature} className="text-center px-1 min-w-[50px] max-w-[75px] text-xs leading-tight" title={feature}>
                        {feature}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEnvironments.map((env) => (
                    <TableRow key={env.id} className="h-10">
                      <TableCell 
                        className="font-medium bg-background sticky left-0 z-10 max-w-[150px] truncate p-1" 
                        title={env.name}
                      >
                        <div className="space-y-1 text-sm">
                         <div className="flex items-center gap-1">
                           <p className="font-semibold truncate">{env.name}</p>
                           {hasWarnings(env) && (
                             <TooltipProvider>
                               <Tooltip>
                                 <TooltipTrigger asChild>
                                   <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                                 </TooltipTrigger>
                                 <TooltipContent className="max-w-xs">
                                   {env.warnings!.map((w, i) => (
                                     <p key={i} className="text-xs text-amber-600">{w}</p>
                                   ))}
                                 </TooltipContent>
                               </Tooltip>
                             </TooltipProvider>
                           )}
                         </div>
                        </div>
                      </TableCell><TableCell className="text-center p-1">
                          {hasNoInstances(env) ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="flex items-center justify-center">
                                  <AlertTriangle className="h-6 w-6 text-amber-500" />
                                </div>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <div className="space-y-1 text-sm">
                                  <p className="font-semibold text-amber-700">No instances configured</p>
                                  <p>This environment has no instances linked to hosts. Compliance cannot be fully evaluated.</p>
                                  {env.warnings && env.warnings.length > 0 && env.warnings.map((w, i) => (
                                    <p key={i} className="text-xs italic text-amber-600">{w}</p>
                                  ))}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : !env.isCompliant && !env.hasNoLicenses ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="flex items-center justify-center">
                                  <XCircle className="h-6 w-6 text-red-500" />
                                </div>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <div className="space-y-1 text-sm">
                                  <p className="font-semibold">Insufficient processor licenses</p>
                                  <p>Required: {env.processorLicensesRequired}</p>
                                  <p>Available: {env.processorLicensesAvailable}</p>
                                  <p>Variance: {env.processorLicensesVariance}</p>
                                  {hasWarnings(env) && env.warnings!.map((w, i) => (
                                    <p key={i} className="text-xs text-amber-600 mt-1">⚠ {w}</p>
                                  ))}
                                  <p className="text-xs italic mt-1">Note: For virtual machines with hard partitioning, only the assigned cores are counted.</p>
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>                        ) : (
                          <div className="relative inline-flex items-center justify-center">
                          {renderStatusCell(env.baseProductStatus, 'Oracle Database', env, { 
                            product: 'Oracle Database', 
                            licensed: env.baseProducts?.some(p => p.licensed) || false, 
                            used: true, 
                            onlyEnterprise: env.edition?.includes('Enterprise') || false,
                            type: 'Base Product',
                            status: env.baseProductStatus
                          })}
                          {hasWarnings(env) && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <AlertTriangle className="h-3 w-3 text-amber-500 absolute -top-1 -right-1" />
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs">
                                  {env.warnings!.map((w, i) => (
                                    <p key={i} className="text-xs text-amber-600">{w}</p>
                                  ))}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                          </div>
                        )}
                      </TableCell>
                      {visibleFeatures.map((featureName) => {
                        const feature = env.features.find(f => f.product === featureName);
                        if (!feature) {
                          return <TableCell key={`${env.id}-${featureName}`} className="text-center p-1">{renderStatusCell('unused', featureName, env, { 
                            product: featureName, 
                            licensed: false, 
                            used: false, 
                            onlyEnterprise: null,
                            type: null,
                            status: 'unused'
                          })}</TableCell>;
                        }

                        const status = feature.status;
                          return (
                          <TableCell key={`${env.id}-${featureName}`} className="text-center p-1">
                            {renderStatusCell(status, featureName, env, feature)} 
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>
          </Tabs>
        </CardContent>
        <CardFooter className="flex justify-between border-t py-2 px-3">
          <div>
            <span className="text-xs text-gray-500">Legend: </span>
            <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1">
              <div className="flex items-center">
                <CheckCircle className="h-5 w-5 text-green-500 mr-1" />
                <span className="text-xs">Licensed</span>
              </div>
              <div className="flex items-center">
                <XCircle className="h-5 w-5 text-red-500 mr-1" />
                <span className="text-xs">Not Licensed</span>
              </div>
              <div className="flex items-center">
                <Circle className="h-5 w-5 text-gray-200 mr-1" />
                <span className="text-xs">Unused</span>
              </div>
              <div className="flex items-center">
                <AlertCircle className="h-5 w-5 text-red-500 mr-1" />
                <span className="text-xs">Enterprise Exclusive</span>
              </div>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['compliance', 'matrix'] })}
          >
            Refresh
          </Button>
        </CardFooter>
      </Card>

      {/* License Purchase Summary */}
      {matrixData?.environments && matrixData.environments.length > 0 && (() => {
        const summary = matrixData.licensePurchaseSummary;
        
        const envSummaries = matrixData.environments
          .filter(env => !hasNoInstances(env))
          .map(env => ({
            id: env.id,
            name: env.name,
            processorNeeded: env.processorNeeded,
            processorRequired: env.processorLicensesRequired ?? 0,
          }));
        const hostNeeds = Array.isArray(summary.hostNeeds) ? summary.hostNeeds : [];
        const featureNeeds = Array.isArray(summary.featureNeeds)
          ? summary.featureNeeds.map((need) => ({
              ...need,
              hostNames: Array.isArray(need.hostNames) ? need.hostNames : [],
              environmentNames: Array.isArray(need.environmentNames) ? need.environmentNames : [],
              requiredHostCount: typeof need.requiredHostCount === 'number'
                ? need.requiredHostCount
                : typeof need.deduplicatedCount === 'number'
                  ? need.deduplicatedCount
                  : Array.isArray(need.hostNames)
                    ? need.hostNames.length
                    : 0,
            }))
          : [];
        const totalProcessorNeeded = summary.totalProcessorNeeded ?? 0;
        const deduplicatedProcessorNeeded = summary.deduplicatedProcessorNeeded ?? 0;
        const sharedHostDeduction = summary.sharedHostDeduction ?? 0;
        const allCompliant = summary.allCompliant ?? false;
        
        // Build shared host notes for tooltips
        const sharedGroups = matrixData.sharedHostGroups;
        const sharedHostNotes: Array<{ hostName: string, envNames: string[], sharedLicenses: number, savedLicenses: number }> = [];
        if (sharedHostDeduction > 0) {
          for (const group of sharedGroups) {
            const envsInGroup = envSummaries.filter(e => group.environmentIds.includes(e.id));
            const individualSum = envsInGroup.reduce((s, e) => s + Math.ceil(e.processorRequired), 0);
            const sharedLicenses = Math.ceil(group.sharedProcessorLicenses);
            const saved = individualSum - sharedLicenses;
            if (saved > 0) {
              sharedHostNotes.push({ hostName: group.physicalHostName, envNames: group.environmentNames, sharedLicenses, savedLicenses: saved });
            }
          }
        }
        
        const totalNonCompliantHosts = hostNeeds.length;

        return (
          <Card className="mt-4">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                {allCompliant ? (
                  <CheckCircle className="h-5 w-5 text-green-500" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                )}
                License Purchase Summary
              </CardTitle>
              <CardDescription>
                {allCompliant
                  ? 'All environments and features are properly licensed.'
                  : `${totalNonCompliantHosts} host(s) and ${featureNeeds.length} feature(s)/option(s) require licensing.`}
              </CardDescription>
            </CardHeader>
            {!allCompliant && (
              <CardContent className="space-y-4">
                {/* Oracle Database Base Licenses */}
                {hostNeeds.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2 flex items-center gap-1">
                      <Database className="h-4 w-4" />
                      Oracle Database Licenses Required
                    </h4>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Host</TableHead>
                          <TableHead>Licensing Unit</TableHead>
                          <TableHead>Related Environments</TableHead>
                          <TableHead>Effective Edition</TableHead>
                          <TableHead className="text-right">Processor Lic. Required</TableHead>
                          <TableHead className="text-right">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {hostNeeds.map((hostNeed) => (
                          <TableRow key={hostNeed.hostId}>
                            <TableCell className="font-medium">{hostNeed.hostName}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">{hostNeed.licensingUnitType}</Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {hostNeed.environmentNames.map((environmentName) => (
                                  <Badge key={environmentName} variant="outline" className="text-xs">{environmentName}</Badge>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell>
                              {hostNeed.effectiveEditions.length === 1 && hostNeed.editions.length === 1 && hostNeed.effectiveEditions[0] !== hostNeed.editions[0] ? (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <div className="flex items-center gap-1">
                                        <Badge variant="outline" className="text-xs bg-amber-50 border-amber-300 text-amber-800">{hostNeed.effectiveEditions[0]}</Badge>
                                        <AlertTriangle className="h-3 w-3 text-amber-500" />
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-xs">
                                      <p className="text-xs">At least one related environment escalates this host from {hostNeed.editions[0]} to {hostNeed.effectiveEditions[0]} because it uses Enterprise-only features.</p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              ) : (
                                <div className="flex flex-wrap gap-1">
                                  {hostNeed.effectiveEditions.map((edition) => (
                                    <Badge key={edition} variant="outline" className="text-xs">{edition}</Badge>
                                  ))}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-right">{hostNeed.processorRequired}</TableCell>
                            <TableCell className="text-right">
                              <Badge variant={hostNeed.status === 'non-compliant' ? 'destructive' : 'outline'} className="text-xs">
                                {hostNeed.status === 'non-compliant' ? 'Not Licensed' : 'Partially Licensed'}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                        {hostNeeds.length > 0 && (
                          <TableRow className="bg-muted/50 font-semibold">
                            <TableCell colSpan={5} className="text-right">Total Processor Licenses to Purchase:</TableCell>
                            <TableCell className="text-right text-red-600">
                              {sharedHostNotes.length > 0 ? (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="cursor-help border-b border-dashed border-red-400">
                                        {deduplicatedProcessorNeeded}
                                        {deduplicatedProcessorNeeded !== totalProcessorNeeded && (
                                          <span className="text-xs text-muted-foreground ml-1 line-through">{totalProcessorNeeded}</span>
                                        )}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-sm">
                                      <div className="space-y-1 text-xs">
                                        <p className="font-semibold">Shared host deduplication applied:</p>
                                        {sharedHostNotes.map((note, i) => (
                                          <p key={i}>
                                            Host "{note.hostName}" shared by {note.envNames.join(', ')} — 
                                            only {note.sharedLicenses} licenses needed (saved {note.savedLicenses})
                                          </p>
                                        ))}
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              ) : totalProcessorNeeded}
                            </TableCell>
                          </TableRow>
                        )}
                        {sharedHostNotes.length > 0 && (
                          <TableRow className="bg-blue-50">
                            <TableCell colSpan={6} className="text-xs text-blue-700">
                              <div className="flex items-center gap-1">
                                <Info className="h-3 w-3" />
                                Shared hosts detected: environments on the same physical server share licenses.
                                {sharedHostNotes.map((note, i) => (
                                  <span key={i} className="ml-1">
                                    "{note.hostName}" ({note.envNames.join(' & ')}) = {note.sharedLicenses} lic.
                                  </span>
                                ))}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {/* Feature / Option Licenses */}
                {featureNeeds.length > 0 && (
                  <div>
                    <Separator className="my-2" />
                    <h4 className="text-sm font-semibold mb-2 flex items-center gap-1">
                      <AlertCircle className="h-4 w-4 text-red-500" />
                      Feature &amp; Option Pack Licenses Required
                    </h4>
                    <p className="text-xs text-muted-foreground mb-2">
                      Oracle options/features are licensed per Processor (or NUP), same as the base database.
                      When multiple environments share a physical host, the feature only needs to be licensed once for that host.
                    </p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Feature / Option</TableHead>
                          <TableHead>Used In Hosts</TableHead>
                          <TableHead className="text-right">Hosts Requiring License</TableHead>
                          <TableHead className="text-right">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {featureNeeds
                          .sort((a, b) => a.feature.localeCompare(b.feature))
                          .map((need) => (
                              <TableRow key={need.feature}>
                                <TableCell className="font-medium">{need.feature}</TableCell>
                                <TableCell>
                                  <div className="flex flex-wrap gap-1">
                                    {need.hostNames.map(n => (
                                      <Badge key={n} variant="outline" className="text-xs">{n}</Badge>
                                    ))}
                                  </div>
                                </TableCell>
                                <TableCell className="text-right">
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="font-semibold text-red-600 cursor-help border-b border-dashed border-red-400">
                                          {need.requiredHostCount}
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent className="max-w-sm">
                                        <p className="text-xs">Affected environments: {need.environmentNames.join(', ')}</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                </TableCell>
                                <TableCell className="text-right">
                                  <Badge variant="destructive" className="text-xs">Not Licensed</Badge>
                                </TableCell>
                              </TableRow>
                            ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        );
      })()}

      {/* Feature Details Dialog */}
      <Dialog open={!!selectedFeature} onOpenChange={(isOpen) => !isOpen && setSelectedFeature(null)}>
        <DialogContent className="sm:max-w-[900px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              {selectedFeature?.featureName} - {selectedFeature?.environmentName}
              {selectedFeature && (
                <Badge className={
                  selectedFeature.status === 'licensed' || selectedFeature.status === 'both'
                    ? "bg-green-100 text-green-800 hover:bg-green-200"
                    : selectedFeature.status === 'unused'
                    ? "bg-gray-100 text-gray-800 hover:bg-gray-200"
                    : "bg-red-100 text-red-800 hover:bg-red-200"
                }>
                  {selectedFeature.status === 'licensed' ? 'Licensed' :
                   selectedFeature.status === 'used' ? 'Used but not licensed' :
                   selectedFeature.status === 'both' ? 'Used and licensed' :
                   selectedFeature.status === 'unlicensed' ? 'Not licensed' :
                   selectedFeature.status === 'unused' ? 'Unused' :
                   selectedFeature.status === 'enterprise-required' ? 'Enterprise Required' :
                   selectedFeature.status}
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground mt-1">
              Oracle Database feature compliance details
            </DialogDescription>
          </DialogHeader>
          
          {/* Feature compliance details */}
          <div className="space-y-6 pt-2">
            {/* Basic feature information */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h4 className="text-sm font-semibold mb-2">Feature Details</h4>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Feature:</span>
                    <span>{selectedFeature?.featureName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Type:</span>
                    <span>{selectedFeature?.feature?.type || 'Standard'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Edition Required:</span>
                    <span>{selectedFeature?.feature?.onlyEnterprise ? 'Enterprise' : 'Standard or Enterprise'}</span>
                  </div>
                </div>
              </div>
              
              <div>
                <h4 className="text-sm font-semibold mb-2">Environment Details</h4>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Environment:</span>
                    <span>{selectedFeature?.environmentName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Edition:</span>
                    <span>{selectedFeature?.environment?.edition}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Version:</span>
                    <span>{selectedFeature?.environment?.version}</span>
                  </div>
                </div>
              </div>
            </div>
              {/* Core Licensing Information */}
            <div className="border rounded-md p-4">
              <h4 className="text-sm font-semibold mb-3 flex items-center">
                <Info className="h-4 w-4 mr-2" />
                Core Licensing Details
              </h4>
                <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Total Cores:</span>
                    <span className="text-sm font-medium">
                      {complianceDetail?.totalCores ?? selectedFeature?.environment?.totalCores ?? 'N/A'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Physical Cores:</span>
                    <span className="text-sm font-medium">
                      {complianceDetail?.totalPhysicalCores ?? selectedFeature?.environment?.totalPhysicalCores ?? 'N/A'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Core Factor:</span>
                    <span className="text-sm font-medium">
                      {complianceDetail?.coreFactor ?? selectedFeature?.environment?.coreFactor ?? 'N/A'}
                    </span>
                  </div>
                </div>
                
                <div className="space-y-2">                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Licenses Required:</span>
                    <span className="text-sm font-medium">
                      {complianceDetail?.processorLicensesNeededForUnlicensed ?? selectedFeature?.environment?.processorLicensesNeededForUnlicensed ?? 'N/A'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Licenses Available:</span>
                    <span className="text-sm font-medium">
                      {complianceDetail?.processorLicensesAvailable ?? selectedFeature?.environment?.processorLicensesAvailable ?? 'N/A'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">License Variance:</span>
                    {(() => {
                      const needed = complianceDetail?.processorLicensesNeededForUnlicensed ?? selectedFeature?.environment?.processorLicensesNeededForUnlicensed;
                      const available = complianceDetail?.processorLicensesAvailable ?? selectedFeature?.environment?.processorLicensesAvailable;
                      if (needed !== undefined && needed !== null && available !== undefined && available !== null) {
                        const variance = available - needed;
                        return (
                          <span className={`text-sm font-medium ${variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {(variance >= 0 ? '+' : '') + variance}
                          </span>
                        );
                      }
                      return <span className="text-sm font-medium">N/A</span>;
                    })()}
                  </div>
                </div>
              </div>              {/* Host details section - Use structured data if available, fallback to JSON parsing */}
              {(complianceDetail?.hostDetails && complianceDetail.hostDetails.length > 0) || 
               selectedFeature?.environment?.processorCalculationDetails ? (
                <div className="mt-4 border-t pt-3">
                  <Collapsible open={isCalculationDetailsOpen} onOpenChange={setIsCalculationDetailsOpen}>
                    <CollapsibleTrigger asChild>
                      <button className="flex items-center justify-between w-full text-left hover:bg-gray-50 rounded-md p-2 transition-colors">
                        <h5 className="text-xs font-semibold text-gray-700 flex items-center">
                          <Info className="h-3 w-3 mr-1" />
                          Detailed Host Analysis
                          {isLoadingDetail && <Loader2 className="h-3 w-3 ml-2 animate-spin" />}
                        </h5>
                        <ChevronDown className={`h-4 w-4 text-gray-500 transition-transform ${isCalculationDetailsOpen ? 'rotate-180' : ''}`} />
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-2">
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                        {complianceDetail?.hostDetails && complianceDetail.hostDetails.length > 0 ? (
                          formatStructuredHostDetails(complianceDetail.hostDetails)
                        ) : selectedFeature?.environment?.processorCalculationDetails ? (
                          formatCalculationDetails(selectedFeature.environment.processorCalculationDetails)
                        ) : (
                          <div className="text-gray-500 italic">No detailed host information available</div>
                        )}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              ) : null}
            </div>

            {/* Feature status information */}
            <div className="border rounded-md p-4">
              <h4 className="text-sm font-semibold mb-3 flex items-center">
                <Info className="h-4 w-4 mr-2" />
                Feature Compliance Status
              </h4>
              
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Is Used:</span>
                  <Badge variant={selectedFeature?.feature?.used ? "destructive" : "secondary"}>
                    {selectedFeature?.feature?.used ? "Yes" : "No"}
                  </Badge>
                </div>
                
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Is Licensed:</span>
                  <Badge variant={selectedFeature?.feature?.licensed ? "default" : "destructive"}>
                    {selectedFeature?.feature?.licensed ? "Yes" : "No"}
                  </Badge>
                </div>
                
                {selectedFeature?.feature?.onlyEnterprise && (
                  <div className="bg-amber-50 border border-amber-200 rounded-md p-3">
                    <p className="text-xs text-amber-800 flex items-center">
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      This feature requires Enterprise Edition
                      {selectedFeature.environment?.edition && !selectedFeature.environment.edition.includes('Enterprise') && 
                        " but this environment is running " + selectedFeature.environment.edition}
                    </p>
                  </div>
                )}
                
                {selectedFeature?.status === 'used' && (
                  <div className="bg-red-50 border border-red-200 rounded-md p-3">
                    <p className="text-xs text-red-800 flex items-center">
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      This feature is being used but is not properly licensed. You may need to purchase additional licenses.
                    </p>
                  </div>
                )}
                
                {selectedFeature?.status === 'enterprise-required' && (
                  <div className="bg-red-50 border border-red-200 rounded-md p-3">
                    <p className="text-xs text-red-800 flex items-center">
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      This feature requires Enterprise Edition but the environment is running {selectedFeature.environment?.edition}. 
                      Consider upgrading to Enterprise Edition or discontinuing use of this feature.
                    </p>
                  </div>
                )}
                
                {selectedFeature?.status === 'both' && (
                  <div className="bg-green-50 border border-green-200 rounded-md p-3">
                    <p className="text-xs text-green-800 flex items-center">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      This feature is properly licensed and compliant.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <DialogFooter className="flex flex-col sm:flex-row justify-between items-center gap-4 border-t pt-4">
            <DialogClose asChild>
              <Button type="button" variant="secondary">Close</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>      </Dialog>
    </div>
  );
};

export default MatrixView;
