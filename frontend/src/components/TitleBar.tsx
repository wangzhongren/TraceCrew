export default function TitleBar({ projectName }: { projectName: string }) {

  const action = (name: 'minimize' | 'maximize' | 'close') => {
    const api = window.codeatlas?.window;
    if (api?.[name]) {
      Promise.resolve(api[name]()).catch(() => {});
    }
  };

  return (
    <div className="flex items-center justify-between h-8 shrink-0 select-none"
      style={{ background: 'var(--ibm-layer)', WebkitAppRegion: 'drag' } as React.CSSProperties}>
      {/* Left: brand */}
      <div className="flex items-center gap-2 pl-3">
        <div className="w-4 h-4 flex items-center justify-center">
          <svg width="14" height="14" viewBox="0 0 32 32" fill="none" stroke="var(--ibm-primary)" strokeWidth="2">
            <circle cx="6" cy="10" r="2"/><circle cx="16" cy="6" r="2"/><circle cx="26" cy="10" r="2"/>
            <circle cx="10" cy="24" r="2"/><circle cx="22" cy="24" r="2"/>
            <line x1="16" y1="8" x2="8" y2="10"/><line x1="16" y1="8" x2="24" y2="10"/>
            <line x1="8" y1="12" x2="6" y2="22"/><line x1="24" y1="12" x2="26" y2="22"/>
          </svg>
        </div>
        <span className="text-[11px] font-medium" style={{ color: 'var(--ibm-text)' }}>CodeAtlas</span>
        {projectName && (
          <span className="text-[11px]" style={{ color: 'var(--ibm-text-placeholder)' }}>{projectName}</span>
        )}
      </div>

      {/* Right: window controls */}
      <div className="flex" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <CtrlBtn onClick={() => action('minimize')}>
          <rect y="5" width="10" height="1" fill="currentColor"/>
        </CtrlBtn>
        <CtrlBtn onClick={() => action('maximize')}>
          <rect x="1" y="1" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1"/>
        </CtrlBtn>
        <CtrlBtn onClick={() => action('close')} hoverRed>
          <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1"/>
        </CtrlBtn>
      </div>
    </div>
  );
}

function CtrlBtn({ children, hoverRed, onClick }: {
  children: React.ReactNode; hoverRed?: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className="w-10 h-8 flex items-center justify-center transition-colors"
      style={{ color: 'var(--ibm-text-secondary)' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = hoverRed ? '#da1e28' : 'var(--ibm-layer-hover)';
        e.currentTarget.style.color = hoverRed ? '#fff' : 'var(--ibm-text)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--ibm-text-secondary)';
      }}>
      <svg width="10" height="10" viewBox="0 0 10 10">{children}</svg>
    </button>
  );
}
