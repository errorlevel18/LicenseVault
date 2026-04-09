import { useEffect, useState } from "react";
import { Customer } from "@/lib/types";
import { storageService } from "@/lib/storageService";
import { useSelectedCustomerId } from "@/hooks/use-selected-customer";
import { setSelectedCustomerId } from "@/lib/selectedCustomer";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { ChevronDown } from "lucide-react";
import logger from "@/lib/logger"; // Importamos el logger

// Clave para el evento de actualización de clientes
export const CUSTOMER_UPDATE_EVENT = "customer_update_event";

export function CustomerSelector() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const selectedCustomerId = useSelectedCustomerId();
  const [loading, setLoading] = useState(true);

  // Función para cargar los clientes
  const loadCustomers = async () => {
    try {
      setLoading(true);
      const allCustomers = await storageService.getCustomers();
      // Solo mostrar clientes activos en el selector
      setCustomers(allCustomers.filter(c => c.active));
    } catch (error) {
      logger.error("Error loading customers:", error);
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Cargar los clientes inicialmente
    loadCustomers();
    
    // Escuchar eventos de actualización de clientes
    const handleCustomerUpdate = () => {
      loadCustomers();
    };
    
    window.addEventListener(CUSTOMER_UPDATE_EVENT, handleCustomerUpdate);
    
    // Limpiar el evento al desmontar el componente
    return () => {
      window.removeEventListener(CUSTOMER_UPDATE_EVENT, handleCustomerUpdate);
    };
  }, []);

  const handleCustomerSelect = (customerId: string) => {
    const selectedId = customerId === "all" ? null : customerId;
    setSelectedCustomerId(selectedId);
  };

  // Si está cargando, mostrar un indicador o nada
  if (loading) {
    return null;
  }

  // Si no hay clientes, no mostrar el selector
  if (customers.length === 0) {
    return null;
  }

  // Encontrar el nombre del cliente seleccionado
  const selectedCustomerName = selectedCustomerId
    ? customers.find(c => c.id === selectedCustomerId)?.name || "Cliente desconocido"
    : "Seleccionar cliente";

  return (
    <div className="w-full">
      <Select
        value={selectedCustomerId || "all"}
        onValueChange={handleCustomerSelect}
      >
        <SelectTrigger className="w-full text-sm bg-white border-neutral-200 focus:ring-1 focus:ring-primary-500">
          <div className="flex items-center justify-between w-full">
            <span className="truncate">{selectedCustomerName}</span>
            <ChevronDown className="h-4 w-4 opacity-50" />
          </div>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos los clientes</SelectItem>
          {customers.map((customer) => (
            <SelectItem key={customer.id} value={customer.id}>
              {customer.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// Función para disparar la actualización de clientes desde cualquier componente
export function triggerCustomerUpdate() {
  window.dispatchEvent(new Event(CUSTOMER_UPDATE_EVENT));
}
