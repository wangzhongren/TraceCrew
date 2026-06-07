/**
 * Unit tests for frontend/src/store/taskStore.ts
 *
 * Tests Zustand state management for background tasks.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useTaskStore, type BackgroundTask } from '../src/store/taskStore';

function makeTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: 'task-1',
    type: 'shell',
    label: 'Test task',
    status: 'running',
    startedAt: Date.now(),
    detail: '',
    ...overrides,
  };
}

beforeEach(() => {
  // Reset store between tests
  useTaskStore.setState({ tasks: [], visible: false });
});

// ═══════════════════════════════════════════════════════════════════
// addTask
// ═══════════════════════════════════════════════════════════════════

describe('addTask', () => {
  it('adds a task to the list', () => {
    const task = makeTask();
    useTaskStore.getState().addTask(task);

    const state = useTaskStore.getState();
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].id).toBe('task-1');
    expect(state.tasks[0].label).toBe('Test task');
  });

  it('deduplicates by id (replaces existing)', () => {
    const task1 = makeTask({ id: 'dup', label: 'First' });
    const task2 = makeTask({ id: 'dup', label: 'Second' });

    useTaskStore.getState().addTask(task1);
    useTaskStore.getState().addTask(task2);

    const state = useTaskStore.getState();
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].label).toBe('Second');
  });

  it('supports multiple different tasks', () => {
    useTaskStore.getState().addTask(makeTask({ id: 't1', label: 'Task 1' }));
    useTaskStore.getState().addTask(makeTask({ id: 't2', label: 'Task 2' }));
    useTaskStore.getState().addTask(makeTask({ id: 't3', label: 'Task 3' }));

    expect(useTaskStore.getState().tasks).toHaveLength(3);
  });
});

// ═══════════════════════════════════════════════════════════════════
// updateTask
// ═══════════════════════════════════════════════════════════════════

describe('updateTask', () => {
  it('updates partial fields', () => {
    useTaskStore.getState().addTask(makeTask({ id: 't1', status: 'running' }));

    useTaskStore.getState().updateTask('t1', { status: 'done', exitCode: 0, detail: 'OK' });

    const task = useTaskStore.getState().tasks[0];
    expect(task.status).toBe('done');
    expect(task.exitCode).toBe(0);
    expect(task.detail).toBe('OK');
    // unchanged fields should persist
    expect(task.label).toBe('Test task');
  });

  it('does nothing for non-existent task id', () => {
    useTaskStore.getState().addTask(makeTask({ id: 't1' }));

    useTaskStore.getState().updateTask('nonexistent', { status: 'done' });

    expect(useTaskStore.getState().tasks).toHaveLength(1);
    expect(useTaskStore.getState().tasks[0].status).toBe('running');
  });
});

// ═══════════════════════════════════════════════════════════════════
// removeTask
// ═══════════════════════════════════════════════════════════════════

describe('removeTask', () => {
  it('removes a task by id', () => {
    useTaskStore.getState().addTask(makeTask({ id: 't1' }));
    useTaskStore.getState().addTask(makeTask({ id: 't2' }));
    useTaskStore.getState().addTask(makeTask({ id: 't3' }));

    useTaskStore.getState().removeTask('t2');

    const tasks = useTaskStore.getState().tasks;
    expect(tasks).toHaveLength(2);
    expect(tasks.map((t) => t.id)).toEqual(['t1', 't3']);
  });

  it('does nothing for non-existent id', () => {
    useTaskStore.getState().addTask(makeTask({ id: 't1' }));

    useTaskStore.getState().removeTask('nonexistent');

    expect(useTaskStore.getState().tasks).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// visibility
// ═══════════════════════════════════════════════════════════════════

describe('visibility', () => {
  it('toggles visible state', () => {
    expect(useTaskStore.getState().visible).toBe(false);

    useTaskStore.getState().toggleVisible();
    expect(useTaskStore.getState().visible).toBe(true);

    useTaskStore.getState().toggleVisible();
    expect(useTaskStore.getState().visible).toBe(false);
  });

  it('setVisible sets specific value', () => {
    useTaskStore.getState().setVisible(true);
    expect(useTaskStore.getState().visible).toBe(true);

    useTaskStore.getState().setVisible(false);
    expect(useTaskStore.getState().visible).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// integration: full task lifecycle
// ═══════════════════════════════════════════════════════════════════

describe('task lifecycle', () => {
  it('tracks running → done → remove', () => {
    const store = useTaskStore.getState();

    // Start task
    store.addTask(makeTask({
      id: 'lifecycle-test',
      type: 'analyze',
      label: 'Analyzing features',
      status: 'running',
    }));

    expect(useTaskStore.getState().tasks).toHaveLength(1);
    expect(useTaskStore.getState().tasks[0].status).toBe('running');

    // Task completes
    useTaskStore.getState().updateTask('lifecycle-test', {
      status: 'done',
      detail: 'Found 5 features',
    });

    expect(useTaskStore.getState().tasks[0].status).toBe('done');
    expect(useTaskStore.getState().tasks[0].detail).toBe('Found 5 features');

    // Remove task
    useTaskStore.getState().removeTask('lifecycle-test');
    expect(useTaskStore.getState().tasks).toEqual([]);
  });

  it('tracks error path', () => {
    const store = useTaskStore.getState();

    store.addTask(makeTask({
      id: 'error-test',
      type: 'summarize',
      label: 'Summarizing changes',
      status: 'running',
    }));

    useTaskStore.getState().updateTask('error-test', {
      status: 'error',
      detail: 'Network timeout',
    });

    const task = useTaskStore.getState().tasks[0];
    expect(task.status).toBe('error');
    expect(task.detail).toBe('Network timeout');
  });
});
