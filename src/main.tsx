import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Global error listener to catch errors early
window.addEventListener('error', (event) => {
  console.error('Global Window Error:', event.error || event.message);
  const root = document.getElementById('root');
  if (root && (!root.innerHTML || root.innerHTML.trim() === '')) {
    root.innerHTML = `
      <div style="padding: 24px; color: #ef4444; font-family: monospace; background: #0f172a; min-height: 100vh;">
        <h2 style="color: #f87171; font-size: 20px;">页面加载出错 (Runtime Error)</h2>
        <p style="color: #cbd5e1; font-size: 14px;"><strong>错误消息:</strong> ${event.message}</p>
        <pre style="background: #1e293b; padding: 12px; border-radius: 6px; overflow: auto; color: #fca5a5;">${event.error?.stack || '无调用栈信息'}</pre>
        <button onclick="localStorage.clear(); location.reload();" style="margin-top: 16px; padding: 8px 16px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer;">
          清空本地缓存并重载
        </button>
      </div>
    `;
  }
});

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error('React ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, color: '#ef4444', fontFamily: 'monospace', background: '#0f172a', minHeight: '100vh' }}>
          <h2 style={{ color: '#f87171', fontSize: 20 }}>组件渲染崩溃 (React Crash)</h2>
          <p style={{ color: '#cbd5e1', fontSize: 14 }}>
            <strong>错误信息:</strong> {String(this.state.error?.message || this.state.error)}
          </p>
          <pre style={{ background: '#1e293b', padding: 12, borderRadius: 6, overflow: 'auto', color: '#fca5a5' }}>
            {this.state.error?.stack}
          </pre>
          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <button
              onClick={() => { localStorage.clear(); window.location.reload(); }}
              style={{ padding: '8px 16px', background: '#dc2626', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}
            >
              清空本地损坏缓存并重载 (Reset LocalStorage)
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{ padding: '8px 16px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}
            >
              刷新页面
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

