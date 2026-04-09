import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Database, Menu, PieChart } from "lucide-react";
import { Button } from "@/components/ui/button";

export function MobileNav() {
  const [isOpen, setIsOpen] = useState(false);
  const [location] = useLocation();

  const toggleMenu = () => {
    setIsOpen(!isOpen);
  };

  const closeMenu = () => {
    setIsOpen(false);
  };

  return (
    <div className="lg:hidden fixed top-0 left-0 w-full bg-white border-b border-neutral-200 z-10">
      <div className="flex justify-between items-center p-4">
        <h1 className="text-lg font-semibold text-primary-600 flex items-center">
          <Database className="h-10 w-10 mr-2" />
          Oracle License Manager
        </h1>
        <Button 
          variant="ghost" 
          size="icon"
          onClick={toggleMenu}
          aria-label="Toggle menu"
          className="text-neutral-500 hover:text-neutral-700 focus:outline-none"
        >
          <Menu className="h-6 w-6" />
        </Button>
      </div>
      
      {isOpen && (
        <div className="bg-white border-b border-neutral-200 pb-3">
          <nav className="px-4 pt-2 pb-3 space-y-1">
            <Link href="/">
              <a 
                className={`block px-3 py-2 rounded-md text-base font-medium ${
                  location === "/" ? "bg-primary-50 text-primary-600" : "text-neutral-700 hover:bg-neutral-100"
                }`}
                onClick={closeMenu}
              >
                Overview
              </a>
            </Link>
            
            <Link href="/licenses">
              <a 
                className={`block px-3 py-2 rounded-md text-base font-medium ${
                  location === "/licenses" ? "bg-primary-50 text-primary-600" : "text-neutral-700 hover:bg-neutral-100"
                }`}
                onClick={closeMenu}
              >
                Licenses
              </a>
            </Link>
            
            <Link href="/hosts">
              <a 
                className={`block px-3 py-2 rounded-md text-base font-medium ${
                  location === "/hosts" ? "bg-primary-50 text-primary-600" : "text-neutral-700 hover:bg-neutral-100"
                }`}
                onClick={closeMenu}
              >
                Hosts
              </a>
            </Link>
            
            <Link href="/environments">
              <a 
                className={`block px-3 py-2 rounded-md text-base font-medium ${
                  location === "/environments" ? "bg-primary-50 text-primary-600" : "text-neutral-700 hover:bg-neutral-100"
                }`}
                onClick={closeMenu}
              >
                Environments
              </a>
            </Link>
            
            <Link href="/instances">
              <a 
                className={`block px-3 py-2 rounded-md text-base font-medium ${
                  location === "/instances" ? "bg-primary-50 text-primary-600" : "text-neutral-700 hover:bg-neutral-100"
                }`}
                onClick={closeMenu}
              >
                Instances
              </a>
            </Link>
            
            {/* Analytics section - added compliance link */}
            <div className="pt-2 pb-1 px-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">
              Analytics
            </div>
            
            <Link href="/compliance">
              <a 
                className={`block px-3 py-2 rounded-md text-base font-medium ${
                  location === "/compliance" ? "bg-primary-50 text-primary-600" : "text-neutral-700 hover:bg-neutral-100"
                }`}
                onClick={closeMenu}
              >
                Compliance
              </a>
            </Link>
            
            <div className="pt-2 pb-1 px-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">
              Management
            </div>

            <Link href="/customers">
              <a 
                className={`block px-3 py-2 rounded-md text-base font-medium ${
                  location === "/customers" ? "bg-primary-50 text-primary-600" : "text-neutral-700 hover:bg-neutral-100"
                }`}
                onClick={closeMenu}
              >
                Customers
              </a>
            </Link>
            
            <Link href="/maintenance">
              <a 
                className={`block px-3 py-2 rounded-md text-base font-medium ${
                  location === "/maintenance" ? "bg-primary-50 text-primary-600" : "text-neutral-700 hover:bg-neutral-100"
                }`}
                onClick={closeMenu}
              >
                Maintenance
              </a>
            </Link>
          </nav>
        </div>
      )}
    </div>
  );
}
