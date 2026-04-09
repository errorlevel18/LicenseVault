import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Pencil, Trash2, Plus, Users, Filter, Search, AlertCircle } from "lucide-react";
import { Customer } from "@/lib/types";
import { storageService } from "@/lib/storageService";
import { format } from "date-fns";
import { triggerCustomerUpdate } from "../../lib/CustomerSelector";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import logger from "@/lib/logger"; // Importamos el logger
import { toast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

// Esquema de validación para el cliente
const customerFormSchema = z.object({
  name: z.string()
    .min(1, "El nombre es requerido")
    .max(100, "El nombre no puede exceder los 100 caracteres"),
  description: z.string().optional(),
  email: z.string()
    .email("Por favor introduzca un email válido")
    .or(z.string().length(0))
    .optional(),
  password: z.string()
    .min(6, "La contraseña debe tener al menos 6 caracteres")
    .or(z.string().length(0))
    .optional(),
  active: z.boolean().default(true)
});

type CustomerFormValues = z.infer<typeof customerFormSchema>;

export function CustomerList() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [filteredCustomers, setFilteredCustomers] = useState<Customer[]>([]);
  const [customerToDelete, setCustomerToDelete] = useState<string | null>(null);
  const [newCustomerDialogOpen, setNewCustomerDialogOpen] = useState(false);
  const [editCustomerDialogOpen, setEditCustomerDialogOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  
  // Filtros
  const [showFilters, setShowFilters] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  
  // Form state para un formulario no controlado por React Hook Form
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    email: "",
    password: "",
    active: true
  });

  // React Hook Form para validación de formulario
  const newCustomerForm = useForm<CustomerFormValues>({
    resolver: zodResolver(customerFormSchema),
    defaultValues: {
      name: "",
      description: "",
      email: "",
      password: "",
      active: true
    }
  });

  const editCustomerForm = useForm<CustomerFormValues>({
    resolver: zodResolver(customerFormSchema),
    defaultValues: {
      name: "",
      description: "",
      email: "",
      password: "",
      active: true
    }
  });

  useEffect(() => {
    const initializeCustomers = async () => {
      await loadCustomers();
    };
    initializeCustomers();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [customers, searchTerm, statusFilter]);
  const loadCustomers = async () => {
    try {
      // Usar parámetros de búsqueda en la solicitud al servidor
      const queryParams = new URLSearchParams();
      if (searchTerm) queryParams.append('search', searchTerm);
      if (statusFilter !== 'all') queryParams.append('status', statusFilter);
      
      const allCustomers = await storageService.getCustomers(queryParams);
      
      if (!Array.isArray(allCustomers)) {
        logger.error('Los datos recibidos no son un array:', allCustomers);
        setCustomers([]);
        setFilteredCustomers([]);
        return;
      }
      
      setCustomers(allCustomers);
      setFilteredCustomers(allCustomers);
    } catch (error) {
      logger.error('Error loading customers:', error);
      toast({
        title: "Error al cargar clientes",
        description: "No se pudieron cargar los datos de clientes. Por favor, intente de nuevo.",
        variant: "destructive",
      });
      setCustomers([]);
      setFilteredCustomers([]);
    }
  };

  const applyFilters = () => {
    let result = Array.isArray(customers) ? [...customers] : [];
    
    // Si el filtrado se hace en el cliente, aplicarlo aquí
    // En producción, esto debería delegarse al servidor para conjuntos de datos grandes
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(customer => 
        customer.name.toLowerCase().includes(term) || 
        (customer.email && customer.email.toLowerCase().includes(term))
      );
    }
    
    if (statusFilter !== "all") {
      const isActive = statusFilter === "active";
      result = result.filter(customer => customer.active === isActive);
    }
    
    setFilteredCustomers(result);
  };

  const handleDeleteCustomer = async (id: string) => {
    try {
      await storageService.deleteCustomer(id);
      await loadCustomers();
      setCustomerToDelete(null);
      
      toast({
        title: "Cliente eliminado",
        description: "El cliente ha sido eliminado correctamente",
      });
      
      // Notificar que hubo un cambio en los clientes
      triggerCustomerUpdate();
    } catch (error) {
      logger.error('Error deleting customer:', error);
      toast({
        title: "Error al eliminar",
        description: "No se pudo eliminar el cliente. Por favor, intente de nuevo.",
        variant: "destructive",
      });
    }
  };

  const handleCreateCustomer = async (data: CustomerFormValues) => {
    setIsSubmitting(true);
    setFormError(null);
    
    try {
      await storageService.addCustomer({
        name: data.name,
        description: data.description || "",
        email: data.email || "",
        password: data.password || "",
        active: data.active,
        role: 'customer'
      });
      
      await loadCustomers();
      newCustomerForm.reset();
      setNewCustomerDialogOpen(false);
      
      toast({
        title: "Cliente creado",
        description: "El cliente ha sido creado correctamente",
      });
      
      // Notificar que hubo un cambio en los clientes
      triggerCustomerUpdate();
    } catch (error: any) {
      logger.error('Error creating customer:', error);
      setFormError(
        error.response?.data?.error || 
        error.response?.data?.details?.[0]?.message || 
        "Error al crear el cliente. Por favor, intente de nuevo."
      );
      
      toast({
        title: "Error al crear cliente",
        description: error.response?.data?.error || "No se pudo crear el cliente",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditCustomer = async (data: CustomerFormValues) => {
    if (!editingCustomer) return;
    
    setIsSubmitting(true);
    setFormError(null);
    
    try {
      // Only include password in the update if one was provided
      const updateData: Partial<Customer> = {
        name: data.name,
        description: data.description || "",
        email: data.email || "",
        active: data.active
      };
      
      // Only include password if it was provided (not empty)
      if (data.password) {
        updateData.password = data.password;
      }
      
      await storageService.updateCustomer(editingCustomer.id, updateData);
      await loadCustomers();
      
      toast({
        title: "Cliente actualizado",
        description: "El cliente ha sido actualizado correctamente",
      });
      
      // Notificar que hubo un cambio en los clientes
      triggerCustomerUpdate();
      
      editCustomerForm.reset();
      setEditCustomerDialogOpen(false);
      setEditingCustomer(null);
    } catch (error: any) {
      logger.error('Error updating customer:', error);
      setFormError(
        error.response?.data?.error || 
        error.response?.data?.details?.[0]?.message || 
        "Error al actualizar el cliente. Por favor, intente de nuevo."
      );
      
      toast({
        title: "Error al actualizar cliente",
        description: error.response?.data?.error || "No se pudo actualizar el cliente",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditDialog = (customer: Customer) => {
    setEditingCustomer(customer);
    editCustomerForm.reset({
      name: customer.name,
      description: customer.description || "",
      email: customer.email || "",
      password: "",  // No mostrar la contraseña actual
      active: customer.active
    });
    setEditCustomerDialogOpen(true);
  };

  const resetForm = () => {
    newCustomerForm.reset();
    editCustomerForm.reset();
    setFormError(null);
  };

  const formatDate = (dateString: string) => {
    try {
      return format(new Date(dateString), 'MMM dd, yyyy');
    } catch (error) {
      return 'Invalid Date';
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold flex items-center">
          <Users className="mr-2 h-5 w-5" />
          Customers
        </h2>
        <div className="flex gap-2">
            <Dialog open={newCustomerDialogOpen} onOpenChange={(open) => {
              setNewCustomerDialogOpen(open);
              if (!open) resetForm();
            }}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Customer
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add New Customer</DialogTitle>
                  <DialogDescription>
                    Enter the details of the new customer.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={newCustomerForm.handleSubmit(handleCreateCustomer)}>
                  <div className="space-y-4 py-4">
                    {formError && (
                      <div className="bg-red-50 p-3 rounded-md flex items-center gap-2 text-red-700 text-sm">
                        <AlertCircle className="h-4 w-4" />
                        {formError}
                      </div>
                    )}
                    
                    <div className="grid grid-cols-1 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="name">Name *</Label>
                        <Input 
                          id="name" 
                          {...newCustomerForm.register("name")}
                          placeholder="Customer name"
                        />
                        {newCustomerForm.formState.errors.name && (
                          <p className="text-sm text-red-500">{newCustomerForm.formState.errors.name.message}</p>
                        )}
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="description">Description</Label>
                        <Textarea 
                          id="description" 
                          {...newCustomerForm.register("description")}
                          placeholder="Optional description"
                        />
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="email">Email (optional)</Label>
                          <Input 
                            id="email" 
                            type="text"
                            {...newCustomerForm.register("email")}
                            placeholder="contact@example.com"
                          />
                          {newCustomerForm.formState.errors.email && (
                            <p className="text-sm text-red-500">{newCustomerForm.formState.errors.email.message}</p>
                          )}
                        </div>
                        
                        <div className="space-y-2">
                          <Label htmlFor="password">Password</Label>
                          <Input 
                            id="password" 
                            type="password"
                            {...newCustomerForm.register("password")}
                            placeholder="Leave empty for no password"
                          />
                          {newCustomerForm.formState.errors.password && (
                            <p className="text-sm text-red-500">{newCustomerForm.formState.errors.password.message}</p>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-2 pt-2">
                        <Switch 
                          id="active" 
                          checked={newCustomerForm.watch("active")}
                          onCheckedChange={(checked) => newCustomerForm.setValue("active", checked)}
                        />
                        <Label htmlFor="active">Active</Label>
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-end space-x-4">
                    <Button variant="outline" type="button" onClick={() => {
                      resetForm();
                      setNewCustomerDialogOpen(false);
                    }}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={isSubmitting || !newCustomerForm.formState.isValid}>
                      {isSubmitting ? "Creating..." : "Create Customer"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
      </div>

      {/* Nueva sección de filtros */}
      <Card className="mb-6">
        <div className="p-4">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-medium">Filtros</h3>
            <Button 
              variant={showFilters ? "default" : "outline"} 
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
            >
              <Filter className="h-4 w-4 mr-2" />
              {showFilters ? "Ocultar Filtros" : "Mostrar Filtros"}
            </Button>
          </div>
          
          {showFilters && (
            <div className="flex flex-wrap gap-4 items-end">
              <div className="space-y-2 min-w-[280px]">
                <Label htmlFor="search">Buscar</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="search"
                    placeholder="Buscar por nombre o email..."
                    className="pl-8"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
              </div>
              
              <div className="space-y-2 min-w-[180px]">
                <Label htmlFor="status">Estado</Label>
                <Select
                  value={statusFilter}
                  onValueChange={setStatusFilter}
                >
                  <SelectTrigger id="status" className="w-full">
                    <SelectValue placeholder="Todos los estados" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos los estados</SelectItem>
                    <SelectItem value="active">Activos</SelectItem>
                    <SelectItem value="inactive">Inactivos</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <Button 
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearchTerm("");
                  setStatusFilter("all");
                  loadCustomers(); // Recargar sin filtros
                }}
              >
                Limpiar Filtros
              </Button>
              
              <Button 
                variant="default"
                size="sm"
                onClick={() => loadCustomers()} // Aplicar filtros
              >
                Aplicar
              </Button>
            </div>
          )}
        </div>
      </Card>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCustomers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-6 text-sm text-neutral-500">
                  No customers found. Add your first customer to get started.
                </TableCell>
              </TableRow>
            ) : (
              filteredCustomers.map((customer) => (
                <TableRow key={customer.id}>
                  <TableCell className="font-medium">{customer.name}</TableCell>
                  <TableCell>{customer.email || "-"}</TableCell>
                  <TableCell>
                    {customer.active ? (
                      <Badge variant="outline" className="bg-green-100 text-green-800">Active</Badge>
                    ) : (
                      <Badge variant="outline" className="bg-red-100 text-red-800">Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end space-x-2">
                      <Button 
                        variant="ghost" 
                        size="icon"
                        onClick={() => openEditDialog(customer)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete the customer "{customer.name}".
                              This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction 
                              onClick={() => handleDeleteCustomer(customer.id)}
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
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={editCustomerDialogOpen} onOpenChange={(open) => {
        setEditCustomerDialogOpen(open);
        if (!open) {
          setEditingCustomer(null);
          resetForm();
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Customer</DialogTitle>
            <DialogDescription>
              Update the customer information.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={editCustomerForm.handleSubmit(handleEditCustomer)}>
            <div className="space-y-4 py-4">
              {formError && (
                <div className="bg-red-50 p-3 rounded-md flex items-center gap-2 text-red-700 text-sm">
                  <AlertCircle className="h-4 w-4" />
                  {formError}
                </div>
              )}
              
              <div className="grid grid-cols-1 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-name">Name *</Label>
                  <Input 
                    id="edit-name" 
                    {...editCustomerForm.register("name")}
                    placeholder="Customer name"
                  />
                  {editCustomerForm.formState.errors.name && (
                    <p className="text-sm text-red-500">{editCustomerForm.formState.errors.name.message}</p>
                  )}
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="edit-description">Description</Label>
                  <Textarea 
                    id="edit-description" 
                    {...editCustomerForm.register("description")}
                    placeholder="Optional description"
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-email">Email (optional)</Label>
                    <Input 
                      id="edit-email" 
                      type="text"
                      {...editCustomerForm.register("email")}
                      placeholder="contact@example.com"
                    />
                    {editCustomerForm.formState.errors.email && (
                      <p className="text-sm text-red-500">{editCustomerForm.formState.errors.email.message}</p>
                    )}
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="edit-password">Password</Label>
                    <Input 
                      id="edit-password" 
                      type="password"
                      {...editCustomerForm.register("password")}
                      placeholder="Leave empty to keep current password"
                    />
                    {editCustomerForm.formState.errors.password && (
                      <p className="text-sm text-red-500">{editCustomerForm.formState.errors.password.message}</p>
                    )}
                  </div>
                </div>
                
                <div className="flex items-center space-x-2 pt-2">
                  <Switch 
                    id="edit-active" 
                    checked={editCustomerForm.watch("active")}
                    onCheckedChange={(checked) => editCustomerForm.setValue("active", checked)}
                  />
                  <Label htmlFor="edit-active">Active</Label>
                </div>
              </div>
            </div>
            <div className="flex justify-end space-x-4">
              <Button variant="outline" type="button" onClick={() => {
                resetForm();
                setEditCustomerDialogOpen(false);
                setEditingCustomer(null);
              }}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting || !editCustomerForm.formState.isValid}>
                {isSubmitting ? "Updating..." : "Update Customer"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}