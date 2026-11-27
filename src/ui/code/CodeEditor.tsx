import { indentWithTab } from '@codemirror/commands';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
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
  '&': { height: '100%', backgroundColor: '#23180f', color: '#f4e8d2', fontSize: 'var(--code-font, 14px)' },
  '.cm-scroller': { scrollbarColor: '#6e4c33 #1c130c', fontFamily: "Consolas, 'Cascadia Mono', 'Courier New', monospace", lineHeight: '1.55' },
  '.cm-content': { caretColor: '#ffcf6e', padding: '6px 0' },
  '.cm-cursor': { borderLeftColor: '#ffcf6e', borderLeftWidth: '2px' },
  '.cm-gutters': { backgroundColor: '#1c130c', color: '#7a6048', border: 'none', borderRight: '1px solid #4a3324' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#c2a98b' },
  '.cm-activeLine': { backgroundColor: 'rgba(255, 207, 110, 0.05)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'rgba(217, 138, 78, 0.32) !important' },
  '.cm-exec-line': { backgroundColor: 'rgba(169, 207, 142, 0.16)', boxShadow: 'inset 3px 0 0 #a9cf8e' },
  '.cm-error-line': { backgroundColor: 'rgba(255, 112, 90, 0.16)', boxShadow: 'inset 3px 0 0 #ff705a' },
  '.cm-matchingBracket': { backgroundColor: 'rgba(255, 208, 98, 0.18)', outline: 'none' },
  '.cm-tooltip, .cm-tooltip-autocomplete': { backgroundColor: '#2b1e17', border: '1px solid #6e4c33', color: '#f4e8d2' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: '#4a3222', color: '#ffcf6e' },
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
  /** Filled with the editor's insert function, for the tutorial, command palette and inspector hints. */
  apiRef?: { current: EditorApi | null };
}

export interface EditorApi {
  /** Insert code below the cursor's line (or at the end if the player never placed the cursor), matching its indentation. */
  insert(code: string): void;
}

/** CodeMirror 6 wrapped for React. The editor owns its document; React only pushes language, markers and read-only state. */
export function CodeEditor({ language, value, onChange, onRun, readOnly, activeLine, errorLine, apiRef }: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const cbs = useRef({ onChange, onRun });
  cbs.current = { onChange, onRun };
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
        ],
      }),
    });
    view.current = v;
    if (apiRef) apiRef.current = { insert: (code) => insertBelow(v, code) };
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
