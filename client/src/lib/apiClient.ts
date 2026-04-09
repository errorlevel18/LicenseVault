import axios from 'axios';
import { authService } from './authService';
import logger from "@/lib/logger"; // Importamos el logger

// Create a custom axios instance
const apiClient = axios.create({
  baseURL: '/api'
});

// Add a request interceptor to include the auth token in all requests
apiClient.interceptors.request.use(
  (config) => {
    // Get the token from the auth service
    const token = authService.getToken();
    
    // If the token exists, add it to the Authorization header
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Add a response interceptor to handle 401 errors
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // If we get a 401 Unauthorized error, log the user out
    if (error.response && error.response.status === 401) {
      console.warn('API Client: 401 Unauthorized response received');
      // If we're not already on the login page, log the user out
      if (window.location.pathname !== '/login') {
        authService.logout();
        window.location.href = '/login';
      }
    }
    
    return Promise.reject(error);
  }
);

export default apiClient;