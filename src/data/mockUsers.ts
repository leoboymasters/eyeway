
import { User } from '@/types';

export const users: User[] = [
  {
    id: 'u-001',
    name: 'Admin User',
    email: 'admin@potholepulse.com',
    role: 'admin',
    avatar: '/placeholder.svg'
  },
  {
    id: 'u-002',
    name: 'Maintenance Crew',
    email: 'crew@potholepulse.com',
    role: 'maintenance',
    avatar: '/placeholder.svg'
  },
  {
    id: 'u-003',
    name: 'Road Inspector',
    email: 'inspector@potholepulse.com',
    role: 'inspector',
    avatar: '/placeholder.svg'
  }
];

// For demo purposes, we'll use this as the current logged-in user
// For demo purposes, we'll use this as the current logged-in user
export const currentUser: User = {
  ...users[0],
  avatar: 'https://rickandmortyapi.com/api/character/avatar/2.jpeg' // Morty Smith
};
