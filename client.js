window.__ModuleLoader__.load({
  id: '@liuer/intel-station',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useCallback } = React;

    const PANEL_ID = 'liuer-intel-station';
    const SRC = '/intel-station/';

    async function probe() {
      try {
        await fetch(SRC + 'api/bootstrap', {
          mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(2000),
        });
        return true;
      } catch { return false; }
    }

    function StatusDot({ status }) {
      const color = status === 'ok' ? '#2f9e63' : status === 'offline' ? '#c0392b' : '#b9b9b2';
      const label = status === 'ok' ? '已连接' : status === 'offline' ? '未启动' : '检查中';
      return h('span', {
        style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: '#8a8a84' },
      },
        h('span', { style: { width: 6, height: 6, borderRadius: 99, background: color, display: 'inline-block' } }),
        label);
    }

    function OfflineView({ onRetry, busy }) {
      return h('div', {
        style: {
          flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 14,
          padding: 40, textAlign: 'center', background: 'var(--bg, #fff)',
        },
      },
        h('div', {
          style: {
            width: 54, height: 54, borderRadius: 15, background: '#faf9f7',
            display: 'grid', placeItems: 'center', color: '#c9c9c3', fontSize: 22,
          },
        }, '📡'),
        h('div', { style: { fontSize: 15, fontWeight: 650, color: '#1b1b1a' } }, '情报站引擎未就绪'),
        h('div', { style: { fontSize: 12.5, color: '#8a8a84', lineHeight: 1.8, maxWidth: 420 } },
          'Host 插件的 Python 引擎可能还没准备好。',
          h('br'), '确认 python3 可用后点「重新检查」。'),
        h('button', {
          onClick: onRetry, disabled: busy,
          style: {
            border: '1px solid #ffd9c2', background: '#fff1e9', color: '#b8420a',
            fontSize: 12.5, fontWeight: 600, padding: '7px 16px', borderRadius: 8,
            cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
          },
        }, busy ? '检查中…' : '重新检查'));
    }

    function IntelPage() {
      const [status, setStatus] = useState('probing');
      const [nonce, setNonce] = useState(0);

      const check = useCallback(async (remount) => {
        setStatus('probing');
        const ok = await probe();
        setStatus(ok ? 'ok' : 'offline');
        if (ok && remount) setNonce((n) => n + 1);
      }, []);

      useEffect(() => { check(false); }, [check]);

      return h('div', {
        style: {
          height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column',
          background: 'var(--bg, #fff)', color: 'var(--ink, #16181D)',
        },
      },
        h('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 10, flex: 'none',
            padding: '9px 16px', borderBottom: '1px solid var(--line, #E4E4E0)',
          },
        },
          h('span', {
            style: {
              display: 'flex', alignItems: 'baseline', gap: 5,
              fontWeight: 700, fontSize: 14, letterSpacing: '.01em',
            },
          },
            '六耳',
            h('span', {
              style: {
                fontWeight: 500, fontSize: 13, opacity: .55, letterSpacing: 0,
              },
            }, '情报站')),
          h('span', { style: { flex: 1 } }),
          h(StatusDot, { status }),
          h('button', {
            onClick: () => check(true),
            title: '重新检查连接',
            style: {
              border: '1px solid var(--line, #E4E4E0)', background: 'transparent',
              color: '#6e6e69', fontSize: 12, padding: '5px 11px', borderRadius: 7, cursor: 'pointer',
            },
          }, '重连'),
          h('button', {
            onClick: () => window.open(SRC, '_blank'),
            title: '在系统浏览器里打开',
            style: {
              border: '1px solid var(--line, #E4E4E0)', background: 'transparent',
              color: '#6e6e69', fontSize: 12, padding: '5px 11px', borderRadius: 7, cursor: 'pointer',
            },
          }, '新窗口 ↗')),
        status === 'ok'
          ? h('iframe', {
              key: nonce, src: SRC, title: '六耳情报站',
              style: { flex: 1, width: '100%', minHeight: 0, border: 0, display: 'block' },
            })
          : status === 'probing'
            ? h('div', {
                style: { flex: 1, display: 'grid', placeItems: 'center', fontSize: 12.5, color: '#a5a59e' },
              }, '正在连接…')
            : h(OfflineView, { onRetry: () => check(true), busy: false }));
    }

    function PanelIcon({ size }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        'aria-hidden': true, style: { display: 'block' },
      },
        h('circle', { cx: 12, cy: 10, r: 7, stroke: 'currentColor', strokeWidth: 1.5 }),
        h('circle', { cx: 9.5, cy: 9, r: 1, fill: 'currentColor' }),
        h('circle', { cx: 14.5, cy: 9, r: 1, fill: 'currentColor' }),
        h('path', { d: 'M10 12.5c.8.6 3.2.6 4 0', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
        h('circle', { cx: 5, cy: 8, r: 2.5, stroke: 'currentColor', strokeWidth: 1.2 }),
        h('circle', { cx: 19, cy: 8, r: 2.5, stroke: 'currentColor', strokeWidth: 1.2 }),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 12,
          label: '情报站',
        }, PanelIcon));
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: PANEL_ID,
        }, IntelPage));
      },
    };
  },
});
