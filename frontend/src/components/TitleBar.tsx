export default function TitleBar({ projectName }: { projectName: string }) {
  const iconSrc = window.tracecrew?.getAppIcon?.() ?? '';

  const action = (name: 'minimize' | 'maximize' | 'close') => {
    const api = window.tracecrew?.window;
    if (api?.[name]) Promise.resolve(api[name]()).catch(() => {});
  };

  return (
    <div className="flex items-center justify-between h-9 shrink-0 select-none"
      style={{ background: 'var(--ibm-layer-01)', WebkitAppRegion: 'drag' } as React.CSSProperties}>
      {/* Left: brand */}
      <div className="flex items-center gap-2.5 pl-4">
        {iconSrc && <img src={iconSrc} alt="TraceCrew" className="w-4 h-4 object-contain" />}
        <span className="text-body font-medium tracking-wide" style={{ color: 'var(--ibm-text-primary)' }}>TraceCrew</span>
        {projectName && (
          <>
            <span className="text-body font-light" style={{ color: 'var(--ibm-text-disabled)' }}>/</span>
            <span className="text-body font-light" style={{ color: 'var(--ibm-text-secondary)' }}>{projectName}</span>
          </>
        )}
      </div>

      {/* Right: window controls */}
      <div className="flex" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <CtrlBtn onClick={() => action('minimize')}>
          <rect x="2" y="5.5" width="8" height="1" fill="currentColor"/>
        </CtrlBtn>
        <CtrlBtn onClick={() => action('maximize')}>
          <rect x="2" y="2" width="8" height="8" rx="0.5" fill="none" stroke="currentColor" strokeWidth="1.2"/>
        </CtrlBtn>
        <CtrlBtn onClick={() => action('close')} hoverRed>
          <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.2"/>
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
      className="w-11 h-9 flex items-center justify-center transition-colors"
      style={{ background: 'transparent', color: 'var(--ibm-icon-secondary)' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = hoverRed ? 'var(--ibm-error)' : 'var(--ibm-layer-hover)';
        e.currentTarget.style.color = hoverRed ? 'var(--ibm-text-on-color)' : 'var(--ibm-icon-primary)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--ibm-icon-secondary)';
      }}>
      <svg width="12" height="12" viewBox="0 0 12 12">{children}</svg>
    </button>
  );
}
