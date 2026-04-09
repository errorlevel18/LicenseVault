import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Database, Tag, Server, Layers, Cpu, Users, PieChart, Download } from "lucide-react";
import { CustomerSelector } from "@/lib/CustomerSelector";
import { useAuth } from "@/lib/AuthContext";

interface NavItemProps {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  current: boolean;
}

function NavItem({ href, icon, children, current }: NavItemProps) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center px-3 py-2 text-base font-medium rounded-md",
        current
          ? "bg-primary-50 text-primary-600"
          : "text-neutral-700 hover:bg-neutral-100"
      )}
    >
      {icon}
      {children}
    </Link>
  );
}

export function Sidebar() {
  const [location] = useLocation();
  const { isAdmin } = useAuth();

  return (
    <aside className="w-64 bg-white border-r border-neutral-200 h-screen sticky top-0 overflow-y-auto shadow-md hidden lg:block">
      <div className="p-4 border-b border-neutral-200">
        <Link
          href="/"
          className="text-xl font-semibold text-primary-600 flex items-center cursor-pointer hover:text-primary-700 transition-colors"
        >
          <Layers className="h-10 w-10 mr-2 text-teal-500" />
          Oracle License Manager
        </Link>
      </div>
      
      <nav className="p-2">
        <div className="space-y-1">
          {/* Solo mostrar selector de cliente para administradores */}
          {isAdmin && (
            <div className="py-1 px-2 mb-2">
              <div className="mb-1 text-xs font-semibold text-neutral-500">
                CLIENTE ACTIVO
              </div>
              <CustomerSelector />
            </div>
          )}
          
          <NavItem
            href="/hosts"
            icon={<Server className="h-5 w-5 mr-3 text-indigo-500" />}
            current={location === "/hosts"}
          >
            Hosts
          </NavItem>

          <NavItem
            href="/environments"
            icon={<Database className="h-5 w-5 mr-3 text-blue-600" />}
            current={location === "/environments"}
          >
            Databases
          </NavItem>

          <NavItem
            href="/licenses"
            icon={<Tag className="h-5 w-5 mr-3 text-purple-500" />}
            current={location === "/licenses"}
          >
            Licenses
          </NavItem>
          
          {/* Analytics Section */}
          <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider pt-4 pb-1 px-2">
            Analytics
          </div>

          <NavItem
            href="/compliance"
            icon={<PieChart className="h-5 w-5 mr-3 text-orange-500" />}
            current={location === "/compliance"}
          >
            Compliance
          </NavItem>
          
          {/* Mostrar sección Management solo para administradores */}
          {isAdmin && (
            <>
              <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider pt-4 pb-1 px-2">
                Management
              </div>

              <NavItem
                href="/customers"
                icon={<Users className="h-5 w-5 mr-3 text-cyan-500" />}
                current={location === "/customers"}
              >
                Customers
              </NavItem>
              
              <NavItem
                href="/maintenance"
                icon={<Cpu className="h-5 w-5 mr-3 text-emerald-500" />}
                current={location === "/maintenance"}
              >
                Maintenance
              </NavItem>
              
              <NavItem
                href="/import"
                icon={<Download className="h-5 w-5 mr-3 text-amber-500" />}
                current={location === "/import"}
              >
                Import
              </NavItem>
            </>
          )}
        </div>
      </nav>
    </aside>
  );
}
