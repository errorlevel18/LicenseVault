import React, { useEffect, useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tag,Pencil, Trash2, Plus, Link as LinkIcon, Network, Filter, ArrowDownUp, ChevronRight, ChevronDown, Search, X, Ban } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { License } from "@/lib/types";
import { storageService } from "@/lib/storageService";
import { format } from "date-fns";
import logger from "@/lib/logger"; // Importamos el logger

// Extended license interface to match what's used in this component
interface ExtendedLicense extends Omit<License, 'edition'> {
  product?: string;
  edition?: string; // Override the strict LicenseEdition type
  metric?: string;
  csi?: string;
}

export function LicenseList() {
  const [_, navigate] = useLocation();
  const [licenses, setLicenses] = useState<ExtendedLicense[]>([]);
  const [licenseToDelete, setLicenseToDelete] = useState<string | null>(null);
  const [filterTerm, setFilterTerm] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterMetric, setFilterMetric] = useState<string>("all");
  const [groupBy, setGroupBy] = useState<string>("none");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  
  // Make useEffect async to use await inside loadLicenses directly
  useEffect(() => {
    loadLicenses();
  }, []);

  // Make loadLicenses async
  const loadLicenses = async () => {
    try {
      logger.info("LicenseList: Starting to load licenses");
      
      // Usar getLicensesByCustomer para filtrar por el cliente seleccionado
      // Need to await this call since it's an async function
      const allLicensesMeta = await storageService.getLicensesByCustomer();
      logger.info("LicenseList: getLicensesByCustomer returned:", allLicensesMeta);

      // Ensure allLicensesMeta is an array
      if (!Array.isArray(allLicensesMeta)) {
        logger.error("LicenseList: getLicensesByCustomer did not return an array:", allLicensesMeta);
        setLicenses([]); // Set to empty array in case of error
        return;
      }

      if (allLicensesMeta.length === 0) {
        logger.info("LicenseList: No licenses returned from getLicensesByCustomer");
        setLicenses([]);
        return;
      }

      logger.info(`LicenseList: Processing ${allLicensesMeta.length} licenses`);
     
      // Create an array of promises
      const licensePromises = allLicensesMeta.map(async (metaLicense) => {
        try {
          // Skip usage calculation since the method doesn't exist
          logger.info(`LicenseList: Fetching details for license ${metaLicense.id}`);
          const license = await storageService.getLicense(metaLicense.id);
          logger.info(`LicenseList: License details for ${metaLicense.id}:`, license);
          return license;
        } catch (err) {
          logger.error(`LicenseList: Error processing license ${metaLicense.id}:`, err);
          return undefined;
        }
      });

      // Wait for all promises to resolve
      logger.info("LicenseList: Waiting for all license detail requests to complete");
      const resolvedLicenses = await Promise.all(licensePromises);

      // Filter out any undefined results (if getLicense can return undefined)
      const validLicenses = resolvedLicenses.filter((license): license is License => license !== undefined);
      logger.info(`LicenseList: Final licenses array has ${validLicenses.length} items:`, validLicenses);
      
      setLicenses(validLicenses);
    } catch (error) {
      logger.error("LicenseList: Error loading licenses:", error);
      setLicenses([]);
    }
  };


  // handleDeleteLicense should remain async if deleteLicense is async
  const handleDeleteLicense = async (id: string) => {
    const deleted = await storageService.deleteLicense(id);
    if (deleted) {
      // Reload licenses to reflect the deletion and recalculate usage
      await loadLicenses(); // Use await here as loadLicenses is now async
      setLicenseToDelete(null);
    } else {
      logger.error("Failed to delete license with ID:", id);
      setLicenseToDelete(null);
    }
  };

  const formatDate = (dateString: string) => {
    try {
      // Add a check for valid date string before formatting
      if (!dateString || isNaN(new Date(dateString).getTime())) {
          return 'Invalid Date';
      }
      return format(new Date(dateString), 'MMM dd, yyyy');
    } catch (error) {
      logger.error("Error formatting date:", dateString, error);
      return 'Invalid Date';
    }
  };

  const getLicenseStatus = (license: ExtendedLicense): string => {
    const now = new Date();
    // Ensure endDate is valid before creating a Date object
    const endDateString = license.endDate;
    if (!endDateString || isNaN(new Date(endDateString).getTime())) {
        return 'active'; // Or some other default/error status
    }
    const endDate = new Date(endDateString);

    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(now.getDate() + 30);

    if (endDate < now) {
      return 'expired';
    } else if (endDate <= thirtyDaysFromNow) {
      return 'expiring';
    } else if (typeof license.quantityUsed === 'number' && license.quantityUsed > license.quantity) {
      return 'insufficient';
    } else {
      return 'active';
    }
  };

  const getLicenseStatusBadge = (license: ExtendedLicense) => {
    const status = getLicenseStatus(license);

    switch(status) {
      case 'expired':
        return <Badge variant="destructive">Expired</Badge>;
      case 'expiring':
        return <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-200">Expiring Soon</Badge>;
      case 'insufficient':
        return <Badge variant="outline" className="bg-red-100 text-red-800 border-red-200">Insufficient</Badge>;
      case 'active':
      default:
        return <Badge variant="outline" className="bg-green-100 text-green-800 border-green-200">Active</Badge>;
    }
  };

  // Filter licenses (remains synchronous, operates on state)
  const filteredLicenses = useMemo(() => {
    return licenses
      .filter(license => {
        // Filter by search term
        if (filterTerm) {
            const searchTermLower = filterTerm.toLowerCase();
            const productMatch = license.product?.toLowerCase().includes(searchTermLower);
            const editionMatch = license.edition?.toLowerCase().includes(searchTermLower);
            const csiMatch = license.csi?.toLowerCase().includes(searchTermLower);
            if (!productMatch && !editionMatch && !csiMatch) {
                return false;
            }
        }

        // Filter by status
        if (filterStatus !== 'all') {
          const status = getLicenseStatus(license);
          if (status !== filterStatus) {
            return false;
          }
        }

        // Filter by metric
        if (filterMetric !== 'all' && license.metric !== filterMetric) {
          return false;
        }

        return true;
      });
  }, [licenses, filterTerm, filterStatus, filterMetric]); // Dependencies are correct

  // Group licenses (remains synchronous, operates on filtered results)
  const groupedLicenses = useMemo(() => {
    // Early exit if no licenses after filtering
    if (filteredLicenses.length === 0) {
        return {};
    }

    if (groupBy === 'none') {
      // Use a consistent structure even when not grouping
      return { 'All Licenses': filteredLicenses };
    }

    const grouped: Record<string, ExtendedLicense[]> = {};

    filteredLicenses.forEach(license => {
      let groupKey: string;

      switch(groupBy) {
        case 'product':
          groupKey = license.product || 'Unknown Product';
          break;
        case 'status':
          const status = getLicenseStatus(license);
           switch(status) {
             case 'active': groupKey = 'Status: Active'; break; // Prefix for clarity
             case 'expired': groupKey = 'Status: Expired'; break;
             case 'expiring': groupKey = 'Status: Expiring Soon'; break;
             case 'insufficient': groupKey = 'Status: Insufficient'; break;
             default: groupKey = 'Status: Other';
           }
          break;
        case 'metric':
          groupKey = license.metric ? `Metric: ${license.metric}` : 'Metric: Unknown'; // Prefix
          break;
        case 'csi':
          groupKey = license.csi ? `CSI: ${license.csi}` : 'No CSI Assigned';
          break;
        default:
          groupKey = 'All Licenses'; // Fallback
      }

      if (!grouped[groupKey]) {
        grouped[groupKey] = [];
      }
      grouped[groupKey].push(license);
    });

    // Sort groups alphabetically, special handling for "No CSI Assigned"
    return Object.keys(grouped)
      .sort((a, b) => {
        // Keep 'No CSI Assigned' at the end if grouping by CSI
        if (groupBy === 'csi') {
            if (a === 'No CSI Assigned') return 1;
            if (b === 'No CSI Assigned') return -1;
        }
        // Keep 'All Licenses' or similar generic groups first if needed
        if (a === 'All Licenses') return -1;
        if (b === 'All Licenses') return 1;

        // Default alphabetical sort
        return a.localeCompare(b);
      })
      .reduce((acc, key) => {
        acc[key] = grouped[key];
        return acc;
      }, {} as Record<string, ExtendedLicense[]>);

  }, [filteredLicenses, groupBy]); // Dependency is correct

  // Initialize/reset expanded state when grouping/filters change the groups
   useEffect(() => {
     const initialExpandedState: Record<string, boolean> = {};
     Object.keys(groupedLicenses).forEach(group => {
       // Default to expanded, unless it's a very large group maybe?
       initialExpandedState[group] = true;
     });
     // Only update if the keys actually changed to avoid unnecessary renders
     if (JSON.stringify(Object.keys(initialExpandedState)) !== JSON.stringify(Object.keys(expandedGroups))) {
         setExpandedGroups(initialExpandedState);
     }
   }, [groupedLicenses]); // Dependency on the calculated groups

  const toggleGroupExpansion = (group: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [group]: !prev[group] // Toggle the specific group
    }));
  };

  // Calculate metrics for summary cards (remains synchronous)
  const metrics = useMemo(() => {
    const total = licenses.length;
    if (total === 0) {
        // Return zeroed metrics if no licenses
        return { total: 0, active: 0, expired: 0, expiringSoon: 0, insufficient: 0, totalUsage: 0, totalCapacity: 0, usagePercentage: 0 };
    }

    let active = 0;
    let expired = 0;
    let expiringSoon = 0;
    let insufficient = 0;
    let totalUsage = 0;
    let totalCapacity = 0;

    licenses.forEach(license => {
        const status = getLicenseStatus(license);
        switch (status) {
            case 'active': active++; break;
            case 'expired': expired++; break;
            case 'expiring': expiringSoon++; break;
            case 'insufficient': insufficient++; break;
        }
        totalUsage += license.quantityUsed || 0;
        totalCapacity += license.quantity || 0; // Ensure quantity is treated as number
    });

    // Avoid division by zero
    const usagePercentage = totalCapacity > 0 ? Math.round((totalUsage / totalCapacity) * 100) : 0;

    return { total, active, expired, expiringSoon, insufficient, totalUsage, totalCapacity, usagePercentage };
  }, [licenses]); // Dependency is correct

  const handleOpenAssignDialog = (licenseId: string) => {
    // Navigate directly to the license assignment page with the selected license
    navigate(`/license-assignment?licenseId=${licenseId}`);
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Oracle Licenses</h2>
        <div className="flex flex-wrap gap-2"> {/* Use flex-wrap for responsiveness */}
          <Button variant="outline" onClick={() => navigate('/license-assignment')}>
            <Network className="mr-2 h-4 w-4" />
            Assign License
          </Button>
          <Link href="/licenses/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add License
            </Button>
          </Link>
        </div>
      </div>

      {/* Metric Cards Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6"> {/* Adjusted grid columns */}
        <Card className="bg-white shadow-sm"> {/* Added subtle shadow */}
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">License Compliance</CardTitle> {/* Adjusted size */}
            <CardDescription className="text-xs">Overall usage vs capacity</CardDescription> {/* Adjusted size */}
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xl font-bold">{metrics.usagePercentage}%</p> {/* Adjusted size */}
                <p className="text-xs text-muted-foreground">Used capacity</p> {/* Adjusted size */}
              </div>
              <div className="flex flex-col gap-1 text-xs"> {/* Adjusted size */}
                 {metrics.active > 0 && (
                    <div className="flex items-center justify-end">
                        <span>{metrics.active} Active</span>
                        <Badge variant="outline" className="bg-green-100 text-green-800 border-green-200 ml-2 w-3 h-3 p-0 rounded-full" />
                    </div>
                 )}
                 {metrics.insufficient > 0 && (
                    <div className="flex items-center justify-end">
                        <span>{metrics.insufficient} Insufficient</span>
                        <Badge variant="outline" className="bg-red-100 text-red-800 border-red-200 ml-2 w-3 h-3 p-0 rounded-full" />
                    </div>
                 )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">License Status</CardTitle>
            <CardDescription className="text-xs">Current status breakdown</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xl font-bold">{metrics.total}</p>
                <p className="text-xs text-muted-foreground">Total licenses</p>
              </div>
              <div className="flex flex-col gap-1 text-xs items-end"> {/* Adjusted size & alignment */}
                {metrics.active > 0 && (
                  <div className="flex items-center">
                    <span>{metrics.active} Active</span>
                    <Badge variant="outline" className="bg-green-100 text-green-800 border-green-200 ml-2 w-3 h-3 p-0 rounded-full" />
                  </div>
                )}
                {metrics.expiringSoon > 0 && (
                  <div className="flex items-center">
                    <span>{metrics.expiringSoon} Expiring</span>
                    <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-200 ml-2 w-3 h-3 p-0 rounded-full" />
                  </div>
                )}
                {metrics.expired > 0 && (
                  <div className="flex items-center">
                    <span>{metrics.expired} Expired</span>
                     <Badge variant="destructive" className="ml-2 w-3 h-3 p-0 rounded-full" />
                  </div>
                )}
                 {metrics.insufficient > 0 && (
                   <div className="flex items-center">
                     <span>{metrics.insufficient} Insufficient</span>
                     <Badge variant="outline" className="bg-red-100 text-red-800 border-red-200 ml-2 w-3 h-3 p-0 rounded-full" />
                   </div>
                 )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">License Allocation</CardTitle>
            <CardDescription className="text-xs">Units used vs. total by metric</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                 <p className="text-xl font-bold">{metrics.totalUsage} / {metrics.totalCapacity}</p>
                <p className="text-xs text-muted-foreground">Total units (used/qty)</p>
              </div>
              <div className="flex flex-col gap-1 text-xs items-end"> {/* Adjusted size & alignment */}
                <div className="flex items-center">
                  <span className="font-medium">Processor:</span>
                  <span className="ml-2">{licenses.filter(l => l.metric === 'Processor').length} ({licenses.filter(l=>l.metric === 'Processor').reduce((sum, l) => sum + (l.quantityUsed || 0), 0)}/{licenses.filter(l=>l.metric === 'Processor').reduce((sum, l) => sum + l.quantity, 0)})</span>
                </div>
                <div className="flex items-center">
                  <span className="font-medium">NUP:</span>
                   <span className="ml-2">{licenses.filter(l => l.metric === 'Named User Plus').length} ({licenses.filter(l=>l.metric === 'Named User Plus').reduce((sum, l) => sum + (l.quantityUsed || 0), 0)}/{licenses.filter(l=>l.metric === 'Named User Plus').reduce((sum, l) => sum + l.quantity, 0)})</span>
                </div>
                {/* Add other metrics if necessary */}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter Section */}
      <div className="mb-6 flex flex-wrap gap-4 items-center p-4 bg-slate-50 rounded-lg border"> {/* Added border */}
        <div className="relative flex-grow sm:flex-grow-0"> {/* Allow search to grow on small screens */}
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search product, edition, CSI..."
            value={filterTerm}
            onChange={(e) => setFilterTerm(e.target.value)}
            className="pl-8 w-full sm:w-[250px] bg-white" // Full width on small screens
          />
        </div>

        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-full sm:w-40 bg-white"> {/* Full width on small screens */}
            <div className="flex items-center">
              <Filter className="h-4 w-4 mr-2 flex-shrink-0" />
              <SelectValue placeholder="Status" />
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="expiring">Expiring Soon</SelectItem>
            <SelectItem value="insufficient">Insufficient</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filterMetric} onValueChange={setFilterMetric}>
          <SelectTrigger className="w-full sm:w-40 bg-white"> {/* Full width on small screens */}
            <div className="flex items-center">
              <Filter className="h-4 w-4 mr-2 flex-shrink-0" />
              <SelectValue placeholder="Metric" />
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Metrics</SelectItem>
            <SelectItem value="Processor">Processor</SelectItem>
            <SelectItem value="Named User Plus">NUP</SelectItem>
            {/* Add other metrics dynamically if applicable */}
          </SelectContent>
        </Select>

        <Select value={groupBy} onValueChange={setGroupBy}>
          <SelectTrigger className="w-full sm:w-40 bg-white"> {/* Full width on small screens */}
            <div className="flex items-center">
              <ArrowDownUp className="h-4 w-4 mr-2 flex-shrink-0" />
              <SelectValue placeholder="Group by" />
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No Grouping</SelectItem>
            <SelectItem value="product">By Product</SelectItem>
            <SelectItem value="status">By Status</SelectItem>
            <SelectItem value="metric">By Metric</SelectItem>
            <SelectItem value="csi">By CSI</SelectItem>
          </SelectContent>
        </Select>

        {(filterTerm || filterStatus !== 'all' || filterMetric !== 'all' || groupBy !== 'none') && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFilterTerm('');
              setFilterStatus('all');
              setFilterMetric('all');
              setGroupBy('none');
            }}
            className="text-sm text-gray-500 hover:bg-slate-200"
          >
            <X className="h-4 w-4 mr-1" />
            Clear filters
          </Button>
        )}
      </div>

      <div className="rounded-md border overflow-x-auto"> {/* Added overflow-x-auto */}
        <Table className="min-w-full">
          <TableHeader>
             {/* Keep header consistent, grouping adds rows below */}
            <TableRow className="bg-slate-50 hover:bg-slate-100">
              <TableHead className="whitespace-nowrap px-3 py-2">Product</TableHead>
              <TableHead className="whitespace-nowrap px-3 py-2">Edition</TableHead>
              <TableHead className="whitespace-nowrap px-3 py-2">CSI</TableHead>
              <TableHead className="whitespace-nowrap px-3 py-2">Metric</TableHead>
              <TableHead className="text-right whitespace-nowrap px-3 py-2">Quantity</TableHead>
              <TableHead className="text-right whitespace-nowrap px-3 py-2">Usage (%)</TableHead>
              <TableHead className="whitespace-nowrap px-3 py-2">Expiration</TableHead>
              <TableHead className="whitespace-nowrap px-3 py-2">Status</TableHead>
              <TableHead className="text-right whitespace-nowrap px-3 py-2">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Object.keys(groupedLicenses).length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-6 text-sm text-neutral-500 h-40"> {/* Ensure minimum height */}
                   {licenses.length === 0 ? "No licenses defined yet. Click 'Add License' to start." : "No licenses match the current filters."}
                </TableCell>
              </TableRow>
            ) : (
              Object.entries(groupedLicenses).map(([group, groupLicenses]) => (
                <React.Fragment key={group}>
                  {/* Group header row - Render only if grouping is active */}
                  {groupBy !== 'none' && (
                    <TableRow
                      className="bg-slate-100 hover:bg-slate-200 cursor-pointer"
                      onClick={() => toggleGroupExpansion(group)}
                    >
                      <TableCell colSpan={9} className="font-medium py-2 px-4 text-sm"> {/* Use text-sm */}
                        <div className="flex items-center">
                          {expandedGroups[group] ?? true ? // Default to expanded if state not yet set
                            <ChevronDown className="h-4 w-4 mr-2 flex-shrink-0" /> :
                            <ChevronRight className="h-4 w-4 mr-2 flex-shrink-0" />
                          }
                          <span className="truncate font-semibold">{group}</span> {/* Make group bold */}
                          <span className="ml-2 text-xs text-gray-500 whitespace-nowrap">
                             ({groupLicenses.length} {groupLicenses.length === 1 ? 'license' : 'licenses'})
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}

                  {/* License rows - Render if group is expanded or if no grouping */}
                  {(groupBy === 'none' || (expandedGroups[group] ?? true)) && groupLicenses.map((license) => {
                    const usageValue = license.quantityUsed;
                    const quantityValue = license.quantity;
                    const usagePercent = (typeof usageValue === 'number' && quantityValue > 0)
                        ? Math.round((usageValue / quantityValue) * 100)
                        : undefined;

                    return (
                      <TableRow key={license.id} className="bg-white hover:bg-slate-50 text-sm"> {/* Use text-sm */}
                        <TableCell className="font-medium px-3 py-2">
                            <div className="flex items-center">
                              <Tag className="h-5 w-5 mr-3 text-purple-500" />
                              {license.product}
                            </div>
                        </TableCell>
                        <TableCell className="px-3 py-2">
                          <Badge variant="outline" className="bg-purple-100 text-purple-800 border-purple-200 font-normal text-xs"> {/* Adjusted badge style */}
                            {license.edition}
                          </Badge>
                        </TableCell>
                        <TableCell className="px-3 py-2">{license.csi || <span className="text-gray-400 italic">None</span>}</TableCell>
                        <TableCell className="px-3 py-2">{license.metric}</TableCell>
                        <TableCell className="text-right px-3 py-2">{quantityValue}</TableCell>
                        <TableCell className="text-right px-3 py-2">
                           {typeof usageValue === 'number' ? (
                             <div className={`flex items-center justify-end ${usageValue > quantityValue ? 'text-red-600 font-semibold' : ''}`}>
                               <span>{usageValue}</span>
                               {usagePercent !== undefined && (
                                 <span className="text-xs text-gray-500 ml-1">({usagePercent}%)</span>
                               )}
                             </div>
                           ) : (
                             <span className="text-gray-400">N/A</span>
                           )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap px-3 py-2">{license.endDate ? formatDate(license.endDate) : 'No expiration'}</TableCell>
                        <TableCell className="px-3 py-2">{getLicenseStatusBadge(license)}</TableCell>
                        <TableCell className="text-right px-3 py-2">
                          <div className="flex justify-end space-x-0"> {/* Reduced space */}
                            <Link href={`/licenses/${license.id}`} title="Edit License">
                              <Button variant="ghost" size="icon" className="h-7 w-7"> {/* Smaller buttons */}
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </Link>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title="Assign License"
                              onClick={() => handleOpenAssignDialog(license.id)}
                            >
                              <LinkIcon className="h-4 w-4" />
                            </Button>
                             {/* Use Dialog component directly for delete confirmation */}
                             <AlertDialog open={licenseToDelete === license.id} onOpenChange={(open) => !open && setLicenseToDelete(null)}>
                               <AlertDialogTrigger asChild>
                                 <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50" title="Delete License" onClick={() => setLicenseToDelete(license.id)}>
                                   <Trash2 className="h-4 w-4" />
                                 </Button>
                               </AlertDialogTrigger>
                               {/* Render content only when this specific dialog should be open */}
                               {licenseToDelete === license.id && (
                                 <AlertDialogContent>
                                   <AlertDialogHeader>
                                     <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                                     <AlertDialogDescription>
                                       This will permanently delete the license: <strong className="break-words">{license.product} ({license.edition})</strong>{license.csi ? ` with CSI ${license.csi}` : ''}.
                                       This action cannot be undone and might affect compliance calculations.
                                     </AlertDialogDescription>
                                   </AlertDialogHeader>
                                   <AlertDialogFooter>
                                     <AlertDialogCancel onClick={() => setLicenseToDelete(null)}>Cancel</AlertDialogCancel>
                                     <AlertDialogAction
                                       onClick={() => handleDeleteLicense(license.id)} // Already async
                                       className="bg-red-600 hover:bg-red-700"
                                     >
                                       Delete License
                                     </AlertDialogAction>
                                   </AlertDialogFooter>
                                 </AlertDialogContent>
                               )}
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
    </div>
  );
}