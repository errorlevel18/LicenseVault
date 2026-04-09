import { ComponentType, Suspense, lazy } from "react";
import { Loader2 } from "lucide-react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/AppLayout";
import { AuthProvider } from "@/lib/AuthContext";
import { RequireAuth } from "@/components/layout/RequireAuth";

const LicensesPage = lazy(() => import("@/pages/LicensesPage"));
const HostsPage = lazy(() => import("@/pages/HostsPage"));
const EnvironmentsPage = lazy(() => import("@/pages/EnvironmentsPage"));
const InstancesPage = lazy(() => import("@/pages/InstancesPage"));
const CompliancePage = lazy(() => import("@/pages/CompliancePage"));
const CustomersPage = lazy(() => import("@/pages/CustomersPage"));
const MaintenancePage = lazy(() => import("@/pages/MaintenancePage"));
const ImportPage = lazy(() => import("@/pages/ImportPage"));
const LoginPage = lazy(() => import("@/pages/LoginPage"));
const NotFound = lazy(() => import("@/pages/not-found"));
const LicenseAssignment = lazy(() =>
  import("@/components/licenses/assignment/LicenseAssig").then((module) => ({
    default: module.LicenseAssignment,
  })),
);

type ProtectedRouteConfig = {
  path: string;
  adminOnly?: boolean;
  component: ComponentType;
};

const protectedRoutes: ProtectedRouteConfig[] = [
  { path: "/customers", component: CustomersPage },
  { path: "/maintenance", adminOnly: true, component: MaintenancePage },
  { path: "/import", adminOnly: true, component: ImportPage },
  { path: "/licenses/new", component: LicensesPage },
  { path: "/licenses/assign/:id", component: LicensesPage },
  { path: "/licenses/:id", component: LicensesPage },
  { path: "/licenses", component: LicensesPage },
  { path: "/license-assignment", component: LicenseAssignment },
  { path: "/hosts/:id/map-cores", component: HostsPage },
  { path: "/hosts/new", component: HostsPage },
  { path: "/hosts/:id", component: HostsPage },
  { path: "/hosts", component: HostsPage },
  { path: "/environments/new", component: EnvironmentsPage },
  { path: "/environments/:id", component: EnvironmentsPage },
  { path: "/environments", component: EnvironmentsPage },
  { path: "/instances/new", component: InstancesPage },
  { path: "/instances/:id", component: InstancesPage },
  { path: "/instances", component: InstancesPage },
  { path: "/compliance", component: CompliancePage },
  { path: "/", component: CompliancePage },
];

function RouteLoadingFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
      <span>Cargando modulo...</span>
    </div>
  );
}

function ProtectedRoute({ component: Component, adminOnly = false }: { component: ComponentType; adminOnly?: boolean }) {
  return (
    <RequireAuth adminOnly={adminOnly}>
      <Suspense fallback={<RouteLoadingFallback />}>
        <Component />
      </Suspense>
    </RequireAuth>
  );
}

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/login">
          <Suspense fallback={<RouteLoadingFallback />}>
            <LoginPage />
          </Suspense>
        </Route>

        {protectedRoutes.map((route) => (
          <Route key={route.path} path={route.path}>
            <ProtectedRoute adminOnly={route.adminOnly} component={route.component} />
          </Route>
        ))}

        <Route>
          <ProtectedRoute component={NotFound} />
        </Route>
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
