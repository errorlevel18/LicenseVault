import { useEffect, useState } from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import logger from "@/lib/logger"; // Importamos el logger
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormDescription,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { storageService } from "@/lib/storageService";
import { useSelectedCustomerId } from "@/hooks/use-selected-customer";
import { Environment, Host, Instance, EnvironmentType, DatabaseEdition, DatabaseType, FeatureStatus } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { Database, Server, Plus, X, Pencil, Trash2, CalendarIcon } from "lucide-react";
import { format, parse } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

// Define interface for features in the form (extendiendo FeatureStat de types.ts)
interface Feature {
  id: number;
  name: string;
  currentlyUsed: boolean;
  detectedUsages: number;
  firstUsageDate: string | null;
  lastUsageDate: string | null;
  isEditing?: boolean;
  status: FeatureStatus; // Campo requerido por FeatureStat
}

type EnvironmentDraftValidation = {
  normalizedValues: {
    edition?: string;
    dbType?: string;
  };
  errors: {
    environmentName?: string;
    instanceName?: string;
    hostId?: string;
    form: string[];
  };
  isValid: boolean;
};

const formSchema = z.object({
  name: z.string().min(2, {
    message: "Name must be at least 2 characters.",
  }),
  description: z.string().optional(),
  version: z.string().min(1, {
    message: "Version is required.",
  }),
  edition: z.string().min(1, {
    message: "Edition is required.",
  }),
  type: z.string().min(1, {
    message: "Type is required.",
  }),
  licensable: z.boolean().optional(),
  primaryUse: z.string().min(1, {
    message: "Primary use is required.",
  }),
  dbType: z.string().min(1, {
    message: "Database type is required.",
  }),
  isDataGuard: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  managementPacks: z.array(z.string()).optional(),
});

type FormValues = z.infer<typeof formSchema>;

export interface EnvironmentFormProps {
  initialValues?: Environment;
  environmentId?: string;
}

export function EnvironmentForm({ initialValues, environmentId: propEnvironmentId }: EnvironmentFormProps) {
  const [_, navigate] = useLocation();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("basicInfo");
    // Add state to save form values when changing tabs
  const [formValues, setFormValues] = useState<FormValues | null>(null);
  
  // States for dynamically loaded reference data
  const [environmentTypes, setEnvironmentTypes] = useState<string[]>([]);
  const [databaseEditions, setDatabaseEditions] = useState<string[]>([]);
  const [primaryUses, setPrimaryUses] = useState<string[]>([]);
  const [databaseVersions, setDatabaseVersions] = useState<string[]>([]);
  const [dbTypes, setDbTypes] = useState<string[]>([]);
  
  // States for field disabling based on business rules
  const [isEditionDisabled, setIsEditionDisabled] = useState(false);
  const [isDbTypeDisabled, setIsDbTypeDisabled] = useState(false);
  const [filteredVersions, setFilteredVersions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [environment, setEnvironment] = useState<Environment | undefined>(initialValues);
  
  // Add state to properly track the current environmentId
  const [environmentId, setEnvironmentId] = useState<string | undefined>(propEnvironmentId);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [hosts, setHosts] = useState<Host[]>([]);
  
  // State for inline instance creation and editing
  const [isAddingInstance, setIsAddingInstance] = useState(false);
  const [newInstanceName, setNewInstanceName] = useState("");
  const [newInstanceHostId, setNewInstanceHostId] = useState("");
  const [editingInstance, setEditingInstance] = useState<Instance | null>(null);
  const [nameError, setNameError] = useState("");
  const [hostError, setHostError] = useState("");

  // State for features
  const [features, setFeatures] = useState<Feature[]>([]);

  // Get the selected customer ID
  const selectedCustomerId = useSelectedCustomerId();

  // Modified tab change handler to preserve form values
  const handleTabChange = (value: string) => {
    // Save current form values when changing tabs
    const currentValues = form.getValues();
    setFormValues(currentValues);
    setActiveTab(value);
  };

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: environment || {
      name: "",
      description: "",
      licensable: true,
      isDataGuard: false,
      options: [],
      managementPacks: [],
    },
  });

  // Load environment data if environmentId is provided
  // This depends on reference data being loaded first (loading === false)
  useEffect(() => {
    if (loading) return; // Wait for reference data to load
    
    const loadEnvironment = async () => {
      if (environmentId && !initialValues) {
        try {
          const env = await storageService.getEnvironment(environmentId);
          if (env) {
            setEnvironment(env);
            logger.info("Loaded environment data:", env);
            logger.info("Environment type:", env.type);
            logger.info("Environment edition:", env.edition);
            logger.info("Environment primaryUse:", env.primaryUse);
            logger.info("Environment dbType:", env.dbType);
            logger.info("Environment version:", env.version);
            
            // Helper to parse JSON string arrays from DB into actual arrays
            const parseJsonArray = (value: any): string[] => {
              if (!value) return [];
              if (Array.isArray(value)) return value;
              if (typeof value === 'string') {
                try { return JSON.parse(value); } catch { return []; }
              }
              return [];
            };

            // Reference data is already loaded, safe to set form values immediately
            form.reset({
              name: env.name || "",
              description: env.description || "",
              version: env.version || "",
              edition: env.edition || "",
              type: env.type || "",
              licensable: env.licensable ?? true,
              primaryUse: env.primaryUse || "",
              dbType: env.dbType || "",
              isDataGuard: env.isDataGuard ?? false,
              options: parseJsonArray(env.options),
              managementPacks: parseJsonArray(env.managementPacks),
            });
            
            // Update form fields directly to ensure controlled components see the values
            if (env.type) form.setValue("type", env.type);
            if (env.edition) form.setValue("edition", env.edition);
            if (env.primaryUse) form.setValue("primaryUse", env.primaryUse);
            if (env.version) form.setValue("version", env.version);
            if (env.dbType) form.setValue("dbType", env.dbType);

            logger.info("Form values after reset:", form.getValues());
            
            // Load feature stats for this environment
            loadFeatureStats(env.id);
          }
        } catch (error) {
          logger.error("Error loading environment:", error);
          toast({
            title: "Error",
            description: "Failed to load environment data",
            variant: "destructive",
          });
        }
      }
    };

    const loadFeatureStats = async (envId: string) => {
      try {
        // Get feature stats for this environment
        const featureStats = await storageService.getFeatureStats(envId);
        
        // Transform into our features state structure
        if (featureStats && featureStats.length > 0) {          setFeatures(featureStats.map(stat => ({
            id: stat.id,
            name: stat.name,
            currentlyUsed: stat.currentlyUsed,
            detectedUsages: stat.detectedUsages || 0,
            firstUsageDate: stat.firstUsageDate,
            lastUsageDate: stat.lastUsageDate,
            status: stat.status || 'Not Licensed' // Asegurarse que status siempre está presente
          })));
        } else {
          // If no feature stats yet, load features from license products
          await loadInitialFeatures(envId);
        }
      } catch (error) {
        logger.error("Error loading feature stats:", error);
      }
    };
    
    const loadInitialFeatures = async (envId: string) => {
      try {        // Get features and option packs instead of enterprise features
        const featuresAndOptionPacks = await storageService.getLicenseProductsByType();
        
        // Create initial feature stats for each product
        const initialFeatures = featuresAndOptionPacks.map((product, index) => ({
          id: -(index + 1), // Temp negative ID to show it's new
          name: product.product,
          currentlyUsed: false,
          detectedUsages: 0,
          firstUsageDate: null as string | null,
          lastUsageDate: null as string | null,
          status: 'Not Licensed' as FeatureStatus // Valor por defecto para status
        }));
        
        setFeatures(initialFeatures);
      } catch (error) {
        logger.error("Error loading features and option packs:", error);
      }
    };

    loadEnvironment();
  }, [environmentId, initialValues, form, loading]);

  // Load reference data and instances when component mounts
  useEffect(() => {
    const loadReferenceData = async () => {
      try {
        setLoading(true);
        
        // Load all reference data in parallel
        const [
          envTypesData,
          dbEditionsData,
          primaryUsesData,
          dbVersionsData,
          dbTypesData,
          allHosts
        ] = await Promise.all([
          storageService.getEnvironmentTypes(),
          storageService.getDatabaseEditions(),
          storageService.getPrimaryUses(),
          storageService.getDatabaseVersions(),
          storageService.getDatabaseTypes(),
          storageService.getHosts()
        ]);
        
        // Update states with loaded data
        setEnvironmentTypes(envTypesData);
        setDatabaseEditions(dbEditionsData);
        setPrimaryUses(primaryUsesData);
        setDatabaseVersions(dbVersionsData);
        setDbTypes(dbTypesData);
        setHosts(allHosts);
        
        // Initialize filtered versions with all versions
        setFilteredVersions(dbVersionsData);
        
        // Load instances if editing an environment
        if (environmentId || initialValues?.id) {
          const envId = environmentId || initialValues?.id;
          if (envId) {
            const env = await storageService.getEnvironment(envId);
            if (env) {
              setInstances(env.instances || []);
            }
          }
        }
        
      } catch (error) {
        logger.error("Error loading reference data:", error);
        toast({
          title: "Error",
          description: "Failed to load reference data",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };
    
    loadReferenceData();
  }, [environmentId, initialValues]);

  // Business rule 1: RAC or Rac One Node means Enterprise Edition and disabled
  useEffect(() => {
    const environmentType = form.getValues().type;
    
    if (environmentType === 'RAC' || environmentType === 'Rac One Node') {
      // Set to Enterprise Edition and disable the field
      form.setValue('edition', 'Enterprise');
      setIsEditionDisabled(true);
    } else {
      // Enable the field
      setIsEditionDisabled(false);
    }
  }, [form.watch('type')]);

  // Business rule 2: Version < 12 means Non-CDB and disabled database type
  // Business rule 3: CDB type requires version 12 or higher
  useEffect(() => {
    const version = form.getValues().version;
    const dbType = form.getValues().dbType;
    
    if (version) {
      // Extract version number (e.g., "Oracle Database 11g" -> 11)
      const versionMatch = version.match(/\d+/);
      const versionNumber = versionMatch ? parseInt(versionMatch[0], 10) : 0;
      
      if (versionNumber < 12) {
        // If version < 12, set to Non-CDB and disable
        form.setValue('dbType', 'Non-CDB');
        setIsDbTypeDisabled(true);
      } else {
        // Enable database type selection for version 12+
        setIsDbTypeDisabled(false);
      }
    }
    
    // If dbType is CDB, filter versions to show only 12+
    if (dbType === 'CDB') {
      const filteredVersionsList = databaseVersions.filter(ver => {
        const versionMatch = ver.match(/\d+/);
        const versionNumber = versionMatch ? parseInt(versionMatch[0], 10) : 0;
        return versionNumber >= 12;
      });
      setFilteredVersions(filteredVersionsList);
    } else {
      // Reset to show all versions
      setFilteredVersions(databaseVersions);
    }
  }, [form.watch('version'), form.watch('dbType'), databaseVersions]);

  const applyDraftValidation = (validation: EnvironmentDraftValidation, showToast = false) => {
    if (validation.normalizedValues.edition && validation.normalizedValues.edition !== form.getValues().edition) {
      form.setValue('edition', validation.normalizedValues.edition, { shouldDirty: true, shouldValidate: true });
    }

    if (validation.normalizedValues.dbType && validation.normalizedValues.dbType !== form.getValues().dbType) {
      form.setValue('dbType', validation.normalizedValues.dbType, { shouldDirty: true, shouldValidate: true });
    }

    if (validation.errors.environmentName) {
      form.setError('name', { type: 'server', message: validation.errors.environmentName });
    } else {
      form.clearErrors('name');
    }

    setNameError(validation.errors.instanceName || '');
    setHostError(validation.errors.hostId || '');

    if (showToast && validation.errors.form.length > 0) {
      toast({
        title: 'Validation error',
        description: validation.errors.form[0],
        variant: 'destructive',
      });
    }
  };

  const validateEnvironmentDraft = async (nextInstances: Instance[] = instances, showToast = false) => {
    const customerId = selectedCustomerId || environment?.customerId || initialValues?.customerId;

    if (!customerId) {
      return {
        normalizedValues: {},
        errors: { form: [] },
        isValid: true,
      } as EnvironmentDraftValidation;
    }

    const validation = await storageService.validateEnvironmentDraft({
      customerId,
      environmentId: environmentId || initialValues?.id,
      name: form.getValues().name,
      type: form.getValues().type,
      version: form.getValues().version,
      edition: form.getValues().edition,
      dbType: form.getValues().dbType,
      instances: nextInstances.map((instance) => ({
        id: instance.id,
        name: instance.name,
        hostId: instance.hostId,
        environmentId: instance.environmentId,
        isPrimary: instance.isPrimary,
        status: instance.status,
      })),
    });

    applyDraftValidation(validation, showToast);
    return validation;
  };

  async function onSubmit(data: FormValues) {
    try {      if (environmentId || initialValues?.id) {
        const validation = await validateEnvironmentDraft(instances, true);
        if (!validation.isValid) {
          return;
        }

        const normalizedData = {
          ...data,
          edition: validation.normalizedValues.edition ?? data.edition,
          dbType: validation.normalizedValues.dbType ?? data.dbType,
        };

        // Update existing environment
        const envId = environmentId || initialValues?.id;
        if (envId) {
          // Primero guardar environment sin feature stats para evitar problemas
          await storageService.updateEnvironment(envId, {
            ...normalizedData,
            instances: instances // Preservar instancias
          });
          
          // Mostrar información de progreso
          toast({
            title: "Actualizando features",
            description: `Procesando ${features.length} features...`,
          });
            // Ahora guardar feature stats con reintentos y espera entre solicitudes
          let successCount = 0;
          let failCount = 0;
          
          // Crear una función para guardar un feature con reintentos          
          try {
            // Mostrar mensaje de actualización en curso
            toast({
              title: "Actualizando features",
              description: `Procesando ${features.length} features...`,
              variant: "default"
            });

            // Preparar todos los feature stats en un único array
            const featureStatsArray = features.map(feature => ({
              id: feature.id > 0 ? feature.id : undefined,
              environmentId: envId,
              name: feature.name,
              status: feature.status || 'Not Licensed',
              currentlyUsed: feature.currentlyUsed !== undefined ? !!feature.currentlyUsed : false,
              detectedUsages: feature.detectedUsages !== undefined ? 
                parseInt(String(feature.detectedUsages || '0'), 10) || 0 : 0,
              firstUsageDate: feature.firstUsageDate,
              lastUsageDate: feature.lastUsageDate
            }));
            
            // Enviar todos los features en una sola llamada
            const result = await storageService.updateFeatureStatsBatch(envId, featureStatsArray);
            
            // Mostrar resultado
            toast({
              title: "Features actualizados",
              description: `${result.count} features guardados correctamente.`,
              variant: "default"
            });
          } catch (batchError) {
            console.error("Error procesando lote de features:", batchError);
            toast({
              title: "Error en actualización",
              description: "Hubo un problema al guardar los features",
              variant: "destructive"
            });
          }
            toast({
            title: "Environment Updated",
            description: "Environment has been successfully updated"
          });
        }
        // Don't navigate away after update
      } else {
        // Create new environment
        if (!selectedCustomerId) {
          toast({
            title: "Error",
            description: "No se ha seleccionado ningún cliente. Por favor, seleccione un cliente primero.",
            variant: "destructive"
          });
          return;
        }
        
        try {          // Make sure we have required fields
          const validation = await validateEnvironmentDraft(instances, true);
          if (!validation.isValid) {
            return;
          }

          const normalizedData = {
            ...data,
            edition: validation.normalizedValues.edition ?? data.edition,
            dbType: validation.normalizedValues.dbType ?? data.dbType,
          };

          if (!data.name) {
            toast({
              title: "Error",
              description: "Environment name is required",
              variant: "destructive"
            });
            return;
          }
          
          const newEnv = await storageService.addEnvironment({
            ...normalizedData,
            name: normalizedData.name, // Explicitly provide name as it's required
            instances: instances, // Incluir las instancias ya creadas en la interfaz
            featureStats: [], // Initialize empty feature stats array
            customerId: selectedCustomerId
          });
          
          if (newEnv && newEnv.id) {
            // Set the created environment and environmentId to change to edit mode
            setEnvironment(newEnv);
            setEnvironmentId(newEnv.id); // Use our state setter instead of direct assignment
            
            // Enable the tabs by setting the environmentId
            setActiveTab("instances"); // Switch to the instances tab
            
            // Load features and option packs for this environment
            const featuresAndOptionPacks = await storageService.getLicenseProductsByType();
            const initialFeatures = featuresAndOptionPacks.map((product, index) => ({
              id: -(index + 1), // Temp negative ID to show it's new
              name: product.product,
              currentlyUsed: false,
              detectedUsages: 0,
              firstUsageDate: null,
              lastUsageDate: null,
              status: 'Not Licensed' as FeatureStatus // Valor por defecto para status
            }));
            
            setFeatures(initialFeatures);
            
            toast({
              title: "Environment Created",
              description: "New environment has been successfully created. You can now add instances and configure features."
            });
            
            // Do not navigate away
            return;
          }
        } catch (error) {
          logger.error("Error creating environment:", error);
          const validation = (error as any)?.response?.data?.validation as EnvironmentDraftValidation | undefined;
          if (validation) {
            applyDraftValidation(validation, true);
            return;
          }

          toast({
            title: "Error",
            description: (error as any)?.response?.data?.error || "There was an error creating the environment. Please try again.",
            variant: "destructive",
          });
        }
      }
    } catch (error) {
      logger.error("Error saving environment:", error);
      const validation = (error as any)?.response?.data?.validation as EnvironmentDraftValidation | undefined;
      if (validation) {
        applyDraftValidation(validation, true);
        return;
      }

      toast({
        title: "Error",
        description: (error as any)?.response?.data?.error || "There was an error saving the environment",
        variant: "destructive",
      });
    }
  }

  // Handle adding instance inline
  const handleAddInstanceInline = async () => {
    // Validate inputs
    let hasError = false;
    
    if (!newInstanceName.trim()) {
      setNameError("Instance name is required");
      hasError = true;
    } else {
      setNameError("");
    }
    
    if (!newInstanceHostId) {
      setHostError("Host is required");
      hasError = true;
    } else {
      setHostError("");
    }
    
    if (hasError) return;

    const newInstance: Instance = {
      id: `instance-${Date.now()}`, // Temporary ID that will be replaced by server with a UUID
      name: newInstanceName.trim(),
      hostId: newInstanceHostId,
      environmentId: environmentId || initialValues?.id || "",
      isPrimary: false, // Default isPrimary to false
      status: "Running", // Set default status
      sessions: 0,
    };

    const nextInstances = [...instances, newInstance];
    const validation = await validateEnvironmentDraft(nextInstances, true);
    if (!validation.isValid) {
      return;
    }

    // Update local state with new instance
    setInstances(nextInstances);
    
    // Reset form fields
    setNewInstanceName("");
    setNewInstanceHostId("");
    setIsAddingInstance(false);

    toast({
      title: "Instance Added",
      description: `Instance ${newInstanceName} has been added`,
    });
  };

  // Start editing an instance
  const handleEditInstance = (instance: Instance) => {
    setEditingInstance(instance);
    setNewInstanceName(instance.name);
    setNewInstanceHostId(instance.hostId);
    setIsAddingInstance(true);
  };

  // Save edits to an instance
  const handleSaveInstanceEdit = async () => {
    // Validate inputs
    let hasError = false;
    
    if (!newInstanceName.trim()) {
      setNameError("Instance name is required");
      hasError = true;
    } else {
      setNameError("");
    }
    
    if (!newInstanceHostId) {
      setHostError("Host is required");
      hasError = true;
    } else {
      setHostError("");
    }
    
    if (hasError || !editingInstance) return;

    // Update the instance in the instances array
    const updatedInstances = instances.map(instance => 
      instance.id === editingInstance.id 
        ? { 
            ...instance, 
            name: newInstanceName.trim(),
            hostId: newInstanceHostId 
          } 
        : instance
    );

    const validation = await validateEnvironmentDraft(updatedInstances, true);
    if (!validation.isValid) {
      return;
    }
    
    setInstances(updatedInstances);
    
    // Reset form fields
    setNewInstanceName("");
    setNewInstanceHostId("");
    setIsAddingInstance(false);
    setEditingInstance(null);
    
    toast({
      title: "Instance Updated",
      description: `Instance ${newInstanceName} has been updated`,
    });
  };

  // Delete an instance
  const handleDeleteInstance = (instanceToDelete: Instance) => {
    if (confirm(`Are you sure you want to delete instance "${instanceToDelete.name}"?`)) {
      const updatedInstances = instances.filter(instance => instance.id !== instanceToDelete.id);
      setInstances(updatedInstances);
      
      toast({
        title: "Instance Deleted",
        description: `Instance ${instanceToDelete.name} has been deleted`,
      });
    }
  };

  // Cancel instance editing or creation
  const handleCancelInstanceEdit = () => {
    setNewInstanceName("");
    setNewInstanceHostId("");
    setNameError("");
    setHostError("");
    setIsAddingInstance(false);
    setEditingInstance(null);
  };

  const handleAddInstance = () => {
    const envId = environmentId || initialValues?.id;
    if (envId) {
      navigate(`/instances/new?environment=${envId}`);
    } else {
      toast({
        title: "Save Environment First",
        description: "Please save the environment before adding instances",
        variant: "default",
      });
    }
  };

  // Handle feature toggle
  const handleFeatureToggle = (featureId: number, checked: boolean) => {
    const updatedFeatures = features.map(feature => 
      feature.id === featureId 
        ? { 
            ...feature, 
            currentlyUsed: checked,
            // We don't auto-update the stats anymore as user will input them manually
            isEditing: checked // Start editing mode when feature is enabled
          } 
        : feature
    );
    
    setFeatures(updatedFeatures);
  };
  
  // Handle updating feature usage count
  const handleUpdateFeatureUsages = (featureId: number, value: string) => {
    const numValue = parseInt(value, 10);
    if (isNaN(numValue)) return;
    
    const updatedFeatures = features.map(feature => 
      feature.id === featureId 
        ? { ...feature, detectedUsages: numValue } 
        : feature
    );
    
    setFeatures(updatedFeatures);
  };
  
  // Handle updating first usage date
  const handleUpdateFirstUsageDate = (featureId: number, date: Date | undefined) => {
    const updatedFeatures = features.map(feature => 
      feature.id === featureId 
        ? { ...feature, firstUsageDate: date ? date.toISOString() : null } 
        : feature
    );
    
    setFeatures(updatedFeatures);
  };
  
  // Handle updating last usage date
  const handleUpdateLastUsageDate = (featureId: number, date: Date | undefined) => {
    const updatedFeatures = features.map(feature => 
      feature.id === featureId 
        ? { ...feature, lastUsageDate: date ? date.toISOString() : null } 
        : feature
    );
    
    setFeatures(updatedFeatures);
  };
  
  // Save feature changes
  const handleSaveFeatureChanges = (featureId: number) => {
    const updatedFeatures = features.map(feature => 
      feature.id === featureId 
        ? { ...feature, isEditing: false } 
        : feature
    );
    
    setFeatures(updatedFeatures);
  };
  
  // Cancel feature editing
  const handleCancelFeatureEdit = (featureId: number) => {
    const feature = features.find(f => f.id === featureId);
    if (!feature) return;
    
    // If this is a new feature being enabled, set it back to disabled
    if (feature.detectedUsages === 0 && !feature.firstUsageDate && !feature.lastUsageDate) {
      const updatedFeatures = features.map(f => 
        f.id === featureId 
          ? { ...f, currentlyUsed: false, isEditing: false } 
          : f
      );
      
      setFeatures(updatedFeatures);
    } else {
      // Otherwise just exit edit mode
      const updatedFeatures = features.map(f => 
        f.id === featureId 
          ? { ...f, isEditing: false } 
          : f
      );
      
      setFeatures(updatedFeatures);
    }
  };

  return (
    <Card className="w-full mx-auto border shadow-sm">
      <CardHeader className="bg-slate-50 border-b">
        <CardTitle>
          {initialValues || environmentId ? "Edit Environment" : "Add New Environment"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Tabs 
          defaultValue="basicInfo" 
          value={activeTab} 
          onValueChange={handleTabChange} 
          className="w-full"
        >
          <TabsList className="grid grid-cols-3 border-b rounded-none h-auto px-4 py-2">
            <TabsTrigger value="basicInfo" className="data-[state=active]:bg-white rounded py-2">Basic Information</TabsTrigger>
            <TabsTrigger 
              value="instances" 
              className="data-[state=active]:bg-white rounded py-2"
              disabled={!environmentId && !initialValues?.id && !environment?.id}
            >
              Instances
            </TabsTrigger>
            <TabsTrigger 
              value="features" 
              className="data-[state=active]:bg-white rounded py-2"
              disabled={!environmentId && !initialValues?.id && !environment?.id}
            >
              Features
            </TabsTrigger>
          </TabsList>
          
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 p-6">
              
              {/* Basic Information Tab */}
              <TabsContent value="basicInfo" className="space-y-4 mt-0">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Environment Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Enter environment name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">                  <FormField
                    control={form.control}
                    name="type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex">Environment Type <span className="text-destructive ml-1">*</span></FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value || ""}
                          disabled={loading}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select environment type"/>
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {environmentTypes.map((type) => (
                              <SelectItem key={type} value={type}>
                                {type}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormDescription>
                          Standalone, RAC, etc.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="primaryUse"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Primary Use</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value || ""}
                          disabled={loading}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select primary use"/>
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {primaryUses.map((use) => (
                              <SelectItem key={use} value={use}>
                                {use}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="edition"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Database Edition</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value || ""}
                          disabled={loading || isEditionDisabled}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select database edition"/>
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {databaseEditions.map((edition) => (
                              <SelectItem key={edition} value={edition}>
                                {edition}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="version"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Database Version</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value || ""}
                          disabled={loading}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select database version"/>
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {(filteredVersions.length > 0 ? filteredVersions : databaseVersions).map((version) => (
                              <SelectItem key={version} value={version}>
                                {version}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                    <FormField
                    control={form.control}
                    name="dbType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Database Type</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value || ""}
                          disabled={loading || isDbTypeDisabled}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select database type"/>
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {dbTypes.map((type) => (
                              <SelectItem key={type} value={type}>
                                {type}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="isDataGuard"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0 p-2">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Data Guard</FormLabel>
                          <FormDescription>
                            Enable if this environment is part of a Data Guard configuration.
                          </FormDescription>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </TabsContent>
              
              {/* Instances Tab */}
              <TabsContent value="instances" className="space-y-4 mt-0">
                {instances.length === 0 && !isAddingInstance ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Server className="h-12 w-12 text-gray-400 mb-4" />
                    <h3 className="text-lg font-medium text-gray-900">No instances added yet</h3>
                    <p className="mt-1 text-sm text-gray-500 max-w-sm">
                      Click 'Add Instance' to create a new instance in this environment.
                    </p>
                    <Button 
                      onClick={() => setIsAddingInstance(true)} 
                      className="mt-4"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Instance
                    </Button>
                  </div>
                ) : (
                  <div>
                    {isAddingInstance && (
                      <div className="mb-6 p-4 border rounded-lg bg-slate-50">
                        <div className="flex justify-between items-center mb-4">
                          <h3 className="text-sm font-medium">
                            {editingInstance ? `Edit Instance: ${editingInstance.name}` : 'Add New Instance'}
                          </h3>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={handleCancelInstanceEdit}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="flex flex-wrap gap-4">
                          <div className="flex-1 min-w-[200px]">
                            <FormLabel className="text-sm">Instance Name*</FormLabel>
                            <Input
                              value={newInstanceName}
                              onChange={(e) => {
                                setNewInstanceName(e.target.value);
                                if (e.target.value.trim()) setNameError("");
                              }}
                              placeholder="Enter instance name"
                              className={`mt-1 ${nameError ? "border-red-500" : ""}`}
                            />
                            {nameError && <p className="text-xs text-red-500 mt-1">{nameError}</p>}
                          </div>
                          <div className="flex-1 min-w-[200px]">
                            <FormLabel className="text-sm">Host*</FormLabel>
                            <Select
                              value={newInstanceHostId}
                              onValueChange={(value) => {
                                setNewInstanceHostId(value);
                                setHostError("");
                              }}
                            >
                              <SelectTrigger className={`mt-1 ${hostError ? "border-red-500" : ""}`}>
                                <SelectValue placeholder="Select host" />
                              </SelectTrigger>
                              <SelectContent>
                                {hosts.length === 0 ? (
                                  <SelectItem value="none" disabled>No hosts available</SelectItem>
                                ) : (
                                  hosts.map(host => (
                                    <SelectItem key={host.id} value={host.id}>
                                      {host.name}
                                    </SelectItem>
                                  ))
                                )}
                              </SelectContent>
                            </Select>
                            {hostError && <p className="text-xs text-red-500 mt-1">{hostError}</p>}
                          </div>
                          <div className="flex items-end">
                            <Button 
                              type="button" // Add type="button" here
                              onClick={editingInstance ? handleSaveInstanceEdit : handleAddInstanceInline}
                              className="mb-0.5"
                            >
                              {editingInstance ? "Update" : "Add"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    <div className="rounded-md border">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Name
                            </th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Host
                            </th>
                            <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Actions
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {instances.map((instance) => {
                            const host = hosts.find(h => h.id === instance.hostId);
                            return (
                              <tr key={instance.id}>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                  {instance.name}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                  {host ? host.name : 'Unknown Host'}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                  <div className="flex justify-end space-x-2">
                                    <Button 
                                      variant="ghost" 
                                      size="sm" 
                                      onClick={() => handleEditInstance(instance)}
                                      className="text-blue-600"
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                    <Button 
                                      variant="ghost" 
                                      size="sm" 
                                      onClick={() => handleDeleteInstance(instance)}
                                      className="text-red-600"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {!isAddingInstance && (
                      <div className="mt-4 flex justify-start">
                        <Button 
                          onClick={() => setIsAddingInstance(true)} 
                          variant="outline"
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          Add Instance
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </TabsContent>
              
              {/* Features Tab */}
              <TabsContent value="features" className="mt-0">
                <div className="p-4 border rounded-md bg-slate-50">
                  <h4 className="text-sm font-medium mb-4">Oracle Features Usage</h4>
                  <p className="text-xs text-gray-500 mb-4">
                    Indicate which Oracle features are currently used in this environment. This impacts licensing assessment.
                  </p>
                  
                  <div className="rounded-md border bg-white">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Feature Name
                          </th>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Currently Used
                          </th>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Detected Usages
                          </th>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            First Detected Usage
                          </th>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Last Detected Usage
                          </th>
                          <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {features.map((feature) => (
                          <tr key={feature.id} className={feature.isEditing ? "bg-blue-50" : ""}>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                              {feature.name}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              <div className="flex items-center">
                                <Checkbox
                                  checked={feature.currentlyUsed}
                                  onCheckedChange={(checked) => handleFeatureToggle(feature.id, !!checked)}
                                  className="mr-2"
                                />
                                <span>{feature.currentlyUsed ? "Yes" : "No"}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {feature.isEditing ? (
                                <Input
                                  type="number"
                                  min="0"
                                  value={feature.detectedUsages}
                                  onChange={(e) => handleUpdateFeatureUsages(feature.id, e.target.value)}
                                  className="w-20"
                                />
                              ) : (
                                feature.detectedUsages
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {feature.isEditing ? (
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <Button
                                      variant="outline"
                                      className={cn(
                                        "w-[240px] justify-start text-left font-normal",
                                        !feature.firstUsageDate && "text-muted-foreground"
                                      )}
                                    >
                                      <CalendarIcon className="mr-2 h-4 w-4" />
                                      {feature.firstUsageDate ? format(new Date(feature.firstUsageDate), "yyyy-MM-dd") : "Pick a date"}
                                    </Button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-auto p-0">
                                    <Calendar
                                      mode="single"
                                      selected={feature.firstUsageDate ? new Date(feature.firstUsageDate) : undefined}
                                      onSelect={(date) => handleUpdateFirstUsageDate(feature.id, date)}
                                      initialFocus
                                    />
                                  </PopoverContent>
                                </Popover>
                              ) : (
                                feature.firstUsageDate 
                                  ? format(new Date(feature.firstUsageDate), "yyyy-MM-dd") 
                                  : "-"
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {feature.isEditing ? (
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <Button
                                      variant="outline"
                                      className={cn(
                                        "w-[240px] justify-start text-left font-normal",
                                        !feature.lastUsageDate && "text-muted-foreground"
                                      )}
                                    >
                                      <CalendarIcon className="mr-2 h-4 w-4" />
                                      {feature.lastUsageDate ? format(new Date(feature.lastUsageDate), "yyyy-MM-dd") : "Pick a date"}
                                    </Button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-auto p-0">
                                    <Calendar
                                      mode="single"
                                      selected={feature.lastUsageDate ? new Date(feature.lastUsageDate) : undefined}
                                      onSelect={(date) => handleUpdateLastUsageDate(feature.id, date)}
                                      initialFocus
                                    />
                                  </PopoverContent>
                                </Popover>
                              ) : (
                                feature.lastUsageDate 
                                  ? format(new Date(feature.lastUsageDate), "yyyy-MM-dd") 
                                  : "-"
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                              {feature.isEditing ? (
                                <div className="flex justify-end space-x-2">
                                  <Button 
                                    variant="outline" 
                                    size="sm" 
                                    onClick={() => handleSaveFeatureChanges(feature.id)}
                                  >
                                    Save
                                  </Button>
                                  <Button 
                                    variant="ghost" 
                                    size="sm" 
                                    onClick={() => handleCancelFeatureEdit(feature.id)}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              ) : (
                                feature.currentlyUsed && (
                                  <Button 
                                    variant="ghost" 
                                    size="sm" 
                                    onClick={() => {
                                      const updatedFeatures = features.map(f => 
                                        f.id === feature.id 
                                          ? { ...f, isEditing: true } 
                                          : f
                                      );
                                      setFeatures(updatedFeatures);
                                    }}
                                    className="text-blue-600"
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                )
                              )}
                            </td>
                          </tr>
                        ))}
                        {features.length === 0 && (
                          <tr>
                            <td colSpan={6} className="px-6 py-4 whitespace-nowrap text-sm text-center text-gray-500">
                              {loading ? "Loading features..." : "No features available"}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </TabsContent>
              
              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => navigate("/environments")}>
                  Close
                </Button>
                <Button 
                  type="submit" 
                  disabled={loading}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {environmentId || initialValues?.id || environment?.id ? "Update Environment" : "Create Environment"}
                </Button>
              </div>
            </form>
          </Form>
        </Tabs>
      </CardContent>
    </Card>
  );
}
