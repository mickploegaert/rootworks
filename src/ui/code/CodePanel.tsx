import { useEffect, useRef, useState } from 'react';
import type { ConsoleEntry, Game, ProgramStatus } from '../../game/Game.ts';
import type { ProgramStore } from '../../game/save/ProgramStore.ts';
import { LANGUAGES, LANGUAGE_IDS } from '../../game/scripting/adapters.ts';
import { PYTHON_EXAMPLES, STARTER_CODE } from '../../game/scripting/templates.ts';
import { FIRMWARE_NAMES } from '../../game/scripting/hostApi.ts';
import type { LanguageId } from '../../game/scripting/types.ts';
import type { TutorialStep } from '../../game/tutorial/Tutorial.ts';
import { CodeEditor } from './CodeEditor.tsx';

const CONSOLE_LIMIT = 300;
const SAVE_DELAY = 300;

const STATUS_LABEL: Record<ProgramStatus['state'], string> = {
  idle: 'Ready', running: 'Running', paused: 'Paused', finished: 'Completed', error: 'Error', stopped: 'Stopped',
};

interface Props {
  game: Game;
  store: ProgramStore;
  tutorial: TutorialStep[];
  /** Show the tutorial checklist (a setting; always on in a tutorial game). */
  showTutorial: boolean;
  firmware: number;
  open: boolean;
  onToggle(): void;
}

/** The programming workspace: language, editor, run controls, tutorial and console. UI only; the game runs the code. */
export function CodePanel({ game, store, tutorial, showTutorial, firmware, open, onToggle }: Props) {
  const [guided, setGuidedState] = useState(store.guided);
  useEffect(() => { game.setGuided(guided); }, [game, guided]);
  const setGuided = (on: boolean) => { store.setGuided(on); setGuidedState(on); };
  const [language, setLanguage] = useState<LanguageId>(store.language);
  const [code, setCode] = useState(() => store.code(store.language) ?? STARTER_CODE[store.language]);
  const [status, setStatus] = useState<ProgramStatus>(game.programStatus);
  const [log, setLog] = useState<ConsoleEntry[]>([]);
  const saveTimer = useRef<number>(0);
  const consoleEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const offs = [
      game.events.on('program', setStatus),
      game.events.on('console', (e) => setLog((l) => [...l.slice(-(CONSOLE_LIMIT - 1)), e])),
    ];
    return () => offs.forEach((f) => f());
  }, [game]);

  useEffect(() => { consoleEnd.current?.scrollIntoView({ block: 'end' }); }, [log]);

  // save on edit (debounced) and when leaving the page
  const flush = useRef(() => {});
  flush.current = () => { window.clearTimeout(saveTimer.current); store.setCode(language, code); };
  useEffect(() => {
    const onHide = () => flush.current();
    window.addEventListener('beforeunload', onHide);
    return () => window.removeEventListener('beforeunload', onHide);
  }, []);

  const edit = (next: string) => {
    setCode(next);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => store.setCode(language, next), SAVE_DELAY);
  };

  const switchLanguage = (next: LanguageId) => {
    if (next === language) return;
    flush.current(); // the current language keeps its own program
    store.setLanguage(next);
    setLanguage(next);
    setCode(store.code(next) ?? STARTER_CODE[next]);
  };

  const replaceCode = (next: string, what: string) => {
    if (next === code) return;
    if (!window.confirm(`Replace your current ${LANGUAGES[language].name} program with ${what}?`)) return;
    setCode(next);
    store.setCode(language, next);
  };

  const active = status.state === 'running' || status.state === 'paused';
  const run = () => { flush.current(); game.runProgram(language, code); };
  const tutorialDone = tutorial.every((s) => s.done);
  const examples = PYTHON_EXAMPLES.filter((e) => !guided || e.tier <= firmware);
  const lockedExamples = PYTHON_EXAMPLES.length - examples.length;

  if (!open) {
    return <button type="button" className="code-tab" onClick={onToggle} aria-label="Open the program editor">{'</>'} Program</button>;
  }

  return (
    <section className="panel code-panel" aria-label="Program editor">
      <header className="code-head">
        <h2>Program</h2>
        <span className={`run-state rs-${status.state}`} role="status">
          {STATUS_LABEL[status.state]}{status.state === 'running' && status.line ? ` · line ${status.line}` : ''}
        </span>
        <button type="button" className="icon" onClick={onToggle} aria-label="Hide the program editor">{'>>'}</button>
      </header>

      <div className="code-bar">
        <label>
          <span className="label">Language</span>
          <select value={language} onChange={(e) => switchLanguage(e.target.value as LanguageId)} disabled={active}>
            {LANGUAGE_IDS.map((id) => (
              <option key={id} value={id}>{LANGUAGES[id].name}{LANGUAGES[id].available ? '' : ' (coming soon)'}</option>
            ))}
          </select>
        </label>
        {language === 'python' && (
          <label>
            <span className="label">Examples</span>
            <select value="" disabled={active} onChange={(e) => {
              const ex = PYTHON_EXAMPLES.find((x) => x.id === e.target.value);
              if (ex) replaceCode(ex.code, `"${ex.title}"`);
            }}>
              <option value="">Load...</option>
              {examples.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
              {lockedExamples > 0 && <option disabled>{lockedExamples} more with new firmware</option>}
            </select>
          </label>
        )}
        {language === 'python' && (
          <label title="Guided: Python features unlock with firmware research, one idea at a time. Engineer: all of Python, right away.">
            <span className="label">Mode</span>
            <select value={guided ? 'guided' : 'engineer'} disabled={active} onChange={(e) => setGuided(e.target.value === 'guided')}>
              <option value="guided">Guided · T{firmware} {FIRMWARE_NAMES[firmware] ?? ''}</option>
              <option value="engineer">Engineer (all Python)</option>
            </select>
          </label>
        )}
      </div>

      {!LANGUAGES[language].available && (
        <p className="code-note">{LANGUAGES[language].name} is still being built, so this program can't run yet. Your code here is saved separately. Switch to Python to run programs.</p>
      )}

      {showTutorial && !tutorialDone && language === 'python' && (
        <ol className="tutorial" aria-label="Tutorial">
          {!tutorial[0].done && code !== STARTER_CODE.python && (
            <li className="tutorial-load"><button type="button" className="icon" disabled={active} onClick={() => replaceCode(STARTER_CODE.python, 'the Lesson 1 program')}>Load the Lesson 1 program</button></li>
          )}
          {tutorial.map((s) => (
            <li key={s.id} className={s.done ? 'done' : ''}>
              <span className="check" aria-hidden>{s.done ? '■' : '□'}</span>{s.label} <code>{s.hint}</code>
            </li>
          ))}
        </ol>
      )}

      <div className="code-body">
        <CodeEditor language={language} value={code} onChange={edit} onRun={() => !active && run()} readOnly={active}
          activeLine={active ? status.line : null} errorLine={status.state === 'error' ? status.errorLine : null} />
      </div>

      <div className="code-actions">
        <button type="button" className="primary" onClick={run} disabled={active} title="Run (Ctrl+Enter)">Run</button>
        {status.state === 'paused'
          ? <button type="button" onClick={() => game.resumeProgram()}>Resume</button>
          : <button type="button" onClick={() => game.pauseProgram()} disabled={status.state !== 'running'}>Pause</button>}
        <button type="button" onClick={() => game.stopProgram()} disabled={!active}>Stop</button>
        <button type="button" className="right" onClick={() => replaceCode(STARTER_CODE[language], 'the starter program')} disabled={active}>Reset</button>
      </div>

      <div className="console" role="log" aria-label="Console" aria-live="polite">
        <div className="console-head">
          <span className="label">Console</span>
          <button type="button" className="icon" onClick={() => setLog([])} aria-label="Clear the console">clear</button>
        </div>
        <div className="console-lines">
          {log.length === 0 && <div className="c-system">Press Run to start your program.</div>}
          {log.map((e) => <div key={e.id} className={`c-${e.kind}`}>{e.text}</div>)}
          <div ref={consoleEnd} />
        </div>
      </div>
    </section>
  );
}
