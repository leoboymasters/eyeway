
import { Pothole } from '@/types';

export const potholes: Pothole[] = [
  {
    id: 'ph-001',
    location: {
      lat: 8.2380,
      lng: 124.2438,
      address: 'Andres Bonifacio Avenue, Iligan City'
    },
    severity: 'high',
    status: 'reported',
    detectionAccuracy: 0.92,
    reportDate: '2025-04-15T08:30:00Z',
    images: ['/placeholder.svg'],
    description: 'Large pothole causing traffic slowdowns during rush hour'
  },
  {
    id: 'ph-002',
    location: {
      lat: 8.2365,
      lng: 124.2442,
      address: 'Andres Bonifacio Avenue, Iligan City'
    },
    severity: 'medium',
    status: 'scheduled',
    detectionAccuracy: 0.87,
    reportDate: '2025-04-12T14:15:00Z',
    scheduledRepairDate: '2025-05-10T09:00:00Z',
    images: ['/placeholder.svg'],
    description: 'Medium-sized pothole near pedestrian crossing'
  },
  {
    id: 'ph-003',
    location: {
      lat: 8.2405,
      lng: 124.2445,
      address: 'Tibanga Highway, Iligan City'
    },
    severity: 'critical',
    status: 'in-progress',
    detectionAccuracy: 0.95,
    reportDate: '2025-04-10T11:45:00Z',
    scheduledRepairDate: '2025-05-01T08:00:00Z',
    images: ['/placeholder.svg'],
    description: 'Deep pothole causing damage to multiple vehicles'
  },
  {
    id: 'ph-004',
    location: {
      lat: 8.2348,
      lng: 124.2452,
      address: 'Quezon Avenue, Del Carmen, Iligan City'
    },
    severity: 'low',
    status: 'completed',
    detectionAccuracy: 0.81,
    reportDate: '2025-04-05T09:20:00Z',
    scheduledRepairDate: '2025-04-25T10:00:00Z',
    completionDate: '2025-04-27T14:30:00Z',
    images: ['/placeholder.svg'],
    description: 'Small pothole repaired ahead of schedule'
  },
  {
    id: 'ph-005',
    location: {
      lat: 8.2320,
      lng: 124.2435,
      address: 'General Aguinaldo Street, Poblacion, Iligan City'
    },
    severity: 'high',
    status: 'inspected',
    detectionAccuracy: 0.89,
    reportDate: '2025-04-18T13:10:00Z',
    images: ['/placeholder.svg'],
    description: 'Pothole in high-traffic area causing congestion'
  },
  {
    id: 'ph-006',
    location: {
      lat: 8.2298,
      lng: 124.2448,
      address: 'Pala-o Road, Poblacion, Iligan City'
    },
    severity: 'medium',
    status: 'reported',
    detectionAccuracy: 0.84,
    reportDate: '2025-04-20T16:05:00Z',
    images: ['/placeholder.svg'],
    description: 'Pothole near bus stop affecting public transportation'
  },
  {
    id: 'ph-007',
    location: {
      lat: 8.2285,
      lng: 124.2440,
      address: 'Maharlika Highway, Poblacion, Iligan City'
    },
    severity: 'critical',
    status: 'reported',
    detectionAccuracy: 0.93,
    reportDate: '2025-04-21T10:15:00Z',
    images: ['/placeholder.svg'],
    description: 'Severe road damage near commercial area'
  },
  {
    id: 'ph-008',
    location: {
      lat: 8.2268,
      lng: 124.2432,
      address: 'Maharlika Highway South, Iligan City'
    },
    severity: 'low',
    status: 'inspected',
    detectionAccuracy: 0.79,
    reportDate: '2025-04-19T14:30:00Z',
    images: ['/placeholder.svg'],
    description: 'Minor road crack near school zone'
  },
  {
    id: 'ph-009',
    location: {
      lat: 8.2335,
      lng: 124.2458,
      address: 'Macapagal Avenue, Del Carmen, Iligan City'
    },
    severity: 'medium',
    status: 'scheduled',
    detectionAccuracy: 0.86,
    reportDate: '2025-04-17T09:45:00Z',
    scheduledRepairDate: '2025-05-15T08:00:00Z',
    images: ['/placeholder.svg'],
    description: 'Road surface deterioration on main highway'
  },
  {
    id: 'ph-010',
    location: {
      lat: 8.2392,
      lng: 124.2435,
      address: 'Buhanginan Road, Tibanga, Iligan City'
    },
    severity: 'high',
    status: 'in-progress',
    detectionAccuracy: 0.91,
    reportDate: '2025-04-16T11:20:00Z',
    scheduledRepairDate: '2025-04-28T07:00:00Z',
    images: ['/placeholder.svg'],
    description: 'Multiple potholes affecting traffic flow'
  }
];
