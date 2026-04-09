import { useState, useEffect } from "react";
import { useForm, SubmitHandler } from "react-hook-form"; // Importar SubmitHandler
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"; // DialogFooter no se usa
import { ComboboxMulti } from "@/components/ui/combobox-multi";
import { License, Host } from "@/lib/types";
import { storageService } from "@/lib/storageService";
import { useSelectedCustomerId } from "@/hooks/use-selected-customer";
import { useLocation } from "wouter";
import { CoreSelectionDialog } from "@/components/licenses/assignment/CoreSelectionDialog";
import logger from "@/lib/logger"; // Importamos el logger
import apiClient from "@/lib/apiClient"; // Import apiClient to use the correct endpoint

// --- Interfaz para los datos del formulario ---
// Usaremos Date para las fechas aquí
interface LicenseFormData extends Omit<License, 'startDate' | 'endDate' | 'createdAt' | 'updatedAt'> {
  startDate?: Date; // Usa Date | undefined en el formulario
  endDate?: Date;   // Usa Date | undefined en el formulario
  comments?: string; // Add missing comments property
}

// Tipo temporal para el objeto 'temp-license' del diálogo (sigue necesitando strings ISO)
interface TempLicenseForDialog extends Omit<License, 'id' | 'createdAt' | 'updatedAt'> {
  id: string;
  startDate: string; // Cambiado: ahora es string requerido (no opcional)
  endDate: string;   // Cambiado: ahora es string requerido (no opcional)
  comments?: string; // Add missing comments property
  // Asegúrate de que otros campos requeridos en License también estén aquí
  // o que Omit los esté incluyendo correctamente.
}

interface HostAssignmentDraft {
  selectedCoreIds: number[];
  coreMappings?: Record<number, number>;
}


// Define the LicenseFormProps type
interface LicenseFormProps {
  licenseId?: string; // Optional license ID
  isDialog?: boolean; // Optional flag to indicate if it's a dialog
}

export function LicenseForm({ licenseId, isDialog = false }: LicenseFormProps) {
  const [_, setLocation] = useLocation();
  const { toast } = useToast();
  const [hosts, setHosts] = useState<Host[]>([]);
  const [defaultValuesLoaded, setDefaultValuesLoaded] = useState(false);
  const [products, setProducts] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // --- State para Core Selection Dialog ---
  const [coreDialogOpen, setCoreDialogOpen] = useState(false);
  const [selectedHostId, setSelectedHostId] = useState<string>("");
  const [pendingHostIds, setPendingHostIds] = useState<string[]>([]);
  const [confirmedPendingHostIds, setConfirmedPendingHostIds] = useState<string[]>([]);
  const [queuedHostSelection, setQueuedHostSelection] = useState<string[]>([]);
  const [dialogHost, setDialogHost] = useState<Host | null>(null);
  const [dialogLicense, setDialogLicense] = useState<TempLicenseForDialog | null>(null);
  const [draftAssignments, setDraftAssignments] = useState<Record<string, HostAssignmentDraft>>({});
  const [initialHostIds, setInitialHostIds] = useState<string[]>([]);

  const currentCustomerId = useSelectedCustomerId();

  // Usar el tipo de formulario con Date objects
  const form = useForm<LicenseFormData>({
    defaultValues: undefined,
  });

  // --- Funciones auxiliares para fechas ---
  const parseISOStringToDate = (isoString: string | undefined | null): Date | undefined => {
    return isoString ? new Date(isoString) : undefined;
  };

  const formatDateToISOString = (date: Date | undefined | null): string | undefined => {
    // Comprobar explícitamente que es una instancia de Date válida
    if (date instanceof Date && !isNaN(date.getTime())) {
      return date.toISOString();
    }
    return undefined;
  };

  const deriveLicenseType = (
    metric: string | undefined,
    existingLicenseType?: License["licenseType"]
  ): License["licenseType"] => {
    if (existingLicenseType === "Application User") {
      return existingLicenseType;
    }

    return metric === "Named User Plus" ? "Named User Plus" : "Processor";
  };

  // --- Carga de datos asíncrona ---
  
  // Load products from database
  useEffect(() => {
    const loadProducts = async () => {
      try {
        setLoading(true);
        const productsData = await storageService.getLicenseProducts();
        if (Array.isArray(productsData)) {
          setProducts(productsData.map(p => p.product));
        }
      } catch (error) {
        logger.error("Error loading license products:", error);
        toast({ title: "Error", description: "Could not load license products.", variant: "destructive" });
      } finally {
        setLoading(false);
      }
    };
    
    loadProducts();
  }, [toast]);

  // Cargar Hosts
  useEffect(() => {
    const loadHosts = async () => {
      try {
        const hostsData = await storageService.getHostsByCustomer();
        setHosts(Array.isArray(hostsData) ? hostsData : []);
      } catch (error) {
        logger.error("Error loading hosts:", error);
        setHosts([]);
        toast({ title: "Error", description: "Could not load hosts.", variant: "destructive" });
      }
    };
    loadHosts();
  }, [currentCustomerId, toast]);

  // Cargar valores por defecto
  useEffect(() => {
    const loadDefaultValues = async () => {
      let defaults: Partial<LicenseFormData>; // Usar el tipo del formulario
      if (licenseId) {
        try {
          const existingLicense = await storageService.getLicense(licenseId);
          if (existingLicense) {
            // Convertir strings ISO a objetos Date para el formulario
            defaults = {
              ...existingLicense,
              startDate: parseISOStringToDate(existingLicense.startDate),
              endDate: parseISOStringToDate(existingLicense.endDate),
              hostIds: existingLicense.hostIds || [],
            };
          } else {
            toast({ title: "Error", description: `License with ID ${licenseId} not found.`, variant: "destructive" });
            if (!isDialog) setLocation("/licenses");
            defaults = createNewLicenseDefaults(currentCustomerId);
          }
        } catch (error) {
          logger.error(`Error loading license ${licenseId}:`, error);
          toast({ title: "Error", description: "Could not load license data.", variant: "destructive" });
          if (!isDialog) setLocation("/licenses");
          defaults = createNewLicenseDefaults(currentCustomerId);
        }
      } else {
        defaults = createNewLicenseDefaults(currentCustomerId);
      }

      // Resetear el formulario con los valores correctos (Date objects)
      form.reset(defaults); // No necesita 'as any' si los tipos coinciden
      setInitialHostIds(defaults.hostIds || []);
      setDraftAssignments({});
      resetHostDialogState();
      setDefaultValuesLoaded(true);
    };

    loadDefaultValues();
  }, [licenseId, currentCustomerId, form, toast, setLocation, isDialog]); // Dependencias correctas

  // Función auxiliar para valores por defecto (devuelve tipo del formulario)
  const createNewLicenseDefaults = (customerId: string | null): Partial<LicenseFormData> => ({
    product: "",
    edition: "Enterprise",
    metric: "Processor",
    licenseType: "Processor",
    quantity: 0,
    startDate: new Date(), // Objeto Date
    endDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)), // Objeto Date
    status: "Active",
    hostIds: [],
    customerId: customerId ?? undefined,
    csi: undefined,
    comments: undefined,
  });


  // --- Watchers y lógica dependiente --- (Sin cambios relevantes aquí)
  useEffect(() => {
    if (!licenseId && defaultValuesLoaded) {
      form.setValue("customerId", currentCustomerId ?? undefined, { shouldDirty: true });
    }
  }, [currentCustomerId, licenseId, form, defaultValuesLoaded]);

  const watchedProduct = form.watch("product");
  const watchedMetric = form.watch("metric");
  useEffect(() => {
    if (watchedProduct !== "Oracle Database" && defaultValuesLoaded) {
      form.setValue("edition", "Enterprise", { shouldDirty: true });
    }
  }, [watchedProduct, form, defaultValuesLoaded]);

  useEffect(() => {
    if (!defaultValuesLoaded) {
      return;
    }

    const currentLicenseType = form.getValues("licenseType");
    const nextLicenseType = deriveLicenseType(watchedMetric, currentLicenseType);

    if (currentLicenseType !== nextLicenseType) {
      form.setValue("licenseType", nextLicenseType, { shouldDirty: true });
    }
  }, [watchedMetric, form, defaultValuesLoaded]);

  // --- Opciones para Selects y Combobox --- (Sin cambios)
  const editions = [/*...*/ "Enterprise", "Standard", "Standard One", "Standard 2", "Express" ];
  const metrics = [/*...*/ "Processor", "Named User Plus" ];
  const hostOptions = hosts.map(host => ({
    label: `${host.name} (${host.serverType || 'N/A'}, ${host.cores || 'N/A'} cores)`,
    value: host.id
  }));

  const resetHostDialogState = () => {
    setCoreDialogOpen(false);
    setSelectedHostId("");
    setPendingHostIds([]);
    setConfirmedPendingHostIds([]);
    setQueuedHostSelection([]);
    setDialogHost(null);
    setDialogLicense(null);
  };

  const keepAssignmentsForSelectedHosts = (selectedHostIds: string[]) => {
    setDraftAssignments(prev => Object.fromEntries(
      Object.entries(prev).filter(([hostId]) => selectedHostIds.includes(hostId))
    ));
  };

  const persistHostAssignments = async (
    targetLicenseId: string,
    hostAssignments: Record<string, HostAssignmentDraft>,
    removedHostIds: string[] = []
  ) => {
    for (const hostId of removedHostIds) {
      await apiClient.post(`/licenses/${targetLicenseId}/assign-to-host/${hostId}`, {
        selectedCoreIds: []
      });
    }

    for (const [hostId, assignment] of Object.entries(hostAssignments)) {
      await apiClient.post(`/licenses/${targetLicenseId}/assign-to-host/${hostId}`, {
        selectedCoreIds: assignment.selectedCoreIds,
        coreMappings: assignment.coreMappings
      });
    }
  };


  // --- Handlers ---

  // Submit del formulario (usa el tipo de datos del formulario)
  const onSubmit: SubmitHandler<LicenseFormData> = async (formData) => { // Tipar explícitamente
    try {
      const resolvedLicenseType = deriveLicenseType(formData.metric, formData.licenseType);

      // formData ahora contiene Date objects para startDate/endDate

      // Convertir Date objects a strings ISO ANTES de guardar
      const dataToSave: Partial<License> = {
        ...formData,
        licenseType: resolvedLicenseType,
        customerId: formData.customerId || currentCustomerId || undefined, // Asegurar customerId
        startDate: formatDateToISOString(formData.startDate), // Usa la función auxiliar
        endDate: formatDateToISOString(formData.endDate),     // Usa la función auxiliar
        hostIds: formData.hostIds || [],
      };

       if (!dataToSave.customerId) {
         toast({ title: "Error", description: "Customer ID is missing.", variant: "destructive" });
         return;
       }

      const selectedHostIds = dataToSave.hostIds || [];
      const stagedAssignments = Object.fromEntries(
        Object.entries(draftAssignments).filter(([hostId]) => selectedHostIds.includes(hostId))
      );

      if (licenseId) {
        // Update
        await storageService.updateLicense(licenseId, dataToSave);

        const removedHostIds = initialHostIds.filter(id => !selectedHostIds.includes(id));
        if (removedHostIds.length > 0 || Object.keys(stagedAssignments).length > 0) {
          try {
            await persistHostAssignments(licenseId, stagedAssignments, removedHostIds);
          } catch (assignmentError) {
            logger.error("Error applying staged host assignments after license update:", assignmentError);
            toast({
              title: "License updated with assignment errors",
              description: "The license was saved, but some host/core assignment changes could not be applied.",
              variant: "destructive"
            });

            setInitialHostIds(selectedHostIds);
            setDraftAssignments({});

            if (!isDialog) {
              setLocation("/licenses");
            }
            return;
          }
        }

        setInitialHostIds(selectedHostIds);
        setDraftAssignments({});
        toast({
          title: "License updated",
          description: `License for ${dataToSave.product} has been updated successfully.`
        });
      } else {
        // Create
        const { id, ...licenseToAdd } = dataToSave; // Quitar id si existe
        const createdLicense = await storageService.addLicense(licenseToAdd as Omit<License, 'id'>);

        if (Object.keys(stagedAssignments).length > 0) {
          try {
            await persistHostAssignments(createdLicense.id, stagedAssignments);
          } catch (assignmentError) {
            logger.error("Error applying staged host assignments after license creation:", assignmentError);
            toast({
              title: "License created with assignment errors",
              description: "The license was saved, but some host/core assignments could not be applied.",
              variant: "destructive"
            });

            setInitialHostIds(selectedHostIds);
            setDraftAssignments({});

            if (!isDialog) {
              setLocation("/licenses");
            }
            return;
          }
        }

        setInitialHostIds(selectedHostIds);
        setDraftAssignments({});
        toast({
          title: "License created",
          description: `New license for ${dataToSave.product} has been created successfully.`
        });
      }

      if (!isDialog) {
        setLocation("/licenses");
      }

    } catch (error) {
      logger.error("Error saving license:", error);
      toast({
        title: "Error",
        description: `Failed to save license: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: "destructive"
      });
    }
  };


  // Manejar cambio en selección de hosts (sin cambios en la lógica principal)
  const handleHostsChange = (selectedHostIds: string[]) => {
    const currentHostIds = form.getValues("hostIds") || [];
    const addedHostIds = selectedHostIds.filter(id => !currentHostIds.includes(id));

    if (addedHostIds.length > 0) {
      setQueuedHostSelection(selectedHostIds);
      setPendingHostIds(addedHostIds);
      setConfirmedPendingHostIds([]);
      void openCoreDialogForHost(addedHostIds[0]);
    } else {
      form.setValue("hostIds", selectedHostIds, { shouldDirty: true });
      keepAssignmentsForSelectedHosts(selectedHostIds);
    }
  };

  // Abre el diálogo de selección de cores para un host específico
  const openCoreDialogForHost = async (hostId: string) => {
    try {
       const host = await storageService.getHost(hostId);
       if (!host) {
           toast({ title: "Error", description: `Host with ID ${hostId} not found.`, variant: "destructive" });
           processNextPendingHost(hostId, false);
           return;
       }

       const formValues = form.getValues();

       // Crear el objeto de licencia temporal (ahora necesita strings no undefined)
       const tempLicense: TempLicenseForDialog = {
           id: licenseId || 'temp-license-' + Date.now(),
           product: formValues.product || "",
           name: formValues.product || "", // Add missing name property
           edition: formValues.edition || "Enterprise",
           licenseType: deriveLicenseType(formValues.metric, formValues.licenseType),
           metric: formValues.metric || "Processor",
           quantity: formValues.quantity || 0,
           // Convertir Date -> string ISO y añadir fallback a '' si es undefined
           startDate: formatDateToISOString(formValues.startDate) || '', // <-- Añadir fallback
           endDate: formatDateToISOString(formValues.endDate) || '',     // <-- Añadir fallback
           status: formValues.status || "Active",
           hostIds: formValues.hostIds || [],
           customerId: formValues.customerId, // Puede ser undefined si el tipo base lo permite
           csi: formValues.csi || undefined,
           comments: formValues.comments || undefined,
           // Copia otros campos requeridos de License si Omit no los cubre
            // Ejemplo: Si License tuviera un campo obligatorio 'category: string'
            // category: formValues.category || 'DefaultCategory',
       };

       setDialogHost(host);
       setDialogLicense(tempLicense);
       setSelectedHostId(hostId);
       setCoreDialogOpen(true);

    } catch (error) {
       logger.error("Error fetching host for core dialog:", error);
       toast({ title: "Error", description: "Could not prepare core selection.", variant: "destructive" });
       processNextPendingHost(hostId, false);
    }
 };

  // Procesa el siguiente host pendiente o finaliza (sin cambios)
   const processNextPendingHost = (completedHostId: string, keepSelection: boolean) => {
      const queuedHostIds = pendingHostIds;
      const remainingHosts = queuedHostIds.filter(id => id !== completedHostId);
      const nextConfirmedHostIds = keepSelection
        ? [...confirmedPendingHostIds, completedHostId]
        : confirmedPendingHostIds;

      setPendingHostIds(remainingHosts);
      setConfirmedPendingHostIds(nextConfirmedHostIds);

      if (remainingHosts.length > 0) {
          void openCoreDialogForHost(remainingHosts[0]);
          return;
      }

      const updatedHostIds = queuedHostSelection.filter(id => (
        !queuedHostIds.includes(id) || nextConfirmedHostIds.includes(id)
      ));

      form.setValue("hostIds", updatedHostIds, { shouldDirty: true });
      keepAssignmentsForSelectedHosts(updatedHostIds);
      resetHostDialogState();
  };

  // Confirmación del diálogo de selección de cores
  const handleCoreSelectionConfirm = async (selectedCoreIds: number[], coreMappings?: Record<number, number>) => {
    const hostIdToProcess = selectedHostId;
    if (!hostIdToProcess) return;

    try {
      const host = dialogHost;

      if (!host) {
        processNextPendingHost(hostIdToProcess, false);
            return;
        }

      setDraftAssignments(prev => ({
        ...prev,
        [hostIdToProcess]: {
        selectedCoreIds,
        coreMappings: host.hasHardPartitioning ? coreMappings : undefined
        }
      }));

      processNextPendingHost(hostIdToProcess, true);

    } catch (error) {
        logger.error("Error confirming core selection:", error);
        toast({ title: "Error", description: `Failed to update core assignments: ${error instanceof Error ? error.message : 'Unknown error'}`, variant: "destructive" });
      processNextPendingHost(hostIdToProcess, false);
    }
  };


  // --- Renderizado ---

  if (loading || !defaultValuesLoaded) { // Simplificado el loader
      return (
          <Card>
              <CardHeader><CardTitle>{licenseId ? "Edit License" : "Add New License"}</CardTitle></CardHeader>
              <CardContent>Loading data...</CardContent>
          </Card>
      );
  }

  // El FormContent ahora usa el formulario tipado con LicenseFormData
  const FormContent = (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <input type="hidden" {...form.register("customerId")} />
          <input type="hidden" {...form.register("licenseType")} />

          {/* Fields: Product, Edition, Metric, Quantity, CSI */}
          {/* (Sin cambios en la estructura JSX de estos campos) */}
           <FormField control={form.control} name="product" render={({ field }) => (<FormItem><FormLabel>Product</FormLabel><Select onValueChange={field.onChange} value={field.value || ""}><FormControl><SelectTrigger><SelectValue placeholder="Select a product" /></SelectTrigger></FormControl><SelectContent>{products.map(product => (<SelectItem key={product} value={product}>{product}</SelectItem>))}</SelectContent></Select><FormMessage /></FormItem>)} />
           <FormField control={form.control} name="edition" render={({ field }) => (<FormItem><FormLabel>Edition</FormLabel><Select onValueChange={field.onChange} value={field.value || ""} disabled={watchedProduct !== "Oracle Database"}><FormControl><SelectTrigger><SelectValue placeholder="Select edition" /></SelectTrigger></FormControl><SelectContent>{editions.map(edition => (<SelectItem key={edition} value={edition}>{edition}</SelectItem>))}</SelectContent></Select><FormMessage /></FormItem>)} />
           <FormField control={form.control} name="metric" render={({ field }) => (<FormItem><FormLabel>Metric</FormLabel><Select onValueChange={field.onChange} value={field.value || ""}><FormControl><SelectTrigger><SelectValue placeholder="Select metric" /></SelectTrigger></FormControl><SelectContent>{metrics.map(metric => (<SelectItem key={metric} value={metric}>{metric}</SelectItem>))}</SelectContent></Select><FormDescription>Compliance uses this field to calculate Processor or Named User Plus requirements.</FormDescription><FormMessage /></FormItem>)} />
           <FormField control={form.control} name="quantity" render={({ field }) => (<FormItem><FormLabel>Quantity</FormLabel><FormControl><Input type="number" min="0" {...field} value={field.value ?? 0} onChange={e => field.onChange(parseInt(e.target.value, 10) || 0)} /></FormControl><FormDescription>Number of licenses</FormDescription><FormMessage /></FormItem>)} />
           <FormField control={form.control} name="csi" render={({ field }) => (<FormItem><FormLabel>CSI</FormLabel><FormControl><Input type="text" placeholder="Número de contrato de soporte" {...field} value={field.value || ''} /></FormControl><FormDescription>Customer Support Identifier (Opcional)</FormDescription><FormMessage /></FormItem>)} />


          {/* Start Date Field */}
          <FormField
            control={form.control}
            name="startDate" // Nombre coincide con LicenseFormData
            render={({ field }) => ( // field.value es Date | undefined
              <FormItem className="flex flex-col">
                <FormLabel>Start Date</FormLabel>
                <DatePicker
                  // No necesita instanceof check aquí si field.value es Date | undefined
                  date={field.value}
                  setDate={(date) => field.onChange(date)} // onChange espera Date | undefined
                />
                <FormMessage />
              </FormItem>
            )}
          />

          {/* End Date Field */}
          <FormField
            control={form.control}
            name="endDate" // Nombre coincide con LicenseFormData
            render={({ field }) => ( // field.value es Date | undefined
              <FormItem className="flex flex-col">
                <FormLabel>End Date</FormLabel>
                <DatePicker
                  // No necesita instanceof check aquí
                  date={field.value}
                  setDate={(date) => field.onChange(date)}
                />
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Comments Field */}
          {/* (Sin cambios en la estructura JSX) */}
           <FormField control={form.control} name="comments" render={({ field }) => (<FormItem className="col-span-2"><FormLabel>Comments</FormLabel><FormControl><textarea className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50" placeholder="Add any relevant comments, notes or additional information about this license" {...field} value={field.value || ''} /></FormControl><FormMessage /></FormItem>)} />

        </div>

        {/* Buttons */}
        {/* (Sin cambios en la estructura JSX) */}
         <div className="flex justify-end gap-2">
           <Button type="button" variant="outline" onClick={() => { if (!isDialog) setLocation("/licenses"); }}>Cancel</Button>
           <Button type="submit" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? "Saving..." : (licenseId ? "Update License" : "Create License")}</Button>
         </div>
      </form>
    </Form>
  );

  // --- Renderizado condicional (Dialogo o Tarjeta) ---
  if (isDialog) {
    return (
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{licenseId ? "Edit License" : "Add New License"}</DialogTitle>
          <DialogDescription>
            {licenseId ? "Update the details..." : "Create a new license..."}
          </DialogDescription>
        </DialogHeader>
        {FormContent}
        {/* CoreSelectionDialog dentro del diálogo principal si es necesario */}
         {dialogHost && dialogLicense && (
           <CoreSelectionDialog
             host={dialogHost}
             // Pasamos el tipo TempLicenseForDialog, pero CoreSelectionDialog debe esperar License
             // Usamos 'as unknown as License' como antes, asumiendo que el diálogo puede manejarlo
             // Idealmente, CoreSelectionDialog debería aceptar Partial<License> o un tipo específico
             license={dialogLicense as unknown as License}
             open={coreDialogOpen}
             onOpenChange={(open) => {
               setCoreDialogOpen(open);
               if (!open) {
                 if (selectedHostId) {
                   processNextPendingHost(selectedHostId, false);
                 } else {
                   resetHostDialogState();
                 }
               }
             }}
             onConfirm={handleCoreSelectionConfirm}
             isEditing={false}
             loadAssignmentState={Boolean(licenseId)}
           />
         )}
      </DialogContent>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{licenseId ? "Edit License" : "Add New License"}</CardTitle>
      </CardHeader>
      <CardContent>
        {FormContent}
      </CardContent>
      {/* CoreSelectionDialog fuera si no es diálogo principal */}
      {dialogHost && dialogLicense && (
        <CoreSelectionDialog
          host={dialogHost}
          license={dialogLicense as unknown as License} // Igual que arriba
          open={coreDialogOpen}
          onOpenChange={(open) => {
              setCoreDialogOpen(open);
              if (!open) {
                if (selectedHostId) {
                  processNextPendingHost(selectedHostId, false);
                } else {
                  resetHostDialogState();
                }
              }
          }}
          onConfirm={handleCoreSelectionConfirm}
          isEditing={false}
          loadAssignmentState={Boolean(licenseId)}
        />
      )}
    </Card>
  );
}