import { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
// Import directly using the full relative path
import { ReferenceDataTable } from '@/components/maintenance/ReferenceDataTable';
import { DataTable } from '@/components/maintenance/DataTable';
import { storageService } from '@/lib/storageService';
import apiClient from '@/lib/apiClient';
import { useToast } from '@/hooks/use-toast';
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Trash2, Database } from 'lucide-react';
import logger from "@/lib/logger"; // Importamos el logger

// Define the structure for reference tables metadata
interface ReferenceTable {
  id: string;
  name: string;
  tableName: string;
  valueColumn: string;
  secondaryColumn?: string;
  hasMultipleColumns: boolean;
}

// Define the structure for data tables
interface DataTable {
  id: string;
  name: string;
  tableName: string;
  description: string;
}

// Enum for table types
enum TableType {
  Metadata = 'metadata',
  Data = 'data'
}

export function MaintenancePage() {
  const [referenceTables, setReferenceTables] = useState<ReferenceTable[]>([]);
  const [dataTables, setDataTables] = useState<DataTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tableType, setTableType] = useState<TableType>(TableType.Metadata);
  const [selectedTableId, setSelectedTableId] = useState<string>('');
  const [isErasing, setIsErasing] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const fetchTables = async () => {
      try {
        setLoading(true);
        // Usar apiClient en lugar de fetch directo
        const response = await apiClient.get('/maintenance/tables');
        
        // Ensure tables is an array before setting state
        const metadataTables = Array.isArray(response.data) ? response.data : [];
        setReferenceTables(metadataTables);
        
        // Set default selected table
        if (metadataTables.length > 0) {
          setSelectedTableId(metadataTables[0].id);
        }
        
        // Define data tables - these are the main application tables
        setDataTables([
          {
            id: 'customers',
            name: 'Customers',
            tableName: 'customers',
            description: 'Customer organizations using Oracle products'
          },
          {
            id: 'licenses',
            name: 'Licenses',
            tableName: 'licenses',
            description: 'Oracle product licenses owned by customers'
          },
          {
            id: 'environments',
            name: 'Environments',
            tableName: 'environments',
            description: 'Database environments deployed by customers'
          },
          {
            id: 'hosts',
            name: 'Hosts',
            tableName: 'hosts',
            description: 'Physical or virtual servers hosting Oracle products'
          },
          {
            id: 'instances',
            name: 'Instances',
            tableName: 'instances',
            description: 'Database instances running in customer environments'
          },
          {
            id: 'pdbs',
            name: 'PDBs',
            tableName: 'pdbs',
            description: 'Pluggable databases within container databases'
          },
          {
            id: 'featureStats',
            name: 'Feature Stats',
            tableName: 'feature_stats',
            description: 'Usage statistics for Oracle database features'
          },
          {
            id: 'coreAssignments',
            name: 'Core Assignments',
            tableName: 'core_assignments',
            description: 'CPU core assignments for licensing'
          },
          {
            id: 'coreLicenseMappings',
            name: 'Core License Mappings',
            tableName: 'core_license_mappings',
            description: 'Mapping between cores and licenses'          }
        ]);
        
        setError(null);
      } catch (err) {
        logger.error('Error loading reference tables:', err);
        setError('Failed to load reference tables. Please try again.');
        toast({
          title: 'Error',
          description: 'Failed to load maintenance tables.',
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    };

    fetchTables();
  }, [toast]);

  // Handle tab type change (Metadata vs Data)
  const handleTableTypeChange = (type: TableType) => {
    setTableType(type);
    
    // Set the first table of the selected type as active
    if (type === TableType.Metadata && referenceTables.length > 0) {
      setSelectedTableId(referenceTables[0].id);
    } else if (type === TableType.Data && dataTables.length > 0) {
      setSelectedTableId(dataTables[0].id);
    }
  };

  // Handle specific table selection
  const handleTableSelect = (id: string) => {
    setSelectedTableId(id);
  };

  // Handle erase all data
  const handleEraseAllData = async () => {
    try {
      setIsErasing(true);
      await storageService.eraseAllData();
      setIsErasing(false);
      toast({
        title: 'Success',
        description: 'All data has been erased successfully.',
        variant: 'default',
      });
    } catch (error) {
      logger.error('Error erasing all data:', error);
      setIsErasing(false);
      toast({
        title: 'Error',
        description: 'Failed to erase all data. Please try again.',
        variant: 'destructive',
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="text-lg">Loading tables...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-md text-red-700">
        <h3 className="font-medium">Error Loading Data</h3>
        <p>{error}</p>
      </div>
    );
  }

  // Get the current table to display
  const currentTables = tableType === TableType.Metadata ? referenceTables : dataTables;
  const currentTable = currentTables.find(t => t.id === selectedTableId) || currentTables[0];

  return (
    <div className="container py-6">
      <div className="mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold mb-2">System Maintenance</h1>
          <p className="text-gray-600">
            Manage reference data used throughout the application. Changes made here will affect options available in forms and reports.
          </p>
        </div>
        
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" className="bg-red-400 hover:bg-red-500">
              <Trash2 className="mr-2 h-4 w-4" />
              Erase All Data
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
              <AlertDialogDescription>
                Esta acción eliminará TODOS los datos de la aplicación, incluyendo clientes, entornos, hosts y licencias.
                Esta acción no se puede deshacer.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleEraseAllData}
                className="bg-red-500 hover:bg-red-600"
                disabled={isErasing}
              >
                {isErasing ? 'Borrando...' : 'Sí, borrar todos los datos'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div>
        {/* Tabs strip with Metadata Tables and Data Tables options */}
        <div className="border-b mb-4">
          <div className="flex">
            {/* Tab for Metadata Tables */}
            <button
              className={`py-2 px-4 border-b-2 ${
                tableType === TableType.Metadata
                  ? 'border-primary text-primary font-medium'
                  : 'border-transparent hover:text-gray-700 hover:border-gray-300'
              }`}
              onClick={() => handleTableTypeChange(TableType.Metadata)}
            >
              Metadata Tables
            </button>
            
            {/* Tab for Data Tables */}
            <button
              className={`py-2 px-4 border-b-2 ${
                tableType === TableType.Data
                  ? 'border-primary text-primary font-medium'
                  : 'border-transparent hover:text-gray-700 hover:border-gray-300'
              }`}
              onClick={() => handleTableTypeChange(TableType.Data)}
            >
              Data Tables
            </button>
          </div>
        </div>
        
        {/* Second level tabs for specific tables */}
        <Tabs value={selectedTableId} onValueChange={handleTableSelect} className="mb-4">
          <TabsList className="mb-4">
            {currentTables.map((table) => (
              <TabsTrigger key={table.id} value={table.id}>
                {table.name}
              </TabsTrigger>
            ))}
          </TabsList>

          {currentTables.map((table) => (
            <TabsContent key={table.id} value={table.id}>
              <Card>
                <CardHeader>
                  <CardTitle>{table.name}</CardTitle>
                  <CardDescription>
                    {tableType === TableType.Data
                      ? (table as DataTable).description
                      : `Manage ${table.name.toLowerCase()} reference data. You can add, edit or delete entries.`
                    }
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {tableType === TableType.Data ? (
                    <DataTableContent tableId={table.id} tableName={table.name} />
                  ) : (
                    <ReferenceDataTable table={table as ReferenceTable} />
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
}

// Component to display data tables content
function DataTableContent({ tableId, tableName }: { tableId: string; tableName: string }) {
  return <DataTable tableId={tableId} tableName={tableName} />;
}

export default MaintenancePage;