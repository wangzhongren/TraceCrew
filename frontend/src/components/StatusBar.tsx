import { useTaskStore } from '../store/taskStore';
import type { BackgroundTask } from '../store/taskStore';

function TaskItem({ task }: { task: BackgroundTask }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-caption">
      <span className="w-1.5 h-1.5 rounded-full animate-pulse-dot shrink-0"
        style={{ background: task.status === 'error' ? 'var(--color-error)' : 'var(--color-warning)' }} />
      <span className="truncate flex-1 text-secondary">{task.label}</span>
      <span className="text-[9px] shrink-0 text-dim">{task.detail}</span>
    </div>
  );
}

export default function StatusBar() {
  const { tasks, visible, toggleVisible, setVisible } = useTaskStore();
  const running = tasks.filter((t) => t.status === 'running');

  return (
    <div className="relative shrink-0">
      <button
        onClick={toggleVisible}
        className="flex items-center gap-1.5 px-2 py-0.5 text-caption rounded transition-colors hover:bg-white/5 max-w-[200px]"
        style={{ color: running.length > 0 ? 'var(--color-warning)' : 'var(--color-text-disabled)' }}>
        {running.length > 0 ? (
          <>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse-dot shrink-0" style={{ background: 'var(--color-warning)' }} />
            <span className="truncate">{running[0]?.detail || running[0]?.label || running.length}</span>
          </>
        ) : (
          <span className="text-disabled">0</span>
        )}
      </button>

      {visible && (
        <div
          className="absolute right-0 top-full mt-1 w-64 rounded-lg border border-subtle bg-layer card-elevation z-50">
          <div className="px-3 py-1.5 border-b border-subtle text-caption font-medium flex items-center justify-between text-muted">
            <span>{running.length > 0 ? `Running (${running.length})` : 'No running tasks'}</span>
            <button onClick={() => setVisible(false)} className="text-disabled">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          {running.length === 0 ? (
            <div className="px-3 py-3 text-caption text-center text-dim">
              All tasks completed
            </div>
          ) : (
            running.map((t) => <TaskItem key={t.id} task={t} />)
          )}
        </div>
      )}
    </div>
  );
}
