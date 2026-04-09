import { QueryClient, QueryFunction } from "@tanstack/react-query";
import apiClient from "./apiClient";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  // Utilizar apiClient en lugar de fetch directo
  try {
    let response;
    if (method.toLowerCase() === "get") {
      response = await apiClient.get(url);
    } else if (method.toLowerCase() === "post") {
      response = await apiClient.post(url, data);
    } else if (method.toLowerCase() === "put") {
      response = await apiClient.put(url, data);
    } else if (method.toLowerCase() === "delete") {
      response = await apiClient.delete(url);
    } else {
      throw new Error(`Método no soportado: ${method}`);
    }
    
    // Convertir la respuesta de axios a una respuesta similar a fetch para mantener compatibilidad
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      statusText: response.statusText,
      // Agregar un método json() para mantener la compatibilidad con la API de fetch
      json: async () => response.data,
      text: async () => JSON.stringify(response.data),
    } as any;
  } catch (error: any) {
    // Manejar errores de axios
    if (error.response) {
      // La solicitud se realizó y el servidor respondió con un código de estado fuera del rango 2xx
      return {
        ok: false,
        status: error.response.status,
        statusText: error.response.statusText,
        json: async () => error.response.data,
        text: async () => JSON.stringify(error.response.data),
      } as any;
    } else {
      // Error de red u otro error
      throw error;
    }
  }
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    try {
      // Usar apiClient en lugar de fetch
      const response = await apiClient.get(queryKey[0] as string);
      return response.data;
    } catch (error: any) {
      // Manejar errores específicos de autenticación
      if (error.response && error.response.status === 401 && unauthorizedBehavior === "returnNull") {
        return null;
      }
      throw error;
    }
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
