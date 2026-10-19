window.__ModuleLoader__.load({
  id: 'dsh-browser-mode',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'browser-mode';
    /** Host routes mounted by the `browser-source` plugin. */
    const API = '/dsh-browser-mode/api/source';

    const SOURCES = ['edge', 'builtin', 'endpoint'];

    const DICTIONARIES = {
      zh: {
        'title': '浏览器来源',
        'intro': '「浏览器操作」会话用哪个浏览器打开页面。切换后已经打开的浏览器会话会失效，请新开一个会话再导航。',
        'source.edge': 'Microsoft Edge（默认）',
        'source.builtin': 'Playwright 内置 Chromium',
        'source.endpoint': '连接已运行的浏览器（CDP）',
        'source.label': '来源',
        'endpoint.label': 'CDP 地址',
        'endpoint.hint': '例如 http://127.0.0.1:9222，浏览器需以 --remote-debugging-port 启动。',
        'path.label': '浏览器可执行文件（可选）',
        'path.hint': '留空则使用上面选定的来源；填了就改用这个程序。',
        'headless.label': '无头运行（不显示窗口）',
        'save': '保存',
        'saved': '已保存，按下面的提示新开一个会话。',
        'reload': '重新读取',
        'loading': '读取中…',
        'current': '当前：{text}',
        'invalid.endpoint': '选了「连接已运行的浏览器」就必须填 CDP 地址。',
        'error': '保存失败：{message}',
        'error.load': '读取配置失败：{message}',
        'summary': '浏览器来源：{text}',
      },
      en: {
        'title': 'Browser source',
        'intro': 'Which browser "Browser operation" sessions open. Switching invalidates the tools of browser sessions that are already open — start a new session before navigating.',
        'source.edge': 'Microsoft Edge (default)',
        'source.builtin': 'Chromium bundled with Playwright',
        'source.endpoint': 'Attach to a running browser (CDP)',
        'source.label': 'Source',
        'endpoint.label': 'CDP endpoint',
        'endpoint.hint': 'For example http://127.0.0.1:9222; start the browser with --remote-debugging-port.',
        'path.label': 'Browser executable (optional)',
        'path.hint': 'Empty uses the source above; a path overrides the program to launch.',
        'headless.label': 'Run headless (no window)',
        'save': 'Save',
        'saved': 'Saved — start a new session as described below.',
        'reload': 'Reload',
        'loading': 'Loading…',
        'current': 'Current: {text}',
        'invalid.endpoint': 'Choose a CDP endpoint when attaching to a running browser.',
        'error': 'Save failed: {message}',
        'error.load': 'Could not read the configuration: {message}',
        'summary': 'Browser source: {text}',
      },
    };

    async function readSource() {
      const response = await fetch(API, { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? `HTTP ${String(response.status)}`);
      return body;
    }

    async function writeSource(patch) {
      const response = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? `HTTP ${String(response.status)}`);
      return body;
    }

    function describe(data, t) {
      if (data.source === 'endpoint') return t('source.endpoint');
      if (data.source === 'builtin') return t('source.builtin');
      return t('source.edge');
    }

    function useSource() {
      const [state, setState] = React.useState({ status: 'loading', data: null, error: null });
      const reload = React.useCallback(() => {
        setState((previous) => ({ ...previous, status: 'loading' }));
        readSource().then(
          (data) => setState({ status: 'ready', data, error: null }),
          (error) => setState({ status: 'failed', data: null, error: error.message }),
        );
      }, []);
      React.useEffect(reload, [reload]);
      return { ...state, reload };
    }

    const fieldStyle = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 };
    const inputStyle = {
      height: 30,
      padding: '0 8px',
      borderRadius: 6,
      border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.4))',
      background: 'var(--dsw-alias-bg-l1, transparent)',
      color: 'inherit',
      font: 'inherit',
    };
    const hintStyle = { margin: 0, fontSize: 12, opacity: 0.6 };

    function createView() {
      /** Plugins → dsh-browser-mode page: pick the browser the preset launches. */
      return function BrowserSourceSettings({ t, view }) {
        const loaded = useSource();
        const [draft, setDraft] = React.useState(null);
        const [status, setStatus] = React.useState('idle');
        const [message, setMessage] = React.useState('');

        React.useEffect(() => {
          if (loaded.data !== null) {
            const { source, endpoint, executablePath, headless } = loaded.data;
            setDraft({ source, endpoint, executablePath, headless });
          }
        }, [loaded.data]);

        if (view === 'summary') {
          if (loaded.data === null) return loaded.status === 'failed' ? `! ${loaded.error}` : t('loading');
          return t('summary', { text: describe(loaded.data, t) });
        }

        if (loaded.status === 'failed') {
          return h('p', { style: { ...hintStyle, color: 'var(--dsw-alias-label-error, #d14343)' } },
            t('error.load', { message: loaded.error }));
        }
        if (draft === null) return h('p', { style: hintStyle }, t('loading'));

        const update = (patch) => {
          setDraft((previous) => ({ ...previous, ...patch }));
          setStatus('idle');
        };

        const submit = (event) => {
          event.preventDefault();
          if (draft.source === 'endpoint' && draft.endpoint.trim() === '') {
            setStatus('invalid');
            setMessage(t('invalid.endpoint'));
            return;
          }
          setStatus('busy');
          writeSource(draft).then(
            (data) => {
              setStatus('saved');
              setMessage('');
              loaded.reload();
              setDraft({
                source: data.source,
                endpoint: data.endpoint,
                executablePath: data.executablePath,
                headless: data.headless,
              });
            },
            (error) => {
              setStatus('failed');
              setMessage(t('error', { message: error.message }));
            },
          );
        };

        return h('form', {
          onSubmit: submit,
          style: { display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 520, padding: '4px 0' },
        }, [
          h('h3', { key: 'title', style: { margin: 0, fontSize: 14 } }, t('title')),
          h('p', { key: 'intro', style: hintStyle }, t('intro')),
          h('p', { key: 'current', style: { ...hintStyle, opacity: 0.85 } },
            t('current', { text: describe(loaded.data, t) })),
          h('label', { key: 'source', style: fieldStyle }, [
            h('span', { key: 'text' }, t('source.label')),
            h('select', {
              key: 'select',
              value: draft.source,
              onChange: (event) => update({ source: event.target.value }),
              style: inputStyle,
            }, SOURCES.map((value) => h('option', { key: value, value }, t(`source.${value}`)))),
          ]),
          draft.source === 'endpoint' ? h('label', { key: 'endpoint', style: fieldStyle }, [
            h('span', { key: 'text' }, t('endpoint.label')),
            h('input', {
              key: 'input',
              type: 'text',
              value: draft.endpoint,
              placeholder: 'http://127.0.0.1:9222',
              onChange: (event) => update({ endpoint: event.target.value }),
              style: inputStyle,
            }),
            h('p', { key: 'hint', style: hintStyle }, t('endpoint.hint')),
          ]) : null,
          draft.source === 'edge' ? h('label', { key: 'path', style: fieldStyle }, [
            h('span', { key: 'text' }, t('path.label')),
            h('input', {
              key: 'input',
              type: 'text',
              value: draft.executablePath,
              onChange: (event) => update({ executablePath: event.target.value }),
              style: inputStyle,
            }),
            h('p', { key: 'hint', style: hintStyle }, t('path.hint')),
          ]) : null,
          h('label', { key: 'headless', style: { ...fieldStyle, flexDirection: 'row', alignItems: 'center', gap: 8 } }, [
            h('input', {
              key: 'checkbox',
              type: 'checkbox',
              checked: draft.headless === true,
              onChange: (event) => update({ headless: event.target.checked }),
            }),
            h('span', { key: 'text' }, t('headless.label')),
          ]),
          h('div', { key: 'actions', style: { display: 'flex', alignItems: 'center', gap: 10 } }, [
            h('button', {
              key: 'save',
              type: 'submit',
              disabled: status === 'busy',
              style: {
                height: 28,
                padding: '0 14px',
                borderRadius: 6,
                border: 0,
                cursor: status === 'busy' ? 'default' : 'pointer',
                opacity: status === 'busy' ? 0.6 : 1,
                background: 'var(--dsw-alias-state-business-primary, #4176e6)',
                color: '#fff',
                font: 'inherit',
                fontSize: 13,
              },
            }, t('save')),
            h('button', {
              key: 'reload',
              type: 'button',
              onClick: loaded.reload,
              style: { ...inputStyle, height: 28, padding: '0 12px', cursor: 'pointer', fontSize: 13 },
            }, t('reload')),
            status === 'saved' ? h('span', { key: 'saved', style: { fontSize: 12, opacity: 0.75 } }, t('saved')) : null,
            status === 'invalid' || status === 'failed'
              ? h('span', {
                key: 'error',
                role: 'alert',
                style: { fontSize: 12, color: 'var(--dsw-alias-label-error, #d14343)' },
              }, message)
              : null,
          ]),
        ]);
      };
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICTIONARIES), 'browser-mode: dictionaries');
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config',
          key: '@local/dsh-browser-mode',
          locale: NS,
        }, createView()));
      },
    };
  },
});
