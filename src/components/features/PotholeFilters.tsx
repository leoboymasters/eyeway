
import React from 'react';
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue 
} from "@/components/ui/select";
import { Status, Severity } from '@/types';

interface PotholeFiltersProps {
  severity: Severity | 'all';
  status: Status | 'all';
  onSeverityChange: (severity: Severity | 'all') => void;
  onStatusChange: (status: Status | 'all') => void;
  onClearFilters: () => void;
  totalPotholes: number;
  filteredCount: number;
}

export const PotholeFilters = ({
  severity,
  status,
  onSeverityChange,
  onStatusChange,
  onClearFilters,
  totalPotholes,
  filteredCount
}: PotholeFiltersProps) => {
  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h3 className="font-semibold text-lg">Filter Potholes</h3>
          <Badge variant="outline" className="bg-pothole-50 text-pothole-700 border-pothole-200 w-fit">
            Showing {filteredCount} of {totalPotholes}
          </Badge>
        </div>

        <Separator />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="flex flex-col">
            <label className="text-sm font-medium mb-2 block text-gray-700">Severity</label>
            <Select
              value={severity}
              onValueChange={(value) => onSeverityChange(value as Severity | 'all')}
            >
              <SelectTrigger className="w-full border-pothole-200 focus:ring-pothole-500">
                <SelectValue placeholder="Filter by severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Severities</SelectItem>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col">
            <label className="text-sm font-medium mb-2 block text-gray-700">Status</label>
            <Select
              value={status}
              onValueChange={(value) => onStatusChange(value as Status | 'all')}
            >
              <SelectTrigger className="w-full border-pothole-200 focus:ring-pothole-500">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="reported">Reported</SelectItem>
                <SelectItem value="inspected">Inspected</SelectItem>
                <SelectItem value="scheduled">Scheduled</SelectItem>
                <SelectItem value="in-progress">In Progress</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col justify-end sm:col-span-2 lg:col-span-1">
            <Button
              variant="outline"
              onClick={onClearFilters}
              className="w-full border-pothole-300 text-pothole-700 hover:bg-pothole-50 h-10"
            >
              Clear Filters
            </Button>
          </div>
        </div>
    </div>
  );
};

export default PotholeFilters;
