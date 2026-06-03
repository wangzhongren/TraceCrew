export type Language = 'zh' | 'en';

export const LANG_KEY = 'codeatlas-language';

export function getInitialLanguage(): Language {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'zh' || saved === 'en') return saved;
  } catch { /* ignore */ }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function saveLanguage(language: Language) {
  try { localStorage.setItem(LANG_KEY, language); } catch { /* ignore */ }
}

export function languageInstruction(language: Language): string {
  return language === 'zh'
    ? '【语言偏好】请使用中文回复，并让生成的地图标题、说明、错误信息和操作摘要尽量使用中文。'
    : '【Language preference】Please respond in English. Keep generated map labels, descriptions, errors, and operation summaries in English.';
}

export const UI = {
  zh: {
    run: 'AI 终端',
    closeProject: '关闭项目',
    language: '中文',
    features: '地图',
    analyze: '分析',
    refresh: '刷新',
    analyzingProject: '正在分析项目结构...',
    readingCode: '读取代码...',
    featuresFound: '个节点',
    noFeatures: '没有生成地图',
    askAnything: '问点什么',
    agentHint: '编辑代码、运行命令、分析结构。',
    contextFromFeature: '来自地图的上下文',
    commandApproval: '命令需要确认',
    reviewCommand: '确认命令',
    commandLocation: 'Agent 想在这里运行命令：',
    commandHint: '允许后会在下方流式显示输出，并一直运行到命令结束或你停止它。',
    deny: '拒绝',
    allow: '允许',
    running: '运行中...',
    send: '发送',
    stop: '停止生成',
    openFolder: '打开文件夹',
    loading: '加载中...',
    initializing: '初始化中...',
    electronReady: 'Electron 已就绪',
    browserMode: '浏览器模式',
    recent: '最近项目',
    openFolderHint: '打开文件夹',
    selectFeature: '选择一个地图节点查看详情',
    overview: '概览',
    keyFiles: '关键文件',
    askAgent: '问 Agent',
    noFurtherDetails: '没有更多细节（AI 已自动分析到此层级）',
  },
  en: {
    run: 'AI Terminal',
    closeProject: 'Close Project',
    language: 'English',
    features: 'Features',
    analyze: 'Analyze',
    refresh: 'Refresh',
    analyzingProject: 'Analyzing project structure...',
    readingCode: 'Reading code...',
    featuresFound: 'features found',
    noFeatures: 'No features generated',
    askAnything: 'Ask anything.',
    agentHint: 'Edit code, run commands, analyze structure.',
    contextFromFeature: 'Context from Feature Analysis',
    commandApproval: 'Command approval required',
    reviewCommand: 'Review Command',
    commandLocation: 'The agent wants to run this command in:',
    commandHint: 'Allowing this command streams output below and keeps running until it exits or you stop it.',
    deny: 'Deny',
    allow: 'Allow',
    running: 'Running...',
    send: 'Send',
    stop: 'Stop generating',
    openFolder: 'Open Folder',
    loading: 'Loading...',
    initializing: 'Initializing...',
    electronReady: 'Electron ready',
    browserMode: 'Browser mode',
    recent: 'Recent',
    openFolderHint: 'to open folder',
    selectFeature: 'Select a feature to see its details',
    overview: 'Overview',
    keyFiles: 'Key Files',
    askAgent: 'Ask Agent',
    noFurtherDetails: 'No further details (AI analysis reached max depth)',
  },
} as const;

export function tr(language: Language, key: keyof typeof UI.en): string {
  return UI[language][key];
}
