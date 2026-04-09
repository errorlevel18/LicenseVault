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
  DialogTrigger,
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Pencil, Trash2, Plus, AlertCircle } from "lucide-react";
import { storageService } from '@/lib/storageService';
import { useToast } from '@/hooks/use-toast';
import logger from "@/lib/logger"; // Importamos el logger

// Define props interface
interface ReferenceDataTableProps {
  table: {
    id: string;
    name: string;
    tableName: string;
    valueColumn: string;
    secondaryColumn?: string;
    hasMultipleColumns: boolean;
  };
}

// Define types
type ValueItem = string | { 
  [key: string]: string | number;
};

export function ReferenceDataTable({ table }: ReferenceDataTableProps) {
  const [values, setValues] = useState<ValueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newValue, setNewValue] = useState('');
  const [newSecondaryValue, setNewSecondaryValue] = useState('');
  const [editValue, setEditValue] = useState('');
  const [editSecondaryValue, setEditSecondaryValue] = useState('');
  const [originalValue, setOriginalValue] = useState('');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  
  const { toast } = useToast();

  useEffect(() => {
    const fetchValues = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await storageService.getReferenceTableValues(table.id);
        setValues(Array.isArray(data) ? data : []);
      } catch (err) {
        logger.error(`Error loading values for ${table.name}:`, err);
        setError(`Failed to load ${table.name.toLowerCase()} data.`);
        toast({
          title: 'Error',
          description: `Failed to load ${table.name.toLowerCase()} data.`,
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    };

    if (table) {
      fetchValues();
    }
  }, [table, toast]);

  const handleAdd = async () => {
    if (!newValue.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a valid value',
        variant: 'destructive',
      });
      return;
    }

    try {
      if (table.hasMultipleColumns) {
        const numericValue = parseFloat(newSecondaryValue);
        if (isNaN(numericValue)) {
          toast({
            title: 'Error',
            description: 'Please enter a valid numeric value for core factor',
            variant: 'destructive',
          });
          return;
        }
        await storageService.addReferenceValue(table.id, newValue, numericValue);
      } else {
        await storageService.addReferenceValue(table.id, newValue);
      }

      const updatedValues = await storageService.getReferenceTableValues(table.id);
      setValues(Array.isArray(updatedValues) ? updatedValues : []);
      
      setNewValue('');
      setNewSecondaryValue('');
      setIsAddDialogOpen(false);
      
      toast({
        title: 'Success',
        description: `Added new ${table.name.toLowerCase()} successfully`,
      });
    } catch (err) {
      logger.error(`Error adding value to ${table.name}:`, err);
      toast({
        title: 'Error',
        description: `Failed to add new ${table.name.toLowerCase()}`,
        variant: 'destructive',
      });
    }
  };

  const handleEdit = async () => {
    if (!editValue.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a valid value',
        variant: 'destructive',
      });
      return;
    }

    try {
      if (table.hasMultipleColumns) {
        const numericValue = parseFloat(editSecondaryValue);
        if (isNaN(numericValue)) {
          toast({
            title: 'Error',
            description: 'Please enter a valid numeric value for core factor',
            variant: 'destructive',
          });
          return;
        }
        await storageService.updateReferenceValue(table.id, originalValue, editValue, numericValue);
      } else {
        await storageService.updateReferenceValue(table.id, originalValue, editValue);
      }

      const updatedValues = await storageService.getReferenceTableValues(table.id);
      setValues(Array.isArray(updatedValues) ? updatedValues : []);
      
      setEditValue('');
      setEditSecondaryValue('');
      setOriginalValue('');
      setIsEditDialogOpen(false);
      
      toast({
        title: 'Success',
        description: `Updated ${table.name.toLowerCase()} successfully`,
      });
    } catch (err) {
      logger.error(`Error updating value in ${table.name}:`, err);
      toast({
        title: 'Error',
        description: `Failed to update ${table.name.toLowerCase()}`,
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async () => {
    if (!itemToDelete) return;

    try {
      await storageService.deleteReferenceValue(table.id, itemToDelete);
      
      const updatedValues = await storageService.getReferenceTableValues(table.id);
      setValues(Array.isArray(updatedValues) ? updatedValues : []);
      
      setItemToDelete(null);
      setIsDeleteDialogOpen(false);
      
      toast({
        title: 'Success',
        description: `Deleted ${table.name.toLowerCase()} successfully`,
      });
    } catch (err) {
      logger.error(`Error deleting value from ${table.name}:`, err);
      toast({
        title: 'Error',
        description: `Failed to delete ${table.name.toLowerCase()}`,
        variant: 'destructive',
      });
    }
  };

  const openEditDialog = (value: ValueItem) => {
    if (typeof value === 'string') {
      setEditValue(value);
      setOriginalValue(value);
    } else if (table.hasMultipleColumns && table.valueColumn && table.secondaryColumn) {
      setEditValue(value[table.valueColumn] as string);
      setEditSecondaryValue((value[table.secondaryColumn] ?? '').toString());
      setOriginalValue(value[table.valueColumn] as string);
    }
    setIsEditDialogOpen(true);
  };

  const openDeleteDialog = (value: ValueItem) => {
    if (typeof value === 'string') {
      setItemToDelete(value);
    } else if (table.valueColumn) {
      setItemToDelete(value[table.valueColumn] as string);
    }
    setIsDeleteDialogOpen(true);
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

  return (
    <div>
      <div className="mb-4">
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add New Entry
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New {table.name} Entry</DialogTitle>
              <DialogDescription>
                Enter the details for the new entry.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="new-value" className="text-right">
                  Value
                </Label>
                <Input
                  id="new-value"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  className="col-span-3"
                  autoFocus
                />
              </div>
              {table.hasMultipleColumns && (
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="new-secondary-value" className="text-right">
                    {table.secondaryColumn === 'coreFactor' ? 'Core Factor' : 'Secondary Value'}
                  </Label>
                  <Input
                    id="new-secondary-value"
                    value={newSecondaryValue}
                    onChange={(e) => setNewSecondaryValue(e.target.value)}
                    className="col-span-3"
                    type={table.secondaryColumn === 'coreFactor' ? 'number' : 'text'}
                    step={table.secondaryColumn === 'coreFactor' ? '0.1' : undefined}
                  />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleAdd}>Add</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {table.name} Entry</DialogTitle>
            <DialogDescription>
              Update the details for this entry.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="edit-value" className="text-right">
                Value
              </Label>
              <Input
                id="edit-value"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="col-span-3"
                autoFocus
              />
            </div>
            {table.hasMultipleColumns && (
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="edit-secondary-value" className="text-right">
                  {table.secondaryColumn === 'coreFactor' ? 'Core Factor' : 'Secondary Value'}
                </Label>
                <Input
                  id="edit-secondary-value"
                  value={editSecondaryValue}
                  onChange={(e) => setEditSecondaryValue(e.target.value)}
                  className="col-span-3"
                  type={table.secondaryColumn === 'coreFactor' ? 'number' : 'text'}
                  step={table.secondaryColumn === 'coreFactor' ? '0.1' : undefined}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleEdit}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this entry. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      {values.length > 0 ? (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                {table.hasMultipleColumns ? (
                  <>
                    <TableHead className="uppercase font-bold">{table.valueColumn}</TableHead>
                    <TableHead className="uppercase font-bold">{table.secondaryColumn}</TableHead>
                  </>
                ) : (
                  <TableHead className="uppercase font-bold">Value</TableHead>
                )}
                <TableHead className="w-[100px] text-right uppercase font-bold">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {values.map((value, index) => (
                <TableRow key={index}>
                  {table.hasMultipleColumns ? (
                    typeof value === 'object' && table.valueColumn && table.secondaryColumn ? (
                      <>
                        <TableCell>{value[table.valueColumn]}</TableCell>
                        <TableCell>{value[table.secondaryColumn]}</TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell>Error: Invalid value format</TableCell>
                        <TableCell>Error: Invalid value format</TableCell>
                      </>
                    )
                  ) : (
                    <TableCell>
                      {typeof value === 'string' 
                        ? value 
                        : typeof value === 'object' && table.valueColumn && value[table.valueColumn] !== undefined
                          ? String(value[table.valueColumn])
                          : JSON.stringify(value)}
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    <div className="flex justify-end space-x-2">
                      <Button 
                        variant="ghost" 
                        size="icon"
                        onClick={() => openEditDialog(value)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={() => openDeleteDialog(value)}
                        className="text-red-500"
                      >
                        <Trash2 className="h-4 w-4" />
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
          <p className="text-gray-500">No entries found. Add a new entry to get started.</p>
        </div>
      )}
    </div>
  );
}