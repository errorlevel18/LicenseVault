import React, { Suspense, lazy, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useAuth } from '../lib/AuthContext';
import { Loader2, AlertCircle } from 'lucide-react';
import { Button } from '../components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import apiClient from '../lib/apiClient';
import { useSelectedCustomerId } from '@/hooks/use-selected-customer';
import { toast } from '../hooks/use-toast';

const MatrixView = lazy(() => import('../components/compliance/MatrixView'));

type ComplianceSummary = {
  runId: string;
  runDate: string;
  totalEnvironments: number;
  compliant: number;
  nonCompliant: number;
  warning: number;
  unknown: number;
  hasComplianceData: boolean;
  message?: string;
  nonCompliantEnvironments?: Array<{
    detailId: string;
    environmentId: string;
    environmentName: string;
    status: string;
    processorLicensesVariance: number;
    nupLicensesVariance: number;
  }>;
};

type ComplianceRun = {
  id: string;
  customerId: string;
  runDate: string;
  status: string;
  summaryTotalEnvironments: number;
  summaryCompliant: number;
  summaryNonCompliant: number;
  summaryWarning: number;
  summaryUnknown: number;
};

function getComplianceErrorMessage(error: unknown, fallback: string) {
  if (isAxiosError(error)) {
    const apiMessage = error.response?.data?.error || error.response?.data?.message;
    if (typeof apiMessage === 'string' && apiMessage.trim().length > 0) {
      return apiMessage;
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

function ComplianceTabFallback({ label }: { label: string }) {
  return (
    <div className="flex h-40 items-center justify-center text-muted-foreground">
      <Loader2 className="mr-2 h-5 w-5 animate-spin text-primary" />
      <span>Cargando {label}...</span>
    </div>
  );
}

const CompliancePage: React.FC = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('matrix');
  const selectedCustomerId = useSelectedCustomerId();

  const {
    data: dashboardData,
    isLoading: isDashboardLoading,
    error: dashboardError,
  } = useQuery({
    queryKey: ['compliance', 'dashboard', selectedCustomerId],
    queryFn: () => 
      apiClient.get<ComplianceSummary>(`/compliance/dashboard/${selectedCustomerId}`).then(res => res.data),
    enabled: !!selectedCustomerId,
  });

  const {
    data: runsData,
    isLoading: isRunsLoading,
    error: runsError,
  } = useQuery({
    queryKey: ['compliance', 'runs', selectedCustomerId],
    queryFn: () => 
      apiClient.get<ComplianceRun[]>(`/compliance/customer/${selectedCustomerId}`).then(res => res.data),
    enabled: !!selectedCustomerId,
  });

  const { data: environments = [], isLoading: isEnvironmentsLoading } = useQuery({
    queryKey: ['environments', selectedCustomerId],
    queryFn: () => selectedCustomerId ? 
      apiClient.get(`/environments?customerId=${selectedCustomerId}`).then(res => res.data) : Promise.resolve([]),
    enabled: !!selectedCustomerId,
  });

  const runComplianceMutation = useMutation({
    mutationFn: () => {
      if (!selectedCustomerId) {
        return Promise.reject(new Error('No customer selected'));
      }
      return apiClient.post('/compliance/run', { customerId: selectedCustomerId }).then(res => res.data);
    },
    onSuccess: (data) => {
      setActiveTab('matrix');
      queryClient.invalidateQueries({ queryKey: ['compliance', 'dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['compliance', 'runs'] });
      queryClient.invalidateQueries({ queryKey: ['compliance', 'matrix', selectedCustomerId] });
      toast({
        title: 'Compliance Analysis Complete',
        description: `Analyzed ${data.summary.totalEnvironments} environments.`,
        variant: 'default',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error running compliance analysis',
        description: error.message || 'An unexpected error occurred',
        variant: 'destructive',
      });
    },
  });
  
  const eraseComplianceMutation = useMutation({
    mutationFn: () => {
      if (!selectedCustomerId) {
        return Promise.reject(new Error('No customer selected'));
      }
      return apiClient.post('/compliance/erase-data', { customerId: selectedCustomerId }).then(res => res.data);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['compliance'] });
      queryClient.invalidateQueries({ queryKey: ['compliance', 'matrix', selectedCustomerId] });
      toast({
        title: 'Compliance Data Erased',
        description: `Successfully removed ${data.deletedRuns} analysis runs.`,
        variant: 'default',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error erasing compliance data',
        description: error.message || 'An unexpected error occurred',
        variant: 'destructive',
      });
    },
  });
  const handleRunCompliance = () => {
    if (!selectedCustomerId) {
      toast({
        title: 'Error',
        description: 'No customer selected',
        variant: 'destructive',
      });
      return;
    }
  
    if (!environments || environments.length === 0) {
      toast({
        title: 'No environments found',
        description: 'Please configure at least one environment before running a compliance analysis.',
        variant: 'destructive',
      });
      return;
    }
  
    runComplianceMutation.mutate();
  };
  
  const handleEraseCompliance = () => {
    if (window.confirm('¿Está seguro que desea borrar todos los análisis de conformidad? Esta acción no se puede deshacer.')) {
      eraseComplianceMutation.mutate();
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  if (!selectedCustomerId && user?.role === 'admin') {
    return (
      <div className="container mx-auto px-4 py-8">
        <Alert>
          <AlertTitle>Select a customer first</AlertTitle>
          <AlertDescription>
            Compliance analysis runs per customer. Choose a customer from the sidebar to load dashboards, history and matrix results.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (isDashboardLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2">Loading compliance data...</span>
      </div>
    );
  }

  if (dashboardError || runsError) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Alert variant="destructive">
          <AlertTitle>Could not load compliance data</AlertTitle>
          <AlertDescription>
            {getComplianceErrorMessage(dashboardError || runsError, 'An unexpected error occurred while loading compliance data.')}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Render empty state if no compliance data is available
  if (!dashboardData?.hasComplianceData && !isRunsLoading && !runsData?.length) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle>Oracle License Compliance</CardTitle>
            <CardDescription>
              Analyze your Oracle databases for license compliance
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center py-8">
            <div className="flex flex-col items-center justify-center space-y-4">
              <AlertCircle className="h-16 w-16 text-gray-400" />
              <h3 className="text-lg font-medium">No Compliance Data Available</h3>
              <p className="text-sm text-gray-500 max-w-md">
                Run your first compliance analysis to check if your Oracle database environments
                are properly licensed according to your contracts.
              </p>              <Button 
                onClick={handleRunCompliance}
                disabled={runComplianceMutation.isPending || !environments?.length || isEnvironmentsLoading}
                className="mt-4"
                title={!environments?.length ? "Please configure at least one environment before running a compliance analysis" : undefined}
              >
                {runComplianceMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 
                    Running Analysis...
                  </>
                ) : 'Run Compliance Analysis'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }
  return (
    <div className="px-2 py-2 min-w-0 overflow-hidden">
      <div className="flex justify-between items-center mb-2">
        <h1 className="text-xl font-bold">Oracle License Compliance</h1>
        <div className="flex space-x-2 items-center">
          <Button
            onClick={handleRunCompliance}
            disabled={runComplianceMutation.isPending || !environments?.length || isEnvironmentsLoading}
            size="sm"
            title={!environments?.length ? "Please configure at least one environment before running a compliance analysis" : undefined}
          >
            {runComplianceMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 
                Running Analysis...
              </>
            ) : 'Run New Analysis'}
          </Button>
          <Button 
            onClick={handleEraseCompliance}
            disabled={eraseComplianceMutation.isPending}
            size="sm"
            variant="destructive"
            className="bg-red-100 text-red-800 hover:bg-red-200"
          >
            {eraseComplianceMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 
                Erasing...
              </>
            ) : 'Erase All Analysis'}
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="matrix">Matrix</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        {/* History Tab */}
        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>Compliance Analysis History</CardTitle>
              <CardDescription>
                Previous compliance analysis runs
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isRunsLoading ? (
                <div className="flex h-24 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  <span className="ml-2">Loading history...</span>
                </div>
              ) : runsData && runsData.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Total Environments</TableHead>
                      <TableHead>Compliant</TableHead>
                      <TableHead>Non-Compliant</TableHead>
                      <TableHead>Warning/Unknown</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runsData.map((run) => (
                      <TableRow key={run.id}>
                        <TableCell className="font-medium">{formatDate(run.runDate)}</TableCell>
                        <TableCell>{run.summaryTotalEnvironments}</TableCell>
                        <TableCell className="text-green-600">{run.summaryCompliant}</TableCell>
                        <TableCell className="text-red-600">{run.summaryNonCompliant}</TableCell>
                        <TableCell>{run.summaryWarning + run.summaryUnknown}</TableCell>
                        <TableCell className="text-right">
                          <Button 
                            variant="outline"
                            size="sm"
                            onClick={() => setActiveTab('matrix')}
                          >
                            Open Matrix
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-6">
                  <p>No compliance analysis history available.</p>
                </div>
              )}
            </CardContent>
            <CardFooter className="flex justify-end">
              <Button onClick={handleRunCompliance} disabled={runComplianceMutation.isPending}>
                {runComplianceMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 
                    Running Analysis...
                  </>
                ) : 'Run New Analysis'}
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        {/* Matrix View Tab */}
        <TabsContent value="matrix">
          <Suspense fallback={<ComplianceTabFallback label="la matriz de compliance" />}>
            <MatrixView />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default CompliancePage;