import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function cleanTags(text: string): string {
  return text
    .replace(/<(list-dir|read-file|run-shell|update|create-file|delete-file|search)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(list-dir|read-file|run-shell|update|create-file|delete-file|search)\b[^>]*\/>/gi, '')
    .replace(/<done>[^<]*<\/done>/gi, '')
    .replace(/<final\/>/gi, '')
    .replace(/\n{3,}/g, '\n\n').trim();
}

interface Props {
  passed: boolean;
  feedback: string;
  issues: any[];
  color: string;
}

export default function ReviewCard({ passed, feedback, issues, color }: Props) {
  const statusColor = passed ? '#22c55e' : '#ff4444';
  const cleaned = useMemo(() => cleanTags(feedback || ''), [feedback]);

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="w-1 h-3 rounded-full shrink-0" style={{ background: color }} />
        <span className="text-caption text-muted font-medium tracking-wide">审核结果</span>
        <span className="text-caption font-bold tracking-wider px-1.5 py-0.5 rounded" style={{ background: statusColor + '20', color: statusColor, fontSize: '9px' }}>{passed ? 'PASSED' : 'FAILED'}</span>
      </div>
      <div className="text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
        {cleaned && (
          <ReactMarkdown remarkPlugins={[remarkGfm]}
            components={{
              h2: ({ children }: any) => <h2 className="text-sm font-semibold mt-2 mb-1" style={{ color: 'var(--color-text-primary)' }}>{children}</h2>,
              h3: ({ children }: any) => <h3 className="text-xs font-semibold mt-2 mb-1" style={{ color: 'var(--color-text-primary)' }}>{children}</h3>,
              p: ({ children }: any) => <p className="my-1 last:mb-0">{children}</p>,
              code: ({ className, children, ...props }: any) => {
                const inline = !className;
                return inline
                  ? <code className="px-1 py-0.5 rounded text-caption" style={{ background: '#1a1a2e', color: 'var(--color-text-link)' }} {...props}>{children}</code>
                  : <code className={className} {...props}>{children}</code>;
              },
              pre: ({ children }: any) => <pre className="code-block">{children}</pre>,
              ul: ({ children }: any) => <ul className="list-disc pl-5 mb-1 space-y-0.5">{children}</ul>,
              li: ({ children }: any) => <li className="my-0.5">{children}</li>,
              strong: ({ children }: any) => <strong className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{children}</strong>,
              a: ({ children, href }: any) => <a href={href} target="_blank" className="no-underline hover:underline" style={{ color: 'var(--color-text-link)' }}>{children}</a>,
              hr: () => <hr className="my-2" style={{ borderColor: 'var(--color-border-subtle)' }} />,
              blockquote: ({ children }: any) => <blockquote className="border-l-2 pl-2 my-1 opacity-70" style={{ borderColor: 'var(--color-border-default)' }}>{children}</blockquote>,
            }}>
            {cleaned}
          </ReactMarkdown>
        )}
        {issues.length > 0 && (
          <ul className="mt-2 space-y-1">
            {issues.map((issue: any, j) => (
              <li key={j} className="text-xs leading-snug">
                — {typeof issue === 'string'
                  ? issue
                  : `${issue.severity || '?'} [${issue.file || '?'}${issue.line_range ? `:${issue.line_range}` : ''}] ${issue.claim || ''}${issue.reality ? ` → ${issue.reality}` : ''}`}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
