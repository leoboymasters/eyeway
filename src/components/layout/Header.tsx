
import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { currentUser } from '@/data/mockUsers';
import { AuthModal } from './AuthModal';
import logo from './logo.png';

export const Header = ({
  activePanel,
  togglePanel,
  isLoading = false,
  isPotholeDetailsOpen = false
}: {
  activePanel: 'filters' | 'data' | 'documents' | null,
  togglePanel: (panel: 'filters' | 'data' | 'documents') => void,
  isLoading?: boolean,
  isPotholeDetailsOpen?: boolean
}) => {
  const [isAuthenticated, setIsAuthenticated] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);

  const handleLogout = () => {
    setIsAuthenticated(false);
  };

  const handleLogin = () => {
    setShowAuthModal(true);
  };

  return (
    <header className={`fixed top-4 z-50 rounded-2xl bg-gradient-to-br from-white/20 via-white/15 to-white/10 backdrop-blur-2xl shadow-2xl border border-white/20 hover:border-white/30 hover:bg-gradient-to-br hover:from-white/25 hover:via-white/20 hover:to-white/15 hover:shadow-3xl hover:backdrop-blur-3xl ${
      isPotholeDetailsOpen
        ? // Match Index pothole rail: right-3 + min(24rem,100vw-1.5rem) + small gap.
          'left-4 md:right-[calc(0.75rem+min(24rem,calc(100vw-1.5rem))+0.5rem)] right-4 md:w-auto w-[calc(100%-2rem)]'
        : 'left-1/2 transform -translate-x-1/2 w-[calc(100%-2rem)] max-w-7xl mx-auto'
    }`}>
      <div className="px-3 sm:px-4 py-2.5 sm:py-3 flex justify-between items-center">
        <div className="flex items-center gap-2 sm:gap-4">
          <div className="flex items-center">
            <img 
              src={logo} 
              alt="Eyeway Logo" 
              className="w-7 h-7 sm:w-8 sm:h-8 object-contain"
            />
            <h1 className="text-base sm:text-xl md:text-2xl font-bold ml-1.5 sm:ml-2">Eyeway 2.0</h1>
          </div>
          
          {/* Desktop tabs */}
          <div className="hidden md:block">
            <Tabs value={activePanel || ""} className="w-fit">
              <TabsList className="bg-gray-100/50">
                <TabsTrigger
                  value="filters"
                  onClick={() => !isLoading && togglePanel('filters')}
                  disabled={isLoading}
                  className={`${activePanel === 'filters' ? 'bg-pothole-500 text-white' : ''} ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  Filters
                </TabsTrigger>
                <TabsTrigger 
                  value="data" 
                  onClick={() => togglePanel('data')}
                  className={activePanel === 'data' ? 'bg-pothole-500 text-white' : ''}
                >
                  Data
                </TabsTrigger>
                <TabsTrigger 
                  value="documents" 
                  onClick={() => togglePanel('documents')}
                  className={activePanel === 'documents' ? 'bg-pothole-500 text-white' : ''}
                >
                  Potholes
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
        
        <div className="flex items-center gap-2 sm:gap-4">
          {isAuthenticated ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-8 w-8 sm:h-9 sm:w-9 rounded-full p-0">
                  <Avatar className="h-8 w-8 sm:h-9 sm:w-9">
                    <AvatarImage src={currentUser.avatar} alt={currentUser.name} />
                    <AvatarFallback className="bg-pothole-200 text-pothole-800 text-xs">
                      {currentUser.name.split(' ').map(n => n[0]).join('')}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="flex items-center space-x-3">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={currentUser.avatar} alt={currentUser.name} />
                      <AvatarFallback className="bg-pothole-200 text-pothole-800 text-xs">
                        {currentUser.name.split(' ').map(n => n[0]).join('')}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium">{currentUser.name}</p>
                      <p className="text-xs text-muted-foreground">admin@eyeway.com</p>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>Profile</DropdownMenuItem>
                <DropdownMenuItem>Settings</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout}>Log out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button variant="outline" size="sm" className="text-pothole-600 border-pothole-300 hover:text-pothole-700 hover:border-pothole-400 text-xs sm:text-sm" onClick={handleLogin}>Sign In</Button>
          )}
        </div>
      </div>
      
      <AuthModal 
        isOpen={showAuthModal} 
        onClose={() => setShowAuthModal(false)}
        onSuccess={() => {
          setIsAuthenticated(true);
          setShowAuthModal(false);
        }}
      />
    </header>
  );
};

export default Header;
