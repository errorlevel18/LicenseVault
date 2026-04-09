import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import logger from "@/lib/logger"; // Importamos el logger
import { storageService } from "@/lib/storageService";
import { useLocation } from "wouter";
import { Environment, Host, Instance } from "@/lib/types";

interface InstanceFormProps {
  instanceId?: string;
  environmentId?: string;
}

export function InstanceForm({ instanceId, environmentId }: InstanceFormProps) {
  const [_, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [hosts, setHosts] = useState<Host[]>([]);
  
  // Find the instance if editing
  const findInstance = async (): Promise<Instance | undefined> => {
    if (!instanceId) return undefined;
    
    const allEnvironments = await storageService.getEnvironments();
    for (const env of allEnvironments) {
      const instance = env.instances.find(i => i.id === instanceId);
      if (instance) return instance;
    }
    return undefined;
  };
  
  // Use state to store the found instance
  const [instance, setInstance] = useState<Instance | undefined>(undefined);
  
  // Set default values
  const defaultValues = instance ? {
    ...instance
  } : {
    name: "",
    hostId: "",
    environmentId: environmentId || "",
    sessions: 0
  };
  
  const form = useForm({
    defaultValues: defaultValues as any,
  });
  
  useEffect(() => {
    // Initial data load
    const loadData = async () => {
      // Load environments and hosts
      const allEnvironments = await storageService.getEnvironments();
      const allHosts = await storageService.getHosts();
      
      setEnvironments(allEnvironments);
      setHosts(allHosts);
      
      // If we have an instanceId, find the instance
      if (instanceId) {
        const foundInstance = await findInstance();
        setInstance(foundInstance);
        
        if (foundInstance) {
          // Update form with instance data
          form.reset({
            ...foundInstance
          });
        }
      }
      
      // If editing and environmentId is not provided but we have the instance
      if (instance && !environmentId) {
        form.setValue("environmentId", instance.environmentId);
      }
    };
    
    loadData();
  }, [instanceId, environmentId]);
  
  const onSubmit = async (data: Partial<Instance>) => {
    try {
      if (instanceId) {
        // Update existing instance
                // We need to find the environment that contains this instance
        const environment = environments.find(env => env.instances.some((i: Instance) => i.id === instanceId));
        if (!environment) {
          throw new Error("Environment not found for this instance");
        }
        
        // Update the instance in the environment
        const updatedInstances = environment.instances.map((i: Instance) => 
          i.id === instanceId ? { ...i, ...data } : i
        );
        
        await storageService.updateEnvironment(environment.id, {
          instances: updatedInstances
        });
        
        toast({
          title: "Instance updated",
          description: `Instance ${data.name} has been updated successfully.`
        });
      } else {
        // Create new instance
        // Find the environment to add the instance to
        const environment = environments.find(env => env.id === data.environmentId);
        if (!environment) {
          throw new Error("Environment not found");
        }
        
        // Create new instance
        const newInstance: Instance = {
          id: `instance-${Date.now()}`,
          name: data.name || "",
          hostId: data.hostId || "",
          environmentId: data.environmentId || "",
          sessions: data.sessions || 0
        };
        
        // Add instance to environment
        const updatedInstances = [...environment.instances, newInstance];
        
        await storageService.updateEnvironment(environment.id, {
          instances: updatedInstances
        });
        
        toast({
          title: "Instance created",
          description: `New instance ${data.name} has been created successfully.`
        });
      }
      
      // Redirect to instances page
      setLocation("/instances");
    } catch (error) {
      logger.error("Error saving instance:", error);
      toast({
        title: "Error",
        description: `Failed to save instance: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: "destructive"
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{instanceId ? "Edit Instance" : "Add New Instance"}</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Instance Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter instance name" {...field} />
                    </FormControl>
                    <FormDescription>
                      Database instance name (e.g., PROD1, DEV2)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="environmentId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Environment</FormLabel>
                    <Select 
                      onValueChange={field.onChange} 
                      defaultValue={field.value}
                      disabled={!!environmentId} // Disable if environmentId is provided
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select environment" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {environments.length === 0 ? (
                          <SelectItem value="none" disabled>No environments available</SelectItem>
                        ) : (
                          environments.map(env => (
                            <SelectItem key={env.id} value={env.id}>
                              {env.name} ({env.type}, {env.edition})
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="hostId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Host</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select host" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {hosts.length === 0 ? (
                          <SelectItem value="none" disabled>No hosts available</SelectItem>
                        ) : (
                          hosts.map(host => (
                            <SelectItem key={host.id} value={host.id}>
                              {host.name} ({host.serverType}, {host.cores} cores)
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      The server where this instance is running
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="sessions"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Number of Sessions</FormLabel>
                    <FormControl>
                      <Input 
                        type="number" 
                        min="0"
                        {...field} 
                        onChange={e => field.onChange(parseInt(e.target.value) || 0)}
                      />
                    </FormControl>
                    <FormDescription>
                      Current number of database sessions
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setLocation("/instances")}>
                Cancel
              </Button>
              <Button type="submit">
                {instanceId ? "Update Instance" : "Create Instance"}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
