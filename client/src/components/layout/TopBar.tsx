import React, { useEffect, useState } from "react"; // Import React and hooks
import { useAuth } from "@/lib/AuthContext";
import { storageService } from "@/lib/storageService";
import { setSelectedCustomerId } from "@/lib/selectedCustomer";
import { Button } from "@/components/ui/button";
import { UserCircle, LogOut, Settings } from "lucide-react";
import logger from "@/lib/logger"; // Importamos el logger
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Customer } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";

export function TopBar() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [adminFormData, setAdminFormData] = useState({
    name: "",
    password: "",
    confirmPassword: "",
  });
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    description: "",
  });
  const [isLoadingCustomer, setIsLoadingCustomer] = useState(true);
  const [showLogoutWarning, setShowLogoutWarning] = useState(false);

  // Fetch selected customer data asynchronously
  useEffect(() => {
    const fetchCustomer = async () => {
      if (user?.role === 'customer') {
        setIsLoadingCustomer(true);
        try {
          // Ensure customer ID is set in storageService when logged in as customer
          if (user.id) {
            setSelectedCustomerId(user.id);
          }
          
          const selectedCustomerData = await storageService.getSelectedCustomer();
          
          if (selectedCustomerData) {
            setCustomer(selectedCustomerData);
            setFormData({
               email: selectedCustomerData.email || "",
               password: "",
               description: selectedCustomerData.description || "",
            });
          } else {
            setCustomer(null);
          }
        } catch (error) {
          logger.error("Failed to fetch selected customer:", error);
          setCustomer(null);
        } finally {
          setIsLoadingCustomer(false);
        }
      } else {
        setIsLoadingCustomer(false);
      }
    };

    if (user) {
      // Pre-fill admin form data
      if (user.role === 'admin') {
        setAdminFormData({
          name: user.name || "",
          password: "",
          confirmPassword: "",
        });
      }
      fetchCustomer();
    }
  }, [user]);

  const handleLogout = () => {
    logout();
    window.location.href = "/login";
  };

  // Prepare form data when opening the dialog
  const handleOpenEditProfile = () => {
    if (user?.role === 'admin') {
      setAdminFormData({
        name: user.name || "",
        password: "",
        confirmPassword: "",
      });
      setEditProfileOpen(true);
    } else if (customer) {
      setFormData({
        email: customer.email || "",
        password: "",
        description: customer.description || "",
      });
      setEditProfileOpen(true);
    } else {
      console.warn("Edit profile clicked, but no customer data available.");
    }
  };

  // Save profile changes
  const handleSaveProfile = async () => {
    // Handle admin profile update
    if (user?.role === 'admin') {
      // Validate passwords match if provided
      if (adminFormData.password && adminFormData.password !== adminFormData.confirmPassword) {
        toast({
          title: "Error",
          description: "Las contraseñas no coinciden",
          variant: "destructive",
        });
        return;
      }

      try {
        // Update the admin user
        const updatedData: any = {
          name: adminFormData.name,
        };
        
        // Only include password if provided
        if (adminFormData.password) {
          updatedData.password = adminFormData.password;
        }

        // Detect if important fields changed that require logout
        const requiresLogout = adminFormData.name !== user.name || adminFormData.password;
        
        // Here you'd call your API to update the admin profile
        // For example: await api.updateAdminProfile(updatedData);
        
        toast({
          title: "Perfil actualizado",
          description: "Los cambios en tu perfil han sido guardados.",
        });
        
        setEditProfileOpen(false);
        
        // If name or password changed, show a message and log out
        if (requiresLogout) {
          toast({
            title: "Sesión finalizada",
            description: "Has cambiado información crítica de tu perfil. Por favor, inicia sesión nuevamente.",
          });
          setTimeout(() => {
            logout();
            window.location.href = "/login";
          }, 1500);
        }
      } catch (error) {
        logger.error("Error updating admin profile:", error);
        toast({
          title: "Error",
          description: "No se pudo actualizar el perfil",
          variant: "destructive",
        });
      }
    }
    // Handle customer profile update
    else if (customer && user?.role === 'customer') {
      try {
        const updatedData: Partial<Customer> = {
          email: formData.email,
          description: formData.description,
        };
        
        if (formData.password) {
          updatedData.password = formData.password;
        }

        const success = await storageService.updateCustomer(customer.id, updatedData);

        if (success) {
          const updatedCustomer = await storageService.getCustomer(customer.id);
          if (updatedCustomer) {
            setCustomer(updatedCustomer);
          }
          setEditProfileOpen(false);
          
          toast({
            title: "Perfil actualizado",
            description: "Los cambios en tu perfil han sido guardados.",
          });
          
          // If password was changed, require re-login
          if (formData.password) {
            toast({
              title: "Sesión finalizada",
              description: "Has cambiado tu contraseña. Por favor, inicia sesión nuevamente.",
            });
            setTimeout(() => {
              logout();
              window.location.href = "/login";
            }, 1500);
          }
        } else {
          toast({
            title: "Error",
            description: "No se pudo actualizar el perfil",
            variant: "destructive",
          });
        }
      } catch (error) {
        logger.error("Error saving profile:", error);
        toast({
          title: "Error",
          description: "Ocurrió un error al guardar el perfil",
          variant: "destructive",
        });
      }
    }
  };

  // Determine if the edit profile option should be enabled
  const canEditProfile = (user?.role === 'customer' && !isLoadingCustomer && !!customer) || user?.role === 'admin';

  return (
    <div className="h-12 border-b bg-white flex items-center px-4 justify-between fixed top-0 right-0 left-0 md:left-64 z-30 transition-all duration-300">
      {/* Hamburger menu for mobile - Placeholder */}
      <div className="md:hidden">
          {/* Add a button here to toggle mobile sidebar visibility */}
      </div>

      {/* Optional: Breadcrumbs or Title based on location */}
      <div className="flex-1 hidden md:block">
          {/* e.g., <h1 className="text-lg font-semibold">Dashboard</h1> */}
      </div>

      <div className="flex items-center gap-4">
        {/* Welcome message - improved visibility */}
        <div className="text-sm text-gray-700 hidden md:block">
          {user?.role === 'admin' ? (
            <span>Welcome, <strong className="font-semibold">{user.name || 'Administrator'}</strong></span>
          ) : (
             <span>Welcome, <strong className="font-semibold">{customer?.name || user?.name || 'Customer'}</strong></span>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="relative h-8 w-8 rounded-full hover:bg-slate-100">
              <UserCircle className="h-5 w-5 text-gray-600" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end" forceMount>
            <div className="flex flex-col space-y-1 p-2">
              <p className="text-sm font-medium truncate">{isLoadingCustomer && user?.role === 'customer' ? 'Loading...' : (customer?.name || user?.name)}</p>
              <p className="text-xs text-muted-foreground">
                {user?.role === 'admin' ? 'Administrator' : (customer?.email || 'Customer')}
              </p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleOpenEditProfile} disabled={!canEditProfile}>
              <Settings className="mr-2 h-4 w-4" />
              <span>Settings</span>
              {isLoadingCustomer && user?.role === 'customer' && <span className="ml-auto text-xs text-gray-400">Loading...</span>}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-red-600 focus:text-red-700 focus:bg-red-50">
              <LogOut className="mr-2 h-4 w-4" />
              <span>Log Out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Edit Profile Dialog */}
        <Dialog open={editProfileOpen} onOpenChange={setEditProfileOpen}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>User Settings</DialogTitle>
              <DialogDescription>
                {user?.role === 'admin' 
                  ? 'Update your administrator account settings.' 
                  : 'Update your profile information.'} Click save when you're done.
              </DialogDescription>
            </DialogHeader>
            
            {/* Show different forms for admin vs customer */}
            {user?.role === 'admin' ? (
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="admin-name" className="text-right">Username</Label>
                  <Input
                    id="admin-name"
                    value={adminFormData.name}
                    onChange={(e) => setAdminFormData({...adminFormData, name: e.target.value})}
                    placeholder="Administrator name"
                    className="col-span-3"
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="admin-password" className="text-right">Password</Label>
                  <Input
                    id="admin-password"
                    type="password"
                    value={adminFormData.password}
                    onChange={(e) => {
                      setAdminFormData({...adminFormData, password: e.target.value});
                      setShowLogoutWarning(e.target.value.length > 0);
                    }}
                    placeholder="Leave blank to keep current"
                    className="col-span-3"
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="admin-confirm-password" className="text-right">Confirm Password</Label>
                  <Input
                    id="admin-confirm-password"
                    type="password"
                    value={adminFormData.confirmPassword}
                    onChange={(e) => setAdminFormData({...adminFormData, confirmPassword: e.target.value})}
                    placeholder="Confirm new password"
                    className="col-span-3"
                  />
                </div>
                
                {(showLogoutWarning || adminFormData.name !== user?.name) && (
                  <Alert className="mt-2 bg-amber-50 text-amber-800 border-amber-200">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      Al cambiar tu {adminFormData.name !== user?.name ? "nombre de usuario" : ""} 
                      {adminFormData.password && adminFormData.name !== user?.name ? " o " : ""}
                      {adminFormData.password ? "contraseña" : ""}, la sesión se cerrará automáticamente y tendrás que iniciar sesión nuevamente.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            ) : (
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="email" className="text-right">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({...formData, email: e.target.value})}
                    placeholder="your@email.com"
                    className="col-span-3"
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="password" className="text-right">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={formData.password}
                    onChange={(e) => {
                      setFormData({...formData, password: e.target.value});
                      setShowLogoutWarning(e.target.value.length > 0);
                    }}
                    placeholder="Leave blank to keep current"
                    className="col-span-3"
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="description" className="text-right self-start pt-2">Description</Label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData({...formData, description: e.target.value})}
                    placeholder="Optional description about the customer or account."
                    className="col-span-3 min-h-[80px]"
                  />
                </div>
                
                {showLogoutWarning && (
                  <Alert className="mt-2 bg-amber-50 text-amber-800 border-amber-200">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      Al cambiar tu contraseña, la sesión se cerrará automáticamente y tendrás que iniciar sesión nuevamente.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}
            
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditProfileOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveProfile}>
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}