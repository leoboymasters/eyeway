/**
 * Supabase-based storage manager for tracking processing tasks
 * Replaces localStorage with cloud database storage
 */

import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type ProcessingTaskRow = Database['public']['Tables']['processing_tasks']['Row'];
type ProcessingTaskInsert = Database['public']['Tables']['processing_tasks']['Insert'];
type ProcessingTaskUpdate = Database['public']['Tables']['processing_tasks']['Update'];

export interface ProcessingTask {
  id: string;
  taskId: string; // Internal/External task ID
  potholeId?: string | null;
  videoUrl?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  statusMessage?: string | null;
  error?: string | null;
  modelUrl?: string | null;
}

/**
 * Convert Supabase row to ProcessingTask
 */
function rowToTask(row: ProcessingTaskRow): ProcessingTask {
  return {
    id: row.id,
    taskId: row.external_task_id,
    potholeId: row.pothole_id,
    videoUrl: row.video_url,
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at,
    status: row.status as 'pending' | 'processing' | 'completed' | 'failed',
    progress: row.progress || 0,
    statusMessage: row.status_message,
    error: row.error_message,
    modelUrl: row.model_url
  };
}

/**
 * Get all processing tasks from Supabase
 * @param limit - Optional limit on number of tasks (default: 100)
 */
export async function getAllTasks(limit: number = 100): Promise<ProcessingTask[]> {
  try {
    const { data, error } = await supabase
      .from('processing_tasks')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching tasks from Supabase:', error);
      throw error;
    }

    return data ? data.map(rowToTask) : [];
  } catch (error) {
    console.error('Error reading tasks from Supabase:', error);
    return [];
  }
}

/**
 * Get a specific task by ID
 */
export async function getTaskById(id: string): Promise<ProcessingTask | null> {
  try {
    const { data, error } = await supabase
      .from('processing_tasks')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching task by ID:', error);
      return null;
    }

    return data ? rowToTask(data) : null;
  } catch (error) {
    console.error('Error reading task from Supabase:', error);
    return null;
  }
}

/**
 * Get a task by external task ID
 */
export async function getTaskByExternalId(externalTaskId: string): Promise<ProcessingTask | null> {
  try {
    const { data, error } = await supabase
      .from('processing_tasks')
      .select('*')
      .eq('external_task_id', externalTaskId)
      .single();

    if (error) {
      console.error('Error fetching task by external ID:', error);
      return null;
    }

    return data ? rowToTask(data) : null;
  } catch (error) {
    console.error('Error reading task from Supabase:', error);
    return null;
  }
}

/**
 * Add a new processing task to Supabase
 */
export async function addTask(
  externalTaskId: string,
  videoUrl?: string,
  potholeId?: string
): Promise<ProcessingTask | null> {
  try {
    const newTask: ProcessingTaskInsert = {
      external_task_id: externalTaskId,
      pothole_id: potholeId || null,
      video_url: videoUrl || null,
      status: 'pending',
      progress: 0,
      status_message: 'Initializing...'
    };

    const { data, error } = await supabase
      .from('processing_tasks')
      .insert(newTask)
      .select()
      .single();

    if (error) {
      console.error('Error creating task in Supabase:', error);
      throw error;
    }

    return data ? rowToTask(data) : null;
  } catch (error) {
    console.error('Error adding task to Supabase:', error);
    return null;
  }
}

/**
 * Update an existing task
 */
export async function updateTask(
  id: string,
  updates: Partial<ProcessingTask>
): Promise<ProcessingTask | null> {
  try {
    // Convert ProcessingTask updates to database format
    const dbUpdates: ProcessingTaskUpdate = {
      updated_at: new Date().toISOString()
    };

    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.progress !== undefined) dbUpdates.progress = updates.progress;
    if (updates.statusMessage !== undefined) dbUpdates.status_message = updates.statusMessage;
    if (updates.error !== undefined) dbUpdates.error_message = updates.error;
    if (updates.modelUrl !== undefined) dbUpdates.model_url = updates.modelUrl;
    if (updates.videoUrl !== undefined) dbUpdates.video_url = updates.videoUrl;
    if (updates.potholeId !== undefined) dbUpdates.pothole_id = updates.potholeId;

    const { data, error } = await supabase
      .from('processing_tasks')
      .update(dbUpdates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating task in Supabase:', error);
      return null;
    }

    return data ? rowToTask(data) : null;
  } catch (error) {
    console.error('Error updating task in Supabase:', error);
    return null;
  }
}

/**
 * Delete a task
 */
export async function deleteTask(id: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('processing_tasks')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting task from Supabase:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error deleting task from Supabase:', error);
    return false;
  }
}

/**
 * Clear all completed or failed tasks
 */
export async function clearCompletedTasks(): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('processing_tasks')
      .delete()
      .in('status', ['completed', 'failed']);

    if (error) {
      console.error('Error clearing completed tasks:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error clearing completed tasks:', error);
    return false;
  }
}

/**
 * Get active tasks (pending or processing)
 */
export async function getActiveTasks(): Promise<ProcessingTask[]> {
  try {
    const { data, error } = await supabase
      .from('processing_tasks')
      .select('*')
      .in('status', ['pending', 'processing'])
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching active tasks:', error);
      return [];
    }

    return data ? data.map(rowToTask) : [];
  } catch (error) {
    console.error('Error reading active tasks:', error);
    return [];
  }
}

/**
 * Get tasks by pothole ID
 */
export async function getTasksByPotholeId(potholeId: string): Promise<ProcessingTask[]> {
  try {
    const { data, error } = await supabase
      .from('processing_tasks')
      .select('*')
      .eq('pothole_id', potholeId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching tasks by pothole ID:', error);
      return [];
    }

    return data ? data.map(rowToTask) : [];
  } catch (error) {
    console.error('Error reading tasks by pothole ID:', error);
    return [];
  }
}

/**
 * Subscribe to real-time updates for all tasks
 * @param callback - Function to call when tasks change
 * @returns Unsubscribe function
 */
export function subscribeToTasks(
  callback: (payload: any) => void
): () => void {
  const channel = supabase
    .channel('processing_tasks_changes')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'processing_tasks'
      },
      callback
    )
    .subscribe();

  // Return unsubscribe function
  return () => {
    supabase.removeChannel(channel);
  };
}
