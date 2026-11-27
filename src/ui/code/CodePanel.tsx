import { useEffect, useRef, useState } from 'react';
import { useMovable } from '../layout.ts';
import { SizeGrip } from '../Movable.tsx';
import type { ConsoleEntry, Game, ProgramStatus } from '../../game/Game.ts';
import type { ProgramStore } from '../../game/save/ProgramStore.ts';
import { LANGUAGES, LANGUAGE_IDS } from '../../game/scripting/adapters.ts';
import { CONCEPTS, PYTHON_EXAMPLES, STARTER_CODE } from '../../game/scripting/templates.ts';
import { researchById } from '../../game/research/ResearchDefs.ts';
import type { LanguageId } from '../../game/scripting/types.ts';
import type { TutorialStep } from '../../game/tutorial/Tutorial.ts';
import { CodeEditor, type EditorApi } from './CodeEditor.tsx';
import { BlossomBranch, BlossomIcon, Petals } from '../Blossom.tsx';
import { LOGIN_EVENT } from '../DevMenu.tsx';
import { robotColor } from '../../game/robotColors.ts';

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
  /** Skills learned (ids). */
  skills: readonly string[];
  /** Robot names: with more than one, the player picks which robot a Run starts. */
  robots: readonly string[];
  /** Live numbers of the running program. */
  run: { delivered: number; seconds: number; lines: number } | null;
  /** Language, examples and mode: shown once the basics are done (a new player needs only code and Run). */
  extras: boolean;
  open: boolean;
  onToggle(): void;
}

/** The programming workspace: language, editor, run controls, tutorial and console. UI only; the game runs the code. */
export function CodePanel({ game, store, tutorial, showTutorial, skills, robots, run: runInfo, extras, open, onToggle }: Props) {
  const [target, setTarget] = useState<number | null>(null);
  const place = useMovable('code', { minW: 420, minH: 360 });
  const learned = new Set(skills);
  // skills learned while playing: their commands are marked NEW in the palette until it has been opened
  const known = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!known.current) { known.current = new Set(skills); return; }
    const added = skills.filter((k) => !known.current!.has(k));
    if (added.length) { known.current = new Set(skills); setFresh((f) => new Set([...f, ...added])); }
  }, [skills]);
  const [completions] = useState(() => game.commandReference().map((c) => ({ label: c.name, detail: `(${c.params.join(', ')})`, info: c.doc })));
  const [guided, setGuidedState] = useState(store.guided);
  useEffect(() => { game.setGuided(guided); }, [game, guided]);
  const setGuided = (on: boolean) => { store.setGuided(on); setGuidedState(on); };
  const [language, setLanguage] = useState<LanguageId>(store.language);
  const [code, setCode] = useState(() => store.code(store.language) ?? STARTER_CODE[store.language]);
  const [status, setStatus] = useState<ProgramStatus>(game.programStatus);
  const [doneRun, setDoneRun] = useState<number | null>(null); // a finished program lets petals fall
  const [log, setLog] = useState<ConsoleEntry[]>([]);
  const saveTimer = useRef<number>(0);
  const editor = useRef<EditorApi | null>(null);
  const [palette, setPalette] = useState(false);
  const [welcome, setWelcome] = useState(true);
  const consoleEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const offs = [
      game.events.on('program', (p) => { setStatus((prev) => { if (p.state === 'finished' && prev.state !== 'finished') setDoneRun(Date.now()); return p; }); }),
      game.events.on('console', (e) => setLog((l) => [...l.slice(-(CONSOLE_LIMIT - 1)), e])),
      game.events.on('insertCode', (snippet) => insert.current(snippet)),
    ];
    return () => offs.forEach((f) => f());
  }, [game]);

  useEffect(() => { consoleEnd.current?.scrollIntoView({ block: 'end' }); }, [log]);

  // save on edit (debounced) and when leaving the page
  const flush = useRef(() => {});
  flush.current = () => { window.clearTimeout(saveTimer.current); store.setCode(language, code, target); };
  useEffect(() => {
    const onHide = () => flush.current();
    window.addEventListener('beforeunload', onHide);
    return () => window.removeEventListener('beforeunload', onHide);
  }, []);

  const edit = (next: string) => {
    setCode(next);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => store.setCode(language, next, target), SAVE_DELAY);
  };

  const switchLanguage = (next: LanguageId) => {
    if (next === language) return;
    flush.current(); // the current language keeps its own program
    store.setLanguage(next);
    setLanguage(next);
    setCode(store.code(next, target) ?? store.code(next) ?? STARTER_CODE[next]);
  };

  const replaceCode = (next: string, what: string) => {
    if (next === code) return;
    if (!window.confirm(`Replace your current ${LANGUAGES[language].name} program with ${what}?`)) return;
    setCode(next);
    store.setCode(language, next, target);
  };

  /** Add a snippet to the program: below the cursor when the editor is open, else at the end. */
  const insert = useRef((_: string) => {});
  insert.current = (snippet: string) => {
    if (!open) onToggle();
    if (editor.current) { editor.current.insert(snippet); return; }
    edit(`${code.trimEnd()}\n${snippet}\n`);
  };

  /** Switch robot tab: the open program is saved under the old tab, the new tab's own program opens. */
  const pickTarget = (t: number | null) => {
    if (t === target) return;
    flush.current();
    setTarget(t);
    setCode(store.code(language, t) ?? store.code(language) ?? STARTER_CODE[language]);
  };

  const active = status.state === 'running' || status.state === 'paused';
  const run = () => { flush.current(); game.runProgram(language, code, target); };
  const step = () => { flush.current(); game.stepProgram(language, code, target); };
  const tutorialDone = tutorial.every((s) => s.done);
  const examples = PYTHON_EXAMPLES.filter((e) => !guided || e.skills.every((k) => learned.has(k)));
  const lockedExamples = PYTHON_EXAMPLES.length - examples.length;

  if (!open) {
    return <button type="button" className="code-tab" onClick={onToggle} aria-label="Open the program editor">{'</>'} Program</button>;
  }

  return (
    <section ref={place.ref} style={place.style} className={`panel code-panel ${place.moved ? 'moved' : ''}`} aria-label="Program editor">
      <Petals trigger={doneRun} />
      <SizeGrip m={place} label="the editor" />
      <header className="code-head" {...place.dragProps} title="Drag to move the editor. Double-click to dock it again.">
        <BlossomBranch className="code-blossom" length={90} seed={1} side="up" />
        <h2>Program</h2>
        <span className={`run-state rs-${status.state}`} role="status">
          {STATUS_LABEL[status.state]}{status.state === 'running' && status.line ? ` · line ${status.line}` : ''}
        </span>
        {runInfo && runInfo.delivered > 0 && <span className="run-stats" title="Items this run delivered to storage">{runInfo.delivered} delivered · {Math.round((runInfo.delivered / Math.max(1, runInfo.seconds)) * 60)}/min</span>}
        <button type="button" className="icon" onClick={onToggle} aria-label="Hide the program editor" title="Hide (P)">Hide</button>
      </header>

      {extras && <div className="code-bar unlock-in">
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
              {lockedExamples > 0 && <option disabled>{lockedExamples} more with new skills</option>}
            </select>
          </label>
        )}
        {language === 'python' && (
          <label title="Guided: Python features unlock as you buy skills, one idea at a time. Engineer: all of Python, right away.">
            <span className="label">Mode</span>
            <select value={guided ? 'guided' : 'engineer'} disabled={active} onChange={(e) => setGuided(e.target.value === 'guided')}>
              <option value="guided">Guided ({skills.filter((k) => researchById(k)?.code).length})</option>
              <option value="engineer">Engineer (all Python)</option>
            </select>
          </label>
        )}
      </div>}

      {robots.length > 1 && (
        <nav className="robot-tabs" role="tablist" aria-label="Which robot this program is for" title="Each robot can have its own program. Run starts this tab's program on its robot only.">
          {[null, ...robots.map((_, i) => i)].map((t) => (
            <button key={t ?? 'all'} type="button" role="tab" aria-selected={target === t} className={target === t ? 'on' : ''}
              style={t === null ? undefined : { ['--robot' as string]: robotColor(t) }} onClick={() => pickTarget(t)}>
              {t === null ? 'All robots' : <><i />{robots[t].replace(/^RW-\w+ /, '').replace(/"/g, '')}</>}
            </button>
          ))}
        </nav>
      )}
      {language === 'python' && (
        <button type="button" className={`palette-toggle ${palette ? 'on' : ''} ${fresh.size ? 'has-new' : ''}`} onClick={() => { if (palette) setFresh(new Set()); setPalette(!palette); }} aria-expanded={palette}>
          {palette ? 'Hide commands' : 'Commands & help'}
        </button>
      )}
      {palette && language === 'python' && <Palette game={game} store={store} code={code} selection={() => editor.current?.selection() ?? ''} learned={guided ? learned : null} fresh={fresh} onInsert={(c) => insert.current(c)} />}

      {!LANGUAGES[language].available && (
        <p className="code-note">{LANGUAGES[language].name} is still being built, so this program can't run yet. Your code here is saved separately. Switch to Python to run programs.</p>
      )}

      {showTutorial && !tutorialDone && !palette && language === 'python' && (welcome && !tutorial[0].done
        ? <Welcome onStart={() => setWelcome(false)} />
        : <Lesson steps={tutorial} onInsert={(c) => insert.current(c)} />)}

      <div className="code-body">
        <CodeEditor language={language} value={code} onChange={edit} onRun={() => !active && run()} readOnly={active}
          activeLine={active ? status.line : null} errorLine={status.state === 'error' ? status.errorLine : null} apiRef={editor} completions={completions} />
      </div>

      {(status.state === 'paused' || status.state === 'running') && (status.variables?.length ?? 0) > 0 && (
        <div className="vars" aria-label="Variables">
          <span className="label">Variables</span>
          {status.variables!.map(([k, v]) => <span key={k} className="var"><b>{k}</b> = <code>{v}</code></span>)}
        </div>
      )}
      <div className="code-actions">
        <button type="button" className="primary" onClick={run} disabled={active} title="Run (Ctrl+Enter)"><BlossomIcon />Run</button>
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
function Palette({ game, store, code, selection, learned, fresh, onInsert }: { game: Game; store: ProgramStore; code: string; selection(): string; learned: ReadonlySet<string> | null; fresh: ReadonlySet<string>; onInsert(code: string): void }) {
  const [library, setLibrary] = useState(store.library);
  const [commands] = useState(() => game.commandReference());
  const [q, setQ] = useState('');
  const match = (t: string) => t.toLowerCase().includes(q.trim().toLowerCase());
  const row = (key: string, code: string, doc: string, skill?: string) => {
    const locked = !!skill && !!learned && !learned.has(skill);
    return (
      <li key={key} className={`${locked ? 'locked' : ''} ${skill && fresh.has(skill) ? 'new' : ''}`}>
        <code>{skill && fresh.has(skill) && <span className="new-badge">NEW</span>}{code.split('\n')[0]}{code.includes('\n') ? ' ...' : ''}</code>
        <span className="doc">{doc}{locked && <em> Needs the {researchById(skill!)?.name} skill (Skills tab).</em>}</span>
        <button type="button" className="icon" disabled={locked} onClick={() => onInsert(code)}>Insert</button>
      </li>
    );
  };
  return (
    <div className="palette">
      <input type="search" placeholder="Search commands..." value={q} aria-label="Search commands"
        onChange={(e) => { setQ(e.target.value); if (e.target.value.trim().toLowerCase() === 'login') { setQ(''); window.dispatchEvent(new Event(LOGIN_EVENT)); } }} />
      <span className="label">My library</span>
      <ul>
        {library.filter((s) => match(s.name + s.code)).map((s) => (
          <li key={s.name}>
            <code>{s.name}</code>
            <span className="doc">{s.code.split('\n')[0].slice(0, 60)}</span>
            <span className="lib-buttons">
              <button type="button" className="icon" onClick={() => onInsert(s.code)}>Insert</button>
              <button type="button" className="icon" onClick={() => { store.removeSnippet(s.name); setLibrary(store.library); }} aria-label={`Delete ${s.name}`}>×</button>
            </span>
          </li>
        ))}
        {library.length === 0 && <li className="locked"><span className="doc">Save code you want to reuse: select lines in the editor (or nothing for the whole program) and press Save.</span></li>}
      </ul>
      <button type="button" className="icon lib-save" onClick={() => {
        const name = window.prompt('Name for this snippet (for example: make_kit)')?.trim();
        if (!name) return;
        store.saveSnippet(name, selection() || code);
        setLibrary(store.library);
      }}>Save selection to library</button>
      <span className="label">Robot commands</span>
      <ul>{commands.filter((c) => match(c.name + c.doc)).map((c) => row(c.name, c.example, c.doc, c.skill))}</ul>
      <span className="label">Python</span>
      <ul>{CONCEPTS.filter((c) => match(c.title + c.doc)).map((c) => row(c.title, c.code, c.doc, c.skill))}</ul>
    </div>
  );
}
