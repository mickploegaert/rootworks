import { useEffect, useRef, useState } from 'react';
import type { ConsoleEntry, Game, ProgramStatus } from '../../game/Game.ts';
import type { ProgramStore } from '../../game/save/ProgramStore.ts';
import { LANGUAGES, LANGUAGE_IDS } from '../../game/scripting/adapters.ts';
import { CONCEPTS, PYTHON_EXAMPLES, STARTER_CODE } from '../../game/scripting/templates.ts';
import { FIRMWARE_NAMES } from '../../game/scripting/hostApi.ts';
import type { LanguageId } from '../../game/scripting/types.ts';
import type { TutorialStep } from '../../game/tutorial/Tutorial.ts';
import { CodeEditor, type EditorApi } from './CodeEditor.tsx';

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
  const editor = useRef<EditorApi | null>(null);
  const [palette, setPalette] = useState(false);
  const [welcome, setWelcome] = useState(true);
  const consoleEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const offs = [
      game.events.on('program', setStatus),
      game.events.on('console', (e) => setLog((l) => [...l.slice(-(CONSOLE_LIMIT - 1)), e])),
      game.events.on('insertCode', (snippet) => insert.current(snippet)),
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

  /** Add a snippet to the program: below the cursor when the editor is open, else at the end. */
  const insert = useRef((_: string) => {});
  insert.current = (snippet: string) => {
    if (!open) onToggle();
    if (editor.current) { editor.current.insert(snippet); return; }
    edit(`${code.trimEnd()}\n${snippet}\n`);
  };

  const active = status.state === 'running' || status.state === 'paused';
  const run = () => { flush.current(); game.runProgram(language, code); };
  const step = () => { flush.current(); game.stepProgram(language, code); };
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

      {language === 'python' && (
        <button type="button" className={`palette-toggle ${palette ? 'on' : ''}`} onClick={() => setPalette(!palette)} aria-expanded={palette}>
          {palette ? 'Hide commands' : 'Commands & help'}
        </button>
      )}
      {palette && language === 'python' && <Palette game={game} firmware={guided ? firmware : 99} onInsert={(c) => insert.current(c)} />}

      {!LANGUAGES[language].available && (
        <p className="code-note">{LANGUAGES[language].name} is still being built, so this program can't run yet. Your code here is saved separately. Switch to Python to run programs.</p>
      )}

      {showTutorial && !tutorialDone && !palette && language === 'python' && (welcome && !tutorial[0].done
        ? <Welcome onStart={() => setWelcome(false)} />
        : <Lesson steps={tutorial} onInsert={(c) => insert.current(c)} />)}

      <div className="code-body">
        <CodeEditor language={language} value={code} onChange={edit} onRun={() => !active && run()} readOnly={active}
          activeLine={active ? status.line : null} errorLine={status.state === 'error' ? status.errorLine : null} apiRef={editor} />
      </div>

      <div className="code-actions">
        <button type="button" className="primary" onClick={run} disabled={active} title="Run (Ctrl+Enter)">Run</button>
        {status.state === 'paused'
          ? <button type="button" onClick={() => game.resumeProgram()}>Resume</button>
          : <button type="button" onClick={() => game.pauseProgram()} disabled={status.state !== 'running'}>Pause</button>}
        <button type="button" onClick={step} disabled={status.state === 'running'} title="Run one line, then pause: see exactly what each line does">Step</button>
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

/** First contact: who the robot is, what the player is here for, and what to do first. */
function Welcome({ onStart }: { onStart(): void }) {
  return (
    <div className="welcome" role="note">
      <b>Meet Seedling</b>
      <p>Seedling is a salvaged robot, and your only helper in this overgrown valley. You can't pick things up yourself: you <em>write programs</em>, and Seedling carries them out, line by line.</p>
      <p>Your goal: gather resources, build machines and research new tricks, until the valley runs by itself.</p>
      <button type="button" className="primary" onClick={onStart}>Show me the first lesson</button>
    </div>
  );
}

/** The current lesson only: what, why, how, and the code to try. Earlier and later steps stay folded away. */
function Lesson({ steps, onInsert }: { steps: TutorialStep[]; onInsert(code: string): void }) {
  const [all, setAll] = useState(false);
  const i = steps.findIndex((s) => !s.done), s = steps[i];
  if (!s) return null;
  return (
    <section className="lesson" aria-label="Tutorial">
      <div className="lesson-head">
        <span className="label">Lesson {i + 1} of {steps.length}</span>
        <span className="dots" aria-hidden>{steps.map((x, k) => <i key={x.id} className={x.done ? 'done' : k === i ? 'now' : ''} />)}</span>
        <button type="button" className="icon" onClick={() => setAll(!all)} aria-expanded={all}>{all ? 'less' : 'all'}</button>
      </div>
      <b className="lesson-goal">{s.label}</b>
      <p className="lesson-why">{s.why}</p>
      <p className="lesson-how">{s.how}</p>
      {s.code && (
        <div className="snippet">
          <pre>{s.code}</pre>
          <button type="button" onClick={() => onInsert(s.code!)} title="Add this code to your program">Insert</button>
        </div>
      )}
      {all && (
        <ol className="lesson-all">
          {steps.map((x) => <li key={x.id} className={x.done ? 'done' : ''}>{x.label}</li>)}
        </ol>
      )}
    </section>
  );
}

/** Every command and Python idea, with what it does and a ready example. Locked ones say what unlocks them. */
function Palette({ game, firmware, onInsert }: { game: Game; firmware: number; onInsert(code: string): void }) {
  const [commands] = useState(() => game.commandReference());
  const [q, setQ] = useState('');
  const match = (t: string) => t.toLowerCase().includes(q.trim().toLowerCase());
  const row = (key: string, code: string, doc: string, tier: number) => {
    const locked = tier > firmware;
    return (
      <li key={key} className={locked ? 'locked' : ''}>
        <code>{code.split('\n')[0]}{code.includes('\n') ? ' ...' : ''}</code>
        <span className="doc">{doc}{locked && <em> Unlocks with {FIRMWARE_NAMES[tier]} firmware (T{tier}).</em>}</span>
        <button type="button" className="icon" disabled={locked} onClick={() => onInsert(code)}>Insert</button>
      </li>
    );
  };
  return (
    <div className="palette">
      <input type="search" placeholder="Search commands..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search commands" />
      <span className="label">Robot commands</span>
      <ul>{commands.filter((c) => match(c.name + c.doc)).map((c) => row(c.name, c.example, c.doc, c.tier))}</ul>
      <span className="label">Python</span>
      <ul>{CONCEPTS.filter((c) => match(c.title + c.doc)).map((c) => row(c.title, c.code, c.doc, c.tier))}</ul>
    </div>
  );
}
