import { useState, useCallback } from 'react';
import CodeViewer from './CodeViewer';
import ActionPanel, { type StreamState } from './ActionPanel';
import type { ActionType } from './ActionDialog';
import type { GraphNode } from './MapCanvas';

interface Props {
  // CodeViewer props
  filePath: string | null;
  projectPath: string | null;
  scrollToLine?: number | null;

  // ActionPanel props
  activeAction: ActionType | null;
  actionNode: GraphNode | null;
  downstreamNodes?: GraphNode[];
  stream: StreamState;
  onActionConfirm: (instruction: string) => Promise<void>;
  onActionClose: () => void;
}

export default function RightPanel({
  filePath, projectPath, scrollToLine,
  activeAction, actionNode, downstreamNodes, stream,
  onActionConfirm, onActionClose,
}: Props) {
  const [codeRatio, setCodeRatio] = useState(0.5); // 50% code, 50% action when both visible
  const dragging = useState(false);

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = e.currentTarget.parentElement;
    if (!container) return;

    const startY = e.clientY;
    const startRatio = codeRatio;
    const containerH = container.clientHeight;

    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientY - startY;
      const newRatio = Math.max(0.2, Math.min(0.8, startRatio + delta / containerH));
      setCodeRatio(newRatio);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [codeRatio]);

  const showAction = activeAction && actionNode;

  // No file, no action → empty
  if (!filePath && !showAction) {
    return null;
  }

  // No file but has action → show action panel only
  if (!filePath && showAction) {
    return (
      <div className="h-full flex flex-col" style={{ background: 'var(--color-bg-primary)' }}>
        <ActionPanel
          action={activeAction!}
          node={actionNode}
          downstreamNodes={downstreamNodes}
          onClose={onActionClose}
          onConfirm={onActionConfirm}
          stream={stream}
        />
      </div>
    );
  }

  // Has file but no action → show code only
  if (filePath && !showAction) {
    return (
      <div className="h-full flex flex-col" style={{ background: 'var(--color-bg-primary)' }}>
        <CodeViewer
          filePath={filePath}
          projectPath={projectPath}
          scrollToLine={scrollToLine}
        />
      </div>
    );
  }

  // Both file and action → split view
  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--color-bg-primary)' }}>
      {/* Code area */}
      <div className="overflow-hidden min-h-0" style={{ height: `${codeRatio * 100}%` }}>
        <CodeViewer
          filePath={filePath}
          projectPath={projectPath}
          scrollToLine={scrollToLine}
        />
      </div>

      {/* Draggable divider */}
      <div
        className="shrink-0 h-[5px] cursor-row-resize transition-colors hover:bg-[#374151]/15 z-10"
        style={{ background: 'var(--color-border-subtle)' }}
        onMouseDown={handleDividerMouseDown}
      />

      {/* Action panel */}
      <div className="overflow-hidden min-h-0" style={{ height: `${(1 - codeRatio) * 100}%` }}>
        <ActionPanel
          action={activeAction!}
          node={actionNode!}
          downstreamNodes={downstreamNodes}
          onClose={onActionClose}
          onConfirm={onActionConfirm}
          stream={stream}
        />
      </div>
    </div>
  );
}
