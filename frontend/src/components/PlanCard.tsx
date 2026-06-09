import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Props {
  planSummary: string;
  color: string;
}

export default function PlanCard({ planSummary, color }: Props) {
  if (!planSummary) return null;

  return (
    <div className="flex gap-3 pb-3">
      <span className="w-[15px] shrink-0" />
      <div className="flex-1 min-w-0 rounded-lg border-l-2 overflow-hidden" style={{ background: '#0d1117', borderColor: 'var(--color-border-subtle)', borderLeftColor: color }}>
        <div className="px-3 py-1.5 border-b flex items-center gap-2" style={{ borderColor: 'var(--color-border-subtle)' }}>
          <span className="text-caption font-bold tracking-wider px-1.5 py-0.5 rounded" style={{ background: color + '20', color }}>PLAN</span>
          <span className="text-caption" style={{ color: '#8b949e' }}>分析报告</span>
        </div>
        <div className="px-3 py-2 overflow-x-auto">
          <ReactMarkdown remarkPlugins={[remarkGfm]}
            components={{
              h2: ({ children }: any) => <h2 className="text-sm font-semibold mt-3 mb-1" style={{ color: 'var(--color-text-primary)' }}>{children}</h2>,
              h3: ({ children }: any) => <h3 className="text-xs font-semibold mt-2 mb-1" style={{ color: 'var(--color-text-primary)' }}>{children}</h3>,
              h4: ({ children }: any) => <h4 className="text-xs font-medium mt-2 mb-1" style={{ color: 'var(--color-text-primary)' }}>{children}</h4>,
              p: ({ children }: any) => <p className="my-1 text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{children}</p>,
              code: ({ className, children, ...props }: any) => {
                const inline = !className;
                return inline
                  ? <code className="px-1 py-0.5 rounded text-caption" style={{ background: '#1a1a2e', color: '#d2a8ff' }} {...props}>{children}</code>
                  : <code className="block text-caption font-mono" style={{ color: 'var(--color-text-secondary)' }} {...props}>{children}</code>;
              },
              pre: ({ children }: any) => <pre className="code-block" style={{ color: 'var(--color-text-secondary)' }}>{children}</pre>,
              table: ({ children }: any) => <div className="overflow-x-auto my-2"><table className="w-full text-caption border-separate border-spacing-0">{children}</table></div>,
              th: ({ children }: any) => <th className="border border-subtle bg-layer px-2 py-1 text-caption font-medium" style={{ color: 'var(--color-text-primary)' }}>{children}</th>,
              td: ({ children }: any) => <td className="border border-subtle px-2 py-1 text-caption" style={{ color: 'var(--color-text-secondary)' }}>{children}</td>,
              li: ({ children }: any) => <li className="text-xs my-0.5" style={{ color: 'var(--color-text-secondary)' }}>{children}</li>,
              strong: ({ children }: any) => <strong className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{children}</strong>,
              a: ({ children, href }: any) => <a href={href} target="_blank" className="no-underline hover:underline" style={{ color: '#58a6ff' }}>{children}</a>,
              hr: () => <hr className="my-3" style={{ borderColor: 'var(--color-border-subtle)' }} />,
              blockquote: ({ children }: any) => <blockquote className="border-l-2 pl-2 my-1 text-xs" style={{ borderColor: 'var(--color-border-default)', color: '#8b949e' }}>{children}</blockquote>,
            }}>
            {planSummary}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
