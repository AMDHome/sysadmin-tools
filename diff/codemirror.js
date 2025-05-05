import { EditorView, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor,
        rectangularSelection, crosshairCursor, highlightActiveLine, keymap, Decoration, ViewPlugin } 
        from "https://cdn.jsdelivr.net/npm/@codemirror/view@6.36.3/+esm";
import { EditorState, RangeSetBuilder, StateEffect } from"https://cdn.jsdelivr.net/npm/@codemirror/state@6.5.2/+esm";
import { foldGutter, indentOnInput, syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldKeymap }
        from "https://cdn.jsdelivr.net/npm/@codemirror/language@6.11.0/+esm";
import { history, defaultKeymap, historyKeymap }
        from "https://cdn.jsdelivr.net/npm/@codemirror/commands@6.8.1/+esm";
import { highlightSelectionMatches, searchKeymap }
        from "https://cdn.jsdelivr.net/npm/@codemirror/search@6.5.10/+esm";
import { lintKeymap } from "https://cdn.jsdelivr.net/npm/@codemirror/lint@6.8.5/+esm";
import { diffWordsWithSpace } from "https://cdn.jsdelivr.net/npm/diff@7.0.0/+esm";

// Run basic Configuration
const basicSetup = (() => [lineNumbers(),
                           highlightActiveLineGutter(),
                           highlightSpecialChars(),
                           history(),
                           foldGutter(),
                           drawSelection(),
                           dropCursor(),
                           EditorState.allowMultipleSelections.of(!0),
                           indentOnInput(),
                           syntaxHighlighting(defaultHighlightStyle, {fallback:!0}),
                           bracketMatching(),
                           rectangularSelection(),
                           crosshairCursor(),
                           highlightActiveLine(),
                           highlightSelectionMatches(),
                           keymap.of([...defaultKeymap,
                                      ...searchKeymap,
                                      ...historyKeymap,
                                      ...foldKeymap,
                                      ...lintKeymap])
                          ])();

// Effect to update diff highlights
export const setDiffEffect = StateEffect.define();

function createDiffPlugin(side) {
    return ViewPlugin.fromClass(class {
        constructor(view) {
            this.side = side;
            this.decorations = Decoration.none;
            this.paddedLines = null;
        }

        update(update) {
            for (const tr of update.transactions) {
                for (const effect of tr.effects) {
                    if (effect.is(setDiffEffect)) {
                        this.decorations = Decoration.none;
                        const computedDeco = buildDecorations(update.view, effect.value.diffResult, this.side);
                        this.decorations = computedDeco.decorations;
                        this.paddedLines = computedDeco.paddedLines;
                        return;
                    }
                }
            }
            if (this.decorations !== Decoration.none && update.docChanged) {
                this.decorations = this.decorations.map(update.changes);
                const doc = update.state.doc;
                const dirtyDecos = [];

                update.changes.iterChanges((fromA, toA, fromB, toB) => {
                    const startLine = doc.lineAt(fromB).number;
                    const endLine = doc.lineAt(toB).number;

                    for (let i = startLine; i <= endLine; i++) {
                        const line = update.state.doc.line(i);
                        dirtyDecos.push(Decoration.line({ class: "line-dirty" }).range(line.from));
                    }
                });

                if (dirtyDecos.length) {
                    this.decorations = this.decorations.update({ add: dirtyDecos });
                }
            }
        }
    }, {
        decorations: v => v.decorations
    });
}

function buildDecorations(view, diffResult, side) {
    const builder = new RangeSetBuilder();
    const docLineCount = view.state.doc.lines;
    const paddedLines = new Set();

    for (let i = 0; i < diffResult.length; i++) {
        // Get Current line & line number
        const line = diffResult[i];
        const lineNum = view.state.doc.line(i + 1);
        const text = view.state.doc.sliceString(lineNum.from, lineNum.to);

        // Mark Lines
        if(line.status === "inserted") {
            builder.add(lineNum.from, lineNum.from, Decoration.line({ class: (side === "left") ? "line-empty" : "line-inserted" }));
            if (side === "left") paddedLines.add(i);
        } else if (line.status === "removed") {
            builder.add(lineNum.from, lineNum.from, Decoration.line({ class: (side === "left") ? "line-deleted" : "line-empty" }));
            if (side === "right") paddedLines.add(i);
        } else if (line.status === "changed") {
            builder.add(lineNum.from, lineNum.from, Decoration.line({ class: (side === "left") ? "line-deleted" : "line-inserted" }));
        }

        // Mark changes w/ word diff
        if (line.status === "changed") {
            const diffs = diffWordsWithSpace(line.lineA, line.lineB);
            let pos = 0;

            for (const token of diffs) {
                const len = token.value.length;
                if ((side === "left" && token.removed) || (side === "right" && token.added)) {
                    builder.add(lineNum.from + pos, lineNum.from + pos + len, Decoration.mark({ class: token.removed ? "word-deleted" : "word-inserted" }));
                    pos += len;
                } else if (!token.added && !token.removed) {
                    pos += len;
                }
            }
        }
    }

    return { decorations: builder.finish(), paddedLines };
}

export const leftDiffPlugin = createDiffPlugin("left");
export const rightDiffPlugin = createDiffPlugin("right");

// Setup CM Editors
window.leftEditor = new EditorView({
    doc: "",
    extensions: [basicSetup, EditorView.lineWrapping, leftDiffPlugin],
    parent: document.getElementById("left-container")
})

window.rightEditor = new EditorView({
    doc: "",
    extensions: [basicSetup, EditorView.lineWrapping, rightDiffPlugin],
    parent: document.getElementById("right-container")
})