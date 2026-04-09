import { useState, useEffect } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Pencil, Trash2, Plus, AlertCircle, Eye } from "lucide-react";
import { storageService } from '@/lib/storageService';
import apiClient from '@/lib/apiClient';
import { useToast } from '@/hooks/use-toast';
import logger from "@/lib/logger"; // Importamos el logger

// Define props interface
interface DataTableProps {
  tableId: string;
  tableName: string;
  description?: string;
}

export function DataTable({ tableId, tableName }: DataTableProps) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  
  const { toast } = useToast();

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Utilizar apiClient en lugar de fetch directo
        const response = await apiClient.get(`/maintenance/tables/${tableId}`);
        
        // Con apiClient, los datos ya vienen en response.data
        const tableData = Array.isArray(response.data) ? response.data : [];
        
        setData(tableData);
        setError(null);
      } catch (err) {
        logger.error(`Error loading data for table ${tableId}:`, err);
        setError(`Failed to load ${tableName} data.`);
        toast({
          title: 'Error',
          description: `Failed to load ${tableName} data.`,
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    };

    if (tableId) {
      fetchData();
    }
  }, [tableId, tableName, toast]);

  const openViewDialog = (item: any) => {
    setSelectedItem(item);
    setIsViewDialogOpen(true);
  };

  // Get columns from the first item in the data array
  const getColumns = () => {
    if (data.length === 0) return [];
    
    const item = data[0];
    return Object.keys(item).filter(key => 
      // Filter out columns that are objects or arrays
      typeof item[key] !== 'object' || item[key] === null
    );
  };

  // Format value for display
  const formatValue = (value: any) => {
    if (value === null || value === undefined) return '-';
    
    if (typeof value === 'boolean') {
      return value ? 'Yes' : 'No';
    }
    
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    
    return String(value);
  };

  if (loading) {
    return <div className="text-center py-4">Loading data...</div>;
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-md text-red-700">
        <div className="flex items-center">
          <AlertCircle className="h-4 w-4 mr-2" />
          <p>{error}</p>
        </div>
      </div>
    );
  }

  const columns = getColumns();

  return (
    <div>
      {data.length > 0 ? (
        <div className="border rounded-md overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {/* Only show first 5 columns for readability */}
                {columns.slice(0, 5).map((column) => (
                  <TableHead key={column} className="uppercase font-bold">
                    {column}
                  </TableHead>
                ))}
                <TableHead className="w-[100px] text-right uppercase font-bold">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((item, index) => (
                <TableRow key={index}>
                  {columns.slice(0, 5).map((column) => (
                    <TableCell key={column}>
                      {formatValue(item[column])}
                    </TableCell>
                  ))}
                  <TableCell className="text-right">
                    <div className="flex justify-end space-x-2">
                      <Button 
                        variant="ghost" 
                        size="icon"
                        onClick={() => openViewDialog(item)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="text-center py-8 bg-gray-50 border rounded-md">
          <p className="text-gray-500">No data found in this table.</p>
        </div>
      )}

      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{tableName} Data</DialogTitle>
            <DialogDescription>
              Viewing detailed data for this record.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto">
            {selectedItem && (
              <Table>
                <TableBody>
                  {Object.entries(selectedItem).map(([key, value]) => (
                    <TableRow key={key}>
                      <TableCell className="font-medium">{key}</TableCell>
                      <TableCell>
                        {formatValue(value)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setIsViewDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}