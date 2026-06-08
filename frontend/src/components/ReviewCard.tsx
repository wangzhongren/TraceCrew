import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Props {
  passed: boolean;
  feedback: string;
  issues: any[];
  color: string;
}

export default function ReviewCard({ passed, feedback, issues, color }: Props) {
  const statusColor = passed ? '#22c55e' : '#ff4444';

  return (
    <div className="flex gap-3 pb-3">
      <span className="w-[15px] shrink-0" />
      <div className="flex-1 min-w-0 rounded-lg border-l-2 overflow-hidden" style={{ background: '#0d1117', borderColor: '#21262d', borderLeftColor: color }}>
        <div className="px-3 py-1.5 border-b flex items-center gap-2" style={{ borderColor: '#21262d' }}>
          <span className="text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded" style={{ background: statusColor + '20', color: statusColor }}>{passed ? 'PASSED' : 'FAILED'}</span>
          <span className="text-[10px]" style={{ color: '#8b949e' }}>审查结果</span>
        </div>
        <div className="px-3 py-2">
          {feedback && (
            <ReactMarkdown remarkPlugins={[remarkGfm]}
              components={{
                h2: ({ children }: any) => <h2 className="text-[12px] font-semibold mt-3 mb-1" style={{ color: '#e6e6e6' }}>{children}</h2>,
                h3: ({ children }: any) => <h3 className="text-[11px] font-semibold mt-2 mb-1" style={{ color: '#e6e6e6' }}>{children}</h3>,
                p: ({ children }: any) => <p className="my-1 text-[11px] leading-relaxed" style={{ color: '#c9d1d9' }}>{children}</p>,
                code: ({ className, children, ...props }: any) => {
                  const inline = !className;
                  return inline
                    ? <code className="px-1 py-0.5 rounded text-[10px]" style={{ background: '#1a1a2e', color: '#d2a8ff' }} {...props}>{children}</code>
                    : <code className="block text-[10px] font-mono" style={{ color: '#c9d1d9' }} {...props}>{children}</code>;
                },
                pre: ({ children }: any) => <pre className="bg-[#0a0a0a] border border-[#2a2a2a] rounded px-2 py-1.5 my-2 overflow-x-auto text-[10px] font-mono" style={{ color: '#c9d1d9' }}>{children}</pre>,
                li: ({ children }: any) => <li className="text-[11px] my-0.5" style={{ color: '#c9d1d9' }}>{children}</li>,
                strong: ({ children }: any) => <strong className="font-semibold" style={{ color: '#e6e6e6' }}>{children}</strong>,
                a: ({ children, href }: any) => <a href={href} target="_blank" className="no-underline hover:underline" style={{ color: '#58a6ff' }}>{children}</a>,
                hr: () => <hr className="my-3" style={{ borderColor: '#21262d' }} />,
                blockquote: ({ children }: any) => <blockquote className="border-l-2 pl-2 my-1 text-[11px]" style={{ borderColor: '#30363d', color: '#8b949e' }}>{children}</blockquote>,
              }}>
              {feedback}
            </ReactMarkdown>
          )}
          {issues.length > 0 && (
            <ul className="mt-2 space-y-1">
              {issues.map((issue: any, j) => (
                <li key={j} className="text-[11px] leading-snug" style={{ color: '#c9d1d9' }}>
                  — {typeof issue === 'string'
                    ? issue
                    : `${issue.severity || '?'} [${issue.file || '?'}${issue.line_range ? `:${issue.line_range}` : ''}] ${issue.claim || ''}${issue.reality ? ` → ${issue.reality}` : ''}`}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
