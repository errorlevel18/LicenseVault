import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Database, Pencil, Trash2, Plus, AlertTriangle, Copy, Filter, X, Search, ArrowDownUp, ChevronDown, ChevronRight, Users, Loader2, RefreshCw } from "lucide-react";
import { Environment, Host, Customer } from "@/lib/types";
import { storageService } from "@/lib/storageService";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSelectedCustomerId } from "@/hooks/use-selected-customer";
import { useToast } from "@/hooks/use-toast";
import logger from "@/lib/logger";
import React from "react";

// Define filter types
type FilterState = {
  primaryUse: string | null;
  type: string | null;
  edition: string | null;
  customerId: string | null;
};

// Define environment with customer info
interface EnvironmentWithCustomer extends Environment {
  customerName?: string;
  instances: any[];
  pdbs: any[];
  featureStats: any[];
}

const NO_CUSTOMER_FILTER = "__none__";

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

function normalizeEnvironment(environment: Environment, customers: Customer[]): EnvironmentWithCustomer {
  const customer = environment.customerId
    ? customers.find((candidate) => candidate.id === environment.customerId)
    : undefined;

  return {
    ...environment,
    customerName: customer?.name,
    instances: Array.isArray(environment.instances) ? environment.instances : [],
    pdbs: Array.isArray(environment.pdbs) ? environment.pdbs : [],
    featureStats: Array.isArray(environment.featureStats) ? environment.featureStats : [],
  };
}

function getEnvironmentWarnings(environment: EnvironmentWithCustomer) {
  const warnings: string[] = [];

  if (environment.type === "RAC" && environment.instances.length < 2) {
    warnings.push("RAC needs 2+ instances");
  }

  if (environment.type === "RAC One Node" && environment.instances.length !== 2) {
    warnings.push("RAC One Node needs exactly 2 instances");
  }

  if (
    environment.type === "RAC One Node" &&
    environment.instances.length === 2 &&
    !environment.instances.some((instance) => instance.isPrimary === true)
  ) {
    warnings.push("No primary instance defined");
  }

  return warnings;
}

export function EnvironmentList() {
  const { toast } = useToast();
  const selectedCustomerId = useSelectedCustomerId();
  const [environments, setEnvironments] = useState<EnvironmentWithCustomer[]>([]);
  const [filteredEnvironments, setFilteredEnvironments] = useState<EnvironmentWithCustomer[]>([]);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const [environmentToClone, setEnvironmentToClone] = useState<EnvironmentWithCustomer | null>(null);
  const [cloneName, setCloneName] = useState("");
  const [filters, setFilters] = useState<FilterState>({
    primaryUse: null,
    type: null,
    edition: null,
    customerId: null,
  });
  const [showFilters, setShowFilters] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [groupBy, setGroupBy] = useState<string>("none");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isCloning, setIsCloning] = useState(false);
  const [deletingEnvironmentId, setDeletingEnvironmentId] = useState<string | null>(null);

  // Dynamic filter options loaded from reference tables
  const [primaryUseOptions, setPrimaryUseOptions] = useState<string[]>([]);
  const [typeOptions, setTypeOptions] = useState<string[]>([]);
  const [editionOptions, setEditionOptions] = useState<string[]>([]);

  useEffect(() => {
    void loadFilterOptions();
  }, []);

  useEffect(() => {
    setFilters((currentFilters) => ({
      ...currentFilters,
      customerId: null,
    }));
    void loadData(!isLoading);
  }, [selectedCustomerId]);

  const loadFilterOptions = async () => {
    try {
      const [primaryUses, envTypes, editions] = await Promise.all([
        storageService.getPrimaryUses(),
        storageService.getEnvironmentTypes(),
        storageService.getDatabaseEditions(),
      ]);
      setPrimaryUseOptions(primaryUses);
      setTypeOptions(envTypes);
      setEditionOptions(editions);
    } catch (error) {
      logger.error("EnvironmentList: Error loading filter options", error);
      toast({
        title: "Could not load filter options",
        description: "Some filter values could not be loaded. You can still browse environments.",
        variant: "destructive",
      });
    }
  };

  const loadData = async (backgroundRefresh = false) => {
    if (backgroundRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    setLoadError(null);

    try {
      // Get the environments, hosts and customers
      const [selectedCustomer, allEnvironments, allHosts, allCustomers] = await Promise.all([
        storageService.getSelectedCustomer(),
        storageService.getEnvironments(),
        storageService.getHosts(),
        selectedCustomerId ? Promise.resolve([]) : storageService.getCustomers(),
      ]);

      const availableCustomers = selectedCustomer
        ? [selectedCustomer]
        : (Array.isArray(allCustomers) ? allCustomers : []);

      // Ensure allEnvironments is an array before proceeding
      if (!Array.isArray(allEnvironments)) {
        logger.error("EnvironmentList: Expected environments to be an array", allEnvironments);
        setEnvironments([]);
        setFilteredEnvironments([]);
        return;
      }

      const environmentsWithCustomer = allEnvironments.map((env) => normalizeEnvironment(env, availableCustomers));

      setCustomers(availableCustomers);
      setEnvironments(environmentsWithCustomer);
      setFilteredEnvironments(environmentsWithCustomer);
      setHosts(Array.isArray(allHosts) ? allHosts : []);
    } catch (error) {
      const message = getErrorMessage(error, "The environment data could not be loaded.");
      logger.error("EnvironmentList: Error loading data", error);
      setLoadError(message);

      if (!backgroundRefresh) {
        setEnvironments([]);
        setFilteredEnvironments([]);
        setHosts([]);
        setCustomers([]);
      } else {
        toast({
          title: "Refresh failed",
          description: message,
          variant: "destructive",
        });
      }
    } finally {
      if (backgroundRefresh) {
        setIsRefreshing(false);
      } else {
        setIsLoading(false);
      }
    }
  };

  // Apply filters whenever filters or environments change
  useEffect(() => {
    if (!environments || !Array.isArray(environments)) return;
    applyFilters();
  }, [environments, filters, searchTerm]);

  const applyFilters = () => {
    let filtered = [...environments];

    // Apply search term
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(env => 
        env.name.toLowerCase().includes(term) ||
        (env.edition?.toLowerCase().includes(term) || false) ||
        (env.version?.toLowerCase().includes(term) || false) ||
        (env.primaryUse?.toLowerCase().includes(term) || false) ||
        (env.customerName && env.customerName.toLowerCase().includes(term))
      );
    }

    // Apply Primary Use filter
    if (filters.primaryUse) {
      filtered = filtered.filter(env => env.primaryUse === filters.primaryUse);
    }

    // Apply Environment Type filter
    if (filters.type) {
      filtered = filtered.filter(env => env.type === filters.type);
    }

    // Apply Database Edition filter
    if (filters.edition) {
      filtered = filtered.filter(env => env.edition === filters.edition);
    }
    
    // Apply Customer filter
    if (filters.customerId) {
      filtered = filters.customerId === NO_CUSTOMER_FILTER
        ? filtered.filter((env) => !env.customerId)
        : filtered.filter((env) => env.customerId === filters.customerId);
    }

    setFilteredEnvironments(filtered);
  };

  const handleFilterChange = (key: keyof FilterState, value: string | null) => {
    setFilters(prevFilters => ({
      ...prevFilters,
      [key]: value === "all" ? null : value
    }));
  };

  const resetFilters = () => {
    setFilters({
      primaryUse: null,
      type: null,
      edition: null,
      customerId: null
    });
    setSearchTerm("");
    setGroupBy("none");
  };

  const getHostName = (hostId: string): string => {
    const host = hosts.find(h => h.id === hostId);
    return host?.name || 'Unknown Host';
  };

  const handleDeleteEnvironment = async (id: string) => {
    setDeletingEnvironmentId(id);

    try {
      const success = await storageService.deleteEnvironment(id);
      if (success) {
        setEnvironments((currentEnvironments) => currentEnvironments.filter((env) => env.id !== id));
        toast({
          title: "Environment deleted",
          description: "The environment and its related data were removed successfully.",
        });
      }
    } catch (error) {
      const message = getErrorMessage(error, "The environment could not be deleted.");
      logger.error("EnvironmentList: Error deleting environment", error);
      toast({
        title: "Delete failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setDeletingEnvironmentId(null);
    }
  };

  const openCloneDialog = (env: EnvironmentWithCustomer) => {
    setEnvironmentToClone(env);
    setCloneName(`${env.name} (Clone)`); // Default name suggestion
    setCloneDialogOpen(true);
  };

  const closeCloneDialog = () => {
    setCloneDialogOpen(false);
    setEnvironmentToClone(null);
    setCloneName("");
  };

  const handleCloneEnvironment = async () => {
    if (!environmentToClone || !cloneName.trim()) return;

    setIsCloning(true);

    try {
      await storageService.cloneEnvironment(environmentToClone.id, cloneName.trim());
      await loadData(true);
      toast({
        title: "Environment cloned",
        description: `A copy of ${environmentToClone.name} was created successfully.`,
      });
      setCloneDialogOpen(false);
      setEnvironmentToClone(null);
      setCloneName("");
    } catch (error) {
      const message = getErrorMessage(error, "The environment could not be cloned.");
      logger.error("EnvironmentList: Error cloning environment", error);
      toast({
        title: "Clone failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsCloning(false);
    }
  };

  // Format feature status badges
  const getFeatureStatusBadge = (status: string) => {
    switch (status) {
      case 'Licensed':
        return <Badge variant="outline" className="bg-green-100 text-green-800">Licensed</Badge>;
      case 'Not Licensed':
        return <Badge variant="outline" className="bg-red-100 text-red-800">Not Licensed</Badge>;
      default:
        return <Badge variant="outline" className="bg-neutral-100 text-neutral-800">No disponible</Badge>;
    }
  };

  // Group environments by different criteria
  const groupedEnvironments = React.useMemo(() => {
    if (groupBy === 'none') {
      return { 'All Environments': filteredEnvironments };
    }
    
    const grouped: Record<string, EnvironmentWithCustomer[]> = {};
    
    filteredEnvironments.forEach(env => {
      let groupKey: string;
      
      switch(groupBy) {
        case 'edition':
          groupKey = env.edition || 'Unknown Edition';
          break;
        case 'type':
          groupKey = env.type || 'Unknown Type';
          break;
        case 'primaryUse':
          groupKey = env.primaryUse || 'Unknown Use';
          break;
        case 'version':
          groupKey = env.version || 'Unknown Version';
          break;
        case 'customer':
          groupKey = env.customerName || 'No Customer';
          break;
        default:
          groupKey = 'All Environments';
      }
      
      if (!grouped[groupKey]) {
        grouped[groupKey] = [];
      }
      grouped[groupKey].push(env);
    });
    
    return Object.keys(grouped)
      .sort((a, b) => a.localeCompare(b))
      .reduce((acc, key) => {
        acc[key] = grouped[key];
        return acc;
      }, {} as Record<string, EnvironmentWithCustomer[]>);
      
  }, [filteredEnvironments, groupBy]);
  
  // Initialize expanded state for all groups
  useEffect(() => {
    const initialExpandedState: Record<string, boolean> = {};
    Object.keys(groupedEnvironments).forEach(group => {
      initialExpandedState[group] = true; // All groups expanded by default
    });
    setExpandedGroups(initialExpandedState);
  }, [groupBy, searchTerm, filters]);
  
  const toggleGroupExpansion = (group: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [group]: !prev[group]
    }));
  };

  // Calculate metrics for summary cards
  const metrics = React.useMemo(() => {
    const total = environments.length;
    
    const production = environments.filter(env => env.primaryUse === "Production").length;
    const development = environments.filter(env => env.primaryUse === "Development").length;
    const test = environments.filter(env => env.primaryUse === "Test").length;
    
    const standalone = environments.filter(env => env.type === "Standalone").length;
    const rac = environments.filter(env => env.type === "RAC").length;
    
    const enterprise = environments.filter(env => env.edition === "Enterprise").length;
    const standard = environments.filter(env => env.edition === "Standard").length;
    
    const totalInstances = environments.reduce((sum, env) => sum + env.instances.length, 0);
    const totalPDBs = environments.reduce((sum, env) => sum + env.pdbs.length, 0);
    
    return { 
      total, production, development, test, standalone, rac, 
      enterprise, standard, totalInstances, totalPDBs
    };
  }, [environments]);

  if (isLoading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center rounded-lg border bg-white">
        <div className="flex items-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading environments...
        </div>
      </div>
    );
  }

  if (loadError && environments.length === 0) {
    return (
      <Alert variant="destructive" className="bg-white">
        <AlertTitle>Could not load environments</AlertTitle>
        <AlertDescription>
          <div className="space-y-3">
            <p>{loadError}</p>
            <Button variant="outline" size="sm" onClick={() => void loadData()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Database Environments</h2>
        <div className="flex space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadData(true)}
            disabled={isRefreshing}
            className="flex items-center"
          >
            {isRefreshing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Refresh
          </Button>
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center"
          >
            <Filter className="h-4 w-4 mr-2" />
            {showFilters ? "Hide Filters" : "Show Filters"}
          </Button>
          <Link href="/environments/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Environment
            </Button>
          </Link>
        </div>
      </div>

      {loadError && environments.length > 0 && (
        <Alert variant="destructive" className="mb-6 bg-white">
          <AlertTitle>Latest refresh failed</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {/* Metric Cards Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card className="bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Environment Overview</CardTitle>
            <CardDescription>Environment distribution by type</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{metrics.total}</p>
                <p className="text-sm text-muted-foreground">Total environments</p>
              </div>
              <div className="flex flex-col gap-1 text-sm">
                <div className="flex items-center">
                  <Badge variant="outline" className="bg-blue-100 text-blue-800 mr-2">Standalone</Badge>
                  <span>{metrics.standalone}</span>
                </div>
                <div className="flex items-center">
                  <Badge variant="outline" className="bg-purple-100 text-purple-800 mr-2">RAC</Badge>
                  <span>{metrics.rac}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Usage Categories</CardTitle>
            <CardDescription>Environment distribution by purpose</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{metrics.production}</p>
                <p className="text-sm text-muted-foreground">Production environments</p>
              </div>
              <div className="flex flex-col gap-1 text-sm">
                <div className="flex items-center">
                  <Badge variant="outline" className="bg-green-100 text-green-800 mr-2">Development</Badge>
                  <span>{metrics.development}</span>
                </div>
                <div className="flex items-center">
                  <Badge variant="outline" className="bg-yellow-100 text-yellow-800 mr-2">Test</Badge>
                  <span>{metrics.test}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Database Components</CardTitle>
            <CardDescription>Total number of components</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{metrics.totalInstances}</p>
                <p className="text-sm text-muted-foreground">Total instances</p>
              </div>
              <div className="flex flex-col gap-1 text-sm">
                <div className="flex items-center">
                  <span className="font-medium">Enterprise:</span>
                  <span className="ml-2">{metrics.enterprise}</span>
                </div>
                <div className="flex items-center">
                  <span className="font-medium">PDBs:</span>
                  <span className="ml-2">{metrics.totalPDBs}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        
      </div>
      
      {/* Filter and Search Section */}
      {showFilters && (
        <div className="mb-6 flex flex-wrap gap-4 items-center p-4 bg-slate-50 rounded-lg">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search environments..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 w-[250px] bg-white"
            />
          </div>

          <Select value={filters.primaryUse || "all"} onValueChange={(value) => handleFilterChange("primaryUse", value)}>
            <SelectTrigger className="w-40 bg-white">
              <div className="flex items-center">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Primary Use" />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any Primary Use</SelectItem>
              {primaryUseOptions.map((option) => (
                <SelectItem key={option} value={option}>{option}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filters.type || "all"} onValueChange={(value) => handleFilterChange("type", value)}>
            <SelectTrigger className="w-40 bg-white">
              <div className="flex items-center">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Environment Type" />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any Type</SelectItem>
              {typeOptions.map((option) => (
                <SelectItem key={option} value={option}>{option}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filters.edition || "all"} onValueChange={(value) => handleFilterChange("edition", value)}>
            <SelectTrigger className="w-40 bg-white">
              <div className="flex items-center">
                <Database className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Edition" />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any Edition</SelectItem>
              {editionOptions.map((option) => (
                <SelectItem key={option} value={option}>{option}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filters.customerId || "all"} onValueChange={(value) => handleFilterChange("customerId", value)}>
            <SelectTrigger className="w-40 bg-white">
              <div className="flex items-center">
                <Users className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Customer" />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Customers</SelectItem>
              <SelectItem value={NO_CUSTOMER_FILTER}>No Customer</SelectItem>
              {customers
                .filter((customer) => customer.active)
                .map((customer) => (
                  <SelectItem key={customer.id} value={customer.id}>{customer.name}</SelectItem>
                ))}
            </SelectContent>
          </Select>

          <Select value={groupBy} onValueChange={setGroupBy}>
            <SelectTrigger className="w-40 bg-white">
              <div className="flex items-center">
                <ArrowDownUp className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Group by" />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No Grouping</SelectItem>
              <SelectItem value="edition">By Edition</SelectItem>
              <SelectItem value="type">By Type</SelectItem>
              <SelectItem value="primaryUse">By Primary Use</SelectItem>
              <SelectItem value="version">By Version</SelectItem>
              <SelectItem value="customer">By Customer</SelectItem>
            </SelectContent>
          </Select>

          {(searchTerm || filters.primaryUse || filters.type || filters.edition || filters.customerId || groupBy !== "none") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="text-sm text-gray-500"
            >
              <X className="h-4 w-4 mr-1" />
              Clear filters
            </Button>
          )}
        </div>
      )}

      <div className="mb-4 flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Showing {filteredEnvironments.length} of {environments.length} environments
        </span>
        {groupBy !== "none" && <span>Grouped by {groupBy}</span>}
      </div>
      
      {/* Table Section */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Edition</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Primary Use</TableHead>
              <TableHead>DB Type</TableHead>
              <TableHead>Instances</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Object.keys(groupedEnvironments).length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-6 text-sm text-neutral-500">
                  <div className="flex flex-col items-center p-6">
                    <Database className="w-12 h-12 text-neutral-400 mb-3" />
                    <h3 className="text-lg font-medium text-neutral-700">
                      {environments.length === 0 ? "No environments found" : "No environments match your filters"}
                    </h3>
                    <p className="text-neutral-500 mt-1 mb-4">
                      {environments.length === 0 
                        ? "Create your first database environment to get started." 
                        : "Try adjusting your filters or create a new environment."}
                    </p>
                    {environments.length === 0 && (
                      <Link href="/environments/new">
                        <Button>
                          <Plus className="mr-2 h-4 w-4" />
                          Add Environment
                        </Button>
                      </Link>
                    )}
                    {environments.length > 0 && (
                      <Button variant="outline" onClick={resetFilters}>
                        <X className="mr-2 h-4 w-4" />
                        Clear Filters
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              Object.entries(groupedEnvironments).map(([group, groupEnvironments]) => (
                <React.Fragment key={group}>
                  {/* Group header row */}
                  {groupBy !== 'none' && (
                    <TableRow 
                      className="bg-slate-50 hover:bg-slate-100 cursor-pointer" 
                      onClick={() => toggleGroupExpansion(group)}
                    >
                      <TableCell colSpan={10} className="font-medium">
                        <div className="flex items-center">
                          {expandedGroups[group] ? 
                            <ChevronDown className="h-4 w-4 mr-2" /> : 
                            <ChevronRight className="h-4 w-4 mr-2" />
                          }
                          <span>{group}</span>
                          <span className="ml-2 text-xs text-gray-500">
                            ({groupEnvironments.length} {groupEnvironments.length === 1 ? 'environment' : 'environments'})
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                  
                  {/* Environment rows */}
                  {(groupBy === 'none' || expandedGroups[group]) && groupEnvironments.map((env) => {
                    const environmentWarnings = getEnvironmentWarnings(env);

                    return (
                      <TableRow key={env.id} className="bg-white hover:bg-slate-50">
                        <TableCell className="font-medium">
                            <div className="flex items-center">
                              <Database className="h-5 w-5 text-blue-500 mr-1" />
                              {env.name}
                            </div>
                        </TableCell>
                        <TableCell>
                          {env.customerName ? (
                            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                              {env.customerName}
                            </Badge>
                          ) : (
                            <span className="text-neutral-500 text-xs">No customer</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="bg-purple-100 text-purple-800">
                            {env.edition}
                          </Badge>
                        </TableCell>
                        <TableCell>{env.version}</TableCell>
                        <TableCell>
                          {env.type}
                        </TableCell>
                        <TableCell>
                          {env.primaryUse}
                        </TableCell>
                        <TableCell>{env.dbType}</TableCell>
                        <TableCell>
                          {env.instances.length}
                          {environmentWarnings.map((warning) => (
                            <div key={warning} className="text-xs text-orange-600 flex items-center mt-1">
                              <AlertTriangle className="h-4 w-4 inline mr-1" />
                              {warning}
                            </div>
                          ))}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end space-x-2">
                            <Link href={`/environments/${env.id}`}>
                              <Button variant="ghost" size="icon">
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </Link>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              onClick={() => openCloneDialog(env)}
                              disabled={isCloning}
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" disabled={deletingEnvironmentId === env.id}>
                                  {deletingEnvironmentId === env.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin text-red-500" />
                                  ) : (
                                    <Trash2 className="h-4 w-4 text-red-500" />
                                  )}
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This will permanently delete the environment {env.name} and all associated data.
                                    This action cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction 
                                    onClick={() => handleDeleteEnvironment(env.id)}
                                    className="bg-red-500 hover:bg-red-600"
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </React.Fragment>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Clone Dialog */}
      <Dialog open={cloneDialogOpen} onOpenChange={(open) => !open && closeCloneDialog()}> 
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clone Environment</DialogTitle>
            <DialogDescription>
              Enter a name for the cloned environment.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="env-name" className="text-right">
                Name
              </Label>
              <Input 
                id="env-name" 
                value={cloneName} 
                onChange={(e) => setCloneName(e.target.value)} 
                className="col-span-3" 
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeCloneDialog}>
              Cancel
            </Button>
            <Button onClick={handleCloneEnvironment} disabled={!cloneName.trim() || isCloning}>
              {isCloning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Clone Environment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}