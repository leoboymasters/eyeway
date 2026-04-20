
import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { users } from '@/data/mockUsers';
import { useToast } from "@/hooks/use-toast";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const AuthModal = ({ isOpen, onClose, onSuccess }: AuthModalProps) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    
    // Simulate authentication delay
    setTimeout(() => {
      const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
      
      if (user && password.length >= 6) {
        toast({
          title: "Logged in successfully",
          description: `Welcome back, ${user.name}!`,
        });
        onSuccess();
      } else {
        toast({
          variant: "destructive",
          title: "Authentication failed",
          description: "Invalid email or password.",
        });
      }
      
      setIsLoading(false);
    }, 1000);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="text-pothole-700">Welcome to Pothole Pulse</DialogTitle>
          <DialogDescription>
            Access the dashboard to manage pothole repairs
          </DialogDescription>
        </DialogHeader>
        
        <Tabs defaultValue="login" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login">Login</TabsTrigger>
            <TabsTrigger value="register">Register</TabsTrigger>
          </TabsList>
          
          <TabsContent value="login">
            <form onSubmit={handleSubmit} className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input 
                  id="email" 
                  placeholder="admin@potholepulse.com" 
                  value={email} 
                  onChange={(e) => setEmail(e.target.value)}
                  className="border-pothole-200 focus-visible:ring-pothole-500"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input 
                  id="password" 
                  type="password" 
                  placeholder="••••••••" 
                  value={password} 
                  onChange={(e) => setPassword(e.target.value)}
                  className="border-pothole-200 focus-visible:ring-pothole-500"
                  required
                />
              </div>
              <Button 
                type="submit" 
                className="w-full bg-pothole-500 hover:bg-pothole-600 text-white" 
                disabled={isLoading}
              >
                {isLoading ? "Signing in..." : "Sign in"}
              </Button>
              <div className="text-center text-sm text-muted-foreground pt-2">
                <p>For demo, use: admin@potholepulse.com / password123</p>
              </div>
            </form>
          </TabsContent>
          
          <TabsContent value="register">
            <div className="space-y-4 pt-4">
              <p className="text-muted-foreground text-center">Registration is currently by invitation only.</p>
              <p className="text-muted-foreground text-center">Please contact your administrator for access.</p>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
