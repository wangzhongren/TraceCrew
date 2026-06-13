import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useT } from '../i18n';

function cleanTags(text: string): string {
  return text
    .replace(/<(list-dir|read-file|run-shell|update|create-file|delete-file|search)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(list-dir|read-file|run-shell|update|create-file|delete-file|search)\b[^>]*\/>/gi, '')
    .replace(/<done>[^<]*<\/done>/gi, '')
    .replace(/<step-done[^>]*>[^<]*<\/step-done>/gi, '')
    .replace(/<all-done>[^<]*<\/all-done>/gi, '')
    .replace(/<final\/>/gi, '')
    .replace(/\n{3,}/g, '\n\n').trim();
}

interface Props {
  planSummary: string;
  color: string;
}

export default function PlanCard({ planSummary, color: _color }: Props) {
  const t = useT();
  const cleaned = useMemo(() => cleanTags(planSummary || ''), [planSummary]);
  if (!cleaned) return null;

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="w-1 h-3 rounded-full shrink-0" style={{ background: _color }} />
        <span className="text-caption text-muted font-medium tracking-wide">{t('card.analysisReport')}</span>
      </div>
      <div className="text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }: any) => <h1 className="text-md font-semibold mt-3 mb-1" style={{ color: 'var(--color-text-primary)' }}>{children}</h1>,
            h2: ({ children }: any) => <h2 className="text-sm font-semibold mt-2 mb-1" style={{ color: 'var(--color-text-primary)' }}>{children}</h2>,
            h3: ({ children }: any) => <h3 className="text-xs font-semibold mt-2 mb-1" style={{ color: 'var(--color-text-primary)' }}>{children}</h3>,
            p: ({ children }: any) => <p className="my-1 last:mb-0">{children}</p>,
            code: ({ className, children, ...props }: any) => {
              const inline = !className;
              return inline
                ? <code className="px-1 py-0.5 rounded text-caption" style={{ background: '#f0f1f3', color: 'var(--color-text-link)' }} {...props}>{children}</code>
                : <code className={className} {...props}>{children}</code>;
            },
            pre: ({ children }: any) => <pre className="code-block">{children}</pre>,
            ul: ({ children }: any) => <ul className="list-disc pl-5 mb-1 space-y-0.5">{children}</ul>,
            ol: ({ children }: any) => <ol className="list-decimal pl-5 mb-1 space-y-0.5">{children}</ol>,
            li: ({ children }: any) => <li className="my-0.5">{children}</li>,
            strong: ({ children }: any) => <strong className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{children}</strong>,
            a: ({ children, href }: any) => <a href={href} target="_blank" className="no-underline hover:underline" style={{ color: 'var(--color-text-link)' }}>{children}</a>,
            hr: () => <hr className="my-2" style={{ borderColor: 'var(--color-border-subtle)' }} />,
            blockquote: ({ children }: any) => <blockquote className="border-l-2 pl-2 my-1 opacity-70" style={{ borderColor: 'var(--color-border-default)' }}>{children}</blockquote>,
            table: ({ children }: any) => <div className="overflow-x-auto my-2"><table className="w-full text-caption border-separate border-spacing-0">{children}</table></div>,
            th: ({ children }: any) => <th className="border border-subtle bg-layer px-2 py-1 text-caption font-medium" style={{ color: 'var(--color-text-primary)' }}>{children}</th>,
            td: ({ children }: any) => <td className="border border-subtle px-2 py-1 text-caption" style={{ color: 'var(--color-text-secondary)' }}>{children}</td>,
          }}>
          {cleaned}
        </ReactMarkdown>
      </div>
    </div>
  );
}
