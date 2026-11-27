import { indentWithTab } from '@codemirror/commands';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { python, pythonLanguage } from '@codemirror/lang-python';
import type { CompletionContext } from '@codemirror/autocomplete';
import { HighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, keymap, type DecorationSet } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import { useEffect, useRef } from 'react';
import type { LanguageId } from '../../game/scripting/types.ts';

const LANG: Record<LanguageId, () => Extension> = {
  python: () => python(),
  java: () => java(),
  typescript: () => javascript({ typescript: true }),
};

/** Execution / error line markers, driven from outside the editor. */
const setMarks = StateEffect.define<{ active: number | null; error: number | null }>();
const marks = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setMarks)) continue;
      const out: ReturnType<Decoration['range']>[] = [];
      const { doc } = tr.state;
      const add = (line: number | null, cls: string) => {
        if (line && line >= 1 && line <= doc.lines) out.push(Decoration.line({ class: cls }).range(doc.line(line).from));
      };
      add(e.value.error, 'cm-error-line');
      add(e.value.active, 'cm-exec-line');
      deco = Decoration.set(out, true);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: '#18120d', color: '#f2e8d8', fontSize: 'var(--code-font, 14px)' },
  '.cm-scroller': { scrollbarColor: '#6e4c33 #1c130c', fontFamily: "Consolas, 'Cascadia Mono', 'Courier New', monospace", lineHeight: '1.55' },
  '.cm-content': { caretColor: '#f2c062', padding: '10px 0' },
  '.cm-cursor': { borderLeftColor: '#f2c062', borderLeftWidth: '2px' },
  '.cm-gutters': { backgroundColor: '#18120d', color: '#6e5a48', border: 'none', paddingLeft: '6px' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#f2c062' },
  '.cm-activeLine': { backgroundColor: 'rgba(242, 192, 98, 0.045)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'rgba(217, 138, 78, 0.32) !important' },
  '.cm-exec-line': { backgroundColor: 'rgba(143, 191, 108, 0.16)', boxShadow: 'inset 3px 0 0 #8fbf6c' },
  '.cm-error-line': { backgroundColor: 'rgba(226, 119, 94, 0.16)', boxShadow: 'inset 3px 0 0 #e2775e' },
  '.cm-matchingBracket': { backgroundColor: 'rgba(255, 208, 98, 0.18)', outline: 'none' },
  '.cm-tooltip, .cm-tooltip-autocomplete': { backgroundColor: '#2a1f17', border: '1px solid #5a4231', borderRadius: '6px', color: '#f2e8d8', overflow: 'hidden' },
  '.cm-tooltip.cm-completionInfo': { padding: '8px 10px', maxWidth: '320px', fontFamily: 'var(--ui-font)', fontSize: '12px', lineHeight: '1.45' },
  '.cm-completionDetail': { color: '#8f7d69', fontStyle: 'normal', marginLeft: '6px' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: '#3d2d21', color: '#f2c062' },
  '&.cm-focused': { outline: 'none' },
}, { dark: true });

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.modifier], color: '#f2955a' },
  { tag: [t.string, t.special(t.string)], color: '#b9d98a' },
  { tag: [t.number, t.bool, t.null], color: '#ffcf6e' },
  { tag: t.comment, color: '#9a8068', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#8fd0c0' },
  { tag: [t.definition(t.variableName), t.definition(t.function(t.variableName))], color: '#ffe7a8' },
  { tag: [t.operator, t.punctuation, t.bracket], color: '#c2a98b' },
  { tag: [t.typeName, t.className], color: '#c7a6ff' },
  { tag: t.variableName, color: '#f4e8d2' },
]);

export interface CodeEditorProps {
  /** Changing the language swaps in `value` as the new document. */
  language: LanguageId;
  value: string;
  onChange(code: string): void;
  onRun(): void;
  readOnly: boolean;
  activeLine: number | null;
  errorLine: number | null;
  /** Robot commands offered while typing (Python), with their one-line help. */
  completions?: { label: string; detail: string; info: string }[];
  /** Filled with the editor's insert function, for the tutorial, command palette and inspector hints. */
  apiRef?: { current: EditorApi | null };
}

export interface EditorApi {
  /** Insert code below the cursor's line (or at the end if the player never placed the cursor), matching its indentation. */
  insert(code: string): void;
  /** The selected text, or '' when nothing is selected. */
  selection(): string;
}

/** CodeMirror 6 wrapped for React. The editor owns its document; React only pushes language, markers and read-only state. */
export function CodeEditor({ language, value, onChange, onRun, readOnly, activeLine, errorLine, apiRef, completions }: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const cbs = useRef({ onChange, onRun, completions });
  cbs.current = { onChange, onRun, completions };
  const comps = useRef({ lang: new Compartment(), ro: new Compartment() });

  useEffect(() => {
    const { lang, ro } = comps.current;
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup, theme, syntaxHighlighting(highlight), marks, indentUnit.of('    '), EditorView.lineWrapping,
          keymap.of([{ key: 'Mod-Enter', run: () => { cbs.current.onRun(); return true; } }, indentWithTab]),
          lang.of(LANG[language]()), ro.of(EditorState.readOnly.of(readOnly)),
          EditorView.updateListener.of((u) => { if (u.docChanged) cbs.current.onChange(u.state.doc.toString()); }),
          EditorView.contentAttributes.of({ 'aria-label': 'Program code' }),
          // the robot's commands, offered as the player types a name
          pythonLanguage.data.of({ autocomplete: (ctx: CompletionContext) => {
            const word = ctx.matchBefore(/\w+/);
            if (!word || (word.from === word.to && !ctx.explicit)) return null;
            return { from: word.from, options: (cbs.current.completions ?? []).map((c) => ({ ...c, type: 'function', apply: `${c.label}()` })) };
          } }),
        ],
      }),
    });
    view.current = v;
    if (apiRef) apiRef.current = { insert: (code) => insertBelow(v, code), selection: () => { const r = v.state.selection.main; return v.state.sliceDoc(r.from, r.to); } };
    return () => { v.destroy(); view.current = null; if (apiRef) apiRef.current = null; };
    // created once; later prop changes are applied by the effects below
  }, []);

  // language switch: new document and grammar
  const shownLang = useRef(language);
  useEffect(() => {
    const v = view.current;
    if (!v || shownLang.current === language) return;
    shownLang.current = language;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value }, effects: comps.current.lang.reconfigure(LANG[language]()) });
  }, [language, value]);

  // external replacement of the same language's code (Reset, Examples)
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value && shownLang.current === language) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    }
  }, [value, language]);

  useEffect(() => { view.current?.dispatch({ effects: comps.current.ro.reconfigure(EditorState.readOnly.of(readOnly)) }); }, [readOnly]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    v.dispatch({ effects: setMarks.of({ active: activeLine, error: errorLine }) });
    const line = activeLine ?? errorLine;
    if (line && line <= v.state.doc.lines) v.dispatch({ effects: EditorView.scrollIntoView(v.state.doc.line(line).from, { y: 'nearest' }) });
  }, [activeLine, errorLine]);

  return <div ref={host} className="code-editor" />;
}

function insertBelow(v: EditorView, code: string): void {
  const { state } = v, head = state.selection.main.head;
  let line = head === 0 ? state.doc.line(state.doc.lines) : state.doc.lineAt(head);
  // skip back over trailing blank lines at the end so snippets join the program
  while (head === 0 && line.number > 1 && !line.text.trim()) line = state.doc.line(line.number - 1);
  let indent = /^\s*/.exec(line.text)![0];
  if (line.text.trimEnd().endsWith(':')) indent += '    ';
  const body = code.split('\n').map((l) => (l ? indent + l : l)).join('\n');
  const blank = !line.text.trim();
  const from = blank ? line.from : line.to, insert = blank ? body : '\n' + body;
  v.dispatch({ changes: { from, to: line.to, insert }, selection: { anchor: from + insert.length }, scrollIntoView: true });
  v.focus();
}
